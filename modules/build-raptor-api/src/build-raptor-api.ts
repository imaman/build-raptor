import { z } from 'zod'

/**
 * Represents a union of possible build step types, discriminated by the 'step' field.
 * Each step type contains specific information about different phases of the build process.
 */
export const Step = z.discriminatedUnion('step', [
  z.object({
    step: z.literal('BUILD_RUN_STARTED'),
    buildRunId: z.string(),
    commitHash: z.string().optional(),
  }),
  z.object({
    step: z.literal('BUILD_RUN_ENDED'),
  }),
  z.object({
    step: z.literal('TASK_STORE_PUT'),
    fingerprint: z.string().optional(),
    taskName: z.string(),
    unitId: z.string(),
    taskKind: z.string(),
    blobId: z.string(),
    files: z.string().array(),
  }),
  z.object({
    step: z.literal('TASK_STORE_GET'),
    fingerprint: z.string().optional(),
    taskName: z.string(),
    unitId: z.string(),
    taskKind: z.string(),
    blobId: z.string(),
    files: z.string().array(),
  }),
  z.object({
    step: z.literal('TEST_ENDED'),
    taskName: z.string(),
    fileName: z.string(),
    testPath: z.string().array(),
    durationMillis: z.number().or(z.undefined()),
    verdict: z.union([
      z.literal('TEST_PASSED'),
      z.literal('TEST_FAILED'),
      z.literal('TEST_CRASHED'),
      z.literal('TEST_TIMEDOUT'),
    ]),
  }),
  /**
   * Indicates the completion of a build task. This step is emitted when a task either completes execution or is
   * determined to be skippable due to caching.
   *
   * @example
   * // Example of a successfully executed task
   * {
   *   step: 'TASK_ENDED',
   *   taskName: 'webapp:build',
   *   status: 'OK'
   * }
   *
   * // Example of a skipped task due to cache hit
   * {
   *   step: 'TASK_ENDED',
   *   taskName: 'webapp:test',
   *   status: 'SKIPPED'
   * }
   */
  z.object({
    step: z.literal('TASK_ENDED'),
    /** The fully qualified name of the task (e.g., 'moduleA:build') */
    taskName: z.string(),
    /** Status indicating how the task completed */
    verdict: z.union([
      /** Task executed and completed successfully */
      z.literal('OK'),
      /** Task executed but failed with an error code */
      z.literal('FAIL'),
      /** Task execution terminated unexpectedly (e.g., ran out of memory) */
      z.literal('CRASH'),
      /** Task execution terminated unexpectedly (e.g., ran out of memory) */
      z.literal('UNKNOWN'),
    ]),
    executionType: z.union([
      z.literal('EXECUTED'),
      z.literal('CACHED'),
      z.literal('UNKNOWN'),
      z.literal('CANNOT_START'),
    ]),
  }),
  z.object({
    step: z.literal('ASSET_PUBLISHED'),
    labels: z.string().array(),
    taskName: z.string(),
    unitId: z.string(),
    taskKind: z.unknown(),
    fingerprint: z.string(),
    casAddress: z.string(),
    file: z.string(),
  }),
  z.object({
    /**
     * Indicates the planning phase is complete. This step occurs once per build, before task execution begins.
     */
    step: z.literal('PLAN_PREPARED'),
    /**
     * List of all task names within the current build scope. The scope is determined by the goals or labels provided to build-raptor.
     * This list:
     * - Includes tasks that may be skipped due to caching
     * - Excludes tasks from modules not included in this build scope.
     */
    taskNames: z.string().array(),
  }),
  z.object({
    step: z.literal('PUBLIC_FILES'),
    taskName: z.string(),
    /**
     * Maps path-in-repo (of "public output" files) to the hash of the contnet of the file.
     */
    publicFiles: z.record(z.string(), z.string()),
  }),
])

export type Step = z.infer<typeof Step>

export type StepName = Step['step']
export type StepByName<N extends StepName> = Extract<Step, { step: N }>

export const StepByStep = Step.array()
export type StepByStep = z.infer<typeof StepByStep>
