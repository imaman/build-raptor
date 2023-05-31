import { z } from 'zod'

export const Step = z.union([
  z.object({
    step: z.literal('TASK_STORE_PUT'),
    fingerprint: z.string().optional(),
    taskName: z.string(),
    blobId: z.string(),
    files: z.string().array(),
  }),
  z.object({
    step: z.literal('TASK_STORE_GET'),
    fingerprint: z.string().optional(),
    taskName: z.string(),
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
    taskName: z.string(),
    fingerprint: z.string(),
    casAddress: z.string(),
    file: z.string(),
  }),
])

export type Step = z.infer<typeof Step>

export type StepName = Step['step']
export type StepByName<N extends StepName> = Extract<Step, { step: N }>

export const StepByStep = Step.array()
export type StepByStep = z.infer<typeof StepByStep>
