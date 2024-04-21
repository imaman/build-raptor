import { z } from 'zod'

export const ReporterOutput = z.object({
  cases: z
    .object({
      fileName: z.string(),
      testCaseFullName: z.string(),
      ancestorTitles: z.string().array(),
      title: z.string(),
      status: z.union([
        z.literal('passed'),
        z.literal('failed'),
        z.literal('skipped'),
        z.literal('pending'),
        z.literal('todo'),
        z.literal('disabled'),
      ]),
      duration: z.number().optional(),
      message: z.string().optional(),
    })
    .array(),
})
export type ReporterOutput = z.infer<typeof ReporterOutput>
