import { BuildFailedError } from 'build-failed-error'
import escapeStringRegexp from 'escape-string-regexp'
import execa from 'execa'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import {
  DirectoryScanner,
  failMe,
  Graph,
  hardGet,
  pairsToRecord,
  promises,
  shouldNeverHappen,
  switchOn,
  TypedPublisher,
  uniqueBy,
} from 'misc'
import * as path from 'path'
import { ExitStatus, Publisher, RepoProtocol, RepoProtocolEvent } from 'repo-protocol'
import { CatalogOfTasks } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import * as Tmp from 'tmp-promise'
import { PackageJson, TsConfigJson } from 'type-fest'
import { UnitId, UnitMetadata } from 'unit-metadata'
import webpack, { Stats, WebpackPluginInstance } from 'webpack'
import ShebangPlugin from 'webpack-shebang-plugin'
import { z } from 'zod'

import { JestJson } from './jest-json'

const yarnWorkspacesInfoSchema = z.record(
  z.object({
    location: z.string(),
    workspaceDependencies: z.string().array(),
    mismatchedWorkspaceDependencies: z.string().array(),
  }),
)

type YarnWorkspacesInfo = z.infer<typeof yarnWorkspacesInfoSchema>

interface State {
  readonly yarnInfo: YarnWorkspacesInfo
  readonly graph: Graph<UnitId>
  readonly rootDir: string
  readonly units: UnitMetadata[]
  readonly packageByUnitId: Map<UnitId, PackageJson>
  readonly versionByPackageId: Map<string, string>
  readonly publisher: TypedPublisher<RepoProtocolEvent>
}

async function getTempFile() {
  const ret = (await Tmp.file()).path
  return ret
}

function isSimpleName(fileName: string) {
  return path.basename(fileName) === fileName
}

export class YarnRepoProtocol implements RepoProtocol {
  private readonly scriptNames = {
    build: 'build',
    validate: 'validate',
    prepareAssets: 'prepare-assets',
  }

  private readonly src = 'src'
  private readonly tests = 'tests'

  constructor(
    private readonly logger: Logger,
    private readonly shadowing: boolean = false,
    // TODO(imaman): deprecate it.
    private readonly publisher?: Publisher,
  ) {
    if (!isSimpleName(this.tsconfigBaseName)) {
      throw new Error(`tsconfig base file name must be a simple name (not a path). Got: "${this.tsconfigBaseName}"`)
    }
  }

  private readonly tsconfigBaseName: string = 'tsconfig-base.json'
  private state_: State | undefined

  private dist(which?: 't' | 's') {
    const d = `dist`
    return which === undefined
      ? d
      : which === 's'
      ? `${d}/${this.src}`
      : which === 't'
      ? `${d}/${this.tests}`
      : shouldNeverHappen(which)
  }

  private get state() {
    return this.state_ ?? failMe('state was not set')
  }

  private hasRunScript(unitId: UnitId, runScript: string) {
    const pj = this.getPackageJson(unitId)
    const runScripts = Object.keys(pj.scripts ?? {})
    return runScripts.includes(runScript)
  }

  async initialize(rootDir: string, publisher: TypedPublisher<RepoProtocolEvent>): Promise<void> {
    const yarnInfo = await this.getYarnInfo(rootDir)

    const units = computeUnits(yarnInfo)
    const packageByUnitId = await readPackages(rootDir, units)
    const versionByPackageId = computeVersions([...packageByUnitId.values()])

    const violations: [UnitId, UnitId][] = []
    const graph = new Graph<UnitId>(x => x)
    for (const [p, data] of Object.entries(yarnInfo)) {
      const uid = UnitId(p)
      graph.vertex(uid)
      for (const dep of data.workspaceDependencies) {
        graph.edge(uid, UnitId(dep))
      }

      for (const d of data.mismatchedWorkspaceDependencies) {
        violations.push([uid, UnitId(d)])
      }
    }

    const violation = violations.find(Boolean)
    if (violation) {
      const [consumer, supplier] = violation

      const ps = hardGet(packageByUnitId, supplier)
      // We assume that there is a consistent version for all dependencies so we lookup that version, instead of looking
      // into the package.json of the consumer and digging the exact version that is specified there.
      const v = hardGet(versionByPackageId, supplier)
      // TODO(imaman): generate a comprehensive error message that lists *all* violations.
      throw new BuildFailedError(
        `Version mismatch for dependency "${supplier}" of "${consumer}": ${ps.version} vs. ${v}`,
      )
    }

    await this.generateTsConfigFiles(rootDir, units, graph)

    await this.generateSymlinksToPackages(rootDir, units)
    this.state_ = { yarnInfo, graph, rootDir, units, packageByUnitId, versionByPackageId, publisher }
  }

