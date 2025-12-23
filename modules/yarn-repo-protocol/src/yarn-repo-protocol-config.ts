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
      .or(z.union([z.literal('off'), z.literal('dormant'), z.literal('on')]))
      .describe(
        "Controls yarn install behavior. 'off': Skip install, 'dormant': Install only if no node_modules exists, 'on': Always install. Can also be set to boolean (true='on', false='off').",
      ),
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
    additionalJestEnvVars: z
      .record(z.string(), z.string().optional())
      .optional()
      .describe(
        'Additional environment variables to pass to the Jest test runner. Specified as key-value pairs. Note: These variables are not passed to custom test commands.',
      ),
  })
  .strict()
export type YarnRepoProtocolConfig = z.infer<typeof YarnRepoProtocolConfig>
