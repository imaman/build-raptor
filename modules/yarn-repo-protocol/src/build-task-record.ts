import { z } from 'zod'

export const BuildTaskRecord = z.record(
  z.string(),
  z.object({
    inputs: z.string().array(),
    outputs: z.string().array(),
  }),
)
export type BuildTaskRecord = z.infer<typeof BuildTaskRecord>
