import { BuildFailedError } from 'build-failed-error'
import { BuildRunId } from 'build-run-id'
import { PathInRepo, RepoRoot } from 'core-types'
import * as fs from 'fs'
import * as JsoncParser from 'jsonc-parser'
import { createDefaultLogger, Criticality, Logger } from 'logger'
import { errorLike, StorageClient, Subscribable, switchOn, TypedPublisher } from 'misc'
import * as path from 'path'
import { RepoProtocol } from 'repo-protocol'
import * as Tmp from 'tmp-promise'
import * as util from 'util'
import * as uuid from 'uuid'
import { z } from 'zod'

import { Breakdown } from './breakdown'
import { BuildRaptorConfig } from './build-raptor-config'
import { Engine, EngineOptions } from './engine'
import { EngineEventScheme } from './engine-event-scheme'
import { examplifyZod } from './examplify-zod'
import { StepByStepTransmitter } from './step-by-step-transmitter'
import { Task } from './task'
import { TaskStore } from './task-store'
import { TaskSummary } from './task-summary'

export interface TaskSelector {
  /**
   * units the units whose tasks are to be built. An empty array means "all units".
   */
  units: string[]
  /**
   * a list of output locations. The tasks that produce these outputs will be added to "tasks to run".
   */
  goals: string[]
  labels: string[]
}

export class EngineBootstrapper {
  private readonly eventPublisher = new TypedPublisher<EngineEventScheme>()
  readonly transmitter
  readonly rootDir

  private constructor(
    rootDir: string,
    readonly t0: number,
    readonly logger: Logger,
    readonly storageClient: StorageClient,
    readonly repoProtocol: RepoProtocol,
  ) {
    this.rootDir = RepoRoot(rootDir)
    this.transmitter = new StepByStepTransmitter(logger)
  }

  private async makeEngine(
    selector: TaskSelector,
    configFile: string | undefined,
    optionsSansConfig: Omit<EngineOptions, 'config'>,
  ) {
    const taskOutputDir = (await Tmp.dir()).path
    this.logger.info(`rootDir is ${this.rootDir}`)
    this.logger.info(`The console outputs (stdout/stderr) of tasks are stored under ${taskOutputDir}`)

    const resolvedConfigFile = configFile ? PathInRepo(configFile) : this.resolveConfigFile()
    const options = {
      ...optionsSansConfig,
      config: this.readConfigFile(resolvedConfigFile),
    }

    const taskStore = new TaskStore(this.rootDir, this.storageClient, this.logger, this.eventPublisher)

    const stepByStepFile = path.join(options.buildRaptorDir, 'step-by-step.json')
    this.transmitter.setOutputFile(stepByStepFile)
    if (options.stepByStepProcessorModuleName) {
      this.transmitter.dynamicallyLoadProcessor(options.stepByStepProcessorModuleName)
    }
    const engine = new Engine(
      this.logger,
      this.rootDir,
      this.repoProtocol,
      taskStore,
      taskOutputDir,
      selector,
      this.eventPublisher,
      this.transmitter,
      options,
    )
    return engine
  }

  static readonly CONFIG_FILES = ['.build-raptor.jsonc', '.build-raptor.json']

  private resolveConfigFile(): PathInRepo | undefined {
    const arr = EngineBootstrapper.CONFIG_FILES.map(at => PathInRepo(at))
    const existings = arr.flatMap(at => (fs.existsSync(this.rootDir.resolve(at)) ? [at] : []))
    if (existings.length > 1) {
      throw new Error(
        `Found competing config files: ${existings.join(', ')}. To avoid confusion, you must keep just one.`,
      )
    }

    return existings.at(0)
  }

  private readConfigFile(pathToConfigFile: PathInRepo | undefined): BuildRaptorConfig {
    if (pathToConfigFile === undefined) {
      return BuildRaptorConfig.parse({})
    }

    const p = this.rootDir.resolve(pathToConfigFile)
    try {
      if (!fs.existsSync(p)) {
        return BuildRaptorConfig.parse({})
      }
      const content = fs.readFileSync(p, 'utf-8')
      const errors: JsoncParser.ParseError[] = []
      const parsed = JsoncParser.parse(content, errors, { allowTrailingComma: true, allowEmptyContent: true })
      const e = errors.at(0)
      if (e) {
        throw new Error(`Bad format: ${JsoncParser.printParseErrorCode(e.error)} at position ${e.offset}`)
      }
      return BuildRaptorConfig.parse(parsed)
    } catch (e) {
      throw new Error(`could not read repo config file ${p} - ${errorLike(e).message}`)
    }
  }

  get subscribable(): Subscribable<EngineEventScheme> {
    return this.eventPublisher
  }

  private newBuildRunId() {
    return BuildRunId(uuid.v4())
  }

  getConfigFileExample() {
    const withRepoProtocol = z.object({ ...BuildRaptorConfig.shape, repoProtocol: this.repoProtocol.getConfigSchema() })
    return examplifyZod(withRepoProtocol, {})
  }

  /**
   * Returns a "runner function". When the runner function is invoked, a build will run.
   *
   * @param configFile
   * @param options
   * @returns
   */
  async makeRunner(selector: TaskSelector, configFile: string | undefined, options: Omit<EngineOptions, 'config'>) {
    try {
      const t1 = Date.now()
      this.logger.info(`Creating a runner for ${JSON.stringify({ selector, options })}`)
      const engine = await this.makeEngine(selector, configFile, options)
      const buildRunId = this.newBuildRunId()
      return async () => {
        try {
          const tracker = await engine.run(buildRunId)
          const t2 = Date.now()
          this.logger.info(`Engine finished in ${t2 - t1}ms (${t2 - this.t0}ms incl. bootstrapping)`)
          const successful = tracker.successful
          this.logger.info(`tasks=${JSON.stringify(tracker.tasks(), null, 2)}`)
          this.logger.info(`performance report: ${JSON.stringify(tracker.getPerformanceReport(), null, 2)}`)

          if (successful) {
            await engine.executeProgram()
          }

          return new Breakdown(
            successful ? 'OK' : 'FAIL',
            buildRunId,
            tracker.tasks().map(t => summarizeTask(t)),
            this.rootDir.resolve(),
            tracker.getPerformanceReport(),
          )
        } catch (err) {
          if (err instanceof BuildFailedError) {
            const prefix = switchOn(err.hint, {
              program: () => '',
              task: () => 'build-raptor detected the following problem: ',
            })
            // TODO(imaman): cover this print
            this.logger.print(`${prefix}${err.message}`, 'high')
            return new Breakdown(
              'FAIL',
              buildRunId,
              [],
              this.rootDir.resolve(),
              undefined,
              undefined,
              errorLike(err).message,
            )
          }
          this.logger.error(`this build-raptor run has crashed due to an unexpected error`, err)
          this.logger.print(`this build-raptor run has crashed due to an unexpected error ${util.inspect(err)}`, 'high')
          return new Breakdown('CRASH', buildRunId, [], this.rootDir.resolve(), undefined, err)
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
    criticalityLevel: Criticality,
    name?: string,
    logger?: Logger,
  ) {
    if (!logger) {
      const logFile = path.join(rootDir, 'build-raptor.log')
      logger = createDefaultLogger(logFile, criticalityLevel)
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
