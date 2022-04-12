import { Int } from '../src/int'

describe('Int', () => {
  test('yells if a non-integer number is passed to it', () => {
    expect(() => Int(1.5)).toThrowError(/<1.5> is not an integer/)
  })
  test('returns the numerical form of its input', () => {
    expect(Int(3)).toEqual(3)
  })
  describe('Int().parse(...)', () => {
    test('yells if a non-integer string is passed to it', () => {
      expect(() => Int().parse('1.2')).toThrowError(/<1.2> is not an integer/)
    })
    test('yells if a non-number string is passed to it', () => {
      expect(() => Int().parse('x')).toThrowError(/<x> is not an integer/)
    })
    test('returns the numerical form of its input', () => {
      expect(Int().parse('3')).toEqual(3)
      expect(Int().parse('3.0')).toEqual(3)
    })
  })
  describe('addition', () => {
    test('can be achieved by calling Int().sum(...)', () => {
      expect(Int().sum(Int(1), 4)).toEqual(5)
    })
  })
  describe('subtraction', () => {
    test('can be achieved by using addition with negative values', () => {
      expect(Int().sum(Int(8), -3)).toEqual(5)
    })
  })
  describe('multiplication', () => {
    test('can be achieved by calling Int().product(...)', () => {
      expect(Int().product(Int(3), 4)).toEqual(12)
    })
  })
})
