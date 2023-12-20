import { BuildFailedError } from 'build-failed-error'
import { BuildRunId } from 'build-run-id'
import child_process from 'child_process'
import { PathInRepo, RepoRoot } from 'core-types'
import * as fs from 'fs'
import * as fse from 'fs-extra'
import ignore from 'ignore'
import { Logger } from 'logger'
import { DirectoryScanner, failMe, Int, shouldNeverHappen, TypedPublisher } from 'misc'
import * as path from 'path'
import { RepoProtocol } from 'repo-protocol'
import { TaskName } from 'task-name'

import { BuildRaptorConfig } from './build-raptor-config'
import { EngineEventScheme } from './engine-event-scheme'
import { ExecutionPlan } from './execution-plan'
import { NopFingerprintLedger, PersistedFingerprintLedger } from './fingerprint-ledger'
import { Fingerprinter } from './fingerprinter'
import { Model } from './model'
import { Planner } from './planner'
import { Purger } from './purger'
import { StepByStepTransmitter } from './step-by-step-transmitter'
import { TaskExecutor } from './task-executor'
import { TaskStore } from './task-store'
import { TaskTracker } from './task-tracker'

export interface EngineOptions {
  /**
   * The directory that build-ratpor was invoked at. If relative it is relative to the repo root. If absolute it must
   * point to a dir somewhere under the repo root.
   */
  userDir: string
  checkGitIgnore?: boolean
  concurrency: Int
  buildRaptorDir: string
  fingerprintLedger?: boolean
  testCaching?: boolean
  commitHash: string | undefined
  stepByStepProcessorModuleName?: string
  config?: BuildRaptorConfig
  toRun?: {
    program: string
    args: string[]
  }
}

type ResolvedEngineOptions = Required<
  Omit<Omit<Omit<EngineOptions, 'stepByStepProcessorModuleName'>, 'toRun'>, 'userDir'> & {
    userDir: PathInRepo
    toRun:
      | {
          program: PathInRepo
          args: string[]
        }
      | undefined
  }
>

export class Engine {
  private readonly options: ResolvedEngineOptions
  private readonly fingerprintLedger
  private readonly purger
  private tracker?: TaskTracker
  private readonly goals: PathInRepo[]

  /**
   *
   * @param logger
   * @param rootDir
   * @param repoProtocol
   * @param taskStore
   * @param taskOutputDir
   * @param command the task kind to run. An empty string means "all tasks".
   * @param units the units whose tasks are to be run. An empty array means "all units".
   * @param goals list of output locations. The tasks that produce these outputs will be added to "tasks to run".
   * @param eventPublisher
   * @param steps
   * @param options
   */
  constructor(
    private readonly logger: Logger,
    private readonly rootDir: RepoRoot,
    private readonly repoProtocol: RepoProtocol,
    private readonly taskStore: TaskStore,
    private readonly taskOutputDir: string,
    private readonly commands: string[],
    private readonly units: string[],
    goals: string[],
    private readonly eventPublisher: TypedPublisher<EngineEventScheme>,
    private readonly steps: StepByStepTransmitter,
    options: EngineOptions,
  ) {
    const userDirAbsolute = path.isAbsolute(options.userDir)
      ? options.userDir
      : this.rootDir.resolve(PathInRepo(options.userDir))
    const userDir = this.rootDir.unresolve(userDirAbsolute)
    this.options = {
      checkGitIgnore: options.checkGitIgnore ?? true,
      concurrency: options.concurrency,
      buildRaptorDir: options.buildRaptorDir,
      fingerprintLedger: options.fingerprintLedger ?? false,
      testCaching: options.testCaching ?? true,
      commitHash: options.commitHash,
      config: options.config ?? {},
      userDir,
      toRun: options.toRun ? { args: options.toRun.args, program: userDir.to(options.toRun.program) } : undefined,
    }
    this.goals = [...goals, options.toRun?.program].flatMap(g => (g ? [g] : [])).map(g => userDir.to(g))
    const ledgerFile = path.join(this.options.buildRaptorDir, 'fingerprint-ledger.json')
    this.eventPublisher.on('taskStore', e => {
      const step =
        e.opcode === 'RECORDED'
          ? 'TASK_STORE_PUT'
          : e.opcode === 'RESTORED'
          ? 'TASK_STORE_GET'
          : shouldNeverHappen(e.opcode)
      const { taskKind, unitId } = TaskName().undo(e.taskName)
      this.steps.push({
        blobId: e.blobId,
        taskName: e.taskName,
        taskKind,
        unitId,
        step,
        fingerprint: e.fingerprint,
        files: e.files,
      })
    })
    this.eventPublisher.on('testEnded', e => {
      this.steps.push({
        step: 'TEST_ENDED',
        taskName: e.taskName,
        fileName: e.fileName,
        testPath: e.testPath,
        verdict: e.verdict,
        durationMillis: e.durationMillis,
      })
    })
    this.eventPublisher.on('assetPublished', e => {
      if (!this.tracker) {
        throw new Error(`tracker is not set`)
      }
      const task = this.tracker?.getTask(e.taskName) ?? failMe(`Task not found (task name=${e.taskName})`)
      const { taskKind, unitId } = TaskName().undo(e.taskName)
      this.steps.push({
        step: 'ASSET_PUBLISHED',
        taskName: e.taskName,
        taskKind,
        unitId,
        fingerprint: task.getFingerprint(),
        casAddress: e.casAddress,
        file: e.file,
      })
    })

    this.fingerprintLedger = this.options.fingerprintLedger
      ? new PersistedFingerprintLedger(logger, ledgerFile)
      : new NopFingerprintLedger()

    this.purger = new Purger(this.logger, this.rootDir)
  }

