import { z } from 'zod'

import { examplifyZod, ExamplifyZodOptions } from '../src/examplify-zod'

const runExamplify = (input: z.ZodTypeAny, options?: ExamplifyZodOptions) => examplifyZod(input, options).split('\n')

describe('examplify-zod', () => {
  test('object', () => {
    expect(runExamplify(z.object({ alpha: z.string(), beta: z.number() }))).toEqual([
      `{`,
      `  // "alpha": "",`,
      ``,
      `  // "beta": 0,`,
      `}`,
    ])
    expect(runExamplify(z.object({ a: z.string().array(), b: z.boolean() }))).toEqual([
      `{`,
      `  // "a": [],`,
      ``,
      `  // "b": false,`,
      `}`,
    ])
  })
  describe('options', () => {
    test('commentIndentation controls the column at which the comment starts', () => {
      expect(runExamplify(z.object({ alpha: z.string() }), { commentIndentation: 4 })).toEqual([
        `{`,
        `    // "alpha": "",`,
        `}`,
      ])
      expect(runExamplify(z.object({ alpha: z.string() }), { commentIndentation: 2 })).toEqual([
        `{`,
        `  // "alpha": "",`,
        `}`,
      ])
    })
    test('comment controls whether we comment out', () => {
      expect(runExamplify(z.object({ alpha: z.string(), beta: z.number() }), { comment: false })).toEqual([
        `{`,
        `  "alpha": "",`,
        ``,
        `  "beta": 0,`,
        `}`,
      ])
      expect(runExamplify(z.object({ alpha: z.string(), beta: z.number() }), { comment: true })).toEqual([
        `{`,
        `  // "alpha": "",`,
        ``,
        `  // "beta": 0,`,
        `}`,
      ])
    })
    test('commentAlsoOutermostBraces controls whether the braces of the top-level object are commented out', () => {
      expect(runExamplify(z.object({ alpha: z.string() }), { commentAlsoOutermostBraces: false })).toEqual([
        `{`,
        `  // "alpha": "",`,
        `}`,
      ])
      expect(runExamplify(z.object({ alpha: z.string() }), { commentAlsoOutermostBraces: true })).toEqual([
        `// {`,
        `  // "alpha": "",`,
        `// }`,
      ])
      expect(
        runExamplify(z.object({ alpha: z.string() }), { commentAlsoOutermostBraces: true, commentIndentation: 0 }),
      ).toEqual([`// {`, `//   "alpha": "",`, `// }`])
    })
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
      `  // "alpha": "",`,
      ``,
      `  // "beta": {`,
      `  //   "pi": "",`,
      ``,
      `  //   "kappa": 0,`,
      ``,
      `  //   "rho": [],`,
      `  // },`,
      `}`,
    ])
  })
  describe('descriptions', () => {
    test('appear above the property', () => {
      expect(runExamplify(z.object({ s: z.string().describe('lorem ipsum') }))).toEqual([
        `{`,
        `  // lorem ipsum`,
        `  // "s": "",`,
        `}`,
      ])
    })
    test('are split if exceed 120 characters', () => {
      expect(
        runExamplify(
          z.object({
            address: z
              .string()
              .describe(
                'Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived ' +
                  'in Liberty, and dedicated to the proposition that all men are created equal.',
              ),
          }),
        ),
      ).toEqual([
        `{`,
        `  // Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and`,
        `  // dedicated to the proposition that all men are created equal.`,
        `  // "address": "",`,
        `}`,
      ])
    })

    test('nested objects can have a description and also its own properties', () => {
      expect(
        runExamplify(
          z.object({
            alpha: z.string(),
            beta: z
              .object({
                pi: z.string().describe('this is a greek letter'),
                kappa: z.number(),
                rho: z.array(z.number()),
              })
              .describe('beta is the second letter'),
          }),
          {},
        ),
      ).toEqual([
        `{`,
        `  // "alpha": "",`,
        ``,
        `  // beta is the second letter`,
        `  // "beta": {`,
        `  //   this is a greek letter`,
        `  //   "pi": "",`,
        ``,
        `  //   "kappa": 0,`,
        ``,
        `  //   "rho": [],`,
        `  // },`,
        `}`,
      ])
    })
    test('descriptions are always commented out', () => {
      expect(runExamplify(z.object({ s: z.string().describe('lorem ipsum') }), { comment: false })).toEqual([
        `{`,
        `  // lorem ipsum`,
        `  "s": "",`,
        `}`,
      ])
    })
  })
  test.todo('z.literal')
  test.todo('z.enum')
  test.todo('z.discriminatedUnion')
  test.todo('z.tuple')
  test(`in nullable/optional values takes the default value of the wrapped schema`, () => {
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
