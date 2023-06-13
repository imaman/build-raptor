import { Step, StepByStep, StepByStepProcessor } from 'build-raptor-api'
import * as fs from 'fs'
import { Logger } from 'logger'

export class StepByStepTransmitter {
  private readonly steps: Step[] = []

  private constructor(
    private readonly stepByStepFile: string,
    private readonly stepByStepProcessor: StepByStepProcessor | undefined,
    private readonly logger: Logger,
  ) {}

  push(step: Step) {
    const parsed = Step.parse(step)
    this.steps.push(parsed)
  }

  async close() {
    const parsed = StepByStep.parse(this.steps)
    fs.writeFileSync(this.stepByStepFile, JSON.stringify(parsed))
    this.logger.info(`step by step written to ${this.stepByStepFile}`)
  }

  static async create(stepByStepFile: string, stepByStepProcessorModuleName: string | undefined, logger: Logger) {
    let processor
    if (stepByStepProcessorModuleName) {
      const imported = await import(stepByStepProcessorModuleName)
      processor = imported.default
      if (!(processor instanceof StepByStepProcessor)) {
        throw new Error(
          `object loaded from ${stepByStepProcessorModuleName} is not an instance of ${StepByStepProcessor.name}`,
        )
      }
    }

    return new StepByStepTransmitter(stepByStepFile, processor, logger)
  }
}
