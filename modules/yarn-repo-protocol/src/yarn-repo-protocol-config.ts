import { z } from 'zod'

export const YarnRepoProtocolConfig = z
  .object({
    uberBuild: z.boolean().optional(),
    install_: z
      .boolean()
      .optional()
      .or(z.union([z.literal('off'), z.literal('dormant'), z.literal('on')])),
  })
  .strict()
export type YarnRepoProtocolConfig = z.infer<typeof YarnRepoProtocolConfig>
