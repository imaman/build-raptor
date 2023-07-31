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
    ts.entry({ path: 'a', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('the quick brown fox'))

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(await slurpDir(dir)).toEqual({ a: 'the quick brown fox' })
    expect(fs.statSync(path.join(dir, 'a'))).toMatchObject({ mtime: d, mode: 0o100400 })
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
    ts.entry({ path: 'a/b/h', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('epsilon'))
    ts.symlink({ from: 'a/b/c/d/e', to: 'a/b/h', mtime: d })

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
    ts.symlink({ from: 'a/b/c/d/e', mtime: d, to: 'a/b/h' })
    ts.entry({ path: 'a/b/h', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('epsilon'))

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
    ts.entry({ path: 'myfile', mode: 0o400, atime: d1, ctime: d1, mtime: d1 }, Buffer.from('spot on'))
    const d2 = new Date('2022-02-02T22:00:00.000Z')
    ts.symlink({ from: 'mylink', mtime: d2, to: 'myfile' })

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(fs.readFileSync(path.join(dir, 'mylink'), 'utf-8')).toEqual('spot on')
    expect(fs.statSync(path.join(dir, 'mylink'))).toMatchObject({ mtime: d2 })
  })
  test('can create multiple symlinks', async () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    ts.entry({ path: 'a0', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('A'))
    ts.symlink({ from: 'a1', to: 'a0', mtime: d })
    ts.entry({ path: 'b0', mode: 0o400, atime: d, ctime: d, mtime: d }, Buffer.from('B'))
    ts.symlink({ from: 'b1', to: 'b0', mtime: d })

    const b = ts.toBuffer()

    const dir = tempDir()
    await TarStream.extract(b, dir, createNopLogger())

    expect(fs.readlinkSync(path.join(dir, 'a1'))).toEqual('a0')
    expect(fs.readlinkSync(path.join(dir, 'b1'))).toEqual('b0')
  })
  test(`a symlink's target cannot be an absolute path`, () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    expect(() => ts.symlink({ from: 'a', mtime: d, to: '/x/y' })).toThrowError('path must be relative (got: /x/y)')
  })
  test(`a symlink's source cannot be an absolute path`, () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    expect(() => ts.symlink({ from: '/a/b', mtime: d, to: '/x/y' })).toThrowError('path must be relative (got: /a/b)')
  })
  test(`an entry cannot use an absoulte path`, () => {
    const ts = TarStream.pack()
    const d = new Date('2023-04-05T11:00:00.000Z')
    expect(() => ts.entry({ path: '/q/r', mode: 0, atime: d, ctime: d, mtime: d }, Buffer.from('A'))).toThrowError(
      'path must be relative (got: /q/r)',
    )
  })
})
