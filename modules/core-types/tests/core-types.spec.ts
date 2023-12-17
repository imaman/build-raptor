import { PathInRepo } from '../src'

describe('core-types', () => {
  describe('PathInRepo', () => {
    describe('expand()', () => {
      test('appends the given path', async () => {
        const abc = PathInRepo('abc')
        expect(abc.expand('xyz').val).toEqual(PathInRepo('abc/xyz').val)
      })
    })
  })
})
