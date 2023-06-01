import { z } from 'zod'

export const RegisterAssetRequest = z.object({
  packageName: z.string(),
  commitHash: z.string(),
  prNumber: z.number().int().positive().optional(),
  casReference: z.string(),
})
export type RegisterAssetRequest = z.infer<typeof RegisterAssetRequest>