  private async generateSymlinksToPackages(rootDir: string, units: UnitMetadata[]) {
    const nodeModules = path.join(rootDir, 'node_modules')
    await fse.mkdirp(nodeModules)
    for (const u of units) {
      const link = path.join(nodeModules, u.id)
      const exists = await fse.pathExists(link)
      if (exists) {
        continue
      }
      const packagePath = path.join(rootDir, u.pathInRepo)
      const packagePathRelative = path.relative(nodeModules, packagePath)
      await fse.symlink(packagePathRelative, link)
    }
  }

  private async generateTsConfigFiles(rootDir: string, units: UnitMetadata[], graph: Graph<UnitId>) {
    const rootBaseExists = await fse.pathExists(path.join(rootDir, this.tsconfigBaseName))

    const defaultOptions: TsConfigJson.CompilerOptions = {
      module: 'CommonJS',
      inlineSourceMap: true,
      newLine: 'LF',
      declaration: true,
      target: 'ES2021',
      lib: ['ES2021', 'DOM'],
      strict: true,
      noImplicitAny: true,
      moduleResolution: 'node',
      allowSyntheticDefaultImports: true,
      esModuleInterop: true,
    }

    for (const u of units) {
      const deps = graph.neighborsOf(u.id)

      const localBaseExists = await fse.pathExists(path.join(rootDir, u.pathInRepo, this.tsconfigBaseName))

      const tsconf: TsConfigJson = {
        ...(localBaseExists
          ? { extends: this.tsconfigBaseName }
          : rootBaseExists
          ? { extends: path.relative(u.pathInRepo, this.tsconfigBaseName) }
          : {}),
        compilerOptions: {
          ...(localBaseExists || rootBaseExists ? {} : defaultOptions),
          composite: true,
          outDir: this.dist(),
        },
        references: deps.map(d => {
          const dp =
            units.find(at => at.id === d) ?? failMe(`Unit not found: ${d} (when generating tsconfig.json for ${u.id})`)
          return {
            path: path.relative(u.pathInRepo, dp.pathInRepo),
          }
        }),
        include: [`${this.src}/**/*`, `${this.tests}/**/*`],
      }

      if (!tsconf.references?.length) {
        delete tsconf.references
      }

      const content = JSON.stringify(tsconf, null, 2)
      const p = path.join(rootDir, u.pathInRepo, 'tsconfig.json')
      if (await fse.pathExists(p)) {
        const existing = JSON.stringify(await fse.readJSON(p, 'utf-8'), null, 2)
        if (existing.trim() === content.trim()) {
          this.logger.info(`skipping generation of tsconfig.json in ${u.id} - no changes`)
          continue
        }
      }

      this.logger.info(`updating the tsconfig.json file of ${u.id}`)
      await fse.writeFile(p, content)
    }
  }
  async close() {}

  private async run(cmd: string, args: string[], dir: string, outputFile: string): Promise<ExitStatus> {
    const summary = `<${dir}$ ${cmd} ${args.join(' ')}>`
    this.logger.info(`Dispatching ${summary}. output: ${outputFile}`)

    const out = await fse.open(outputFile, 'w')
    try {
      const p = await execa(cmd, args, { cwd: dir, stdout: out, stderr: out, reject: false })
      this.logger.info(`exitCode of ${cmd} ${args.join(' ')} is ${p.exitCode}`)
      if (p.exitCode === 0) {
        return 'OK'
      }
      return 'FAIL'
    } catch (e) {
      this.logger.error(`execution of ${summary} failed`, e)
      return 'CRASH'
    } finally {
      await fse.close(out)
    }
  }

  // TODO(imaman): cover
  private async runCaptureStdout(cmd: string, args: string[], dir: string): Promise<string> {
    const summary = `<${dir}$ ${cmd} ${args.join(' ')}>`
    this.logger.info(`Dispatching ${summary}`)

    let p
    try {
      p = await execa(cmd, args, { cwd: dir, reject: false })
    } catch (e) {
      this.logger.error(`execution of ${summary} failed`, e)
      return 'CRASH'
    }

    this.logger.info(`exitCode of ${cmd} ${args.join(' ')} is ${p.exitCode}`)
    if (p.exitCode !== 0) {
      const e = new Error(`execution of ${summary} crashed with exit code ${p.exitCode}`)
      this.logger.error(`Could not get stdout of a command`, e)
      throw e
    }

    return p.stdout
  }

