import { z } from 'zod'

export const BuildTaskRecord = z.record(
  z.string(),
  z.object({
    inputs: z.string().array().or(z.string()),
    outputs: z.string().array().or(z.string()),
    labels: z.string().array().or(z.string()).optional(),
  }),
)
export type BuildTaskRecord = z.infer<typeof BuildTaskRecord>
