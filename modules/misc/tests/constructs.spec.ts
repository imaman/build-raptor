import { errorLike, failMe, shouldNeverHappen, switchOn } from '../src/constructs.js'

describe('constructs', () => {
  describe('shouldNeverHappen', () => {
    test('can be called from sites which can never be executed', () => {
      // This is a very partial test. It should be complemented by a sad-path test which verifies that it cannot be
      // placed in sites which can be executed. Harder to write such a test.
      const f: () => 'A' | 'B' = () => 'A'

      const v = f()
      // Just to avoid a "no-assetions-in-test" lint error.
      expect(v).toBeTruthy()

      if (v === 'A') {
        return
      }
      if (v === 'B') {
        return
      }
      shouldNeverHappen(v)
    })
  })

  describe('switchOn', () => {
    const aOrB = (x: 'a' | 'b') => x

    test('invokes one of the case functions based on the value passed in', () => {
      expect(switchOn(aOrB('a'), { a: () => 100, b: () => 200 })).toEqual(100)
      expect(switchOn(aOrB('b'), { a: () => 100, b: () => 200 })).toEqual(200)
    })
    test('correctly deduces the return type', () => {
      const n = switchOn(aOrB('a'), { a: () => 100, b: () => 200 })
      const nn: number = n
      expect(nn).toEqual(100)
    })
    test('correctly deduces the return type of booleansß', () => {
      const b = switchOn(aOrB('b'), { a: () => true, b: () => false })
      const bb: boolean = b
      expect(bb).toBe(false)
    })
  })
  describe('failMe()', () => {
    test('throws an error when called', () => {
      expect(() => failMe()).toThrow('This expression must never be evaluated')
    })

    describe('when used in disjunction has the same return type as the left-hand side', () => {
      test('when the left-hand side is non-nullable', () => {
        const f: (x: number) => Date = (x: number) => new Date(x)
        const a: Date = f(900) ?? failMe()
        expect(a.getTime()).toEqual(900)
      })
      test('when the left-hand side is inferred non-nullable', () => {
        const f: (x: number) => Date = (x: number) => new Date(x)
        const b = f(800) ?? failMe()
        expect(b.getTime()).toEqual(800)
      })
      test('when the left-hand side is nullable', () => {
        const f: (x: number) => Date | undefined = (x: number) => (x >= 0 ? new Date(x) : undefined)
        const a: Date = f(900) ?? failMe()
        expect(a.getTime()).toEqual(900)
      })
      test('when the left-hand side is inferred nullable', () => {
        const f: (x: number) => Date | undefined = (x: number) => (x >= 0 ? new Date(x) : undefined)
        const b = f(800) ?? failMe()
        expect(b.getTime()).toEqual(800)
      })
    })
  })
  describe('errorLike', () => {
    test('returns an object with a .message property of type string if the input has one', () => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const input = { message: 'foo' } as unknown
      const output = errorLike(input)
      expect(output).toEqual({ message: 'foo' })
    })
    test('returns an object with a .stack property of type string if the input has one', () => {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const input = { stack: 'goo' } as unknown
      const output = errorLike(input)
      expect(output).toEqual({ stack: 'goo' })
    })
    test('returns an object with an undefined .stack property if the input has a non-string .stack', () => {
      expect(errorLike({ stack: 5 })).toEqual({ stack: undefined })
      expect(errorLike({ stack: new Date(3) })).toEqual({ stack: undefined })
      expect(errorLike({ stack: { something: 'blah' } })).toEqual({ stack: undefined })
    })
    test('returns an object with an undefined .message property if the input has a non-string .message', () => {
      expect(errorLike({ message: 5 })).toEqual({ message: undefined })
      expect(errorLike({ message: new Date(3) })).toEqual({ message: undefined })
      expect(errorLike({ message: { something: 'blah' } })).toEqual({ message: undefined })
    })
  })
})
