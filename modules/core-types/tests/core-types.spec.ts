import { PathInRepo, RepoRoot } from '../src'

describe('core-types', () => {
  describe('PathInRepo', () => {
    describe('expand()', () => {
      test('appends the given path', async () => {
        expect(PathInRepo('abc').expand('xyz').val).toEqual('abc/xyz')
        expect(PathInRepo('abc').expand('uvw/xyz').val).toEqual('abc/uvw/xyz')
      })
      test('allows relative paths to climb up', () => {
        expect(() => PathInRepo('abc/rst/uvw/xyz').expand('../../jkl')).toThrowError(
          `Cannot expand 'abc/rst/uvw/xyz' to 'abc/rst/jkl'`,
        )
      })
      test('can expand the empty path', () => {
        expect(PathInRepo('.').expand('rst/uvw').val).toEqual('rst/uvw')
        expect(PathInRepo('').expand('rst/uvw').val).toEqual('rst/uvw')
      })
      test('can expand with the empty path', () => {
        expect(PathInRepo('rst').expand('.').expand('uvw').val).toEqual('rst/uvw')
        expect(PathInRepo('rst').expand('').expand('uvw').val).toEqual('rst/uvw')
        expect(PathInRepo('.').expand('.').val).toEqual('.')
        expect(PathInRepo('').expand('').val).toEqual('.')
      })
    })
    describe('to()', () => {
      test('allows relative paths to climb up', () => {
        expect(PathInRepo('abc/rst/uvw/xyz').to('../../jkl').val).toEqual('abc/rst/jkl')
      })
    })
  })
  describe('RepoRoot', () => {
    describe('unresolve()', () => {
      test.skip('does not allow escaping', async () => {
        const r = RepoRoot('/abc/def/ghi')
        expect(() => r.unresolve('/abc/pqr')).toThrowError('--')
      })
    })
  })
})
