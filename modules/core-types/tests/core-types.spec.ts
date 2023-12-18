import { PathInRepo, RepoRoot } from '../src'

describe('core-types', () => {
  describe('PathInRepo', () => {
    describe('expand()', () => {
      test('appends the given path', async () => {
        const abc = PathInRepo('abc')
        expect(abc.expand('xyz').val).toEqual(PathInRepo('abc/xyz').val)
      })
    })
  })
  describe('RepoRoot', () => {
    describe('???', () => {
      test('does not allow escaping', async () => {
        const abc = RepoRoot('/abc/def/ghi')
        expect(abc.unresolve('/abc/pqr')).toEqual('--')
      })
    })
  })
})
