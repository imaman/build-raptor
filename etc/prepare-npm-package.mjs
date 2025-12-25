#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { generateDtsBundle } from 'dts-bundle-generator'
import * as esbuild from 'esbuild'
import * as fs from 'node:fs'
import * as path from 'node:path'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

function parseArgs() {
  const args = process.argv.slice(2)
  const excludePackages = new Set()
  const positionalArgs = []

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--exclude') {
      if (i + 1 >= args.length) {
        console.error('Error: --exclude requires a package name')
        process.exit(1)
      }
      excludePackages.add(args[++i])
    } else {
      positionalArgs.push(args[i])
    }
  }

  if (positionalArgs.length !== 2) {
    console.error('Usage: prepare-npm-package.mjs <package-path> <output-dir> [--exclude <package-name>]...')
    console.error('  package-path: path to the package (e.g., modules/foo)')
    console.error('  output-dir: directory where the npm-publishable structure will be created')
    console.error('  --exclude: in-repo package to treat as external (can be specified multiple times)')
    process.exit(1)
  }

  return {
    packagePath: path.resolve(REPO_ROOT, positionalArgs[0]),
    outputDir: path.resolve(positionalArgs[1]),
    excludePackages,
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

function collectThirdPartyDeps(packagePath, inRepoDeps, workspaceIndex, excludedInRepoDeps) {
  const { packageNames, nameToLocation } = workspaceIndex
  const allThirdParty = new Map()

  const allPaths = [packagePath, ...[...inRepoDeps].map(dep => nameToLocation.get(dep)).filter(Boolean)]

  for (const depPath of allPaths) {
    const pkg = readPackageJson(depPath)
    for (const [name, version] of Object.entries(pkg.dependencies || {})) {
      // Skip in-repo deps that will be bundled (but include excluded ones)
      if (packageNames.has(name) && !excludedInRepoDeps.has(name)) continue

      const existingVersion = allThirdParty.get(name)
      if (existingVersion !== undefined && existingVersion !== version) {
        throw new Error(`Version conflict for dependency "${name}": found "${existingVersion}" and "${version}"`)
      }
      allThirdParty.set(name, version)
    }
  }

  return Object.fromEntries(allThirdParty)
}

function normalizeBinField(bin, packageName) {
  if (!bin) return {}

  if (typeof bin === 'string') {
    // Single bin: use package name (without scope) as the command name
    const cmdName = packageName.replace(/^@[^/]+\//, '')
    return { [cmdName]: bin }
  }

  return bin
}

function createOutputPackageJson(originalPkg, thirdPartyDeps, binScripts) {
  const files = ['index.js', 'index.d.ts']

  // Add bin scripts to files
  for (const outputPath of Object.values(binScripts)) {
    if (!files.includes(outputPath)) {
      files.push(outputPath)
    }
  }

  const outputPkg = {
    name: originalPkg.name,
    version: originalPkg.version,
    description: originalPkg.description || '',
    license: originalPkg.license === 'UNLICENSED' ? 'MIT' : originalPkg.license,
    author: originalPkg.author || '',
    type: 'module',
    main: 'index.js',
    types: 'index.d.ts',
    files,
    dependencies: thirdPartyDeps,
  }

  // Add bin field if there are bin scripts
  if (Object.keys(binScripts).length > 0) {
    outputPkg.bin = binScripts
  }

  if (!outputPkg.description) delete outputPkg.description
  if (!outputPkg.author) delete outputPkg.author
  if (Object.keys(outputPkg.dependencies).length === 0) delete outputPkg.dependencies

  return outputPkg
}

async function bundleWithEsbuild(entryPoint, outputPath, externalDeps, options = {}) {
  const { banner } = options
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
    ...(banner && { banner: { js: banner } }),
  })
}

