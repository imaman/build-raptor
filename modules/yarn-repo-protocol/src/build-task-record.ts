import { z } from 'zod'

export const BuildTaskRecord = z.record(
  z.string(),
  z.object({
    inputs: z.string().array().or(z.string()),
    outputs: z.string().array().or(z.string()).optional(),
    /**
     * additional outputs of the build tasks which will be stored separately, allowing other systems to read them
     * directly.
     */
    publicOutputs: z.string().array().or(z.string()).optional(),
    labels: z.string().array().or(z.string()).optional(),
  }),
)
export type BuildTaskRecord = z.infer<typeof BuildTaskRecord>
