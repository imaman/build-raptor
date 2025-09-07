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

import { BuildTaskRecord, ResolvedBuildTaskDefinition } from './build-task-record'
import { generateTestRunSummary } from './generate-test-run-summary'
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
  readonly outDirName: string
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

  private get testRunSummaryFile() {
    return path.join(this.state.outDirName, 'test-runs.json')
  }

  private hasRunScript(unitId: UnitId, runScript: string) {
    const pj = this.getPackageJson(unitId)
    const runScripts = Object.keys(pj.scripts ?? {})
    return runScripts.includes(runScript)
  }

  private getTestCommand(unitId: UnitId): string | undefined {
    // Check if custom test commands are allowed
    const toggle = this.state.config.enableCustomTestCommands ?? true
    if (!toggle) {
      return undefined
    }

    const pj = this.getPackageJson(unitId)
    // Check for buildRaptor.testCommand in package.json

    const schema = z.object({ buildRaptor: z.object({ testCommand: z.string() }).optional() })

    const { buildRaptor } = schema.parse(pj)
    return buildRaptor?.testCommand
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
    outDirName: string,
    repoProtocolConfig?: unknown,
  ): Promise<void> {
    const yarnInfo = await this.getYarnInfo(rootDir)

    const config = this.parseConfig(repoProtocolConfig)
    const allUnits = computeUnits(yarnInfo)
    const units = computeRealUnits(allUnits)
    const [packageByUnitId, _] = await Promise.all([
      readPackages(rootDir, units),
      createOutDirs(rootDir, units, outDirName),
    ])
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
    this.state_ = {
      yarnInfo,
      graph,
      rootDir,
      units: allUnits,
      packageByUnitId,
      versionByPackageId,
      publisher,
      config,
      outDirName,
    }
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
    const rootBase = rootDir.resolve(PathInRepo(this.tsconfigBaseName))
    const rootBaseExists = await fse.pathExists(rootBase)

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const rootBaseContent = rootBaseExists ? ((await fse.readJSON(rootBase)) as Includer) : {}

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

      const localBase = rootDir.resolve(u.pathInRepo.expand(this.tsconfigBaseName))
      const localBaseExists = await fse.pathExists(localBase)

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const localBaseContent = localBaseExists ? ((await fse.readJSON(localBase)) as Includer) : {}
      const additions = [...(localBaseContent.include ?? []), ...(rootBaseContent.include ?? [])]

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
        include: [
          `${this.src}/**/*`,
          `${this.src}/**/*.json`,
          `${this.tests}/**/*`,
          `${this.tests}/**/*.json`,
          ...additions,
        ],
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

  // TODO(imaman): this should be retired. custom build tasks should be used instead.
  private async runAdditionalBuildActions(unitId: UnitId, dir: string, outputFile: string): Promise<ExitStatus> {
    await this.checkBuiltFiles(dir)
    return await this.runPostBuild(unitId, dir, outputFile)
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
      const inputFiles = new Map<string, number>()
      const inputDir = path.join(dir, codeDir)
      const paths = await DirectoryScanner.listPaths(inputDir, { startingPointMustExist: false })
      for (const p of paths) {
        inputFiles.set(p, fs.statSync(path.join(inputDir, p)).mode)
      }

      const d = path.join(dir, `${this.dist()}/${codeDir}`)
      const distFiles = await DirectoryScanner.listPaths(d, { startingPointMustExist: false })

      const replaceSuffix = (f: string, targetSuffx: string) =>
        f.replace(/\.js$/, targetSuffx).replace(/\.d\.ts$/, targetSuffx)

      const inputFileExists = (f: string) => {
        let ret: number | undefined
        ret = inputFiles.get(f)
        if (ret) {
          return ret
        }
        ret = inputFiles.get(replaceSuffix(f, '.ts'))
        if (ret) {
          return ret
        }

        ret = inputFiles.get(replaceSuffix(f, '.tsx'))
        if (ret) {
          return ret
        }

        return undefined
      }

      for (const f of distFiles) {
        const orig = inputFileExists(f)
        const resolved = path.join(d, f)
        if (orig === undefined) {
          this.logger.info(`deleting unmatched dist file: ${f}`)
          fs.rmSync(resolved)
        } else {
          fs.chmodSync(resolved, orig)
        }
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
        on: async () => {
          this.logger.print(`Installing dependencies...`)
          const ret = await this.run('yarn', ['--frozen-lockfile'], this.state.rootDir.resolve(), outputFile)
          return ret
        },
      })
    }

    const { taskKind, unitId, subKind } = TaskName().undo(taskName)
    const u = this.state.units.find(at => at.id === unitId) ?? failMe(`unit ID not found: ${unitId}`)
    const dir = this.state.rootDir.resolve(u.pathInRepo)
    if (taskKind === 'build' && subKind === '') {
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
    if (taskKind === 'build' && subKind !== '') {
      return await this.run('npm', ['run', subKind], dir, outputFile)
    }

    if (taskKind === 'test') {
      const tempFile = await getTempFile()
      const testCommand = this.getTestCommand(u.id)

      // Run test and validate in parallel (same approach for both custom and Jest)
      const [testResult, validateResult] = await Promise.all([
        testCommand ? this.runCustomTest(u.id, dir, taskName, outputFile) : this.runJest(dir, taskName, outputFile),
        this.runValidate(u, dir, tempFile),
      ])

      // Merge validate output into main output file
      const toAppend = await fse.readFile(tempFile)
      await fse.appendFile(outputFile, toAppend)

      // Return based on test result: if test fails, return test result; if test passes, return validate result
      return switchOn(testResult, {
        CRASH: () => testResult,
        FAIL: () => testResult,
        OK: () => validateResult,
      })
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
    const p = this.run('npx', ['tsc', '--build', ...dirs], this.state.rootDir.resolve(), outputFile)
    this.state.uberBuildPromise = p

    const ret = await this.state.uberBuildPromise
    return ret
  }

  private async runJest(dir: string, taskName: TaskName, outputFile: string): Promise<ExitStatus> {
    const dirInRepo = this.state.rootDir.unresolve(dir)
    // file path resolution here is ugly. it's probably better to change dir (parameter of this function) to be
    // PathInRepo
    const resolvedSummaryFile = this.state.rootDir.resolve(dirInRepo.expand(this.testRunSummaryFile))
    // We must create the file (empty) such that even if the task fails there is still an output (to keep the invariant
    // that all outputs must be produced by a task when it runs).
    fs.writeFileSync(resolvedSummaryFile, JSON.stringify({}))

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

    const readStdout = () => fs.readFileSync(outputFile, 'utf-8').trim()
    const latest = fs.readFileSync(reporterOutputFile, 'utf-8')
    if (latest.trim().length === 0) {
      const output = readStdout()
      if (output.length) {
        this.logger.print(
          `<No Jest tests were invoked. Jest output follows below. latest=${JSON.stringify(latest)}>\n${output}`,
        )
        fs.writeFileSync(jof, JSON.stringify(emptyRerunList))
        return 'FAIL'
      }
    }

    let reporterOutput
    try {
      const parsed = JSON.parse(latest)
      reporterOutput = ReporterOutput.parse(parsed)
    } catch (e) {
      const output = readStdout()
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

    const summary = generateTestRunSummary(this.state.rootDir, reporterOutput)
    fs.writeFileSync(resolvedSummaryFile, JSON.stringify(summary))

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
    fs.writeFileSync(jof, JSON.stringify(RerunList.parse(rerunList)))

    return ret
  }

  private async runCustomTest(
    unitId: UnitId,
    dir: string,
    _taskName: TaskName,
    outputFile: string,
  ): Promise<ExitStatus> {
    const testCommand = this.getTestCommand(unitId)
    if (!testCommand) {
      throw new Error(`Custom test command not found for ${unitId}`)
    }

    // Resolve command path relative to repo root
    const commandPath = this.state.rootDir.resolve(PathInRepo(testCommand))

    // Create empty test summary file to maintain invariant
    const dirInRepo = this.state.rootDir.unresolve(dir)
    const resolvedSummaryFile = this.state.rootDir.resolve(dirInRepo.expand(this.testRunSummaryFile))
    fs.writeFileSync(resolvedSummaryFile, JSON.stringify({}))

    // Prepare arguments for the test command
    const args = [
      dir, // Package directory absolute path
      unitId.toString(), // Package name (unit ID)
      path.join(dir, JEST_OUTPUT_FILE), // Rerun file path (optional use by custom runner)
    ]

    // Execute the custom test command
    const ret = await this.run(commandPath, args, dir, outputFile)

    // Write empty rerun list if custom runner doesn't provide one
    const jof = path.join(dir, JEST_OUTPUT_FILE)
    if (!fs.existsSync(jof)) {
      fs.writeFileSync(jof, JSON.stringify([]))
    }

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
    const ret = JSON.parse(JSON.stringify(this.getPackageJson(unitId))) as PackageJson & { nohoist?: boolean }
    ret.files = [this.dist()]
    ret.dependencies = pairsToRecord(outOfRepoDeps.sort().map(d => [d, this.getVersionOfDep(d)]))
    ret.main = path.join(this.dist('s'), 'index.js')
    delete ret.devDependencies
    ret.nohoist = true
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
    fs.mkdirSync(packDistSrc, { recursive: true })
    fs.cpSync(path.join(dir, this.dist('s')), packDistSrc, { recursive: true })

    this.logger.info(`updated packagejson is ${JSON.stringify(packageDef)}`)
    const packageJsonPath = path.join(dir, PACK_DIR, 'package.json')

    // create a deps directory (part of the package) that includes the code of in-repo deps.
    const depUnits = this.state.graph
      .traverseFrom(u.id, { direction: 'forward' })
      .filter(at => at !== u.id)
      .map(at => this.unitOf(at))
    for (const at of depUnits) {
      const d = path.join(packDistDeps, at.id)
      fs.mkdirSync(d, { recursive: true })
      fs.cpSync(this.state.rootDir.resolve(at.pathInRepo.expand(this.dist('s'))), d, { recursive: true })
    }

    try {
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageDef, null, 2))
    } catch (e) {
      throw new Error(`Failed to write new package definition at ${packageJsonPath}: ${e}`)
    }

    // We use a synthetic entry point file which does the following:
    // (i) creates a package-only node_modules directory with symlinks to various deps/* directories
    // (ii) delegates to the *real* entry point: dist/src/index.js
    //
    // Step (i) allows imports (i.e., import <sometning> from '<some-package-name>') to be correctly resolved.
    //
    // The symlinks cannot be created at packing-time because NPM does not include symlinks in its packages
    // (https://github.com/npm/npm/issues/3310#issuecomment-15904722). Initially we tried to do it via a postinstall
    // script but it turns out that yarn tries to optimize away the package-only node_modules directory (when it updates
    // other packages, on subsequent install operations). Hence, we have to do this at import-time.

    const indexJs = path.join(dir, PACK_DIR, this.dist('s'), 'index.js')
    const content = fs.readFileSync(indexJs, 'utf-8')

    const preamble = [
      '(() => {',
      '  const fs = require(`fs`)',
      '  const path = require(`path`)',
      '  const dist = path.dirname(__dirname)',
      '  const distNodeModules = path.join(dist, `node_modules`)',
      '  const distDeps = path.join(dist, `deps`)',
      '  fs.rmSync(distNodeModules, {force: true, recursive: true})',
      '  fs.mkdirSync(distNodeModules, {recursive: true})',
      '  if (fs.existsSync(distDeps)) {',
      '    for (const p of fs.readdirSync(distDeps)) {',
      '      fs.symlinkSync(`../deps/${p}`, `${distNodeModules}/${p}`)',
      '    }',
      '  }',
      '})()',
      '',
    ].join('\n')

    fs.writeFileSync(indexJs, preamble + content)

    return 'OK'
  }

  private async getYarnInfo(rootDir: RepoRoot): Promise<YarnWorkspacesInfo> {
    const copy: NodeJS.ProcessEnv = {}
    // eslint-disable-next-line no-process-env
    for (const [k, v] of Object.entries(process.env)) {
      // FORCE_COLOR makes yarn return colored output and then JSON.parse() fails. Ideally we'd want to pass an empty
      // env to any process we spawn, but some of the CI systems rely on env vars being set.
      if (k === 'FORCE_COLOR') {
        continue
      }
      copy[k] = v
    }
    const p = await execa('yarn', ['--silent', 'workspaces', 'info', '--json'], {
      cwd: rootDir.resolve(),
      reject: false,
      encoding: 'utf-8',
      extendEnv: false,
      env: copy,
    })
    if (p.exitCode === 0) {
      let parsed: unknown
      try {
        parsed = JSON.parse(p.stdout)
      } catch (e) {
        this.logger.info(`unparsable output of yarn workspaces info:\n<${p.stdout}>`)
        throw new Error(`could not parse yarn workspaces info`)
      }

      return yarnWorkspacesInfoSchema.parse(parsed)
    }

    this.logger.info(`running "yarn workspaces info" failed:\n<${p.stderr}>`)
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
      .flatMap(u => [
        this.buildTask(u),
        this.testTask(u),
        this.packTask(u),
        this.publishTask(u),
        ...this.customTasks(u),
      ])
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
    const ret: TaskInfo = {
      labels: ['build'],
      useCaching: this.state.config.cacheCompilationOutputs ?? true,
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

    switchOn(this.getInstallFeatureToggle(), {
      off: () => {
        ret.inputs?.push(PathInRepo('yarn.lock'))
      },
      dormant: () => {},
      on: () => {},
    })

    return ret
  }
  private testTask(u: UnitMetadata): TaskInfo | undefined {
    const dir = u.pathInRepo
    const deps = this.state.graph
      .traverseFrom(u.id)
      .filter(at => at !== u.id)
      .map(at => this.unitOf(at).pathInRepo)
    return {
      labels: ['test'],
      taskName: TaskName(u.id, TaskKind('test')),
      outputLocations: [
        { pathInRepo: dir.expand(JEST_OUTPUT_FILE), purge: 'ALWAYS' },
        { pathInRepo: dir.expand(this.testRunSummaryFile), purge: 'ALWAYS', isPublic: true },
      ],
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
      labels: ['pack'],
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
      labels: ['publish-assets'],
      taskName: TaskName(u.id, TaskKind('publish-assets')),
      outputLocations: [{ pathInRepo: dir.expand(PREPARED_ASSETS_DIR), purge: 'NEVER' }],
      inputs: [dir.expand('package.json'), dir.expand(this.dist('s'))],
    }
  }

  private customTasks(u: UnitMetadata): TaskInfo[] {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const casted = this.getPackageJson(u.id) as { buildTasks?: unknown }
    const dir = u.pathInRepo
    const pj = dir.expand('package.json')
    const parseResult = BuildTaskRecord.safeParse(casted.buildTasks ?? {})
    if (!parseResult.success) {
      throw new BuildFailedError(
        `found a buildTasks object (in ${pj}) which is not well formed: ${parseResult.error.message}`,
      )
    }
    const btr = parseResult.data

    const computeOutputLocation = (buildTaskName: string, s: string) => {
      try {
        return dir.to(s)
      } catch (e) {
        throw new BuildFailedError(`build task ${buildTaskName} in ${pj} specifies an illegal input: ${e}`)
      }
    }
    const ret: TaskInfo[] = []
    for (const name of Object.keys(btr)) {
      const unresolvedDef = btr[name]
      const def =
        typeof unresolvedDef === 'string' ? this.resolveBuildTasks(dir, name, unresolvedDef, pj) : unresolvedDef
      if (!this.hasRunScript(u.id, name)) {
        throw new BuildFailedError(
          `found a build task named "${name}" but no run script with that name is defined in ${pj}`,
        )
      }

      const inputs =
        def.inputs === '_ALWAYS_'
          ? [PathInRepo('.build-raptor/build-run-id')]
          : [pj, ...toArray(def.inputs).map(at => computeOutputLocation(name, at))]

      ret.push({
        taskName: TaskName(u.id, TaskKind('build'), name),
        labels: toArray(def.labels ?? []),
        inputs,
        outputLocations: [
          ...toArray(def.outputs ?? []).map(at => ({
            pathInRepo: dir.expand(at),
            purge: 'ALWAYS' as const,
            isPublic: false,
          })),
          ...toArray(def.publicOutputs ?? []).map(at => ({
            pathInRepo: dir.expand(at),
            purge: 'ALWAYS' as const,
            isPublic: true,
          })),
        ],
      })
    }

    return ret
  }

  private resolveBuildTasks(
    dir: PathInRepo,
    name: string,
    pointer: string,
    originatingFrom: PathInRepo,
  ): ResolvedBuildTaskDefinition {
    let where = dir.to(pointer)
    const absPathToIndex = new Map<string, number>() // Maps file path to its position in the chain

    while (true) {
      const fileToRead = this.state.rootDir.resolve(where)
      const cycleStart = absPathToIndex.get(fileToRead)
      if (cycleStart !== undefined) {
        const cycle = sortBy([...absPathToIndex.entries()], ([_, index]) => index)
          .slice(cycleStart)
          .map(([abs]) => this.state.rootDir.unresolve(abs))
        cycle.push(where) // Complete the cycle
        throw new BuildFailedError(`Circular reference detected in build task definition: ${cycle.join(' -> ')}`)
      }
      absPathToIndex.set(fileToRead, absPathToIndex.size)

      if (!fs.existsSync(fileToRead)) {
        throw new BuildFailedError(
          `Could no find file ${where} while resolving build task "${name}" from ${originatingFrom}`,
        )
      }
      const unparsed = JSON.parse(fs.readFileSync(fileToRead, 'utf-8'))
      const parseResult = BuildTaskRecord.safeParse(unparsed)
      if (!parseResult.success) {
        throw new BuildFailedError(
          `buildTask object (in ${fileToRead}) is not well formed: ${parseResult.error.message}`,
        )
      }

      const parsed = parseResult.data
      const ret = parsed[name]
      if (!ret) {
        throw new BuildFailedError(`could not find buildTask "${name}" in ${fileToRead}`)
      }

      if (typeof ret === 'object') {
        return ret
      }

      where = PathInRepo(path.dirname(where.val)).to(ret)
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
    try {
      parsed = JSON.parse(content)
    } catch (e) {
      this.logger.info(`failed to JSON parse ${resolved} <${e}> - using fallback`)
      parsed = emptyRerunList
    }
    let rerunList

    try {
      rerunList = RerunList.parse(parsed)
    } catch (e) {
      this.logger.info(`failed to parse rerun-list from ${resolved} <${e}> - using fallback`)
      rerunList = emptyRerunList
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

async function createOutDirs(rootDir: RepoRoot, units: UnitMetadata[], outDirName: string | undefined) {
  if (!outDirName) {
    return
  }
  await promises(units).forEach(20, async um => {
    const p = rootDir.resolve(um.pathInRepo.expand(outDirName))
    await fse.ensureDir(p)
  })
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

const emptyRerunList: RerunList = RerunList.parse([])

type Includer = { include?: string[] }

function toArray<T>(input: T | T[]) {
  return Array.isArray(input) ? input : [input]
}
