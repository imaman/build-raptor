import { Step } from './build-raptor-api'

export type StepByStepProcessor = (s: Step) => void | Promise<void>
/**
 * Class to be extended by a module which is intended to receive steps in realtime (i.e, while the build is
 * running). The module should have have a `const export` of type`StepByStepProcessor`. A typical module will
 * therefore look as follows:
 *
 * import {Step, StepByStepProcessor} from 'build-raptor-api'
 *
 * export const processor: StepByStepProcessor = (s: Step) => console.log(`received: ${JSON.stringify(s)})
 */
