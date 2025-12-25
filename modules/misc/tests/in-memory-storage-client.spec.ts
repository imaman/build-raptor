import { InMemoryStorageClient, Int } from '../src'
import { storageClientContract } from './storage-client-contract'

describe('in-memory-storage-client', () => {
  storageClientContract(async () => new InMemoryStorageClient())

  describe('byteCoubnt', () => {
    test('returns the total size of all currrently stored objects', async () => {
      const sc = new InMemoryStorageClient()
      expect(sc.byteCount).toEqual(0)

      await sc.putObject('a', 'x')
      const s1 = sc.byteCount
      expect(s1).toBeGreaterThan(0)

      await sc.putObject('b', 'xy')
      const s2 = sc.byteCount
      expect(s2).toBeGreaterThan(s1)
      await sc.putObject('c', 'xyz')
      const s3 = sc.byteCount
      expect(s3).toBeGreaterThan(s2)
    })
    test('when an smaller object overwrites a larger object, the byte count decreases', async () => {
      const sc = new InMemoryStorageClient()
      await sc.putObject('a', 'stuvwxyz')
      const s1 = sc.byteCount
      await sc.putObject('a', 'x')
      const s2 = sc.byteCount
      expect(s2).toBeLessThan(s1)
    })
  })
  test('when a size limit is given, yells if a put operation will lead to the byteCount exceeding that limit', async () => {
    const sc = new InMemoryStorageClient(Int(14))

    await sc.putObject('a', 'p')
    await sc.putObject('b', 'q')
    await sc.putObject('c', 'r')
    await expect(sc.putObject('d', 'stuvwxyz')).rejects.toThrowError('size limit (14 bytes) will be exceeded')
  })
  describe('load()', () => {
    test('updates the storage with the given data', async () => {
      const sc1 = new InMemoryStorageClient(Int(14))

      await sc1.putObject('a', 'p')
      await sc1.putObject('b', 'q')
      await sc1.putObject('c', 'r')

      const sc2 = new InMemoryStorageClient(Int(14))
      expect(sc2.byteCount).toEqual(0)

      sc2.load(sc1.toJSON())
      expect(sc2.byteCount).toEqual(sc1.byteCount)

      expect(await sc2.getObject('a')).toEqual('p')
      expect(await sc2.getObject('b')).toEqual('q')
      expect(await sc2.getObject('c')).toEqual('r')
    })
    test('overwrites pre-exsiting entries', async () => {
      const sc1 = new InMemoryStorageClient()

      await sc1.putObject('a', 'p')

      const sc2 = new InMemoryStorageClient()
      await sc2.putObject('a', 'alpha')
      await sc2.putObject('b', 'beta')

      sc2.load(sc1.toJSON())
      expect(await sc2.getObject('a')).toEqual('p')
      expect(await sc2.getObject('b')).toEqual('beta')
    })
    test('updates the byte count', async () => {
      const sc1 = new InMemoryStorageClient()
      await sc1.putObject('k1', 'the quick brown fox')
      const bc1 = sc1.byteCount

      const sc2 = new InMemoryStorageClient()
      await sc2.putObject('k2', 'jumps over the lazy dog')
      const bc2 = sc2.byteCount

      sc2.load(sc1.toJSON())
      expect(sc2.byteCount).toEqual(bc1 + bc2)
    })
    test('load() adds to the preexisting entries', async () => {
      const sc1 = new InMemoryStorageClient(Int(14))

      await sc1.putObject('a', 'p')

      const sc2 = new InMemoryStorageClient(Int(14))
      await sc2.putObject('b', 'q')

      sc2.load(sc1.toJSON())

      expect(await sc2.getObject('a')).toEqual('p')
      expect(await sc2.getObject('b')).toEqual('q')
    })
    test('can load empty', async () => {
      const sc1 = new InMemoryStorageClient(Int(14))

      const sc2 = new InMemoryStorageClient(Int(14))

      expect(sc2.byteCount).toEqual(0)
      sc2.load(sc1.toJSON())
      expect(sc2.byteCount).toEqual(0)
    })
    test('yells if the data to load is not well formed', async () => {
      const sc = new InMemoryStorageClient(Int(14))

      expect(() => sc.load({})).toThrowError('not an array')
      expect(() => sc.load([{}])).toThrowError('entry 0 is not a pair (got: object)')
      expect(() => sc.load(['a'])).toThrowError('entry 0 is not a pair (got: string)')
      expect(() => sc.load(['a', 'b'])).toThrowError('entry 0 is not a pair (got: string)')
      expect(() => sc.load([[]])).toThrowError('entry 0 is not a pair (length: 0)')
      expect(() => sc.load([['a']])).toThrowError('entry 0 is not a pair (length: 1)')
      expect(() => sc.load([['a', 'b', 'c']])).toThrowError('entry 0 is not a pair (length: 3)')
      expect(() => sc.load([[100, 200]])).toThrowError('expected a pair of strings but found a number at pair 0')
    })
  })
})
