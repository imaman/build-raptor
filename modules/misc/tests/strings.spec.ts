import { errorLike } from '../src/constructs.js'
import {
  chaoticDeterministicString,
  partition,
  threeWaySplit,
  toReasonableFileName,
  trimTrailing,
} from '../src/strings.js'

describe('strings', () => {
  describe('trimTrailing()', () => {
    test('removes any number of consecutive occurrences of the given suffix string', () => {
      expect(trimTrailing('abx', 'x')).toEqual('ab')
      expect(trimTrailing('abxxx', 'x')).toEqual('ab')
      expect(trimTrailing('xabxxx', 'x')).toEqual('xab')
      expect(trimTrailing('_p_q_', '_')).toEqual('_p_q')
      expect(trimTrailing('//ab////', '/')).toEqual('//ab')
      expect(trimTrailing('pqcdcd', 'cd')).toEqual('pq')
      expect(trimTrailing('pq', '')).toEqual('pq')
    })
  })
  describe('chaoticDeterministicString()', () => {
    test('returns a string at the exact given length', () => {
      expect(chaoticDeterministicString(0, 'a')).toEqual('')
      expect(chaoticDeterministicString(3, 'a')).toHaveLength(3)
      expect(chaoticDeterministicString(50, 'a')).toHaveLength(50)
      expect(chaoticDeterministicString(51, 'a')).toHaveLength(51)
      expect(chaoticDeterministicString(51, 'bcdef')).toHaveLength(51)
      expect(chaoticDeterministicString(51, 'lorem ipsum')).toHaveLength(51)
      expect(chaoticDeterministicString(52, 'a')).toHaveLength(52)
      expect(chaoticDeterministicString(9273, 'a')).toHaveLength(9273)
      expect(chaoticDeterministicString(9273, 'bcdef')).toHaveLength(9273)
      expect(chaoticDeterministicString(9273, 'lorem ipsum')).toHaveLength(9273)
    })
    test('the returned string are chatoic but deterministic', () => {
      expect(chaoticDeterministicString(10, 'A')).toEqual('e2b469b8b1')
      expect(chaoticDeterministicString(20, 'A')).toEqual('fce09765d6fe7607ee4a')

      expect(chaoticDeterministicString(10, 'B')).toEqual('72faac9b39')
      expect(chaoticDeterministicString(20, 'B')).toEqual('4d8421c4d87c6a7ccf8a')
    })
  })
  describe('toReasonableFileName', () => {
    test('if the input contains only alphnumeric symbols, dash, underscore, return it as-is', () => {
      expect(toReasonableFileName('abc')).toEqual('abc')
      expect(toReasonableFileName('123')).toEqual('123')
      expect(toReasonableFileName('abc123')).toEqual('abc123')
      expect(toReasonableFileName('a-b_c')).toEqual('a-b_c')
    })
    test('retains case', () => {
      expect(toReasonableFileName('Abc')).toEqual('Abc')
      expect(toReasonableFileName('aBc')).toEqual('aBc')
      expect(toReasonableFileName('aBc123')).toEqual('aBc123')
    })
    test('converts other symbosl to underscores', () => {
      expect(toReasonableFileName('$a^b@c*d;e')).toEqual('_a_b_c_d_e')
    })
  })
  describe('partition', () => {
    test('when given a single predicate that is always positive, returns the input', () => {
      expect(partition('', () => true)).toEqual([''])
      expect(partition('abc', () => true)).toEqual(['abc'])
      expect(partition('abc123', () => true)).toEqual(['abc123'])
      expect(partition('a-b_c', () => true)).toEqual(['a-b_c'])
    })
    test('returns the consecutive substrings that matches each of the predictes, in order', () => {
      expect(
        partition(
          'abcABC',
          c => c.toLowerCase() === c,
          c => c.toUpperCase() === c,
        ),
      ).toEqual(['abc', 'ABC'])
      expect(
        partition(
          'abcdefg58',
          c => c >= 'A',
          c => c >= '0' && c <= '9',
        ),
      ).toEqual(['abcdefg', '58'])
      expect(
        partition(
          'ab___$@*_xyz',
          c => c !== '_',
          c => c === '_',
          c => c !== '_',
          c => c === '_',
          () => true,
        ),
      ).toEqual(['ab', '___', '$@*', '_', 'xyz'])
    })
    test('if a predicate matches nothing, the corresponding part in the return value is an empty string', () => {
      expect(
        partition(
          '123',
          c => c >= 'A',
          c => c >= '0' && c <= '9',
          c => c >= 'A',
        ),
      ).toEqual(['', '123', ''])
    })
    test('yells if the string is not fully exaushted', () => {
      expect(() => partition('5812ABC', c => c >= '0' && c <= '9')).toThrowError(
        'The input string could not be fully partitioned (remainder: "ABC")',
      )
    })
    test('the error message due to non exhuastive partitioning has a bounded size', () => {
      let message: string | undefined = undefined
      try {
        partition(chaoticDeterministicString(5000, 'a'), () => false)
      } catch (e) {
        message = errorLike(e).message
      }

      expect(message?.length).toBeGreaterThan(10)
      expect(message?.length).toBeLessThan(200)
    })
  })
  describe('threeWaySplit', () => {
    test('basic functionality', () => {
      expect(
        threeWaySplit(
          'ABCDE_AA_aa_bb_BB_pqr[^@$b_lmnopq',
          c => c >= 'A' && c <= 'Z',
          c => c >= 'a' && c <= 'z',
        ),
      ).toEqual({ prefix: 'ABCDE', mid: '_AA_aa_bb_BB_pqr[^@$b_', suffix: 'lmnopq' })
    })
    test('suffix can be empty', () => {
      expect(
        threeWaySplit(
          'ABCDE_12',
          c => c >= 'A' && c <= 'Z',
          c => c >= 'a' && c <= 'z',
        ),
      ).toEqual({ prefix: 'ABCDE', mid: '_12', suffix: '' })
    })
    test('mid can be empty', () => {
      expect(
        threeWaySplit(
          'ABCDEabcde',
          c => c >= 'A' && c <= 'Z',
          c => c >= 'a' && c <= 'z',
        ),
      ).toEqual({ prefix: 'ABCDE', mid: '', suffix: 'abcde' })
    })
    test('prefix can be empty', () => {
      expect(
        threeWaySplit(
          '12abcde',
          c => c >= 'A' && c <= 'Z',
          c => c >= 'a' && c <= 'z',
        ),
      ).toEqual({ prefix: '', mid: '12', suffix: 'abcde' })
    })
    test('prefix and mid can be empty', () => {
      expect(
        threeWaySplit(
          'abcde',
          c => c >= 'A' && c <= 'Z',
          c => c >= 'a' && c <= 'z',
        ),
      ).toEqual({ prefix: '', mid: '', suffix: 'abcde' })
    })
    test('suffix and mid can be empty', () => {
      expect(
        threeWaySplit(
          'XYZ',
          c => c >= 'A' && c <= 'Z',
          c => c >= 'a' && c <= 'z',
        ),
      ).toEqual({ prefix: 'XYZ', mid: '', suffix: '' })
    })
    test('suffix and prefix can be empty', () => {
      const output = threeWaySplit(
        '31415926',
        c => c >= 'A' && c <= 'Z',
        c => c >= 'a' && c <= 'z',
      )
      expect(output).toEqual({ prefix: '', mid: '31415926', suffix: '' })
    })
    test('when the input is empty, prefix + mid + suffix are empty', () => {
      expect(
        threeWaySplit(
          '',
          () => true,
          () => true,
        ),
      ).toEqual({ prefix: '', mid: '', suffix: '' })
    })
    test('prefix and suffix do not overalp', () => {
      expect(
        threeWaySplit(
          'ABCDE',
          c => c >= 'A' && c <= 'Z',
          c => c >= 'A' && c <= 'Z',
        ),
      ).toEqual({ prefix: 'ABCDE', mid: '', suffix: '' })
    })
  })
})
