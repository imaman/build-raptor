import { Step } from './build-raptor-api'

/**
 * Class to be extended by a module which is intended to receive steps in realtime (i.e, while the build is
 * running). The module should have have a `const export` of `processor: StepByStepProcessor`. A typical module will
 * therefore look as follows:
 *
 *
 * class MyProcessor extends StepByStepProcessor {
 * ... // class body goes here
 * }
 *
 * export const processor: StepByStepProcessor = new MyProcessor()
 */
export abstract class StepByStepProcessor {
  abstract process(step: Step): Promise<void>
}