  private async checkBuiltFiles(dir: string) {
    for (const codeDir of [this.src, this.tests]) {
      const srcFiles = new Set<string>(
        await DirectoryScanner.listPaths(path.join(dir, codeDir), { startingPointMustExist: false }),
      )

      const d = path.join(dir, `${this.dist()}/${codeDir}`)
      const distSrcFiles = await DirectoryScanner.listPaths(d, { startingPointMustExist: false })

      const toDelete = distSrcFiles.filter(f => !srcFiles.has(f.replace(/\.js$/, '.ts').replace(/\.d\.ts$/, '.ts')))

      for (const f of toDelete) {
        await fse.rm(path.join(d, f))
      }
    }
  }

  async execute(u: UnitMetadata, dir: string, taskName: TaskName, outputFile: string): Promise<ExitStatus> {
    const taskKind = TaskName().undo(taskName).taskKind
    if (taskKind === 'build') {
      const ret = await this.run('npm', ['run', this.scriptNames.build], dir, outputFile)
      return await switchOn(ret, {
        CRASH: () => Promise.resolve(ret),
        FAIL: () => Promise.resolve(ret),
        OK: () => this.checkBuiltFiles(dir).then(() => 'OK'),
      })
    }

    if (taskKind === 'test') {
      const tempFile = await getTempFile()
      const [a, b] = await Promise.all([this.runJest(dir, taskName, outputFile), this.runValidate(u, dir, tempFile)])
      const ret = switchOn(a, {
        CRASH: () => a,
        FAIL: () => a,
        OK: () => b,
      })

      const toAppend = await fse.readFile(tempFile)
      await fse.appendFile(outputFile, toAppend)

      return ret
    }

    if (taskKind === 'pack') {
      const stat = await this.pack(u, dir)
      if (stat?.hasErrors()) {
        await fse.writeFile(outputFile, JSON.stringify(stat?.toJson('errors-only'), null, 2))
      } else {
        await fse.writeFile(outputFile, '')
      }
      return stat?.hasErrors() ? 'FAIL' : 'OK'
    }

    if (taskKind === 'publish-assets') {
      const scriptName = this.scriptNames.prepareAssets

      const fullPath = path.join(dir, PREPARED_ASSETS_DIR)
      await fse.rm(fullPath, { force: true, recursive: true })
      await fse.mkdirp(fullPath)

      const ret = await this.run('npm', ['run', scriptName], dir, outputFile)
      const exists = await fse.pathExists(fullPath)
      if (!exists) {
        throw new BuildFailedError(
          `Output file ${path.basename(fullPath)} was not created by the ${scriptName} run script in ${dir}`,
        )
      }

      const files = await fse.readdir(fullPath)
      await Promise.all(
        files.map(async f => {
          const contentToPublish = await fse.readFile(path.join(fullPath, f))
          this.logger.info(`unit ${u.id}: publishing asset ${f}`)
          await this.publisher?.publishAsset(u, contentToPublish, f)
        }),
      )

      return ret
    }

    throw new Error(`Unknown task ${taskKind} (at ${dir})`)
  }

  private async runJest(dir: string, taskName: TaskName, outputFile: string): Promise<ExitStatus> {
    const jof = path.join(dir, JEST_OUTPUT_FILE)
    const testsToRun = await this.computeTestsToRun(jof)
    const ret = await this.run(
      'npx',
      [
        'jest',
        ...testsToRun,
        '--json',
        '--outputFile',
        JEST_OUTPUT_FILE,
        '--reporters',
        'build-raptor-jest-reporter,default',
      ],
      dir,
      outputFile,
    )
    const latest = fse.readFileSync(jof, 'utf-8')
    let parsed
    try {
      parsed = JSON.parse(latest)
    } catch (e) {
      throw new Error(`failed to parse ${jof} <${e}>`)
    }

    const jestJson: JestJson = JestJson.parse(parsed)
    jestJson.testResults.forEach(tr => {
      const fileName = path.relative(this.state.rootDir, tr.name)
      tr.assertionResults.forEach(ar => {
        const verdict = ar.status === 'passed' ? 'TEST_PASSED' : ar.status === 'failed' ? 'TEST_FAILED' : undefined
        if (verdict) {
          const testPath = [...ar.ancestorTitles, ar.title]
          this.state.publisher.publish('testEnded', { verdict, fileName, testPath, taskName })
        }
      })
    })

    return ret
  }

