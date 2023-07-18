import { z } from 'zod'

export const YarnRepoProtocolConfig = z
  .object({
    uberBuild: z.boolean().optional(),
  })
  .strict()
export type YarnRepoProtocolConfig = z.infer<typeof YarnRepoProtocolConfig>
