import { z } from 'zod'

import { zodToJson5Template } from '../src/zod-to-json5-template'

describe('zod-to-json5-template', () => {
  test('object', () => {
    expect(zodToJson5Template(z.object({ a: z.string(), b: z.number() }), {})).toEqual(`//{
//  a: "",
//  b: 0,
//}`)
    expect(zodToJson5Template(z.object({ a: z.string().array(), b: z.boolean() }), {})).toEqual(`//{
//  a: [],
//  b: false,
//}`)
  })
  test('descriptions', () => {
    expect(zodToJson5Template(z.object({ s: z.string().describe('lorem ipsum') }), {})).toEqual(`//{
//  lorem ipsum
//  s: "",
//}`)
    expect(zodToJson5Template(z.object({ a: z.string().array(), b: z.boolean() }), {})).toEqual(`//{
//  a: [],
//  b: false,
//}`)
  })
  test('object nested', () => {
    expect(
      zodToJson5Template(
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
    expect(zodToJson5Template(z.number().optional(), {}, false)).toEqual(`0`)
    expect(zodToJson5Template(z.number().nullable(), {}, false)).toEqual(`0`)
  })
  test(`when a schema has .default() that value is taken as the default value`, () => {
    expect(zodToJson5Template(z.number().nullable().default(5), {}, false)).toEqual(`5`)
    expect(zodToJson5Template(z.string().nullable().default('abc'), {}, false)).toEqual(`"abc"`)
    expect(zodToJson5Template(z.boolean().nullable().default(true), {}, false)).toEqual(`true`)
  })
  test(`default().nullable() is treated as nullable()`, () => {
    expect(zodToJson5Template(z.number().default(5).nullable(), {}, false)).toEqual(`0`)
  })
  test(`union's default value is the default value of the first option`, () => {
    expect(zodToJson5Template(z.number().or(z.string()).or(z.boolean()), {}, false)).toEqual(`0`)
    expect(zodToJson5Template(z.string().or(z.number()).or(z.boolean()), {}, false)).toEqual(`""`)
    expect(zodToJson5Template(z.boolean().or(z.string()).or(z.number()), {}, false)).toEqual(`false`)
  })
})
