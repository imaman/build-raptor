import { z } from 'zod'

export const BuildRaptorConfig = z.object({
  repoProtocol: z.unknown().optional(),
  /**
   * task names for which high-detail printing will be enabled. This allow the user to get detailed information about
   * specific tasks. Example: ['foo:build', 'bar:test'].
   */
  verbosePrintTasks: z.string().array().optional(),
})
export type BuildRaptorConfig = z.infer<typeof BuildRaptorConfig>
