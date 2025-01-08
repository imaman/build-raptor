import { Step, StepByStep, StepByStepProcessor } from 'build-raptor-api'
import { loadDynamically } from 'build-raptor-dynamic-loader'
import * as fs from 'fs'
import { Logger } from 'logger'
import * as util from 'util'

export class StepByStepTransmitter {
  private readonly steps: Step[] = []
  private readonly promises: Promise<void>[] = []

  private constructor(
    private readonly stepByStepFile: string,
    private readonly stepByStepProcessor: StepByStepProcessor | undefined,
    private readonly logger: Logger,
  ) {}

  transmit(step: Step) {
    const parsed = Step.parse(step)
    this.steps.push(parsed)

    if (this.stepByStepProcessor) {
      this.promises.push(Promise.resolve(this.stepByStepProcessor(parsed)))
    }
  }

  async close() {
    await Promise.all(this.promises)
    const parsed = StepByStep.parse(this.steps)
    fs.writeFileSync(this.stepByStepFile, JSON.stringify(parsed))
    this.logger.info(`step by step written to ${this.stepByStepFile}`)
  }

  static async create(
    stepByStepFile: string,
    stepByStepProcessorModuleName: string | undefined,
    logger: Logger,
    lookFor = 'processor',
  ) {
    let processor
    if (stepByStepProcessorModuleName) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const imported = loadDynamically(stepByStepProcessorModuleName) as object
      const temp = Object.entries(imported)
        .flatMap(([k, v]) => (k === lookFor ? [v] : []))
        .find(Boolean)
      if (!temp) {
        throw new Error(
          `could not find ${lookFor} in module ${stepByStepProcessorModuleName} which exports ${util.inspect(
            imported,
          )}`,
        )
      }
      processor = temp as StepByStepProcessor // eslint-disable-line @typescript-eslint/consistent-type-assertions
    }

    logger.info(`processor=${util.inspect(processor)}`)
    return new StepByStepTransmitter(stepByStepFile, processor, logger)
  }
}