  private async runValidate(u: UnitMetadata, dir: string, outputFile: string): Promise<ExitStatus> {
    if (!this.hasRunScript(u.id, this.scriptNames.validate)) {
      return 'OK'
    }

    const ret = await this.run('npm', ['run', this.scriptNames.validate], dir, outputFile)
    return ret
  }

  private getPackageJson(uid: UnitId) {
    return this.state.packageByUnitId.get(uid) ?? failMe(`Unit ID not found (${uid})`)
  }

  private toUnitId(packageName: string): UnitId | undefined {
    const ret = UnitId(packageName)
    if (this.state.packageByUnitId.has(ret)) {
      return ret
    }
    return undefined
  }

  private isInRepo(packageName: string): boolean {
    return this.toUnitId(packageName) !== undefined
  }

  async computePackingPackageJson(unitId: UnitId) {
    const visited = new Set<UnitId>()
    const scan = (u: string) => {
      const uid = this.toUnitId(u)
      if (!uid) {
        return
      }

      if (visited.has(uid)) {
        return
      }
      visited.add(uid)

      const pd = this.getPackageJson(uid)
      for (const d of Object.keys(pd.dependencies ?? {})) {
        scan(d)
      }
    }

    scan(unitId)
    const allDeps = [...visited]

    const packageDefs = allDeps.map(d => this.getPackageJson(d))

    const outOfRepoDeps: string[] = []
    for (const at of packageDefs) {
      for (const d of Object.keys(at.dependencies ?? {})) {
        if (!this.isInRepo(d)) {
          outOfRepoDeps.push(d)
        }
      }
    }
    // TODO(imaman): cover (the cloning).
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const ret = JSON.parse(JSON.stringify(this.getPackageJson(unitId))) as PackageJson
    ret.dependencies = pairsToRecord(outOfRepoDeps.sort().map(d => [d, this.getVersionOfDep(d)]))
    ret.main = MAIN_FILE_NAME
    delete ret.devDependencies
    return ret
  }

  private getVersionOfDep(d: string) {
    return hardGet(this.state.versionByPackageId, d)
  }

  private async pack(u: UnitMetadata, dir: string): Promise<Stats | undefined> {
    const inrepo: string[] = this.state.units.map(u => u.id)
    const ret = await new Promise<Stats | undefined>(resolve => {
      webpack(
        {
          context: dir,
          entry: `./${this.dist('s')}/index.js`,
          output: {
            filename: `${PACK_DIR}/${MAIN_FILE_NAME}`,
            path: dir,
          },
          mode: 'development',
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          plugins: [new ShebangPlugin() as WebpackPluginInstance],
          externals: [
            function (arg, callback) {
              const req = arg.request ?? ''
              let decision = 'R'
              if (req.startsWith('.')) {
                decision = 'bundle'
              }

              if (inrepo.includes(req)) {
                decision = 'bundle'
              }

              if (decision === 'bundle') {
                callback()
              } else {
                callback(undefined, 'commonjs ' + req)
              }
            },
          ],
        },
        async (err, stats) => {
          if (err) {
            this.logger.error(`packing of ${dir} failed`, err)
            throw new Error(`packing ${u.id} failed`)
          }

          resolve(stats)
        },
      )
    })

    const packageDef = await this.computePackingPackageJson(u.id)
    this.logger.info(`updated packagejson is ${JSON.stringify(packageDef)}`)
    const packageJsonPath = path.join(dir, PACK_DIR, 'package.json')

    try {
      await fse.writeFile(packageJsonPath, JSON.stringify(packageDef, null, 2))
    } catch (e) {
      throw new Error(`Failed to write new package definition at ${packageJsonPath}: ${e}`)
    }

    return ret
  }

  private async getYarnInfo(rootDir: string): Promise<YarnWorkspacesInfo> {
    if (!path.isAbsolute(rootDir)) {
      throw new Error(`rootDir must be absolute`)
    }

    const p = await execa('yarn', ['--silent', 'workspaces', 'info', '--json'], { cwd: rootDir, reject: false })
    if (p.exitCode === 0) {
      const parsed = JSON.parse(p.stdout)
      return yarnWorkspacesInfoSchema.parse(parsed)
    }

    this.logger.info(`running "yarn workspaces info" failed:\n${p.stderr}}`)
    throw new Error(`Failed to get yarn info for ${rootDir}`)
  }

  async getGraph() {
    return this.state.graph
  }

  async getUnits() {
    return this.state.units
  }

