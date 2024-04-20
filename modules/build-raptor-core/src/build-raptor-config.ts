import { z } from 'zod'

export const BuildRaptorConfig = z.object({
  /**
   * Repo-protocol-specific configuration.
   */
  repoProtocol: z.unknown().default(undefined),
  /**
   * task names for which high-detail printing will be enabled. This allow the user to get detailed information about
   * specific tasks. Example: ['foo:build', 'bar:test'].
   */
  verbosePrintTasks: z.string().array().default([]),
  /**
   * Selects one of two modes for determining when a task will run. A task will always run if one of the tasks listed in
   * its TaskInfo.deps had to run.
   * Additionally, a task will run if any of its inputs have changed (when this attribute is true) or if any of the
   * tasks that generates its inputs had to run (when this attribute is false).
   */
  tightFingerprints: z.boolean().default(false),
  /**
   * Name of the directory at which outputs of tasks will be placed (other than compilation outputs which are currently under dist).
   * This directory is created in each module. Defaults to ".out".
   */
  outDirName: z.string().default('.out'),
})
export type BuildRaptorConfig = z.infer<typeof BuildRaptorConfig>
