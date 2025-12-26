import { aTimeoutOf } from '../src/misc.js'
import { promises } from '../src/promises.js'

describe('promises', () => {
  describe('map', () => {
    test('applies the given function to each value', async () => {
      const ps = promises([1, 2]).map(async x => `${x}${x}`)
      expect(await ps.reify()).toEqual(['11', '22'])
    })
    test('passes the index', async () => {
      const ps = promises(['a', 'b', 'c']).map(async (x, i) => `<${i}, ${x}>`)
      expect(await ps.reify()).toEqual(['<0, a>', '<1, b>', '<2, c>'])
    })
    test('can be applied also to Promises', async () => {
      const ps = promises([Promise.resolve(1), Promise.resolve(2)]).map(async x => `${x}${x}`)
      expect(await ps.reify()).toEqual(['11', '22'])
    })
    test('allows the mapper function to be a plain (non async) function', async () => {
      const ps = promises([Promise.resolve(1), Promise.resolve(2)]).map(x => `${x}${x}`)
      expect(await ps.reify()).toEqual(['11', '22'])
    })
  })
  describe('filter', () => {
    test('returns only the items for which the given function returned true', async () => {
      const ps = promises([1, 2, 3, 4, 5, 6]).filter(async x => x % 2 === 0)
      expect(await ps.reify()).toEqual([2, 4, 6])
    })
    test('passes the index', async () => {
      const ps = promises(['four', 'scores', 'and', 'seven', 'years', 'ago']).filter(async (_x, i) => i % 2 === 0)
      expect(await ps.reify()).toEqual(['four', 'and', 'years'])
    })
    test('can be applied also to Promises', async () => {
      const ps = promises<number>([
        Promise.resolve(1),
        Promise.resolve(2),
        Promise.resolve(3),
        Promise.resolve(4),
      ]).filter(async x => x % 3 === 1)
      expect(await ps.reify()).toEqual([1, 4])
    })
    test('allows the predicate to be a plain (non async) function', async () => {
      const ps = promises<number>([
        Promise.resolve(1),
        Promise.resolve(2),
        Promise.resolve(3),
        Promise.resolve(4),
      ]).filter(x => x % 2 === 0)
      expect(await ps.reify()).toEqual([2, 4])
    })
    test('combined with map', async () => {
      const ps = promises([1, 2, 3, 4, 5, 6])

      const a = ps.filter(async x => x % 3 === 2).map(async x => x * 7)
      expect(await a.reify()).toEqual([14, 35])

      const b = ps.map(async x => x * 7).filter(async x => x % 3 === 2)
      expect(await b.reify()).toEqual([14, 35])
    })
  })
  describe('forEach()', () => {
    test('call the function for each element in the collection, in-order', async () => {
      const arr: string[] = []
      await promises([49, 36, 25])
        .map(async x => Math.sqrt(x))
        .forEach((x, i) => {
          arr.push(`[${i}]: ${x}`)
        })

      expect(arr).toEqual(['[0]: 7', '[1]: 6', '[2]: 5'])
    })
    test('respects the optional concurrency level', async () => {
      let curr = 0
      const snapshots: number[] = []

      const forEacher = async () => {
        ++curr
        snapshots.push(curr)
        await aTimeoutOf(2).hasPassed()
        --curr
      }

      const ps = promises(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])

      curr = 0
      snapshots.length = 0
      await ps.forEach(3, forEacher)
      expect(Math.min(...snapshots)).toEqual(1)
      expect(Math.max(...snapshots)).toEqual(3)

      curr = 0
      snapshots.length = 0
      await ps.map(forEacher).reify(5)
      expect(Math.max(...snapshots)).toEqual(5)

      curr = 0
      snapshots.length = 0
      await ps.map(forEacher).reify(1)
      expect(Math.max(...snapshots)).toEqual(1)

      curr = 0
      snapshots.length = 0
      await ps.map(forEacher).reify(9)
      expect(Math.max(...snapshots)).toEqual(8)
    })
  })
  describe('reify()', () => {
    test('propagates an exception from map()', async () => {
      const ps = promises([1, 2, 3, 4, 5, 6])

      const a = ps.map(async (x, i) => {
        if (x === 5) {
          throw new Error(`this is a very bad value <x=${x}, i=${i}>`)
        }
        return x * x
      })
      await expect(a.reify()).rejects.toThrowError(/this is a very bad value <x=5, i=4>/)
    })
  })
  test('propagates an exception from filter()', async () => {
    const ps = promises([1, 2, 3, 4, 5, 6, 7, 8])

    const a = ps.filter(async (x, i) => {
      if (x === 6) {
        throw new Error(`this is a very bad value <x=${x}, i=${i}>`)
      }
      return x % 3 === 2
    })
    await expect(a.reify()).rejects.toThrowError(/this is a very bad value <x=6, i=5>/)
  })
  test('propagates one of exceptions when multiple exceptions were fired', async () => {
    const ps = promises([1, 2, 3, 4, 5, 6, 7, 8])

    const a = ps.filter(async (x, i) => {
      await aTimeoutOf(10).hasPassed()
      if (i > 2) {
        throw new Error(`this is a very bad value <x=${x}, i=${i}>`)
      }
      return x < 6
    })
    await expect(a.reify()).rejects.toThrowError(/this is a very bad value <x=/)
  })
  describe('concurrency', () => {
    test('respects the concurrency value passed to reify()', async () => {
      const ps = promises([1, 2, 3, 4, 5, 6, 7, 8])

      let curr = 0
      const snapshots: number[] = []

      const mapper = async (x: number) => {
        ++curr
        snapshots.push(curr)
        await aTimeoutOf(2).hasPassed()
        --curr
        return x * x
      }

      await ps.map(mapper).reify(3)
      expect(Math.min(...snapshots)).toEqual(1)
      expect(Math.max(...snapshots)).toEqual(3)

      curr = 0
      snapshots.length = 0
      await ps.map(mapper).reify(5)
      expect(Math.max(...snapshots)).toEqual(5)

      curr = 0
      snapshots.length = 0
      await ps.map(mapper).reify(1)
      expect(Math.max(...snapshots)).toEqual(1)

      curr = 0
      snapshots.length = 0
      await ps.map(mapper).reify(9)
      expect(Math.max(...snapshots)).toEqual(8)
    })
    test('has default concurrency', async () => {
      const ps = promises([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24])

      let curr = 0
      const snapshots: number[] = []

      const mapper = async (x: number) => {
        ++curr
        snapshots.push(curr)
        await aTimeoutOf(2).hasPassed()
        --curr
        return x * x
      }

      const result = await ps.map(mapper).reify()
      expect(result).toHaveLength(24)
      expect(Math.max(...snapshots)).toEqual(16)
    })
  })
  test.todo('calling reify() twice does not re-run the mapper function??? (not sure this is what we want)')
})
