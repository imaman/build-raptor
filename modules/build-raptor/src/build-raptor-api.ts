import { z } from 'zod'

const GithubResponseItemSchema = z.object({
  number: z.number().int().positive().optional(),
})

export const GithubResponseSchema = z.array(GithubResponseItemSchema)

export const RegisterAssetRequest = z.object({
  packageName: z.string(),
  commitHash: z.string(),
  prNumber: z.number().int().positive().optional(),
  casReference: z.string(),
})
export type RegisterAssetRequest = z.infer<typeof RegisterAssetRequest>