async function bundleBinScripts(packagePath, binField, packageName, outputDir, externalDeps) {
  const normalizedBin = normalizeBinField(binField, packageName)
  const outputBin = {}

  for (const [cmdName, srcPath] of Object.entries(normalizedBin)) {
    const entryPoint = path.join(packagePath, srcPath)
    if (!fs.existsSync(entryPoint)) {
      throw new Error(`Bin script not found: ${entryPoint}`)
    }

    const outputFileName = `${cmdName}.js`
    const outputPath = path.join(outputDir, outputFileName)

    // Check if source already has a shebang
    const sourceContent = fs.readFileSync(entryPoint, 'utf-8')
    const hasShebang = sourceContent.startsWith('#!')

    console.log(`  Bundling bin script: ${cmdName}...`)
    await bundleWithEsbuild(entryPoint, outputPath, externalDeps, {
      banner: hasShebang ? undefined : '#!/usr/bin/env node',
    })

    outputBin[cmdName] = outputFileName
  }

  return outputBin
}

function bundleTypeDeclarations(packagePath, inRepoDeps, outputDir) {
  const entryPoint = path.join(packagePath, 'src', 'index.ts')

  // Check if index.ts exists and has actual exports
  if (!fs.existsSync(entryPoint)) {
    copyFallbackDts(packagePath, outputDir)
    return
  }

  const sourceContent = fs.readFileSync(entryPoint, 'utf-8')
  const hasExports = /\bexport\b/.test(sourceContent)
  if (!hasExports) {
    console.log('  src/index.ts has no exports, skipping dts-bundle-generator')
    copyFallbackDts(packagePath, outputDir)
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

function copyFallbackDts(packagePath, outputDir) {
  const compiledDts = path.join(packagePath, 'dist', 'src', 'index.d.ts')
  if (fs.existsSync(compiledDts)) {
    fs.copyFileSync(compiledDts, path.join(outputDir, 'index.d.ts'))
  } else {
    fs.writeFileSync(path.join(outputDir, 'index.d.ts'), '// Type declarations not available\nexport {}\n')
  }
}

async function main() {
  const { packagePath, outputDir, excludePackages } = parseArgs()

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

  // Collect all in-repo deps, then separate into bundled vs excluded
  const allInRepoDeps = collectAllInRepoDeps(packageName, workspaceIndex)

  // Validate --exclude package names
  for (const excludedPkg of excludePackages) {
    if (!workspaceIndex.packageNames.has(excludedPkg)) {
      throw new Error(`Invalid --exclude package "${excludedPkg}": not a workspace package`)
    }
    if (!allInRepoDeps.has(excludedPkg)) {
      throw new Error(`Invalid --exclude package "${excludedPkg}": not a dependency of ${packageName}`)
    }
  }

  const excludedInRepoDeps = new Set([...allInRepoDeps].filter(dep => excludePackages.has(dep)))
  const inRepoDeps = new Set([...allInRepoDeps].filter(dep => !excludePackages.has(dep)))

  console.log(`In-repo dependencies (will be bundled): ${inRepoDeps.size > 0 ? [...inRepoDeps].join(', ') : 'none'}`)
  if (excludedInRepoDeps.size > 0) {
    console.log(`In-repo dependencies (excluded, will be external): ${[...excludedInRepoDeps].join(', ')}`)
  }

  const thirdPartyDeps = collectThirdPartyDeps(packagePath, allInRepoDeps, workspaceIndex, excludedInRepoDeps)
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

  // Bundle bin scripts if present
  let binScripts = {}
  if (packageJson.bin) {
    console.log('Bundling bin scripts...')
    binScripts = await bundleBinScripts(packagePath, packageJson.bin, packageJson.name, outputDir, thirdPartyList)
  }

  const outputPackageJson = createOutputPackageJson(packageJson, thirdPartyDeps, binScripts)
  fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(outputPackageJson, null, 2) + '\n')

  const binFiles = Object.values(binScripts)
  console.log('\nDone! Output structure:')
  console.log(`  ${outputDir}/`)
  console.log('    ├── index.js')
  console.log('    ├── index.d.ts')
  for (const binFile of binFiles) {
    console.log(`    ├── ${binFile}`)
  }
  console.log('    └── package.json')
  console.log('\nTo publish:')
  console.log(`  cd ${outputDir}`)
  console.log('  npm publish')
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
