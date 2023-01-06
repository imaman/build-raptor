import { z } from 'zod'

export const StepByStep = z.array(
  z.object({
    step: z.literal('TASK_STORE_PUT').or(z.literal('TASK_STORE_GET')),
    taskName: z.string(),
    blobId: z.string(),
    bytes: z.number(),
    files: z.string().array(),
  }),
)
export type StepByStep = z.infer<typeof StepByStep>
