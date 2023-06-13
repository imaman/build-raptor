import { Step, StepByStep } from 'build-raptor-api'
import * as fs from 'fs'
import { Logger } from 'logger'

export class StepByStepTransmitter {
  private readonly steps: StepByStep = []

  constructor(private readonly stepByStepFile: string, private readonly logger: Logger) {}

  push(step: Step) {
    this.steps.push(step)
  }

  async close() {
    const parsed = StepByStep.parse(this.steps)
    fs.writeFileSync(this.stepByStepFile, JSON.stringify(parsed))
    this.logger.info(`step by step written to ${this.stepByStepFile}`)
  }
}
