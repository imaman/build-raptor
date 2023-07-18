import { z } from 'zod'

export const YarnRepoProtocolConfig = z
  .object({
    uberBuild: z.boolean().default(false),
  })
  .strict()
export type YarnRepoProtocolConfig = z.infer<typeof YarnRepoProtocolConfig>
