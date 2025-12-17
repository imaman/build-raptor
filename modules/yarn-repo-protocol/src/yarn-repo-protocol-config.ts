import { z } from 'zod'

export const YarnRepoProtocolConfig = z
  .object({
    uberBuild: z
      .boolean()
      .optional()
      .describe(
        'Whether to let tsc to build multiple units of the monorepo. When set to false, build-raptor will build each unit separately.',
      ),
    cacheCompilationOutputs: z
      .boolean()
      .optional()
      .describe('Whether to cache the outputs of tsc (the "dist" directory). Default to true.'),
    install: z
      .boolean()
      .optional()
      .or(z.union([z.literal('off'), z.literal('dormant'), z.literal('on')])),
    enableCustomTestCommands: z
      .boolean()
      .optional()
      .describe(
        'Whether to enable custom test commands specified in package.json files via buildRaptor.testCommand. When false, the standard Jest runner will always be used regardless of package configuration. Defaults to true (custom test commands are enabled).',
      ),
    compilerExecutable: z
      .string()
      .optional()
      .describe(
        "The compiler executable to use for uber builds. Defaults to 'tsc'. The executable must support the same CLI interface as tsc (i.e., `<executable> --build <dirs...>`).",
      ),
  })
  .strict()
export type YarnRepoProtocolConfig = z.infer<typeof YarnRepoProtocolConfig>
