import { z } from 'zod'

import { examplifyZod } from '../src/examplify-zod'

describe('zod-to-json5-template', () => {
  test('object', () => {
    expect(examplifyZod(z.object({ a: z.string(), b: z.number() }), {})).toEqual(`//{
//  a: "",
//  b: 0,
//}`)
    expect(examplifyZod(z.object({ a: z.string().array(), b: z.boolean() }), {})).toEqual(`//{
//  a: [],
//  b: false,
//}`)
  })
  test('descriptions', () => {
    expect(examplifyZod(z.object({ s: z.string().describe('lorem ipsum') }), {})).toEqual(`//{
//  lorem ipsum
//  s: "",
//}`)
    expect(examplifyZod(z.object({ a: z.string().array(), b: z.boolean() }), {})).toEqual(`//{
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
    expect(examplifyZod(z.number().optional(), {}, false)).toEqual(`0`)
    expect(examplifyZod(z.number().nullable(), {}, false)).toEqual(`0`)
  })
  test(`when a schema has .default() that value is taken as the default value`, () => {
    expect(examplifyZod(z.number().nullable().default(5), {}, false)).toEqual(`5`)
    expect(examplifyZod(z.string().nullable().default('abc'), {}, false)).toEqual(`"abc"`)
    expect(examplifyZod(z.boolean().nullable().default(true), {}, false)).toEqual(`true`)
    expect(examplifyZod(z.number().optional().default(5), {}, false)).toEqual(`5`)
    expect(examplifyZod(z.string().optional().default('abc'), {}, false)).toEqual(`"abc"`)
    expect(examplifyZod(z.boolean().optional().default(true), {}, false)).toEqual(`true`)
  })
  test(`the value of .default() is used even if the schema is neither nullable nor optional`, () => {
    expect(examplifyZod(z.string().default('the quick'), {}, false)).toEqual(`"the quick"`)
  })
  test(`default().nullable() is treated as nullable()`, () => {
    expect(examplifyZod(z.number().default(5).nullable(), {}, false)).toEqual(`0`)
  })
  test(`union's default value is the default value of the first option`, () => {
    expect(examplifyZod(z.number().or(z.string()).or(z.boolean()), {}, false)).toEqual(`0`)
    expect(examplifyZod(z.string().or(z.number()).or(z.boolean()), {}, false)).toEqual(`""`)
    expect(examplifyZod(z.boolean().or(z.string()).or(z.number()), {}, false)).toEqual(`false`)
  })
  test(`union which has an explicit default value`, () => {
    expect(examplifyZod(z.number().or(z.string()).default('q'), {}, false)).toEqual(`"q"`)
  })
})
