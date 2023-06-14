import { Step, StepByStep } from 'build-raptor-api'
import * as fs from 'fs'
import { Logger } from 'logger'

export class StepByStepTransmitter {
  private readonly steps: Step[] = []
  private readonly stream: fs.WriteStream | undefined

  private constructor(
    private readonly stepByStepFile: string,
    stepByStepPipe: string | undefined,
    private readonly logger: Logger,
  ) {
    if (stepByStepPipe) {
      this.stream = fs.createWriteStream(stepByStepPipe)
    }
  }

  push(step: Step) {
    const parsed = Step.parse(step)
    this.steps.push(parsed)
    if (this.stream) {
      this.stream.write(JSON.stringify(parsed))
      this.stream.write('\n')
    }
  }

  async close() {
    await new Promise<void>(res => this.stream?.end(() => res()))
    const parsed = StepByStep.parse(this.steps)
    fs.writeFileSync(this.stepByStepFile, JSON.stringify(parsed))
    this.logger.info(`step by step written to ${this.stepByStepFile}`)
  }

  static async create(stepByStepFile: string, stepByStepPipe: string | undefined, logger: Logger) {
    return new StepByStepTransmitter(stepByStepFile, stepByStepPipe, logger)
  }
}
