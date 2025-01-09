import { z } from 'zod'

export const YarnRepoProtocolConfig = z
  .object({
    /**
     * Whether to let tsc to build multiple units of the monorepo. When set to false, build-raptor will build each
     * unit separately.
     */
    uberBuild: z.boolean().optional(),
    /**
     * Whether to cache the outputs of tsc (the "dist" directory). Default to true.
     */
    cacheCompilationOutputs: z.boolean().optional(),
    install: z
      .boolean()
      .optional()
      .or(z.union([z.literal('off'), z.literal('dormant'), z.literal('on')])),
  })
  .strict()
export type YarnRepoProtocolConfig = z.infer<typeof YarnRepoProtocolConfig>
