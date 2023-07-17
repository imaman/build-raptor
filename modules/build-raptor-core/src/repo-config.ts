import { z } from 'zod'

export const RepoConfig = z.object({
  repoProtocol: z.unknown().optional(),
})
export type RepoConfig = z.infer<typeof RepoConfig>
