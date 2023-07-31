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
  test('can reconstruct a file (including its mode and mtime)', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry(
      { path: 'a', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false },
      Buffer.from('the quick brown fox'),
    )

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(await slurpDir(dir)).toEqual({ a: 'the quick brown fox' })
    expect(fs.statSync(path.join(dir, 'a'))).toMatchObject({ mtime: d, mode: 0o100400 })
  })
  test('can reconstruct a directory structure', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry({ path: 'x/y', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('alpha'))
    ts.entry({ path: 'a/b/c/d/e', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('beta'))
    ts.entry({ path: 'a/b/c/f', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('gamma'))
    ts.entry({ path: 'a/b/c/g', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('delta'))
    ts.entry({ path: 'a/h', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('epsilon'))

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
    ts.entry({ path: 'a/b/h', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('epsilon'))
    ts.entry({ path: 'a/b/c/d/e', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: true }, Buffer.from('../../h'))

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(fs.readFileSync(path.join(dir, 'a/b/h'), 'utf-8')).toEqual('epsilon')
    expect(fs.readFileSync(path.join(dir, 'a/b/c/d/e'), 'utf-8')).toEqual('epsilon')
    expect(fs.readlinkSync(path.join(dir, 'a/b/c/d/e'))).toEqual('../../h')
  })
  test('correctly reconstructs symlinks even when they are defined before their target', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry({ path: 'a/b/c/d/e', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: true }, Buffer.from('../../h'))
    ts.entry({ path: 'a/b/h', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('epsilon'))

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(fs.readFileSync(path.join(dir, 'a/b/h'), 'utf-8')).toEqual('epsilon')
    expect(fs.readFileSync(path.join(dir, 'a/b/c/d/e'), 'utf-8')).toEqual('epsilon')
    expect(fs.readlinkSync(path.join(dir, 'a/b/c/d/e'))).toEqual('../../h')
  })
  test('sets mode and mtime of a symlink', async () => {
    const ts = TarStream.pack()
    const d1 = new Date('2011-01-01T11:00:00.000Z')
    ts.entry({ path: 'myfile', mode: 0o400, atime: d1, ctime: d1, mtime: d1, isSymlink: false }, Buffer.from('spot on'))
    const d2 = new Date('2022-02-02T22:00:00.000Z')
    ts.entry({ path: 'mylink', mode: 0, atime: d2, ctime: d2, mtime: d2, isSymlink: true }, Buffer.from('./myfile'))

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(fs.readFileSync(path.join(dir, 'mylink'), 'utf-8')).toEqual('spot on')
    expect(fs.statSync(path.join(dir, 'mylink'))).toMatchObject({ mtime: d2 })
  })
  test('can create multipel symlinks', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry({ path: 'a0', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('A'))
    ts.entry({ path: 'a1', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: true }, Buffer.from('./a0'))
    ts.entry({ path: 'b0', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: false }, Buffer.from('B'))
    ts.entry({ path: 'b1', mode: 0o400, atime: d, ctime: d, mtime: d, isSymlink: true }, Buffer.from('./b0'))

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(fs.readlinkSync(path.join(dir, 'a1'))).toEqual('./a0')
    expect(fs.readlinkSync(path.join(dir, 'b1'))).toEqual('./b0')
  })
  test.todo('symlink has a dedicated function')
  test('a symlink cannot point outside of the bundle', () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    expect(() =>
      ts.entry({ path: 'a', mode: 0, atime: d, ctime: d, mtime: d, isSymlink: true }, Buffer.from('../../b')),
    ).toThrowError('symlink (a) points outside of subtree (../../b)')
  })
})
