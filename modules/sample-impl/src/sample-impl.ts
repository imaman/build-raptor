import { Step, StepByStepProcessor } from 'build-raptor-api'
import * as fs from 'fs'

class MyProcessor extends StepByStepProcessor {
  private n = 0
  async process(step: Step): Promise<void> {
    ++this.n

    fs.writeFileSync(`/tmp/${this.n}.json`, JSON.stringify({ n: this.n, step }))
  }
}

export const processor: StepByStepProcessor = new MyProcessor()
