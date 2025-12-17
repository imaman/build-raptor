import { z } from 'zod'

import { examplifyZod, ExamplifyZodOptions } from '../src/examplify-zod'

const runExamplify = (input: z.ZodTypeAny, options?: ExamplifyZodOptions) => examplifyZod(input, options).split('\n')

describe('examplifyZod', () => {
  test('object', () => {
    expect(runExamplify(z.object({ alpha: z.string(), beta: z.number() }))).toEqual([
      `{`,
      `//  alpha: "",`,
      `//  beta: 0,`,
      `}`,
    ])
    expect(runExamplify(z.object({ a: z.string().array(), b: z.boolean() }))).toEqual([
      `{`,
      `//  a: [],`,
      `//  b: false,`,
      `}`,
    ])
  })
  test('comment controls whether we comment out', () => {
    expect(runExamplify(z.object({ alpha: z.string(), beta: z.number() }), { comment: false })).toEqual([
      `{`,
      `  alpha: "",`,
      `  beta: 0,`,
      `}`,
    ])
    expect(runExamplify(z.object({ alpha: z.string(), beta: z.number() }), { comment: true })).toEqual([
      `{`,
      `//  alpha: "",`,
      `}`,
    ])
  })
  test('commentAlsoOutermostBraces controls whether the braces of the top-level object are commented out', () => {
    expect(runExamplify(z.object({ alpha: z.string() }), { commentAlsoOutermostBraces: false })).toEqual([
      `{`,
      `//  alpha: "",`,
      `}`,
    ])
    expect(runExamplify(z.object({ alpha: z.string() }), { commentAlsoOutermostBraces: true })).toEqual([
      `//{`,
      `//  alpha: "",`,
      `//}`,
    ])
  })
  test('descriptions', () => {
    expect(runExamplify(z.object({ s: z.string().describe('lorem ipsum') }))).toEqual([
      `{`,
      `//  lorem ipsum`,
      `//  s: "",`,
      `}`,
    ])
    expect(runExamplify(z.object({ a: z.string().array(), b: z.boolean() }))).toEqual([
      `{`,
      `//  a: [],`,
      `//  b: false,`,
      `}`,
    ])
  })
  test('nested objects', () => {
    expect(
      runExamplify(
        z.object({
          alpha: z.string(),
          beta: z.object({ pi: z.string(), kappa: z.number(), rho: z.array(z.number()) }),
        }),
        {},
      ),
    ).toEqual([
      `{`,
      `//  alpha: "",`,
      `//  beta: {`,
      `//    pi: "",`,
      `//    kappa: 0,`,
      `//    rho: [],`,
      `//  },`,
      `}`,
    ])
  })
  test('nested objects can have a description', () => {
    expect(
      runExamplify(
        z.object({
          alpha: z.string(),
          beta: z
            .object({ pi: z.string(), kappa: z.number(), rho: z.array(z.number()) })
            .describe('beta is the second letter'),
        }),
        {},
      ),
    ).toEqual([
      `{`,
      `//  alpha: "",`,
      `//  beta is the second letter`,
      `//  beta: {`,
      `//    pi: "",`,
      `//    kappa: 0,`,
      `//    rho: [],`,
      `//  },`,
      `}`,
    ])
  })
  test(`in nullable/optional values the default value of the wrapped schema`, () => {
    expect(runExamplify(z.number().optional(), { comment: false })).toEqual([`0`])
    expect(runExamplify(z.number().nullable(), { comment: false })).toEqual([`0`])
  })
  test(`when a schema has .default() that value is taken as the default value`, () => {
    expect(runExamplify(z.number().nullable().default(5), { comment: false })).toEqual([`5`])
    expect(runExamplify(z.string().nullable().default('abc'), { comment: false })).toEqual([`"abc"`])
    expect(runExamplify(z.boolean().nullable().default(true), { comment: false })).toEqual([`true`])
    expect(runExamplify(z.number().optional().default(5), { comment: false })).toEqual([`5`])
    expect(runExamplify(z.string().optional().default('abc'), { comment: false })).toEqual([`"abc"`])
    expect(runExamplify(z.boolean().optional().default(true), { comment: false })).toEqual([`true`])
  })
  test(`the value of .default() is used even if the schema is neither nullable nor optional`, () => {
    expect(runExamplify(z.string().default('the quick'), { comment: false })).toEqual([`"the quick"`])
  })
  test(`default().nullable() is treated as nullable()`, () => {
    expect(runExamplify(z.number().default(5).nullable(), { comment: false })).toEqual([`0`])
  })
  test(`union's default value is the default value of the first option`, () => {
    expect(runExamplify(z.number().or(z.string()).or(z.boolean()), { comment: false })).toEqual([`0`])
    expect(runExamplify(z.string().or(z.number()).or(z.boolean()), { comment: false })).toEqual([`""`])
    expect(runExamplify(z.boolean().or(z.string()).or(z.number()), { comment: false })).toEqual([`false`])
  })
  test(`union which has an explicit default value`, () => {
    expect(runExamplify(z.number().or(z.string()).default('q'), { comment: false })).toEqual([`"q"`])
  })
})
