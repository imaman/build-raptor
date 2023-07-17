import { z } from 'zod'

export const YarnRepoProtocolConfig = z.object({
  uberBuildStepEnabled: z.boolean().default(false),
})
export type YarnRepoProtocolConfig = z.infer<typeof YarnRepoProtocolConfig>
