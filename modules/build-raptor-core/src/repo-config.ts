import { z } from 'zod'

export const RepoConfig = z.object({
  repoProtocol: z.unknown().optional(),
  /**
   * task names for which fine logging will be enabled. This allow the user to get detailed information about specific
   * tasks. Example: ['foo:build', 'bar:test'].
   */
  tasksToFineLog: z.string().array().optional(),
})
export type RepoConfig = z.infer<typeof RepoConfig>
