import { findDups, groupBy, sortBy, uniqueBy } from '../src'

describe('arrays', () => {
  describe('sortBy', () => {
    test('sorts using the given key function', () => {
      const input = ['luke', 'han', 'chewbacca', 'r2-d2']
      expect(sortBy(input, at => at.length)).toEqual(['han', 'luke', 'r2-d2', 'chewbacca'])
      expect(sortBy(input, at => at[at.length - 1])).toEqual(['r2-d2', 'chewbacca', 'luke', 'han'])
    })
    test('input array is not modified', () => {
      const input = ['luke', 'han', 'chewbacca', 'r2-d2']
      const output = sortBy(input, at => at.length)

      expect(output).toEqual(['han', 'luke', 'r2-d2', 'chewbacca'])
      expect(input).toEqual(['luke', 'han', 'chewbacca', 'r2-d2'])
    })
    test('the sort is stable', () => {
      const input1 = [
        { k1: 'a', k2: 'b', v1: 'four' },
        { k1: 'a', k2: 'c', v1: 'scores' },
        { k1: 'a', k2: 'b', v1: 'and' },
        { k1: 'a', k2: 'c', v1: 'seven' },
        { k1: 'a', k2: 'b', v1: 'years' },
        { k1: 'a', k2: 'c', v1: 'ago' },
      ]
      expect(sortBy(input1, at => at.k1).map(at => at.v1)).toEqual(['four', 'scores', 'and', 'seven', 'years', 'ago'])
      expect(sortBy(input1, at => at.k2).map(at => at.v1)).toEqual(['four', 'and', 'years', 'scores', 'seven', 'ago'])
    })
  })
  describe('uniqueBy', () => {
    test('returns an empty array when given an empty input', () => {
      expect(uniqueBy([], x => x)).toEqual([])
    })
    test('when all elements are mapped to the same value, returns just the first one', () => {
      expect(uniqueBy(['the', 'quick', 'brown', 'fox', 'jumps'], () => 3)).toEqual(['the'])
    })
    test('retains a single element of each group of element that are mapped to the same value', () => {
      expect(uniqueBy(['a', 'b', 'c', 'a', 'c', 'c', 'a'], x => x)).toEqual(['a', 'b', 'c'])
    })
    test('the elements can be mapped to a number', () => {
      expect(uniqueBy(['aa', 'bb', 'xyz', 'pqr'], x => x.length)).toEqual(['aa', 'xyz'])
    })
    test('retains the first element of each group of element that are mapped to the same value', () => {
      expect(uniqueBy(['aa', 'AA', 'aA', 'Aa'], x => x.toLowerCase())).toEqual(['aa'])
      expect(uniqueBy(['AA', 'aa', 'aA', 'Aa'], x => x.toLowerCase())).toEqual(['AA'])
      expect(uniqueBy(['aA', 'aa', 'AA', 'Aa'], x => x.toLowerCase())).toEqual(['aA'])
    })
    test('retains the respective order of the elements in the input', () => {
      expect(uniqueBy(['a', 'b', 'b', 'a', 'b', 'b', 'b'], x => x)).toEqual(['a', 'b'])
      expect(uniqueBy(['b', 'a', 'a', 'a', 'a', 'a', 'a'], x => x)).toEqual(['b', 'a'])
      expect(uniqueBy(['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog'], x => x.length)).toEqual([
        'the',
        'quick',
        'over',
      ])
    })
    test('the input can be an iterable', () => {
      const myIterable = {
        *[Symbol.iterator]() {
          yield 4
          yield 8
          yield 11
          yield 7
          yield 9
          yield 15
        },
      }
      expect(uniqueBy(myIterable, x => x % 3)).toEqual([4, 8, 9])
    })
    test('the input can be an iterator', () => {
      expect(
        uniqueBy(
          (function* () {
            yield 4
            yield 8
            yield 11
            yield 7
            yield 9
            yield 15
          })(),
          x => x % 3,
        ),
      ).toEqual([4, 8, 9])
    })
  })
  describe('findDups', () => {
    test('returns an empty array when given an empty input', () => {
      expect(findDups([], x => x)).toEqual([])
    })
    test('when all elements are mapped to the same value, returns all of them', () => {
      expect(findDups(['the', 'quick', 'brown', 'fox', 'jumps'], () => 3)).toEqual([
        'the',
        'quick',
        'brown',
        'fox',
        'jumps',
      ])
    })
    test('returns all elements that are mapped to the same value', () => {
      expect(findDups(['a', 'b', 'c', 'd', 'a', 'c', 'c'], x => x)).toEqual(['a', 'c', 'a', 'c', 'c'])
    })
  })
  describe('groupBy', () => {
    test('returns an empty array when given an empty input', () => {
      expect(groupBy([], x => x)).toEqual({})
    })
    test('when all elements are mapped to the same value, returns just the first one', () => {
      expect(groupBy(['the', 'quick', 'brown', 'fox', 'jumps'], () => 3)).toEqual({
        3: ['the', 'quick', 'brown', 'fox', 'jumps'],
      })
    })
    test('retains a single element of each group of element that are mapped to the same value', () => {
      expect(groupBy(['a', 'b', 'c', 'a', 'c', 'a'], x => x)).toEqual({
        a: ['a', 'a', 'a'],
        b: ['b'],
        c: ['c', 'c'],
      })
    })
    test('the elements can be mapped to a number', () => {
      expect(groupBy(['aa', 'bb', 'xyz', 'pqr'], x => x.length)).toEqual({ 2: ['aa', 'bb'], 3: ['xyz', 'pqr'] })
    })
    test('retains the first element of each group of element that are mapped to the same value', () => {
      expect(groupBy(['aa', 'AA', 'aA', 'Aa'], x => x.toLowerCase())).toEqual({ aa: ['aa', 'AA', 'aA', 'Aa'] })
      expect(groupBy(['AA', 'aa', 'aA', 'Aa'], x => x.toLowerCase())).toEqual({ aa: ['AA', 'aa', 'aA', 'Aa'] })
      expect(groupBy(['aA', 'aa', 'AA', 'Aa'], x => x.toLowerCase())).toEqual({ aa: ['aA', 'aa', 'AA', 'Aa'] })
    })
    test('retains the respective order of the elements in the input', () => {
      expect(groupBy(['a', 'b', 'b', 'a', 'b'], x => x.length)).toEqual({ 1: ['a', 'b', 'b', 'a', 'b'] })
      expect(groupBy(['b', 'a', 'a', 'b', 'a'], x => x.length)).toEqual({ 1: ['b', 'a', 'a', 'b', 'a'] })
      expect(groupBy(['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'the', 'lazy', 'dog'], x => x.length)).toEqual({
        3: ['the', 'fox', 'the', 'dog'],
        4: ['over', 'lazy'],
        5: ['quick', 'brown', 'jumps'],
      })
    })
    test('the input can be an iterable', () => {
      const myIterable = {
        *[Symbol.iterator]() {
          yield 4
          yield 8
          yield 11
          yield 7
          yield 9
          yield 15
        },
      }
      expect(groupBy(myIterable, x => x % 3)).toEqual({ 0: [9, 15], 1: [4, 7], 2: [8, 11] })
    })
    test('the input can be an iterator', () => {
      expect(
        groupBy(
          (function* () {
            yield 4
            yield 8
            yield 11
            yield 7
            yield 9
            yield 15
          })(),
          x => x % 3,
        ),
      ).toEqual({ 0: [9, 15], 1: [4, 7], 2: [8, 11] })
    })
  })
})
