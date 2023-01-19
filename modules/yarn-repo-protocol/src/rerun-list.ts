import { z } from 'zod'

export const RerunList = z.object({ testCaseFullName: z.string(), fileName: z.string() }).array()
export type RerunList = z.infer<typeof RerunList>
