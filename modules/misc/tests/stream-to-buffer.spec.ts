import { Readable } from 'stream'

import { streamTobuffer } from '../src/stream-to-buffer'

describe('stream-to-buffer', () => {
  test('foo', async () => {
    const stream = Readable.from('abcd')
    const buffer = await streamTobuffer(stream)
    expect(buffer.toString()).toEqual('abcd')
  })
})
