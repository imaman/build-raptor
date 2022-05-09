import { Breakdown, EngineBootstrapper } from 'build-raptor-core'
import * as fse from 'fs-extra'
import { folderify, FolderifyRecipe, InMemoryStorageClient, Int, StorageClient } from 'misc'
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

  async write(content: string) {
    await fse.writeFile(this.resolve(), content)
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
}
class Fork {
  constructor(
    private readonly dir: string,
    private readonly storageClient: StorageClient,
    private readonly repoProtocol: RepoProtocol,
    private readonly testName?: string,
  ) {}

  async run(expectedStatus: 'OK' | 'FAIL' | 'CRASH', options: RunOptions = {}): Promise<Run> {
    const command = options.taskKind ?? ''
    const units = options.units ?? []
    const concurrencyLevel = Int(options.concurrencyLevel ?? 10)
    const rp = this.repoProtocol
    const bootstrapper = await EngineBootstrapper.create(this.dir, this.storageClient, rp, Date.now(), this.testName)
    const runner = await bootstrapper.makeRunner(command, units, {
      checkGitIgnore: options.checkGitIgnore ?? false,
      concurrency: concurrencyLevel,
      buildRaptorDir: await folderify({}),
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
}

class Repo {
  constructor(private readonly recipe: FolderifyRecipe, private readonly driver: Driver) {}

  async fork() {
    const dir = await folderify(this.recipe)
    return new Fork(dir, this.driver.storageClient, this.driver.repoProtocol, this.driver.testName)
  }
}

interface DriverOptions {
  storageClient?: StorageClient
  repoProtocol?: RepoProtocol
}

export class Driver {
  readonly storageClient: StorageClient
  readonly repoProtocol: RepoProtocol

  constructor(readonly testName: string, options: DriverOptions = {}) {
    this.storageClient = options.storageClient ?? new InMemoryStorageClient()
    this.repoProtocol = options.repoProtocol ?? new SimpleNodeRepoProtocol('modules')
  }

  repo(recipe: FolderifyRecipe) {
    return new Repo(recipe, this)
  }
}
