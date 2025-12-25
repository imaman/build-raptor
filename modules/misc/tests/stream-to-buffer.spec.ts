import fse from 'fs-extra/esm'
import * as path from 'path'
import { Readable, Writable } from 'stream'

import { folderify } from '../src/folderify.js'
import { streamTobuffer } from '../src/stream-to-buffer.js'

describe('stream-to-buffer', () => {
  test('translates a file read stream to a buffer', async () => {
    const d = await folderify({ a: 'abcd' })
    const s = fse.createReadStream(path.join(d, 'a'))
    const buffer = await streamTobuffer(s)
    expect(buffer.toString()).toEqual('abcd')
  })
  test('translates an in-memory stream to a buffer', async () => {
    const readable = Readable.from('lorem ipsum')
    const buffer = await streamTobuffer(readable)
    expect(buffer.toString()).toEqual('lorem ipsum')
  })
  test('propagates errors', async () => {
    const myStream = new Writable()

    const fooErr = new Error('foo error')
    myStream.destroy(fooErr)

    await expect(streamTobuffer(myStream)).rejects.toThrowError('error converting stream - Error: foo error')
  })
})
