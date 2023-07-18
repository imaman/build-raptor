import { BuildFailedError } from 'build-failed-error'
import { BuildRunId } from 'build-run-id'
import * as fs from 'fs'
import { createDefaultLogger, Logger } from 'logger'
import { errorLike, StorageClient, Subscribable, TypedPublisher } from 'misc'
import * as path from 'path'
import { RepoProtocol } from 'repo-protocol'
import * as Tmp from 'tmp-promise'
import * as util from 'util'
import * as uuid from 'uuid'

import { Breakdown } from './breakdown'
import { BuildRaptorConfig } from './build-raptor-config'
import { Engine, EngineOptions } from './engine'
import { EngineEventScheme } from './engine-event-scheme'
import { StepByStepTransmitter } from './step-by-step-transmitter'
import { Task } from './task'
import { TaskStore } from './task-store'
import { TaskSummary } from './task-summary'

export class EngineBootstrapper {
  private readonly eventPublisher = new TypedPublisher<EngineEventScheme>()
  private constructor(
    readonly rootDir: string,
    readonly t0: number,
    readonly logger: Logger,
    readonly storageClient: StorageClient,
    readonly repoProtocol: RepoProtocol,
  ) {}

  private async makeEngine(command: string, units: string[], options: EngineOptions) {
    const taskOutputDir = (await Tmp.dir()).path
    this.logger.info(`rootDir is ${this.rootDir}`)
    this.logger.info(`The console outputs (stdout/stderr) of tasks are stored under ${taskOutputDir}`)
    options.buildRaptorConfigFile = options.buildRaptorConfigFile ?? '.build-raptor.json'
    options.config = this.readConfigFile(options.buildRaptorConfigFile)

    const taskStore = new TaskStore(this.storageClient, this.logger, this.eventPublisher)

    const stepByStepFile = path.join(options.buildRaptorDir, 'step-by-step.json')
    const transmitter = await StepByStepTransmitter.create(
      stepByStepFile,
      options.stepByStepProcessorModuleName,
      this.logger,
    )
    const engine = new Engine(
      this.logger,
      this.rootDir,
      this.repoProtocol,
      taskStore,
      taskOutputDir,
      command,
      units,
      this.eventPublisher,
      transmitter,
      options,
    )
    return engine
  }

  private readConfigFile(pathToConfigFile: string) {
    if (path.isAbsolute(pathToConfigFile)) {
      throw new Error(`pathToConfigFile should be relative (got: ${pathToConfigFile})`)
    }
    const p = path.join(this.rootDir, pathToConfigFile)
    try {
      if (!fs.existsSync(p)) {
        return undefined
      }
      const content = fs.readFileSync(p, 'utf-8')
      const parsed = JSON.parse(content)
      return BuildRaptorConfig.parse(parsed)
    } catch (e) {
      throw new Error(`could not read repo config file ${p} - ${e}`)
    }
  }

  get subscribable(): Subscribable<EngineEventScheme> {
    return this.eventPublisher
  }

  private newBuildRunId() {
    return BuildRunId(uuid.v4())
  }

  /**
   * Returns a "runner function". When the runner function is invoked, a build will run.
   *
   * @param command the task kind to build. An empty string means "all tasks".
   * @param units the units whose tasks are to be built. An empty array means "all units".
   * @param printPassing whehter to send the output of passing tasks to stdout.
   * @param concurrency maximum number of tasks to run in parallel.
   * @returns
   */
  async makeRunner(command: string, units: string[], options: EngineOptions) {
    try {
      const t1 = Date.now()
      this.logger.info(`Creating a runner for ${JSON.stringify({ command, units, options })}`)
      const engine = await this.makeEngine(command, units, options)
      const buildRunId = this.newBuildRunId()
      return async () => {
        try {
          const tracker = await engine.run(buildRunId)
          const t2 = Date.now()
          this.logger.info(`Engine finished in ${t2 - t1}ms (${t2 - this.t0}ms incl. bootstrapping)`)
          const successful = tracker.tasks().every(t => t.record.verdict === 'OK')
          this.logger.info(`tasks=${JSON.stringify(tracker.tasks(), null, 2)}`)
          this.logger.info(`performance report: ${JSON.stringify(tracker.getPerformanceReport(), null, 2)}`)
          return new Breakdown(
            successful ? 'OK' : 'FAIL',
            buildRunId,
            tracker.tasks().map(t => summarizeTask(t)),
            this.rootDir,
            tracker.getPerformanceReport(),
          )
        } catch (err) {
          if (err instanceof BuildFailedError) {
            // TODO(imaman): cover this print
            this.logger.print(`build-raptor detected the following problem: ${err.message}`)
            return new Breakdown('FAIL', buildRunId, [], this.rootDir, undefined, undefined, errorLike(err).message)
          }
          this.logger.error(`this build-raptor run has crashed due to an unexpected error`, err)
          this.logger.print(`this build-raptor run has crashed due to an unexpected error ${util.inspect(err)}`)
          return new Breakdown('CRASH', buildRunId, [], this.rootDir, undefined, err)
        }
      }
    } catch (err) {
      this.logger.error(`failed to initialize build-raptor`, err)
      throw err
    }
  }

  static async create(
    rootDir: string,
    storageClient: StorageClient,
    repoProtocol: RepoProtocol,
    t0: number,
    name?: string,
    logger?: Logger,
  ) {
    if (!logger) {
      const logFile = path.join(rootDir, 'build-raptor.log')
      logger = createDefaultLogger(logFile)
      logger.info(`Logger initialized`)
      const formatted = name ? ` ("${name}") ` : ' '
      logger.print(`logging${formatted}to ${logFile}`)
    }

    return new EngineBootstrapper(rootDir, t0, logger, storageClient, repoProtocol)
  }
}

function summarizeTask(t: Task): TaskSummary {
  return {
    outputFile: t.record.outputFile,
    taskName: t.name,
    verdict: t.record.verdict,
    execution: t.record.executionType,
    startedAt: t.record.startedAt,
    endedAt: t.record.endedAt,
    rootCause: t.record.rootCause,
  }
}
