import { z } from 'zod'

import { zodToJson5Template } from '../src/zod-to-json5-template'

describe('zod-to-json5-template', () => {
  test('a', () => {
    expect(zodToJson5Template(z.object({ a: z.string(), b: z.number() }), {})).toEqual(`{
  a: "",
  b: 0,
}`)
  })
})
