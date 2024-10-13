import { Step } from './build-raptor-api'

/**
 * StepByStepProcessor is a function type for processing build steps in real-time.
 *
 * To use with build-raptor:
 * 1. Create a Node.js module that exports a function of this type.
 * 2. Import the necessary types from 'build-raptor-api'.
 * 3. Implement the processing logic.
 * 4. Export the function as 'processor'.
 *
 * Example implementation:
 * ```typescript
 * import { Step, StepByStepProcessor } from 'build-raptor-api'
 * export const processor: StepByStepProcessor = (step: Step) => {
 *   console.log(`Processing step: ${JSON.stringify(step)}`)
 * }
 * ```
 *
 * Usage: Provide the path to your module as an argument to build-raptor's
 * --step-by-step-processor command-line option.
 */
export type StepByStepProcessor = (step: Step) => void | Promise<void>
