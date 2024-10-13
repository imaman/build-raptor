import { z } from 'zod'

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
     * Names of all tasks that are part of this run's scope. The run's scope is defined by the goals/labels passed to
     * build-raptor. Hence, this list excludes tasks that belong to modules which were not asked to be built. But, it
     * does include tasks that will not be executed due to caching.
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
