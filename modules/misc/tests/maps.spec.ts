import { assigningGet, hardGet, mapIncrement } from '../src/maps'

describe('maps', () => {
  describe('hardGet', () => {
    test('returns the value associated with the key', () => {
      const map = new Map<string, Date>()
      map.set('foo', new Date(10))
      map.set('bar', new Date(20))

      expect(hardGet(map, 'foo')).toEqual(new Date(10))
      expect(hardGet(map, 'bar')).toEqual(new Date(20))
    })
    test('throws if the key was not found', () => {
      const map = new Map<string, Date>()

      expect(() => hardGet(map, 'foo')).toThrow('Could not find <foo> in the given map')

      map.set('foo', new Date(20))
      expect(() => hardGet(map, 'bar')).toThrow('Could not find <b_ar> in the given map')
    })
  })
  describe('mapIncrement', () => {
    test('places the given value at the map if no previous value exists', () => {
      const m = new Map<string, number>()
      mapIncrement(m, 'a', 100)

      expect(m.get('a')).toEqual(100)
    })

    test('returns the given value at the if no previous value exists', () => {
      const m = new Map<string, number>()
      expect(mapIncrement(m, 'a', 90)).toEqual(90)
    })

    test('when a previous value exists, increments it by the given value and places the sum back at the map', () => {
      const m = new Map<string, number>()
      m.set('b', 300)

      mapIncrement(m, 'b', 24)
      expect(m.get('b')).toEqual(324)
    })
    test('when a previous value exists, returns the sum (previous value + given value)', () => {
      const m = new Map<string, number>()
      m.set('b', 300)
      expect(mapIncrement(m, 'b', 24)).toEqual(324)
    })
  })
  describe('assigningGet', () => {
    test('places the supplied value at the map if no previous value exists', () => {
      const m = new Map<string, number>()
      assigningGet(m, 'a', () => 100)

      expect(m.get('a')).toEqual(100)
    })

    test('returns the supplied value at the if no previous value exists', () => {
      const m = new Map<string, number>()
      expect(assigningGet(m, 'a', () => 90)).toEqual(90)
    })

    test('when a previous value exists, does not change it', () => {
      const m = new Map<string, number>()
      m.set('b', 300)

      assigningGet(m, 'b', () => 24)
      expect(m.get('b')).toEqual(300)
    })
    test('when a previous value exists, returns it', () => {
      const m = new Map<string, number>()
      m.set('b', 300)
      expect(assigningGet(m, 'b', () => 24)).toEqual(300)
    })
    test('the supplier function is not called when if a value was associated with the given key', () => {
      const m = new Map<string, number>()
      m.set('b', 300)

      let x = 0
      assigningGet(m, 'b', () => {
        ++x
        return 24
      })
      expect(x).toEqual(0)
    })
  })
})
