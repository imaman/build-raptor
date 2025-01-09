import { z } from 'zod'

export const ResolvedBuildTaskDefinition = z.object({
  /**
   * Paths to files which this task needs. The task will run only when these files are available.
   * Each input can be a source file (which is available from the very beginning of the build run) or an ouput of
   * another task (these are available only after their task completed running).
   *
   * If a string is supplied it is treated as a single element array.
   *
   * An input should be relative path. It is resolved from the directory at which the package.json file is located.
   */
  inputs: z.string().array().or(z.string()),
  outputs: z.string().array().or(z.string()).optional(),
  /**
   * additional outputs of the build tasks which will be stored separately, allowing other systems to read them
   * directly.
   */
  publicOutputs: z.string().array().or(z.string()).optional(),
  labels: z.string().array().or(z.string()).optional(),
})
export type ResolvedBuildTaskDefinition = z.infer<typeof ResolvedBuildTaskDefinition>

export const BuildTaskRecord = z.record(
  /**
   * The name of this task. Should match the name of a run script (in the package.json file).
   */
  z.string(),
  z.union([ResolvedBuildTaskDefinition, z.string()]),
)
export type BuildTaskRecord = z.infer<typeof BuildTaskRecord>
