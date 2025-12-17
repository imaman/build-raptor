import { z } from 'zod'

import { examplifyZod, ExamplifyZodOptions } from '../src/examplify-zod'

const run = (input: z.ZodTypeAny, options?: ExamplifyZodOptions) => examplifyZod(input, options).split('\n')

describe('examplifyZod', () => {
  test('object', () => {
    expect(run(z.object({ a: z.string(), b: z.number() }))).toEqual([`//{`, `//  a: ""`, `//  b: 0`, `//}`])
    expect(examplifyZod(z.object({ a: z.string().array(), b: z.boolean() }))).toEqual(`//{
//  a: [],
//  b: false,
//}`)
  })
  test('descriptions', () => {
    expect(examplifyZod(z.object({ s: z.string().describe('lorem ipsum') }))).toEqual(`//{
//  lorem ipsum
//  s: "",
//}`)
    expect(examplifyZod(z.object({ a: z.string().array(), b: z.boolean() }))).toEqual(`//{
//  a: [],
//  b: false,
//}`)
  })
  test('object nested', () => {
    expect(
      examplifyZod(
        z.object({ a: z.string(), b: z.object({ p: z.string(), q: z.number(), r: z.array(z.number()) }) }),
        {},
      ),
    ).toEqual(`//{
//  a: "",
//  b: {
//    p: "",
//    q: 0,
//    r: [],
//  },
//}`)
  })
  test(`in nullable/optional values the default value of the wrapped schema`, () => {
    expect(examplifyZod(z.number().optional(), { comment: false })).toEqual(`0`)
    expect(examplifyZod(z.number().nullable(), { comment: false })).toEqual(`0`)
  })
  test(`when a schema has .default() that value is taken as the default value`, () => {
    expect(examplifyZod(z.number().nullable().default(5), { comment: false })).toEqual(`5`)
    expect(examplifyZod(z.string().nullable().default('abc'), { comment: false })).toEqual(`"abc"`)
    expect(examplifyZod(z.boolean().nullable().default(true), { comment: false })).toEqual(`true`)
    expect(examplifyZod(z.number().optional().default(5), { comment: false })).toEqual(`5`)
    expect(examplifyZod(z.string().optional().default('abc'), { comment: false })).toEqual(`"abc"`)
    expect(examplifyZod(z.boolean().optional().default(true), { comment: false })).toEqual(`true`)
  })
  test(`the value of .default() is used even if the schema is neither nullable nor optional`, () => {
    expect(examplifyZod(z.string().default('the quick'), { comment: false })).toEqual(`"the quick"`)
  })
  test(`default().nullable() is treated as nullable()`, () => {
    expect(examplifyZod(z.number().default(5).nullable(), { comment: false })).toEqual(`0`)
  })
  test(`union's default value is the default value of the first option`, () => {
    expect(examplifyZod(z.number().or(z.string()).or(z.boolean()), { comment: false })).toEqual(`0`)
    expect(examplifyZod(z.string().or(z.number()).or(z.boolean()), { comment: false })).toEqual(`""`)
    expect(examplifyZod(z.boolean().or(z.string()).or(z.number()), { comment: false })).toEqual(`false`)
  })
  test(`union which has an explicit default value`, () => {
    expect(examplifyZod(z.number().or(z.string()).default('q'), { comment: false })).toEqual(`"q"`)
  })
})
