import { Step } from './build-raptor-api'

/**
 * Class to be extended by a module which is intended to receive steps in realtime (i.e, while the build is
 * running). The module should have a default export of a const declaration of this type. A typical module will
 * therefore look as follows:
 *
 *
 * class MyProcessor extends StepByStepProcessor {
 * ... // class body goes here
 * }
 *
 * export default const processor: StepByStepProcessor = new MyProcessor()
 */
export abstract class StepByStepProcessor {
  abstract process(step: Step): Promise<void>
}
