import * as fse from 'fs-extra'
import * as Tmp from 'tmp-promise'

import { computeObjectHash, dumpFile } from '../src/misc'
import { chaoticDeterministicString } from '../src/strings'

describe('misc', () => {
  describe('computeObjectHash', () => {
    test('object hash of two identical objects is identical', () => {
      const h1 = computeObjectHash({ a: 1, b: 2, c: 3 })
      const h2 = computeObjectHash({ a: 1, b: 2, c: 3 })
      expect(h1).toEqual(h2)
    })
    test('object hash of two object with different order of keys is the same', () => {
      const h1 = computeObjectHash({ a: 1, b: 2, c: 3 })
      const h2 = computeObjectHash({ b: 2, c: 3, a: 1 })
      expect(h1).toEqual(h2)
    })
    test('object hash of two objects with different values is the different', () => {
      const h1 = computeObjectHash({ a: 1, b: 2, c: 3 })
      const h2 = computeObjectHash({ a: 1, b: 2, c: 4 })
      expect(h1).not.toEqual(h2)
    })
  })
  describe('dumpFile', () => {
    test('copies the content of a file to the given output stream', async () => {
      const src = (await Tmp.file()).path
      await fse.writeFile(src, 'we choose to go to the moon')

      const f = (await Tmp.file()).path
      const stream = fse.createWriteStream(f)
      try {
        await dumpFile(src, stream)
        const content = await fse.readFile(f, 'utf-8')
        expect(content).toEqual('we choose to go to the moon')
      } finally {
        stream.close()
      }
    })
    test('can cope with files which are hundreds of KBs in size', async () => {
      const longString = chaoticDeterministicString(300 * 1000, 'x')
      const src = (await Tmp.file()).path
      await fse.writeFile(src, longString)

      const f = (await Tmp.file()).path
      const stream = fse.createWriteStream(f)
      try {
        await dumpFile(src, stream)
        const content = await fse.readFile(f, 'utf-8')
        expect(content).toEqual(longString)
      } finally {
        stream.close()
      }
    })
  })
})
