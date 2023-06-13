import { Step } from './build-raptor-api'

/**
 * Interface to be implemened by a module which is intended to receive steps in realtime (i.e, while the build is
 * running). The module should have a default export of a const declaration holding an object of this type.
 */
export interface StepByStepProcessor {
  process(step: Step): Promise<void>
}
