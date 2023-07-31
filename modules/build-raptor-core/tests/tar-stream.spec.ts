import * as fs from 'fs'
import { createNopLogger } from 'logger'
import { slurpDir } from 'misc'
import * as os from 'os'
import * as path from 'path'

import { TarStream } from '../src/tar-stream'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tmp'))
}

describe('tar-stream', () => {
  test('can reconstruct a file', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry({ path: 'a', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('the quick brown fox'))

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(await slurpDir(dir)).toEqual({ a: 'the quick brown fox' })
  })
  test('can reconstruct a directory structure', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry({ path: 'x/y', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('alpha'))
    ts.entry({ path: 'a/b/c/d/e', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('beta'))
    ts.entry({ path: 'a/b/c/f', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('gamma'))
    ts.entry({ path: 'a/b/c/g', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('delta'))
    ts.entry({ path: 'a/h', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('epsilon'))

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(await slurpDir(dir)).toEqual({
      'x/y': 'alpha',
      'a/b/c/d/e': 'beta',
      'a/b/c/f': 'gamma',
      'a/b/c/g': 'delta',
      'a/h': 'epsilon',
    })
  })
  test('can reconstruct symlinks', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry({ path: 'a/b/c/d/e', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: true }, Buffer.from('../../h'))
    ts.entry({ path: 'a/b/h', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('epsilon'))

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(fs.readFileSync(path.join(dir, 'a/b/h'), 'utf-8')).toEqual('epsilon')
  })
})
