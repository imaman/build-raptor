import * as util from 'util'
import * as zlib from 'zlib'

import { InMemoryStorageClient, Int } from '../src'

describe('in-memory-storage-client', () => {
  test('getObject() returns the content that was passed to putObject()', async () => {
    const sc = new InMemoryStorageClient()
    await sc.putObject('a', 'b')
    expect(await sc.getObject('a')).toEqual('b')
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
      expect(sc.byteCount).toEqual(1)
      await sc.putObject('b', 'xy')
      await sc.putObject('c', 'xyz')
      expect(sc.byteCount).toEqual(6)
    })
    test('when an smaller object overwrites a larger object, the byte count decreases', async () => {
      const sc = new InMemoryStorageClient()
      expect(sc.byteCount).toEqual(0)
      await sc.putObject('a', 'stuvwxyz')
      expect(sc.byteCount).toEqual(8)
      await sc.putObject('a', 'x')
      expect(sc.byteCount).toEqual(1)
    })
  })
  test('when a size limit is given, yells if a put operation will lead to the byteCount exceeding that limit', async () => {
    const sc = new InMemoryStorageClient(Int(10))

    await sc.putObject('a', 'p')
    await sc.putObject('b', 'q')
    await sc.putObject('c', 'r')
    await expect(sc.putObject('d', 'stuvwxyz')).rejects.toThrowError('size limit (10 bytes) will be exceeded')
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
