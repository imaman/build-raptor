import { z } from 'zod'

export const TestRunSummary = z.object({
  testRuns: z
    .object({
      /**
       * the location of the test file (path in repo)
       */
      testFile: z.string(),
      /**
       * pinpoints the exact test case inside the file by listing the titles along the "path" to the test case
       */
      testCasePath: z.string().array(),
      /**
       * whether the test passed or not
       */
      verdict: z.union([z.literal('passed'), z.literal('failed')]),
      /**
       * how long it took the test to run. Not always reported by the underlying test runner (in which case it is unset).
       */
      durationInMillis: z.number().optional(),
      /**
       * an additional message associated with this run. Typically, the error message emitted for a failing test.
       */
      message: z.string().optional(),
    })
    .array(),
})

export type TestRunSummary = z.infer<typeof TestRunSummary>
