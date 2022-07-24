import * as util from 'util'
import * as zlib from 'zlib'

import { InMemoryStorageClient, Int } from '../src'

describe('in-memory-storage-client', () => {
  describe('getObject()', () => {
    test('returns the content that was passed to putObject()', async () => {
      const sc = new InMemoryStorageClient()
      await sc.putObject('a', 'b')
      expect(await sc.getObject('a')).toEqual('b')
    })
    test('can return the stored content as either a string or a buffer', async () => {
      const sc = new InMemoryStorageClient()
      await sc.putObject('a', 'Alice')

      const s = await sc.getObject('a', 'string')
      expect(s).toEqual('Alice')

      const b = await sc.getObject('a', 'buffer')
      expect(Buffer.compare(b, Buffer.from('Alice'))).toEqual(0)
    })
  })
  test('objectExists() indicates whether an object with that key was put earlier', async () => {
    const sc = new InMemoryStorageClient()

    expect(await sc.objectExists('a')).toBe(false)
    await sc.putObject('a', 'b')
    expect(await sc.objectExists('a')).toBe(true)
  })
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
  test('can properly store gzipped content', async () => {
    const gzip = util.promisify(zlib.gzip)
    const gunzip = util.promisify(zlib.gunzip)

    const sc = new InMemoryStorageClient()
    await sc.putObject('z', await gzip(Buffer.from('Zebra')))

    const buf = await sc.getObject('z', 'buffer')
    const unzipped = await gunzip(buf)
    expect(unzipped.toString('utf-8')).toEqual('Zebra')
  })
})