  async getTasks(): Promise<CatalogOfTasks> {
    const build = TaskKind('build')
    const pack = TaskKind('pack')
    const test = TaskKind('test')
    const publish = TaskKind('publish-assets')

    const unitIds = this.state.units.map(u => u.id)

    const unitsWith = (s: string) => unitIds.filter(at => this.hasRunScript(at, s))

    const ret: CatalogOfTasks = {
      inUnit: {
        [test]: [build],
        [pack]: [build],
      },
      onDeps: {},
      tasks: [
        {
          taskKind: build,
          outputs: [this.dist()],
          shadowing: this.shadowing,
          inputsInDeps: [this.dist('s')],
          inputsInUnit: [this.src, this.tests, 'package.json'],
        },
        {
          taskKind: test,
          outputs: [{ pathInUnit: JEST_OUTPUT_FILE, purge: 'ALWAYS' }],
          inputsInUnit: [this.dist('s'), this.dist('t')],
          inputsInDeps: [this.dist('s')],
        },
        {
          taskKind: pack,
          outputs: [PACK_DIR],
          inputsInUnit: [this.dist('s')],
          inputsInDeps: [this.dist('s')],
        },
        {
          taskKind: publish,
          unitIds: unitsWith(this.scriptNames.prepareAssets),
          outputs: [PREPARED_ASSETS_DIR],
          inputsInUnit: [this.dist('s')],
        },
      ],
    }

    return ret
  }

  async computeTestsToRun(resolved: string): Promise<string[]> {
    const exists = await fse.pathExists(resolved)
    if (!exists) {
      this.logger.info('jest-output.json does not exist. running everything!')
      return [this.tests]
    }

    const content = await fse.readFile(resolved, 'utf-8')
    let parsed
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      this.logger.print(`failed to parse ${resolved} <${e}> - overwriting with fallback content`)
      const fallback: JestJson = { testResults: [] }
      parsed = fallback
    }
    const jestJson: JestJson = JestJson.parse(parsed)

    const failedTests = jestJson.testResults.filter(x => x.status !== 'passed')
    this.logger.info(
      `file level jest data: ${JSON.stringify(
        jestJson.testResults.map(x => ({ name: x.name, status: x.status })),
        null,
        2,
      )}`,
    )
    if (failedTests.length === 0) {
      this.logger.info(`No failed tests found in ${resolved}`)
      // TODO(imaman): rethink this. maybe we want to run nothing if there are no failed tests.
      // It boilsdown to whether we trust jest-output.json or not.
      return [this.tests]
    }

    const synopsis = failedTests.map(ft => ft.assertionResults.map(x => ({ fullName: x.fullName, status: x.status })))
    this.logger.info(`assertionResults is:\n${JSON.stringify(synopsis, null, 2)}`)
    const failedAssertionResults = failedTests.flatMap(ft =>
      ft.assertionResults.filter(ar => ar.status === 'failed').map(ar => ar.fullName),
    )
    const names = uniqueBy(failedAssertionResults, x => x).sort()
    const ret = [...failedTests.map(x => x.name), '-t', names.map(x => escapeStringRegexp(x)).join('|')]
    this.logger.info(`tests to run: ${JSON.stringify(ret)}`)
    return ret
  }
}

const PACK_DIR = 'pack'
const MAIN_FILE_NAME = 'main.js'

function computeUnits(yarnInfo: YarnWorkspacesInfo): UnitMetadata[] {
  const ret: UnitMetadata[] = []
  for (const [p, data] of Object.entries(yarnInfo)) {
    const uid = UnitId(p)
    ret.push(new UnitMetadata(data.location, uid))
  }
  return ret
}

async function readPackages(rootDir: string, units: UnitMetadata[]) {
  const ret = new Map<UnitId, PackageJson>()
  await promises(units).forEach(20, async um => {
    const p = path.join(rootDir, um.pathInRepo, 'package.json')
    const content = await fse.readJSON(p)
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    ret.set(um.id, content as PackageJson)
  })

  return ret
}

function computeVersions(packages: PackageJson[]) {
  const ret = new Map<string, string>()

  const register = (d: string, v: string) => {
    const preexisting = ret.get(d)
    if (preexisting && preexisting !== v) {
      const arr = [preexisting, v].sort()
      throw new BuildFailedError(`Inconsistent version for depenedency "${d}": ${arr.join(', ')}`)
    }

    ret.set(d, v)
  }

  for (const p of packages) {
    for (const [d, v] of Object.entries(p.dependencies ?? {})) {
      register(d, v)
    }
    for (const [d, v] of Object.entries(p.devDependencies ?? {})) {
      register(d, v)
    }
  }

  return ret
}

const JEST_OUTPUT_FILE = 'jest-output.json'
const PREPARED_ASSETS_DIR = 'prepared-assets'
