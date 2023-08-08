import { BuildFailedError } from 'build-failed-error'
import { PathInRepo, RepoRoot } from 'core-types'
import escapeStringRegexp from 'escape-string-regexp'
import execa from 'execa'
import * as fs from 'fs'
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
  sortBy,
  switchOn,
  TypedPublisher,
  uniqueBy,
} from 'misc'
import * as path from 'path'
import {
  ExitStatus,
  Publisher,
  RepoProtocol,
  RepoProtocolEvent,
  RepoProtocolEventVerdict,
  TaskInfo,
} from 'repo-protocol'
import { ReporterOutput } from 'reporter-output'
import { TaskKind, TaskName } from 'task-name'
import * as Tmp from 'tmp-promise'
import { PackageJson, TsConfigJson } from 'type-fest'
import { UnitId, UnitMetadata } from 'unit-metadata'
import { z } from 'zod'

import { RerunList } from './rerun-list'
import { YarnRepoProtocolConfig } from './yarn-repo-protocol-config'

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
  readonly rootDir: RepoRoot
  readonly units: UnitMetadata[]
  readonly packageByUnitId: Map<UnitId, PackageJson>
  readonly versionByPackageId: Map<string, string>
  readonly publisher: TypedPublisher<RepoProtocolEvent>
  readonly config: YarnRepoProtocolConfig
  uberBuildPromise?: Promise<ExitStatus>
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
    postBuild: 'build:post',
    prepareAssets: 'prepare-assets',
  }

  private readonly src = 'src'
  private readonly tests = 'tests'

  constructor(
    private readonly logger: Logger,
    // TODO(imaman): deprecate it.
    private readonly assetPublisher: Publisher,
  ) {
    if (!isSimpleName(this.tsconfigBaseName)) {
      throw new Error(`tsconfig base file name must be a simple name (not a path). Got: "${this.tsconfigBaseName}"`)
    }
  }

  private readonly tsconfigBaseName = 'tsconfig-base.json'
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
  private parseConfig(untypedConfig: unknown | undefined) {
    const parseResult = YarnRepoProtocolConfig.safeParse(untypedConfig ?? {}, { path: ['repoProtocol'] })
    if (parseResult.success) {
      return parseResult.data
    }

    const formattedIssues = parseResult.error.issues.map(at =>
      at.path.length ? `Attribute: "${at.path.join('.')}": ${at.message}` : at.message,
    )
    throw new BuildFailedError(`bad config\n${formattedIssues.join('\n')}`)
  }

  async initialize(
    rootDir: RepoRoot,
    publisher: TypedPublisher<RepoProtocolEvent>,
    repoProtocolConfig?: unknown,
  ): Promise<void> {
    const yarnInfo = await this.getYarnInfo(rootDir)

    const config = this.parseConfig(repoProtocolConfig)
    const allUnits = computeUnits(yarnInfo)
    const units = computeRealUnits(allUnits)
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
    this.state_ = { yarnInfo, graph, rootDir, units: allUnits, packageByUnitId, versionByPackageId, publisher, config }
  }

  private async generateSymlinksToPackages(rootDir: RepoRoot, units: UnitMetadata[]) {
    const nodeModules = PathInRepo('node_modules')
    const nodeModulesLoc = rootDir.resolve(nodeModules)
    await fse.mkdirp(rootDir.resolve(nodeModules))
    for (const u of units) {
      const link = nodeModules.expand(u.id)
      const linkLoc = rootDir.resolve(link)
      const exists = await fse.pathExists(linkLoc)
      if (exists) {
        continue
      }
      const packageLoc = rootDir.resolve(u.pathInRepo)
      const packageFromNodeModules = path.relative(nodeModulesLoc, packageLoc)
      await fse.symlink(packageFromNodeModules, linkLoc)
    }
  }

  private async generateTsConfigFiles(rootDir: RepoRoot, units: UnitMetadata[], graph: Graph<UnitId>) {
    const rootBaseExists = await fse.pathExists(rootDir.resolve(PathInRepo(this.tsconfigBaseName)))

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
      resolveJsonModule: true,
    }

    for (const u of units) {
      const deps = graph.neighborsOf(u.id)

      const localBaseExists = await fse.pathExists(rootDir.resolve(u.pathInRepo.expand(this.tsconfigBaseName)))

      const tsconf: TsConfigJson = {
        ...(localBaseExists
          ? { extends: `./${this.tsconfigBaseName}` }
          : rootBaseExists
          ? { extends: path.relative(u.pathInRepo.val, this.tsconfigBaseName) }
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
            path: path.relative(u.pathInRepo.val, dp.pathInRepo.val),
          }
        }),
        include: [`${this.src}/**/*`, `${this.src}/**/*.json`, `${this.tests}/**/*`, `${this.tests}/**/*.json`],
      }

      if (!tsconf.references?.length) {
        delete tsconf.references
      }

      const content = JSON.stringify(tsconf, null, 2)
      const p = rootDir.resolve(u.pathInRepo.expand('tsconfig.json'))
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

  private async runAdditionalBuildActions(unitId: UnitId, dir: string, outputFile: string): Promise<ExitStatus> {
    return switchOn(await this.runPostBuild(unitId, dir, outputFile), {
      CRASH: () => Promise.resolve('CRASH'),
      FAIL: () => Promise.resolve('FAIL'),
      OK: () => this.checkBuiltFiles(dir).then(() => 'OK'),
    })
  }

  private async runPostBuild(unitId: UnitId, dir: string, outputFile: string) {
    if (!this.hasRunScript(unitId, this.scriptNames.postBuild)) {
      return 'OK'
    }

    const tempFile = await getTempFile()
    const ret = await this.run('npm', ['run', this.scriptNames.postBuild], dir, tempFile)

    const toAppend = await fse.readFile(tempFile)
    await fse.appendFile(outputFile, toAppend)
    return ret
  }

  private async checkBuiltFiles(dir: string): Promise<void> {
    for (const codeDir of [this.src, this.tests]) {
      const inputFiles = new Set<string>(
        await DirectoryScanner.listPaths(path.join(dir, codeDir), { startingPointMustExist: false }),
      )

      const d = path.join(dir, `${this.dist()}/${codeDir}`)
      const distFiles = await DirectoryScanner.listPaths(d, { startingPointMustExist: false })

      const replaceSuffix = (f: string, targetSuffx: string) =>
        f.replace(/\.js$/, targetSuffx).replace(/\.d\.ts$/, targetSuffx)

      const inputFileExists = (f: string) => {
        if (inputFiles.has(f)) {
          return true
        }
        if (inputFiles.has(replaceSuffix(f, '.ts'))) {
          return true
        }
        if (inputFiles.has(replaceSuffix(f, '.tsx'))) {
          return true
        }

        return false
      }

      const toDelete = distFiles.filter(f => !inputFileExists(f))
      if (toDelete.length) {
        this.logger.info(`deleting unmatched dist files: ${JSON.stringify({ inputFiles, toDelete })}`)
      }
      for (const f of toDelete) {
        await fse.rm(path.join(d, f))
      }
    }
  }

  private getInstallFeatureToggle(): 'off' | 'dormant' | 'on' {
    const raw = this.state.config.install ?? 'off'
    if (typeof raw === 'boolean') {
      return raw ? 'on' : 'off'
    }

    return raw
  }

  async execute(taskName: TaskName, outputFile: string, _buildRunId: string): Promise<ExitStatus> {
    if (taskName === installTaskName) {
      const ft = this.getInstallFeatureToggle()
      return switchOn(ft, {
        off: async () => {
          throw new Error(`cannot execute ${taskName} when its feature toggle is set to ${ft}`)
        },
        dormant: async () => {
          fs.writeFileSync(outputFile, '')
          const ret: ExitStatus = 'OK'
          return ret
        },
        on: async () => await this.run('yarn', ['--frozen-lockfile'], this.state.rootDir.resolve(), outputFile),
      })
    }

    const { taskKind, unitId } = TaskName().undo(taskName)
    const u = this.state.units.find(at => at.id === unitId) ?? failMe(`unit ID not found: ${unitId}`)
    const dir = this.state.rootDir.resolve(u.pathInRepo)
    if (taskKind === 'build') {
      let buildStatus: ExitStatus
      if (this.state.config.uberBuild ?? true) {
        buildStatus = await this.runUberBuild(outputFile, taskName)
      } else {
        buildStatus = await this.run('npm', ['run', this.scriptNames.build], dir, outputFile)
      }
      return await switchOn(buildStatus, {
        CRASH: () => Promise.resolve(buildStatus),
        FAIL: () => Promise.resolve(buildStatus),
        OK: () => this.runAdditionalBuildActions(u.id, dir, outputFile),
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
      const ret = await this.pack(u, dir)
      await fse.writeFile(outputFile, '')
      return ret
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
          const casAddress = await this.assetPublisher.publishAsset(u, contentToPublish, f)
          this.logger.info(`unit ${u.id}: asset ${f} published to cas ${casAddress}`)
          this.state.publisher.publish('assetPublished', {
            taskName,
            casAddress,
            file: f,
          })
        }),
      )

      return ret
    }

    throw new Error(`Unknown task ${taskKind} (at ${dir})`)
  }

  private async runUberBuild(outputFile: string, taskName: TaskName): Promise<ExitStatus> {
    if (this.state.uberBuildPromise) {
      const ret = await this.state.uberBuildPromise
      await fse.writeFile(outputFile, ``)
      return ret
    }

    this.logger.info(`logging uberbuild in ${outputFile} (triggered by ${taskName})`)
    const dirs = computeRealUnits(this.state.units).map(at => at.pathInRepo.val)
    const p = this.run('tsc', ['--build', ...dirs], this.state.rootDir.resolve(), outputFile)
    this.state.uberBuildPromise = p

    const ret = await this.state.uberBuildPromise
    return ret
  }

  private async runJest(dir: string, taskName: TaskName, outputFile: string): Promise<ExitStatus> {
    const jof = path.join(dir, JEST_OUTPUT_FILE)
    const testsToRun = await this.computeTestsToRun(jof)
    const reporterOutputFile = (await Tmp.file()).path
    const ret = await this.run(
      'npx',
      [
        'jest',
        ...testsToRun,
        '--outputFile',
        reporterOutputFile,
        '--reporters',
        'build-raptor-jest-reporter',
        '--reporters',
        'default',
      ],
      dir,
      outputFile,
    )
    const latest = fse.readFileSync(reporterOutputFile, 'utf-8')
    let reporterOutput
    try {
      const parsed = JSON.parse(latest)
      reporterOutput = ReporterOutput.parse(parsed)
    } catch (e) {
      const output = fs.readFileSync(outputFile, 'utf-8')
      const limit = 512
      this.logger.error(
        `crashing due to jest output file parsing error: ${JSON.stringify({
          latest,
          testsToRun,
          outputFile,
        })}. First ${limit} chars of the output file: ${output.slice(0, limit)}`,
        e,
      )
      throw new Error(`failed to parse ${reporterOutputFile} of ${taskName}: <${e}>`)
    }

    reporterOutput.cases.forEach(at => {
      const fileName = this.state.rootDir.unresolve(at.fileName)
      const verdict: RepoProtocolEventVerdict | undefined = switchOn(at.status, {
        disabled: () => undefined,
        failed: () => 'TEST_FAILED',
        passed: () => 'TEST_PASSED',
        pending: () => undefined,
        skipped: () => undefined,
        todo: () => undefined,
      })
      if (verdict) {
        const testPath = [...at.ancestorTitles, at.title]
        this.state.publisher.publish('testEnded', {
          verdict,
          fileName: fileName.val,
          testPath,
          taskName,
          durationMillis: at.duration,
        })
      }
    })

    const failingCases = reporterOutput.cases.filter(at =>
      switchOn(at.status, {
        disabled: () => false,
        failed: () => true,
        passed: () => false,
        pending: () => false,
        skipped: () => false,
        todo: () => false,
      }),
    )

    const rerunList: RerunList = sortBy(
      failingCases.map(at => ({ fileName: at.fileName, testCaseFullName: at.testCaseFullName })),
      at => `${at.fileName} ${at.testCaseFullName}`,
    )
    await fse.writeJSON(jof, RerunList.parse(rerunList))

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
    ret.files = [this.dist()]
    ret.dependencies = pairsToRecord(outOfRepoDeps.sort().map(d => [d, this.getVersionOfDep(d)]))
    ret.main = path.join(this.dist('s'), 'index.js')
    ret.scripts = ret.scripts ?? {}
    const earlier = ret.scripts.postinstall ? ` && ${ret.scripts.postinstall}` : ''
    // TODO(imaman): use a node program to do that (to make it portable)
    ret.scripts.postinstall = `cp -r dist/links dist/node_modules${earlier}`
    delete ret.devDependencies
    return ret
  }

  private getVersionOfDep(d: string) {
    return hardGet(this.state.versionByPackageId, d)
  }

  private async pack(u: UnitMetadata, dir: string): Promise<ExitStatus> {
    const packageDef = await this.computePackingPackageJson(u.id)
    const packDist = path.join(path.join(dir, PACK_DIR), 'dist')
    const packDistSrc = path.join(packDist, this.src)
    const packDistDeps = path.join(packDist, 'deps')
    const packDistLinks = path.join(packDist, 'links')
    fs.mkdirSync(packDistSrc, { recursive: true })
    fs.cpSync(path.join(dir, this.dist('s')), packDistSrc, { recursive: true })

    this.logger.info(`updated packagejson is ${JSON.stringify(packageDef)}`)
    const packageJsonPath = path.join(dir, PACK_DIR, 'package.json')

    fs.mkdirSync(packDistLinks)
    const depUnits = this.state.graph
      .traverseFrom(u.id, { direction: 'forward' })
      .filter(at => at !== u.id)
      .map(at => this.unitOf(at))
    for (const at of depUnits) {
      const d = path.join(packDistDeps, at.id)
      fs.mkdirSync(d, { recursive: true })
      fs.cpSync(this.state.rootDir.resolve(at.pathInRepo.expand(this.dist('s'))), d, { recursive: true })
      const symlinkLoc = path.join(packDistLinks, at.id)
      fs.symlinkSync(path.relative(path.dirname(symlinkLoc), d), symlinkLoc)
    }

    try {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageDef, null, 2))
    } catch (e) {
      throw new Error(`Failed to write new package definition at ${packageJsonPath}: ${e}`)
    }

    return 'OK'
  }

  private async getYarnInfo(rootDir: RepoRoot): Promise<YarnWorkspacesInfo> {
    const p = await execa('yarn', ['--silent', 'workspaces', 'info', '--json'], {
      cwd: rootDir.resolve(),
      reject: false,
    })
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

  private unitOf(uid: UnitId) {
    return this.state.units.find(at => at.id === uid) ?? failMe(`Unit not found (unit ID: ${uid})`)
  }

  async getTasks(): Promise<TaskInfo[]> {
    const unitIds = computeRealUnits(this.state.units).map(at => at.id)

    const ret = unitIds
      .map(at => this.unitOf(at))
      .flatMap(u => [this.buildTask(u), this.testTask(u), this.packTask(u), this.publishTask(u)])
      .flatMap(x => (x ? [x] : []))

    const installTaskInfo: TaskInfo = {
      taskName: installTaskName,
      inputs: [PathInRepo('yarn.lock'), PathInRepo('package.json')],
      outputLocations: [{ pathInRepo: PathInRepo('node_modules'), purge: 'NEVER' }],
    }

    switchOn(this.getInstallFeatureToggle(), {
      off: () => {},
      dormant: () => {
        ret.push(installTaskInfo)
      },
      on: () => {
        ret.push(installTaskInfo)
      },
    })

    return ret
  }

  private depList(...taskNames: TaskName[]) {
    return taskNames.filter(at => {
      if (at !== installTaskName) {
        return true
      }

      return switchOn(this.getInstallFeatureToggle(), {
        off: () => false,
        dormant: () => true,
        on: () => true,
      })
    })
  }

  private buildTask(u: UnitMetadata): TaskInfo | undefined {
    const dir = u.pathInRepo
    const deps = this.state.graph
      .traverseFrom(u.id)
      .filter(at => at !== u.id)
      .map(at => this.unitOf(at).pathInRepo)
    return {
      taskName: TaskName(u.id, TaskKind('build')),
      outputLocations: [{ pathInRepo: dir.expand(this.dist()), purge: 'NEVER' }],
      inputs: [
        dir.expand(this.src),
        dir.expand(this.tests),
        dir.expand('package.json'),
        ...deps.map(d => d.expand(this.dist('s'))),
      ],
      deps: this.depList(installTaskName),
    }
  }
  private testTask(u: UnitMetadata): TaskInfo | undefined {
    const dir = u.pathInRepo
    const deps = this.state.graph
      .traverseFrom(u.id)
      .filter(at => at !== u.id)
      .map(at => this.unitOf(at).pathInRepo)
    return {
      taskName: TaskName(u.id, TaskKind('test')),
      outputLocations: [{ pathInRepo: dir.expand(JEST_OUTPUT_FILE), purge: 'ALWAYS' }],
      inputs: [
        dir.expand(this.dist('s')),
        dir.expand(this.dist('t')),
        dir.expand('package.json'),
        ...deps.map(d => d.expand(this.dist('s'))),
      ],
      deps: this.depList(installTaskName),
    }
  }
  private packTask(u: UnitMetadata): TaskInfo | undefined {
    const dir = u.pathInRepo
    const deps = this.state.graph
      .traverseFrom(u.id)
      .filter(at => at !== u.id)
      .map(at => this.unitOf(at).pathInRepo)
    return {
      taskName: TaskName(u.id, TaskKind('pack')),
      outputLocations: [{ pathInRepo: dir.expand(PACK_DIR), purge: 'ALWAYS' }],
      inputs: [dir.expand(this.dist('s')), ...deps.map(d => d.expand(this.dist('s')))],
    }
  }
  private publishTask(u: UnitMetadata): TaskInfo | undefined {
    if (!this.hasRunScript(u.id, this.scriptNames.prepareAssets)) {
      return undefined
    }
    const dir = u.pathInRepo
    return {
      taskName: TaskName(u.id, TaskKind('publish-assets')),
      outputLocations: [{ pathInRepo: dir.expand(PREPARED_ASSETS_DIR), purge: 'NEVER' }],
      inputs: [dir.expand(this.dist('s'))],
    }
  }

  private async computeTestsToRun(resolved: string): Promise<string[]> {
    const exists = await fse.pathExists(resolved)
    if (!exists) {
      this.logger.info('jest-output.json does not exist. running everything!')
      return [this.tests]
    }

    const content = await fse.readFile(resolved, 'utf-8')
    let parsed
    const fallback: RerunList = RerunList.parse([])
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      this.logger.info(`failed to JSON parse ${resolved} <${e}> - using fallback`)
      parsed = fallback
    }
    let rerunList

    try {
      rerunList = RerunList.parse(parsed)
    } catch (e) {
      this.logger.info(`failed to parse rerun-list from ${resolved} <${e}> - using fallback`)
      rerunList = fallback
    }

    if (rerunList.length === 0) {
      this.logger.info(`No failed tests found in ${resolved}`)
      // TODO(imaman): rethink this. maybe we want to run nothing if there are no failed tests.
      // It boilsdown to whether we trust jest-output.json or not.
      return [this.tests]
    }

    const names = sortBy(
      rerunList.map(at => at.testCaseFullName),
      x => x,
    )
    const fileNames = uniqueBy(
      rerunList.map(at => at.fileName),
      x => x,
    )
    const ret = [...fileNames, '-t', names.map(x => escapeStringRegexp(x)).join('|')]
    this.logger.info(`tests to run: ${JSON.stringify(ret)}`)
    return ret
  }
}

const PACK_DIR = 'pack'

function computeUnits(yarnInfo: YarnWorkspacesInfo): UnitMetadata[] {
  const ret: UnitMetadata[] = []
  for (const [p, data] of Object.entries(yarnInfo)) {
    const uid = UnitId(p)
    ret.push(new UnitMetadata(data.location, uid))
  }

  ret.push(new UnitMetadata('', rootUnitId))
  return ret
}

async function readPackages(rootDir: RepoRoot, units: UnitMetadata[]) {
  const ret = new Map<UnitId, PackageJson>()
  await promises(units).forEach(20, async um => {
    const p = rootDir.resolve(um.pathInRepo.expand('package.json'))
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

function computeRealUnits(units: UnitMetadata[]) {
  return units.filter(at => at.id !== rootUnitId)
}

const JEST_OUTPUT_FILE = 'jest-output.json'
const PREPARED_ASSETS_DIR = 'prepared-assets'

const rootUnitId = UnitId('.')
const installTaskName = TaskName(rootUnitId, TaskKind('install'))
