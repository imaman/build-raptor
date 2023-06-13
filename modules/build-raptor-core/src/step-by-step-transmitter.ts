import { Step, StepByStep, StepByStepProcessor } from 'build-raptor-api'
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

  push(step: Step) {
    const parsed = Step.parse(step)
    this.steps.push(parsed)

    if (this.stepByStepProcessor) {
      this.promises.push(this.stepByStepProcessor.process(parsed))
    }
  }

  async close() {
    await Promise.all(this.promises)
    const parsed = StepByStep.parse(this.steps)
    fs.writeFileSync(this.stepByStepFile, JSON.stringify(parsed))
    this.logger.info(`step by step written to ${this.stepByStepFile}`)
  }

  static async create(stepByStepFile: string, stepByStepProcessorModuleName: string | undefined, logger: Logger) {
    let processor
    if (stepByStepProcessorModuleName) {
      const imported = await import(stepByStepProcessorModuleName)
      processor = imported.processor
      if (!(processor instanceof StepByStepProcessor)) {
        throw new Error(
          `object loaded from ${stepByStepProcessorModuleName} is not an instance of ${
            StepByStepProcessor.name
          }: ${util.inspect(processor)}`,
        )
      }
    }

    this.logger.info(`processor=${util.inspect(processor)}`)
    return new StepByStepTransmitter(stepByStepFile, processor, logger)
  }
}
