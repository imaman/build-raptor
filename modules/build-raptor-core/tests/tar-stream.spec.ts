import * as fs from 'fs'
import { createNopLogger } from 'logger'
import { slurpDir } from 'misc'
import * as os from 'os'
import * as path from 'path'

import { TarStream } from '../src/tar-stream'

describe('tar-stream', () => {
  test('foo', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry({ path: 'a', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('the quick brown fox'))

    const b = ts.toBuffer()

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp'))
    await TarStream.extract(b, dir, createNopLogger())

    expect(await slurpDir(dir)).toEqual({ a: 'the quick brown fox' })
  })
})
