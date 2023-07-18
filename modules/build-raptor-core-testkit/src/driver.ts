import { Step, StepByName, StepByStep, StepName } from 'build-raptor-api'
import { BlobId, Breakdown, EngineBootstrapper, TaskStore } from 'build-raptor-core'
import * as fse from 'fs-extra'
import { createNopLogger } from 'logger'
import {
  folderify,
  FolderifyRecipe,
  InMemoryStorageClient,
  Int,
  shouldNeverHappen,
  slurpDir,
  sortBy,
  StorageClient,
} from 'misc'
import * as path from 'path'
import { RepoProtocol } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitId } from 'unit-metadata'

import { SimpleNodeRepoProtocol } from './simple-node-repo-protocol'

interface LinesOptions {
  trimEach?: boolean
}
export class Run {
  constructor(private readonly breakdown: Breakdown) {}

  async outputOf(taskKind: string, unitId: string) {
    return await this.breakdown.outputOf(taskKind, unitId, 'lines')
  }

  getSummary(unitId: string, taskKind: string) {
    const tn = TaskName(UnitId(unitId), TaskKind(taskKind))
    const ret = this.breakdown.getSummaries().find(s => s.taskName === tn)
    if (!ret) {
      throw new Error(`Task ${unitId}/${taskKind} not found`)
    }
    return ret
  }

  taskNames() {
    return sortBy(
      this.breakdown.getSummaries().map(s => s.taskName),
      x => x,
    )
  }

  // TODO(imaman): use timing information gathered by the protocol testkit (instead of relying on summaries which are
  // SUT-generated)
  happened(
    unitIdA: string,
    taskKindA: string,
    unitIdB: string,
    taskKindB: string,
  ): 'BEFORE' | 'CONCURRENTLY' | 'AFTER' {
    const a = this.getSummary(unitIdA, taskKindA)
    const b = this.getSummary(unitIdB, taskKindB)
    if (a.endedAt <= b.startedAt) {
      return 'BEFORE'
    }
    if (a.startedAt >= b.endedAt) {
      return 'AFTER'
    }
    return 'CONCURRENTLY'
  }

  executionTypeOf(unitId: string, taskKind: string) {
    const s = this.getSummary(unitId, taskKind)
    return s.execution
  }

  get buildRunId() {
    return this.breakdown.buildRunId
  }

  /**
   * returns the numerical exit code of the build process.
   */
  get exitCode() {
    return this.breakdown.exitCode
  }

  get performanceReport() {
    return this.breakdown.performanceReport
  }

  get message() {
    return this.breakdown.message
  }

  toString() {
    return `message=${this.message} exitCode=${this.exitCode}, summaries=${JSON.stringify(
      this.breakdown.getSummaries(),
    )}`
  }
}

class File {
  constructor(private readonly rootDir: string, private readonly pathInRepo: string) {}

  private resolve() {
    return path.join(this.rootDir, this.pathInRepo)
  }

  to(relativePath: string) {
    if (path.isAbsolute(relativePath)) {
      throw new Error(`Absolute path not allowed`)
    }
    return new File(this.rootDir, path.join(this.pathInRepo, relativePath))
  }

  /**
   * @returns the content of the file as an array of lines or undefined if the file does not exist.
   */
  async lines(options: LinesOptions = {}): Promise<string[] | undefined> {
    const trimEach = options.trimEach ?? false
    const resolved = this.resolve()
    if (!(await fse.pathExists(resolved))) {
      return undefined
    }
    const content = await fse.readFile(resolved, 'utf-8')
    return content
      .trim()
      .split('\n')
      .map(at => (trimEach ? at.trim() : at))
  }

  async readJson() {
    const resolved = this.resolve()
    if (!(await fse.pathExists(resolved))) {
      return undefined
    }

    return await fse.readJSON(resolved)
  }

  async write(content: string | object) {
    const resolved = this.resolve()
    await fse.mkdirp(path.dirname(resolved))

    const c =
      typeof content === 'string'
        ? content
        : typeof content === 'object'
        ? JSON.stringify(content)
        : shouldNeverHappen(content)
    await fse.writeFile(resolved, c)
  }

  async exists() {
    return await fse.pathExists(this.resolve())
  }

  async rm() {
    await fse.remove(this.resolve())
  }

  async lastChanged() {
    const st = await fse.stat(this.resolve())
    return st.mtime.getTime()
  }
}

interface RunOptions {
  units?: string[]
  taskKind?: string
  concurrencyLevel?: number
  checkGitIgnore?: boolean
  testCaching?: boolean
}

const BUILD_RAPTOR_DIR_NAME = '.build-raptor'
class Fork {
  private readonly buildRaptorDir: string

