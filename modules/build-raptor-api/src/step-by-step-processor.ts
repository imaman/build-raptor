import { Step } from './build-raptor-api'

/**
 * StepByStepProcessor is a function type for processing build steps in real-time.
 * Each step's details are passed to your processor as it occurs during the build.
 *
 * To use with build-raptor:
 * 1. Create a file that imports the necessary types from 'build-raptor-api'
 * 2. Implement and export a function called `processor` matching the `StepByStepProcessor` type
 * 3. The function can be async or sync and should handle the `Step` object according to your needs
 *
 * ## Example Implementation (my-step-processor.ts)
 * ```typescript
 * import { Step, StepByStepProcessor } from 'build-raptor-api'
 *
 * export const processor: StepByStepProcessor = async (step: Step) => {
 *   // Log step details
 *   console.log(`Step "${step.name}" status: ${step.status}`)
 *
 *   // Send metrics to monitoring system
 *   await sendMetrics({
 *     stepName: step.name,
 *     duration: step.duration,
 *     status: step.status
 *   })
 * }
 * ```
 *
 * ## Usage
 * To make build-raptor use your own processor:
 *
 * ```bash
 * build-raptor --step-by-step-processor ./path/to/my-step-processor.js
 * ```
 */
export type StepByStepProcessor = (step: Step) => void | Promise<void>
