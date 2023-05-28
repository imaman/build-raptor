import { z } from 'zod'

export const RegisterAssetRequest = z.object({
  packageName: z.string(),
  commitHash: z.string(),
  prNumber: z.number().optional(),
  casReference: z.string(),
})
