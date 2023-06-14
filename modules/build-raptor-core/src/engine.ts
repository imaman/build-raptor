import { BuildFailedError } from 'build-failed-error'
import { BuildRunId } from 'build-run-id'
import * as fse from 'fs-extra'
import ignore from 'ignore'
import { Logger } from 'logger'
import { DirectoryScanner, groupBy, Int, recordToPairs, shouldNeverHappen, TypedPublisher } from 'misc'
import * as path from 'path'
import { RepoProtocol } from 'repo-protocol'
import { TaskName } from 'task-name'
import * as util from 'util'

import { EngineEventScheme } from './engine-event-scheme'
import { ExecutionPlan } from './execution-plan'
import { NopFingerprintLedger, PersistedFingerprintLedger } from './fingerprint-ledger'
import { Fingerprinter } from './fingerprinter'
import { Model } from './model'
import { Planner } from './planner'
import { Purger } from './purger'
import { StepByStepTransmitter } from './step-by-step-transmitter'
import { Task } from './task'
import { TaskExecutor } from './task-executor'
import { TaskStore } from './task-store'
import { TaskTracker } from './task-tracker'

export interface EngineOptions {
  checkGitIgnore?: boolean
  concurrency: Int
  buildRaptorDir: string
  fingerprintLedger?: boolean
  testCaching?: boolean
  commitHash: string | undefined
  stepByStepPipe?: string
}

export class Engine {
  private readonly options: Required<Omit<EngineOptions, 'stepByStepPipe'>>
  private readonly fingerprintLedger
  private readonly purger
  /**
   *
   * @param logger
   * @param rootDir
   * @param repoProtocol
   * @param taskStore
   * @param printPassing whehter to send the output of passing tasks to stdout.
   * @param taskOutputDir
   * @param command the task kind to run. An empty string means "all tasks".
   * @param units the units whose tasks are to be run. An empty array means "all units".
   */
  constructor(
    private readonly logger: Logger,
    private readonly rootDir: string,
    private readonly repoProtocol: RepoProtocol,
    private readonly taskStore: TaskStore,
    private readonly taskOutputDir: string,
    private readonly command: string,
    private readonly units: string[],
    private readonly eventPublisher: TypedPublisher<EngineEventScheme>,
    private readonly steps: StepByStepTransmitter,
    options: EngineOptions,
  ) {
    this.options = {
      checkGitIgnore: options.checkGitIgnore ?? true,
      concurrency: options.concurrency,
      buildRaptorDir: options.buildRaptorDir,
      fingerprintLedger: options.fingerprintLedger ?? false,
      testCaching: options.testCaching ?? true,
      commitHash: options.commitHash,
    }
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
      const { taskKind, unitId } = TaskName().undo(e.taskName)
      this.steps.push({
        step: 'ASSET_PUBLISHED',
        taskName: e.taskName,
        taskKind,
        unitId,
        fingerprint: e.fingerprint,
        casAddress: e.casAddress,
        file: e.file,
      })
    })

    this.fingerprintLedger = this.options.fingerprintLedger
      ? new PersistedFingerprintLedger(logger, ledgerFile)
      : new NopFingerprintLedger()

    this.purger = new Purger(this.logger)
  }

  async run(buildRunId: BuildRunId) {
    this.steps.push({ step: 'BUILD_RUN_STARTED', buildRunId, commitHash: this.options.commitHash })
    await this.fingerprintLedger.updateRun(buildRunId)
    await this.repoProtocol.initialize(this.rootDir, this.eventPublisher)
    try {
      const model = await this.loadModel(buildRunId)

      const catalog = await this.repoProtocol.getTasks()
      this.logger.info(`catalog=\n${JSON.stringify(catalog, null, 2)}`)
      const plan = await new Planner(this.logger).computePlan(model, catalog)
      const startingPoints = plan.apply(this.command, this.units)
      if (startingPoints.length === 0) {
        throw new BuildFailedError(
          `No tasks to run in this build (command=<${this.command}>, units=<${JSON.stringify(this.units)})>`,
        )
      }

      const tracker = await this.execute(plan, model)
      await Promise.all([this.fingerprintLedger.close(), this.steps.close()])
      return tracker
    } finally {
      await this.repoProtocol.close()
    }
  }

  async execute(plan: ExecutionPlan, model: Model) {
    this.logger.info(`plan.taskGraph=${plan.taskGraph}`)
    const taskTracker = new TaskTracker(plan)
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
    )

    const batchScheduler = (batch: TaskName[]) => {
      const tasks = batch.map(taskName => taskTracker.getTask(taskName))
      const filtered = tasks.filter(t => t.shadowingEnabled)

      if (!filtered.length) {
        this.logger.info(`No batch scheduling for ${JSON.stringify(batch)}`)
        return undefined
      }

      const grouping = groupBy(filtered, t => t.kind)
      const shadowedBy = new Map<TaskName, TaskName>()
      for (const [_, ts] of recordToPairs(grouping)) {
        for (const t of ts) {
          if (shadowedBy.has(t.name)) {
            continue
          }

          const isSameKind = (tn: TaskName, task: Task) => TaskName().undo(tn).taskKind === task.kind
          const isShadowing = (tn: TaskName) => {
            if (!isSameKind(tn, t)) {
              return false
            }
            const dependents = plan.taskGraph.backNeighborsOf(tn)
            return dependents.filter(at => isSameKind(at, t)).length === 0
          }

          const shadowingTasks = plan.taskGraph
            .traverseFrom(t.name, { direction: 'backwards' })
            .filter(tn => isShadowing(tn))

          const chosen = shadowingTasks.find(Boolean) ?? t.name
          shadowedBy.set(t.name, chosen)
        }
      }

      for (const [shadowed, shadowing] of shadowedBy) {
        taskTracker.registerShadowing(shadowed, shadowing)
        plan.errorPropagationGraph.edge(shadowed, shadowing)
      }

      this.logger.info(`shadowing of batch ${JSON.stringify(batch)} is: ${util.inspect(shadowedBy)}`)
      // We return undefined because we do not use the batch-scheduling functionality. we go all the information
      // we needed from the batch and stored it in taskTracker. This information will be used to affect the actual
      // execution of the tasks.
      return undefined
    }

    const workFunction = async (tn: TaskName) => {
      try {
        const deps = plan.taskGraph.neighborsOf(tn)
        await taskExecutor.executeTask(tn, deps)
      } catch (e) {
        this.logger.info(`crashed while running ${tn}`)
        throw e
      } finally {
        taskTracker.changeStatus(tn, 'DONE')
      }
    }

    await plan.taskGraph.execute(this.options.concurrency, workFunction, batchScheduler)
    return taskTracker
  }

  async loadModel(buildRunId: BuildRunId) {
    const gitIgnorePath = path.join(this.rootDir, '.gitignore')
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
    const scanner = new DirectoryScanner(this.rootDir, { predicate: ig.createFilter() })
    const fingerprinter = new Fingerprinter(scanner, this.logger, async (h, c) => {
      if (c) {
        this.fingerprintLedger.updateFile(h, c)
      } else {
        this.fingerprintLedger.updateDirectory(h)
      }
    })
    return new Model(path.resolve(this.rootDir), graph, units, buildRunId, fingerprinter)
  }
}
