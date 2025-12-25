#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { generateDtsBundle } from 'dts-bundle-generator'
import * as esbuild from 'esbuild'
import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function parseArgs() {
  const args = process.argv.slice(2)
  if (args.length !== 2) {
    console.error('Usage: prepare-npm-package.mjs <package-path> <output-dir>')
    console.error('  package-path: path to the package (e.g., modules/foo)')
    console.error('  output-dir: directory where the npm-publishable structure will be created')
    process.exit(1)
  }
  return {
    packagePath: path.resolve(REPO_ROOT, args[0]),
    outputDir: path.resolve(args[1]),
  }
}

function getWorkspacesInfo() {
  const output = execSync('yarn -s workspaces info --json', { cwd: REPO_ROOT, encoding: 'utf-8' })
  return JSON.parse(output)
}

function buildWorkspaceIndex(workspacesInfo) {
  const packageNames = new Set(Object.keys(workspacesInfo))
  const locationToName = new Map()
  const nameToLocation = new Map()

  for (const [name, info] of Object.entries(workspacesInfo)) {
    const fullLocation = path.join(REPO_ROOT, info.location)
    locationToName.set(fullLocation, name)
    nameToLocation.set(name, fullLocation)
  }

  return { packageNames, locationToName, nameToLocation, workspacesInfo }
}

function readPackageJson(packagePath) {
  const packageJsonPath = path.join(packagePath, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at ${packageJsonPath}`)
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))
}

function collectAllInRepoDeps(packageName, workspaceIndex, visited = new Set()) {
  const { workspacesInfo } = workspaceIndex
  const info = workspacesInfo[packageName]

  if (!info) {
    return visited
  }

  for (const depName of info.workspaceDependencies) {
    if (!visited.has(depName)) {
      visited.add(depName)
      collectAllInRepoDeps(depName, workspaceIndex, visited)
    }
  }

  return visited
}

function collectThirdPartyDeps(packagePath, inRepoDeps, workspaceIndex) {
  const { packageNames, nameToLocation } = workspaceIndex
  const allThirdParty = new Map()

  const allPaths = [packagePath, ...[...inRepoDeps].map(dep => nameToLocation.get(dep)).filter(Boolean)]

  for (const depPath of allPaths) {
    const pkg = readPackageJson(depPath)
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      if (packageNames.has(name)) continue

      const existingVersion = allThirdParty.get(name)
      if (existingVersion !== undefined && existingVersion !== version) {
        throw new Error(`Version conflict for dependency "${name}": found "${existingVersion}" and "${version}"`)
      }
      allThirdParty.set(name, version)
    }
  }

  return Object.fromEntries(allThirdParty)
}

function createOutputPackageJson(originalPkg, thirdPartyDeps) {
  const outputPkg = {
    name: originalPkg.name,
    version: originalPkg.version,
    description: originalPkg.description || '',
    license: originalPkg.license === 'UNLICENSED' ? 'MIT' : originalPkg.license,
    author: originalPkg.author || '',
    type: 'module',
    main: 'index.js',
    types: 'index.d.ts',
    files: ['index.js', 'index.d.ts'],
    dependencies: thirdPartyDeps,
  }

  if (!outputPkg.description) delete outputPkg.description
  if (!outputPkg.author) delete outputPkg.author
  if (Object.keys(outputPkg.dependencies).length === 0) delete outputPkg.dependencies

  return outputPkg
}

async function bundleWithEsbuild(entryPoint, outputPath, externalDeps) {
  await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    outfile: outputPath,
    external: externalDeps,
    sourcemap: false,
    minify: false,
    keepNames: true,
  })
}

function bundleTypeDeclarations(packagePath, inRepoDeps, outputDir) {
  const entryPoint = path.join(packagePath, 'src', 'index.ts')
  if (!fs.existsSync(entryPoint)) {
    fs.writeFileSync(path.join(outputDir, 'index.d.ts'), '// Type declarations not available\nexport {}\n')
    return
  }

  // Create a temporary tsconfig with moduleResolution: "node" because dts-bundle-generator
  // doesn't support moduleResolution: "bundler" which is used in this repo
  const tempTsconfig = path.join(REPO_ROOT, '.temp-dts-tsconfig.json')
  fs.writeFileSync(
    tempTsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          module: 'ES2022',
          moduleResolution: 'node',
          target: 'ES2022',
          declaration: true,
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: ['node'],
        },
        include: [path.join(packagePath, 'src', '**', '*')],
      },
      null,
      2,
    ),
  )

  try {
    const [bundledDts] = generateDtsBundle(
      [
        {
          filePath: entryPoint,
          libraries: {
            inlinedLibraries: [...inRepoDeps],
          },
          output: {
            noBanner: true,
          },
        },
      ],
      {
        preferredConfigPath: tempTsconfig,
      },
    )

    fs.writeFileSync(path.join(outputDir, 'index.d.ts'), bundledDts)
  } finally {
    fs.rmSync(tempTsconfig, { force: true })
  }
}

async function main() {
  const { packagePath, outputDir } = parseArgs()

  console.log(`Preparing npm package from: ${packagePath}`)
  console.log(`Output directory: ${outputDir}`)

  console.log('Fetching workspace info from yarn...')
  const workspacesInfo = getWorkspacesInfo()
  const workspaceIndex = buildWorkspaceIndex(workspacesInfo)

  const packageName = workspaceIndex.locationToName.get(packagePath)
  if (!packageName) {
    throw new Error(
      `Package at ${packagePath} is not a yarn workspace. Known workspaces: ${[
        ...workspaceIndex.locationToName.keys(),
      ].join(', ')}`,
    )
  }

  const packageJson = readPackageJson(packagePath)
  console.log(`Package: ${packageJson.name}`)

  const entryPoint = path.join(packagePath, packageJson.main || 'dist/src/index.js')
  if (!fs.existsSync(entryPoint)) {
    throw new Error(`Entry point not found: ${entryPoint}. Did you run 'yarn build'?`)
  }

  const inRepoDeps = collectAllInRepoDeps(packageName, workspaceIndex)
  console.log(`In-repo dependencies (will be bundled): ${inRepoDeps.size > 0 ? [...inRepoDeps].join(', ') : 'none'}`)

  const thirdPartyDeps = collectThirdPartyDeps(packagePath, inRepoDeps, workspaceIndex)
  const thirdPartyList = Object.keys(thirdPartyDeps)
  console.log(
    `Third-party dependencies (will be external): ${thirdPartyList.length > 0 ? thirdPartyList.join(', ') : 'none'}`,
  )

  fs.mkdirSync(outputDir, { recursive: true })

  const bundledJsPath = path.join(outputDir, 'index.js')
  console.log('Bundling JavaScript...')
  await bundleWithEsbuild(entryPoint, bundledJsPath, thirdPartyList)

  console.log('Bundling type declarations...')
  bundleTypeDeclarations(packagePath, inRepoDeps, outputDir)

  const outputPackageJson = createOutputPackageJson(packageJson, thirdPartyDeps)
  fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(outputPackageJson, null, 2) + '\n')

  console.log('\nDone! Output structure:')
  console.log(`  ${outputDir}/`)
  console.log('    ├── index.js')
  console.log('    ├── index.d.ts')
  console.log('    └── package.json')
  console.log('\nTo publish:')
  console.log(`  cd ${outputDir}`)
  console.log('  npm publish')
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
