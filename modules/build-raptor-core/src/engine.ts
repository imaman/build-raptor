import { BuildFailedError } from 'build-failed-error'
import { BuildRunId } from 'build-run-id'
import * as fse from 'fs-extra'
import ignore from 'ignore'
import { Logger } from 'logger'
import { DirectoryScanner, Graph, groupBy, Int, recordToPairs, TypedPublisher } from 'misc'
import * as path from 'path'
import { RepoProtocol } from 'repo-protocol'
import { TaskName } from 'task-name'
import { UnitId } from 'unit-metadata'

import { EngineEventScheme } from './engine-event-scheme'
import { ExecutionPlan } from './execution-plan'
import { NopFingerprintLedger, PersistedFingerprintLedger } from './fingerprint-ledger'
import { Fingerprinter } from './fingerprinter'
import { Model } from './model'
import { Planner } from './planner'
import { TaskExecutor } from './task-executor'
import { TaskStore } from './task-store'
import { TaskTracker } from './task-tracker'

export interface EngineOptions {
  checkGitIgnore?: boolean
  concurrency: Int
  buildRaptorDir: string
  fingerprintLedger?: boolean
}

export class Engine {
  private readonly options: Required<EngineOptions>
  private readonly fingerprintLedger

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
    options: EngineOptions,
  ) {
    this.options = {
      checkGitIgnore: options.checkGitIgnore ?? true,
      concurrency: options.concurrency,
      buildRaptorDir: options.buildRaptorDir,
      fingerprintLedger: options.fingerprintLedger ?? false,
    }
    const ledgerFile = path.join(this.options.buildRaptorDir, 'fingerprint-ledger.json')
    this.fingerprintLedger = this.options.fingerprintLedger
      ? new PersistedFingerprintLedger(logger, ledgerFile)
      : new NopFingerprintLedger()
  }

  async run(buildRunId: BuildRunId) {
    await this.fingerprintLedger.updateRun(buildRunId)
    await this.repoProtocol.initialize(this.rootDir)
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
      await this.fingerprintLedger.close()
      return tracker
    } finally {
      await this.repoProtocol.close()
    }
  }

  async execute(plan: ExecutionPlan, model: Model) {
    const taskTracker = new TaskTracker(plan)

    const batchScheduler = (batch: TaskName[]) => {
      const tasks = batch.map(taskName => taskTracker.getTask(taskName))
      const filtered = tasks.filter(t => t.shadowingEnabled)

      if (!filtered.length) {
        this.logger.info(`No batch scheduling for ${JSON.stringify(batch)}`)
        return undefined
      }

      const ret = new Graph<TaskName>(x => x)
      for (const t of tasks) {
        ret.vertex(t.name)
      }

      const grouping = groupBy(filtered, t => t.kind)
      for (const [_, ts] of recordToPairs(grouping)) {
        const shadowingCandidates = new Set<TaskName>(ts.map(t => t.name))
        for (const t of ts) {
          if (!shadowingCandidates.has(t.name)) {
            continue
          }
          const reachable = new Set<UnitId>(model.graph.traverseFrom(t.unitId))
          reachable.delete(t.unitId)

          for (const cand of shadowingCandidates) {
            const unitId = TaskName().undo(cand).unitId
            if (!reachable.has(unitId)) {
              continue
            }

            shadowingCandidates.delete(cand)
            taskTracker.addShadowed(cand)
            plan.errorPropagationGraph.edge(cand, t.name)
            ret.edge(cand, t.name)
          }
        }
      }

      this.logger.info(`batch scheduling:\n${ret}`)

      // TODO(imaman): the graph here can be further optimized.
      return ret
    }

    await plan.taskGraph.execute(
      this.options.concurrency,
      async tn => {
        if (taskTracker.hasVerdict(tn)) {
          return
        }

        try {
          taskTracker.changeStatus(tn, 'RUNNING')
          const taskExecutor = new TaskExecutor(
            tn,
            model,
            taskTracker,
            this.logger,
            this.repoProtocol,
            this.taskStore,
            this.taskOutputDir,
            this.eventPublisher,
            this.fingerprintLedger,
          )
          await taskExecutor.executeTask(tn, model, taskTracker)
        } catch (e) {
          this.logger.info(`crashed while running ${tn}`)
          throw e
        } finally {
          taskTracker.changeStatus(tn, 'DONE')
        }
      },
      batchScheduler,
    )

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
