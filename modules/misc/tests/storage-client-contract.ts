import * as util from 'util'
import * as zlib from 'zlib'

import { StorageClient } from '../src'

// eslint-disable-next-line jest/no-export
export function storageClientContract(create: () => Promise<StorageClient>) {
  describe('storage-client-contract', () => {
    describe('getObject()', () => {
      test('returns the content that was passed to putObject()', async () => {
        const sc = await create()
        await sc.putObject('a', 'b')
        expect(await sc.getObject('a')).toEqual('b')
      })
      test('can return the stored content as either a string or a buffer', async () => {
        const sc = await create()
        await sc.putObject('a', 'Alice')

        const s = await sc.getObject('a', 'string')
        expect(s).toEqual('Alice')

        const b = await sc.getObject('a', 'buffer')
        expect(Buffer.compare(b, Buffer.from('Alice'))).toEqual(0)
      })
    })
    describe('getContentAddressable()', () => {
      test('retreves the content of an object using the "address" returned value of putContentAddressable()', async () => {
        const sc = await create()
        const h = await sc.putContentAddressable('abc')
        expect((await sc.getContentAddressable(h)).toString()).toEqual('abc')
      })
      test('identical objects will have identical address', async () => {
        const sc = await create()
        const h1 = await sc.putContentAddressable('abc')
        const h2 = await sc.putContentAddressable('abb')
        const h3 = await sc.putContentAddressable('abc')
        const h4 = await sc.putContentAddressable('abb')
        expect(h1).toEqual(h3)
        expect(h2).toEqual(h4)
        expect(h1).not.toEqual(h2)

        expect((await sc.getContentAddressable(h1)).toString()).toEqual('abc')
        expect((await sc.getContentAddressable(h2)).toString()).toEqual('abb')
      })
    })
    test('objectExists() indicates whether an object with that key was put earlier', async () => {
      const sc = await create()

      expect(await sc.objectExists('a')).toBe(false)
      await sc.putObject('a', 'b')
      expect(await sc.objectExists('a')).toBe(true)
    })
    test('can properly store gzipped content', async () => {
      const gzip = util.promisify(zlib.gzip)
      const gunzip = util.promisify(zlib.gunzip)

      const sc = await create()
      await sc.putObject('z', await gzip(Buffer.from('Zebra')))

      const buf = await sc.getObject('z', 'buffer')
      const unzipped = await gunzip(buf)
      expect(unzipped.toString('utf-8')).toEqual('Zebra')
    })
  })
}