  constructor(
    private readonly dir: string,
    private readonly storageClient: StorageClient,
    private readonly repoProtocol: RepoProtocol,
    private readonly testName?: string,
  ) {
    this.buildRaptorDir = path.join(this.dir, BUILD_RAPTOR_DIR_NAME)
  }

  async run(expectedStatus: 'OK' | 'FAIL' | 'CRASH', options: RunOptions = {}): Promise<Run> {
    const command = options.taskKind ?? ''
    const units = options.units ?? []
    const concurrencyLevel = Int(options.concurrencyLevel ?? 10)
    const rp = this.repoProtocol
    const bootstrapper = await EngineBootstrapper.create(this.dir, this.storageClient, rp, Date.now(), this.testName)

    await fse.mkdirp(this.buildRaptorDir)
    const runner = await bootstrapper.makeRunner(command, units, undefined, {
      checkGitIgnore: options.checkGitIgnore ?? false,
      concurrency: concurrencyLevel,
      buildRaptorDir: this.buildRaptorDir,
      testCaching: options.testCaching,
      commitHash: 'COMMIT-HASH-FOR-TESTING',
    })
    const output = await runner()
    if (expectedStatus === output.overallVerdict) {
      return new Run(output)
    }

    if (output.crashCause) {
      throw output.crashCause
    }

    const m = output
      .getSummaries()
      .map(s => `${s.taskName} -> ${s.verdict}`)
      .join('\n')
    throw new Error(`Expected ${expectedStatus}, but got ${output.overallVerdict} ${output.message ?? ''}\n${m}`)
  }

  file(pathInRepo: string) {
    return new File(this.dir, pathInRepo)
  }

  getBuildRaptorDir() {
    return this.file(BUILD_RAPTOR_DIR_NAME)
  }

  async readStepByStepFile() {
    const unparsed = await this.getBuildRaptorDir().to('step-by-step.json').readJson()
    return StepByStep.parse(unparsed)
  }

  async getSteps<N extends StepName>(stepName: N): Promise<StepByName<N>[]> {
    const parsed = await this.readStepByStepFile()
    const ret = Fork.filterSteps<N>(parsed, stepName)
    return ret
  }

  private static filterSteps<N extends StepName>(input: Step[], stepName: N) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return input.flatMap(at => (at.step === stepName ? [at as StepByName<N>] : []))
  }
}

class Repo {
  constructor(private readonly recipe: FolderifyRecipe, private readonly driver: Driver) {}

  async fork() {
    // Creates this strcutrue:
    //
    // [outerDir]
    //   node_modules
    //   [ROOT_NAME]
    //     <content of the repo goes here>
    //     node_modules
    //
    // The upper node_modules is symlinked to the node_modules dir of the build-raptor repo. This allows us to run
    // tests which use "tsc", "jest" and other tools without having to run "yarn install". The inner node_modules
    // directory is used mostly for storing symlinks to the repo packages to allow inter-repo dependencies.
    const outerDir = await folderify(ROOT_NAME, this.recipe)
    const rootDir = path.join(outerDir, ROOT_NAME)
    const ret = new Fork(rootDir, this.driver.storageClient, this.driver.repoProtocol, this.driver.testName)
    await fse.symlink(path.resolve(__dirname, '../../../../node_modules'), path.join(outerDir, 'node_modules'))
    return ret
  }
}

const ROOT_NAME = 'repo-root'

interface DriverOptions {
  storageClient?: StorageClient
  repoProtocol?: RepoProtocol
}

export class Driver {
  readonly storageClient: StorageClient
  readonly repoProtocol: RepoProtocol

  constructor(readonly testName?: string, options: DriverOptions = {}) {
    this.storageClient = options.storageClient ?? new InMemoryStorageClient()
    this.repoProtocol = options.repoProtocol ?? new SimpleNodeRepoProtocol('modules')
  }

  repo(recipe: FolderifyRecipe) {
    return new Repo(recipe, this)
  }

  packageJson(packageName: string, dependencies: string[] = [], scripts = {}) {
    return {
      name: packageName,
      license: 'UNLICENSED',
      version: '1.0.0',
      scripts: {
        build: 'tsc -b',
        test: 'jest',
        ...scripts,
      },
      files: ['dist/src'],
      main: 'dist/src/index.js',
      jest: {
        roots: ['<rootDir>/dist'],
      },
      dependencies: Object.fromEntries(dependencies.map(d => [d, '1.0.0'])),
    }
  }

  async slurpBlob(blobId?: string) {
    if (!blobId) {
      throw new Error(`bad blobId: <${blobId}>`)
    }
    const taskStore = new TaskStore(this.storageClient, createNopLogger())

    const tempDir = await folderify({})
    const outputDir = path.join(tempDir, blobId)
    await fse.mkdirp(outputDir)
    await taskStore.restoreBlob(BlobId(blobId), outputDir)
    return await slurpDir(outputDir)
  }
}
