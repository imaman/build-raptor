import { PathInRepo, RepoRoot } from '../src'

describe('core-types', () => {
  describe('PathInRepo', () => {
    test('can be constructed with a relative path', () => {
      expect(PathInRepo('abc/pqr').val).toEqual('abc/pqr')
    })
    test('can be constructed with an empty path', () => {
      expect(PathInRepo('').val).toEqual('.')
      expect(PathInRepo('.').val).toEqual('.')
      expect(PathInRepo('abc/def/../../').val).toEqual('.')
    })
    test('errors if constructed with a path that climbs up', () => {
      expect(() => PathInRepo('../x').val).toThrowError('..')
      expect(() => PathInRepo('abc/def/../../..').val).toThrowError('..')
    })
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
        expect(PathInRepo('abc').to('..').val).toEqual('.')
      })
      test('errors if the result tries to go up', () => {
        expect(() => PathInRepo('abc').to('../../')).toThrowError(`cannot go up outside of the repo (got: '..')`)
        expect(() => PathInRepo('abc').to('../../../')).toThrowError(`cannot go up outside of the repo (got: '../..')`)
        expect(() => PathInRepo('abc').to('pqr/../../../')).toThrowError(`cannot go up outside of the repo (got: '..')`)
      })
      test('when passed an empty path stays the same', () => {
        expect(PathInRepo('abc/def').to('').val).toEqual('abc/def')
        expect(PathInRepo('abc/def').to('.').val).toEqual('abc/def')
      })
      test('when it is the empty path the result is the argument', () => {
        expect(PathInRepo('').to('pqr/s').val).toEqual('pqr/s')
        expect(PathInRepo('.').to('pqr/s').val).toEqual('pqr/s')
      })
    })
  })
  describe('RepoRoot', () => {
    describe('unresolve()', () => {
      test('returns a PathInRepo to the given input (an absolute path)', async () => {
        const r = RepoRoot('/abc/def/')
        expect(r.unresolve('/abc/def/pqr/stu').val).toEqual('pqr/stu')
      })
      test('errors if the given input is outside of the subtree', async () => {
        const r = RepoRoot('/abc/def/ghi')
        expect(() => r.unresolve('/abc/pqr')).toThrowError(`cannot go up outside of the repo (got: '../../pqr')`)
      })
    })
  })
})