  async run(buildRunId: BuildRunId) {
    this.steps.push({ step: 'BUILD_RUN_STARTED', buildRunId, commitHash: this.options.commitHash })
    fs.writeFileSync(path.join(this.options.buildRaptorDir, 'build-run-id'), buildRunId)
    await this.fingerprintLedger.updateRun(buildRunId)
    await this.repoProtocol.initialize(this.rootDir, this.eventPublisher, this.options.config.repoProtocol)
    try {
      const model = await this.loadModel(buildRunId)

      const taskList = await this.repoProtocol.getTasks()
      this.logger.info(`catalog=\n${JSON.stringify(taskList, null, 2)}`)
      const plan = await new Planner(this.logger).computePlan(taskList, model)
      const startingPoints = plan.apply(this.commands, this.units, this.goals)
      if (startingPoints.length === 0) {
        throw new BuildFailedError(
          `No tasks to run in this build (command=<${this.commands}>, units=<${JSON.stringify(this.units)})>`,
        )
      }

      const ret = await this.executePlan(plan, model)
      if (ret.successful) {
        await this.executeProgram()
      }
      this.steps.push({ step: 'BUILD_RUN_ENDED' })
      await Promise.all([this.fingerprintLedger.close(), this.steps.close()])
      return ret
    } finally {
      await this.repoProtocol.close()
    }
  }

  async executePlan(plan: ExecutionPlan, model: Model) {
    this.logger.info(`plan.taskGraph=${plan.taskGraph}`)
    const taskTracker = new TaskTracker(plan)
    this.tracker = taskTracker
    const taskExecutor = new TaskExecutor(
      model,
      taskTracker,
      this.logger,
      this.repoProtocol,
      this.taskStore,
      this.taskOutputDir,
      this.eventPublisher,
      this.fingerprintLedger,
      this.purger,
      this.options.testCaching,
      this.options.config.verbosePrintTasks ?? [],
    )

    const workFunction = async (tn: TaskName) => {
      try {
        const deps = this.options.config.tightFingerprints
          ? taskTracker.getTask(tn).taskInfo.deps ?? []
          : plan.taskGraph.neighborsOf(tn)
        await taskExecutor.executeTask(tn, deps)
      } catch (e) {
        this.logger.info(`crashed while running ${tn}`)
        throw e
      } finally {
        taskTracker.changeStatus(tn, 'DONE')
      }
    }

    await plan.taskGraph.execute(this.options.concurrency, workFunction)
    return taskTracker
  }

  async executeProgram() {
    if (!this.options.toRun) {
      return
    }

    const resolved = this.rootDir.resolve(this.options.toRun.program)
    const cwd = this.rootDir.resolve(this.options.userDir)
    const spawnResult = child_process.spawnSync(resolved, this.options.toRun.args, {
      cwd,
      stdio: 'inherit',
      shell: false,
    })
    if (spawnResult.error) {
      throw new BuildFailedError(`could not execute ${this.options.toRun.program}: ${spawnResult.error}`, 'program')
    }

    if (spawnResult.status === 0) {
      return
    }

    throw new BuildFailedError(
      `execution of ${this.options.toRun.program} exited with status=${spawnResult.status}, signal=${spawnResult.signal}`,
      'program',
    )
  }

  async loadModel(buildRunId: BuildRunId) {
    const gitIgnorePath = this.rootDir.resolve(PathInRepo('.gitignore'))
    const ig = ignore()
    if (await fse.pathExists(gitIgnorePath)) {
      const gitIgnoreContent = await fse.readFile(gitIgnorePath, 'utf8')
      const lines = gitIgnoreContent.split('\n')
      this.logger.info(`Found a .gitignore file:\n${JSON.stringify(lines, null, 2)}`)
      ig.add(lines)
    }

    if (this.options.checkGitIgnore) {
      const d = '.build-raptor'
      const ignoresBuildRaptorDir = ig.ignores(d)
      if (!ignoresBuildRaptorDir) {
        throw new BuildFailedError(`the ${d} directory should be .gitignore-d`)
      }
    }

    const [graph, units] = await Promise.all([this.repoProtocol.getGraph(), this.repoProtocol.getUnits()])
    if (graph.isCyclic()) {
      throw new BuildFailedError(`Cyclic dependency detected in ${graph}`)
    }

    this.logger.info(`unit graph=\n${graph}`)
    const scanner = new DirectoryScanner(this.rootDir.resolve(), { predicate: ig.createFilter() })
    const fingerprinter = new Fingerprinter(scanner, this.logger, async (h, c) => {
      if (c) {
        this.fingerprintLedger.updateFile(h, c)
      } else {
        this.fingerprintLedger.updateDirectory(h)
      }
    })
    return new Model(this.rootDir, graph, units, buildRunId, fingerprinter)
  }
}
