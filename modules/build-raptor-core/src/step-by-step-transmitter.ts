import { Step, StepByStep } from 'build-raptor-api'
import * as fs from 'fs'
import { Logger } from 'logger'

export class StepByStepTransmitter {
  private readonly steps: Step[] = []

  constructor(private readonly stepByStepFile: string, private readonly logger: Logger) {}

  push(step: Step) {
    const parsed = Step.parse(step)
    this.steps.push(parsed)
  }

  async close() {
    const parsed = StepByStep.parse(this.steps)
    fs.writeFileSync(this.stepByStepFile, JSON.stringify(parsed))
    this.logger.info(`step by step written to ${this.stepByStepFile}`)
  }
}
