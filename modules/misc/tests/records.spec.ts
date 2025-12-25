import { mapRecord, pairsToRecord, recordToPairs } from '../src/records.js'

describe('records', () => {
  describe('recordToPairs', () => {
    test('returns an empty array on an empty input', () => {
      expect(recordToPairs({})).toEqual([])
    })
    test('returns a pair for each property of the record', () => {
      expect(recordToPairs({ x: 1, y: 2 })).toEqual([
        ['x', 1],
        ['y', 2],
      ])
    })
    test('returns the pairs ordered', () => {
      expect(recordToPairs({ foo: 1, bar: 2 })).toEqual([
        ['bar', 2],
        ['foo', 1],
      ])
      expect(recordToPairs({ bar: 1, foo: 2 })).toEqual([
        ['bar', 1],
        ['foo', 2],
      ])
      expect(recordToPairs({ foo: 2, bar: 1 })).toEqual([
        ['bar', 1],
        ['foo', 2],
      ])
      expect(recordToPairs({ bar: 2, foo: 1 })).toEqual([
        ['bar', 2],
        ['foo', 1],
      ])
    })
    test('retain the types of the keys and values of the input', () => {
      type A = string & { __brand: 'A' }
      type B = string & { __brand: 'B' }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const a: Record<A, Date> = { ['v1' as A]: new Date(10) }
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const b: Record<B, number> = { ['v2' as B]: 3 }

      const pairsA: [A, Date][] = recordToPairs(a)
      expect(pairsA).toEqual([['v1', new Date(10)]])
      const pairsB: [B, number][] = recordToPairs(b)
      expect(pairsB).toEqual([['v2', 3]])
    })
  })
  describe('pairsToRecord', () => {
    test('returns an emptry record when given an empty list of pairs', () => {
      expect(pairsToRecord([])).toEqual({})
    })
    test('returns a record from the given list of pairs', () => {
      expect(
        pairsToRecord([
          ['x', 500],
          ['y', 300],
        ]),
      ).toEqual({ x: 500, y: 300 })
    })
    test('retains the types of the input', () => {
      type A = string & { __brand: 'A' }
      type B = string & { __brand: 'B' }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const a: Record<A, Date> = pairsToRecord([['v1' as A, new Date(10)]])
      expect(a).toEqual({ v1: new Date(10) })

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const b: Record<B, Date> = pairsToRecord([['v2' as B, new Date(3)]])
      expect(b).toEqual({ v2: new Date(3) })
    })
  })
  describe('mapRecord', () => {
    test('returns a new record obtained by applying the given function to each pair of the input record', () => {
      const input = { ab: 500, cde: 300 }
      const output = mapRecord(input, ([k, v]) => [k.toUpperCase(), new Date(v)])
      expect(output).toEqual({ AB: new Date(500), CDE: new Date(300) })
    })
    test('when the callback function returns undefined, no corresponding pair is added to the output', () => {
      const input = { ab: 5, cde: 3, xy: 8 }
      expect(mapRecord(input, () => undefined)).toEqual({})
      expect(mapRecord(input, ([k, v]) => (k.length === 2 ? [k, v * 2] : undefined))).toEqual({ ab: 10, xy: 16 })
    })
  })
})
