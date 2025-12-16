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
    /**
     * Whether to enable custom test commands specified in package.json files via buildRaptor.testCommand.
     * When false, the standard Jest runner will always be used regardless of package configuration.
     * Defaults to true (custom test commands are enabled).
     */
    enableCustomTestCommands: z.boolean().optional(),
    /**
     * The compiler executable to use for uber builds. Defaults to 'tsc'.
     * The executable must support the same CLI interface as tsc (i.e., `<executable> --build <dirs...>`).
     */
    compilerExecutable: z.string().optional(),
  })
  .strict()
export type YarnRepoProtocolConfig = z.infer<typeof YarnRepoProtocolConfig>
