import { Step, StepByStep } from 'build-raptor-api'

export class StepByStepTransmitter {
  private readonly steps: StepByStep = []

  push(step: Step) {
    this.steps.push(step)
  }

  close() {}
}
