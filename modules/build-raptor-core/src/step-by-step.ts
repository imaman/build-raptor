import { z } from 'zod'

export const Step = z.object({
  step: z.literal('TASK_STORE_PUT'),
  taskName: z.string(),
  blobId: z.string(),
  files: z.string().array(),
}).or(z.object({
  step: z.literal('TASK_STORE_GET'),
  taskName: z.string(),
  blobId: z.string(),
  files: z.string().array(),
})).or(z.object({
  step: z.literal('TEST_ENDED'),
  verdict: z.literal('TEST_PASSED').or(z.literal('TEST_FAILED')).or(z.literal('TEST_CRASHED')).or(z.literal('TEST_TIMEDOUT')),
  qualifiedName: z.string(),
  fileName: z.string(),
  taskName: z.string(),
}))
export type Step = z.infer<typeof Step>

export type StepName = Step['step']
export type StepByName<N extends StepName> = Extract<Step, {step: N}>

export const StepByStep = Step.array()
export type StepByStep = z.infer<typeof StepByStep>

