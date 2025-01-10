import { Step, StepByStep, StepByStepProcessor } from 'build-raptor-api'
import { loadDynamically } from 'build-raptor-dynamic-loader'
import * as fs from 'fs'
import { Logger } from 'logger'
import * as util from 'util'

export class StepByStepTransmitter {
  private readonly steps: Step[] = []
  private readonly promises: Promise<void>[] = []
  private readonly stepByStepProcessors: StepByStepProcessor[] = []
  private stepByStepFile: string | undefined = undefined

  constructor(private readonly logger: Logger) {}

  setOutputFile(f: string) {
    this.stepByStepFile = f
  }

  addProcessor(p: StepByStepProcessor) {
    this.stepByStepProcessors.push(p)
  }

  transmit(step: Step) {
    const parsed = Step.parse(step)
    this.steps.push(parsed)

    for (const p of this.stepByStepProcessors) {
      this.promises.push(Promise.resolve(p(parsed)))
    }
  }

  async close() {
    await Promise.all(this.promises)
    if (!this.stepByStepFile) {
      return
    }
    const parsed = StepByStep.parse(this.steps)
    fs.writeFileSync(this.stepByStepFile, JSON.stringify(parsed))
    this.logger.info(`step by step written to ${this.stepByStepFile}`)
  }

  async dynamicallyLoadProcessor(stepByStepProcessorModuleName: string, lookFor = 'processor') {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const imported = loadDynamically(stepByStepProcessorModuleName) as object
    const temp = Object.entries(imported)
      .flatMap(([k, v]) => (k === lookFor ? [v] : []))
      .find(Boolean)
    if (!temp) {
      throw new Error(
        `could not find ${lookFor} in module ${stepByStepProcessorModuleName} which exports ${util.inspect(imported)}`,
      )
    }
    const processor = temp as StepByStepProcessor // eslint-disable-line @typescript-eslint/consistent-type-assertions

    this.logger.info(`processor=${util.inspect(processor)}`)
    this.addProcessor(processor)
  }
}
