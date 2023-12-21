import { z } from 'zod'

export const BuildTaskRecord = z.record(
  z.string(),
  z.object({
    inputs: z.string().array(),
    outputs: z.string().array(),
    labels: z.string().array().optional(),
  }),
)
export type BuildTaskRecord = z.infer<typeof BuildTaskRecord>
