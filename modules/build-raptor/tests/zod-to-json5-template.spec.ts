import { z } from 'zod'

import { zodToJson5Template } from '../src/zod-to-json5-template'

describe('zod-to-json5-template', () => {
  test('a', () => {
    expect(zodToJson5Template(z.object({ a: z.string(), b: z.number() }), {})).toEqual(`{
  a: "",
  b: 0,
}`)
    expect(zodToJson5Template(z.object({ a: z.string().array(), b: z.boolean() }), {})).toEqual(`{
  a: [],
  b: false,
}`)
    expect(zodToJson5Template(z.number().optional(), {})).toEqual(`0`)
    expect(zodToJson5Template(z.number().nullable(), {})).toEqual(`0`)
    expect(zodToJson5Template(z.number().nullable().default(5), {})).toEqual(`0`)
    expect(zodToJson5Template(z.number().default(5).nullable(), {})).toEqual(`0`)
  })
  test('union', () => {
    expect(zodToJson5Template(z.number().or(z.string()).or(z.boolean()), {})).toEqual(`0`)
    expect(zodToJson5Template(z.string().or(z.number()).or(z.boolean()), {})).toEqual(`""`)
    expect(zodToJson5Template(z.boolean().or(z.string()).or(z.number()), {})).toEqual(`false`)
  })
})
