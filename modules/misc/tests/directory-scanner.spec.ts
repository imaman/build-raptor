import * as fs from 'fs'
import * as fse from 'fs-extra'
import * as path from 'path'

import { DirectoryScanner } from '../src/directory-scanner'
import { folderify } from '../src/folderify'

describe('directory-scanner', () => {
  async function run(
    ds: DirectoryScanner,
    startingPoint: string,
    ignore?: string[],
  ): Promise<{ loc: string; content: string }[]> {
    const acc: { loc: string; content: string }[] = []
    await ds.scanTree(startingPoint, { predicate: x => !ignore || !ignore.includes(x) }, (loc, content) => {
      acc.push({ loc, content: content.toString() })
    })
    return acc
  }
  async function scanPaths(ds: DirectoryScanner, startingPoint: string, ignore?: string[]): Promise<string[]> {
    return (await run(ds, startingPoint, ignore)).map(x => x.loc)
  }

  test('invokes the given callback with the path and content of each of the files', async () => {
    const d = await folderify({
      'd1/q.txt': 'lorem',
      'd1/r.txt': 'ipsum',
      'd1/c/d/e/f/r.txt': 'dolor',
      'd2/u.txt': 'elit',
      'd1/c/r.txt': 'sit',
      'd1/c/s.txt': 'amet',
      'd1/c/d/e/t.txt': 'consectetur',
      'd1/c/d/e/f/t.txt': 'adipiscing',
    })

    const ds = new DirectoryScanner(d)
    const acc: { p: string; content: string }[] = []
    await ds.scanTree('', (p, buf) => acc.push({ p, content: buf.toString('utf-8') }))
    expect(acc).toEqual([
      { p: 'd1/c/d/e/f/r.txt', content: 'dolor' },
      { p: 'd1/c/d/e/f/t.txt', content: 'adipiscing' },
      { p: 'd1/c/d/e/t.txt', content: 'consectetur' },
      { p: 'd1/c/r.txt', content: 'sit' },
      { p: 'd1/c/s.txt', content: 'amet' },
      { p: 'd1/q.txt', content: 'lorem' },
      { p: 'd1/r.txt', content: 'ipsum' },
      { p: 'd2/u.txt', content: 'elit' },
    ])
  })
  test('alphabetical order of files in a directory', async () => {
    const d = await folderify({
      b: '',
      e: '',
      c: '',
      a: '',
      d: '',
    })

    const ds = new DirectoryScanner(d)
    const acc: string[] = []
    await ds.scanTree('', p => acc.push(p))
    expect(acc).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
  test('alphabetical order of directories', async () => {
    const d = await folderify({
      'b/x': '',
      'e/x': '',
      'c/x': '',
      'a/x': '',
      'd/x': '',
    })

    const ds = new DirectoryScanner(d)
    const acc: string[] = []
    await ds.scanTree('', p => acc.push(p))
    expect(acc).toEqual(['a/x', 'b/x', 'c/x', 'd/x', 'e/x'])
  })
  test('scans only the files under the given starting point', async () => {
    const d = await folderify({
      'd1/a/a1': 'V',
      'd1/a/a2': 'W',
      'd1/b/charlie/c1': 'X',
      'd1/b/charlie/c2': 'Y',
      'd1/b/david/d1': 'Z',
    })

    const ds = new DirectoryScanner(d)

    const acc1: string[] = []
    await ds.scanTree('d1', p => acc1.push(p))
    expect(acc1).toEqual(['d1/a/a1', 'd1/a/a2', 'd1/b/charlie/c1', 'd1/b/charlie/c2', 'd1/b/david/d1'])

    const acc2: string[] = []
    await ds.scanTree('d1/a', p => acc2.push(p))
    expect(acc2).toEqual(['d1/a/a1', 'd1/a/a2'])

    const acc3: string[] = []
    await ds.scanTree('d1/b', p => acc3.push(p))
    expect(acc3).toEqual(['d1/b/charlie/c1', 'd1/b/charlie/c2', 'd1/b/david/d1'])

    const acc4: string[] = []
    await ds.scanTree('d1/b/charlie', p => acc4.push(p))
    expect(acc4).toEqual(['d1/b/charlie/c1', 'd1/b/charlie/c2'])

    const acc5: string[] = []
    await ds.scanTree('d1/b/david', p => acc5.push(p))
    expect(acc5).toEqual(['d1/b/david/d1'])
  })
  test('yells if root directory is not an asolute path', async () => {
    const d = await folderify({ 'a/b/c/d': '' })

    const relativePath = path.relative(process.cwd(), d)

    expect(() => new DirectoryScanner(relativePath)).toThrow('rootDir must be absolute')
  })
  test('yells if the starting point is not absolute', async () => {
    const d = await folderify({ 'a/b/c/d': '' })

    const ds = new DirectoryScanner(d)

    await expect(ds.scanTree(path.join(d, 'a'), () => {})).rejects.toThrow('relativePath must be relative')
    await expect(ds.scanTree('/some-absolute-file-which-i-just-invented', () => {})).rejects.toThrow(
      'relativePath must be relative',
    )
    await expect(ds.scanTree('///', () => {})).rejects.toThrowError('relativePath must be relative')
  })
  test('handles unnormalized root directory path', async () => {
    const d = await folderify({
      'a/b/c1/d/e/e1.txt': 'this-is-e1',
      'a/b/c2/d/e/e2.txt': 'this-is-e2',
    })

    const ds = new DirectoryScanner(path.join(d, 'a/b/../b/c1'))

    const acc: { p: string; content: string }[] = []
    await ds.scanTree('', (p, buf) => acc.push({ p, content: buf.toString('utf-8') }))
    expect(acc).toEqual([{ p: 'd/e/e1.txt', content: 'this-is-e1' }])
  })
  test('normalizes that starting point path', async () => {
    const d = await folderify({
      'a/b/c1/d/e/e1.txt': 'this-is-e1',
      'a/b/c2/d/e/e2.txt': 'this-is-e2',
    })

    const ds = new DirectoryScanner(d)

    const acc1: { p: string; content: string }[] = []
    await ds.scanTree('a/b/../b/c1', (p, buf) => acc1.push({ p, content: buf.toString('utf-8') }))
    expect(acc1).toEqual([{ p: 'a/b/c1/d/e/e1.txt', content: 'this-is-e1' }])

    const acc2: { p: string; content: string }[] = []
    await ds.scanTree('a/b/c1/../c2', (p, buf) => acc2.push({ p, content: buf.toString('utf-8') }))
    expect(acc2).toEqual([{ p: 'a/b/c2/d/e/e2.txt', content: 'this-is-e2' }])
  })
  test('the callback is not invoked if there are no files', async () => {
    const d = await folderify({
      'a/b/c1/d/e/e1.txt': '',
    })
    await fse.remove(path.join(d, 'a/b/c1/d/e/e1.txt'))

    const ds = new DirectoryScanner(d)

    const acc: string[] = []
    await ds.scanTree('', p => acc.push(p))
    expect(acc).toHaveLength(0)
  })
  test('the starting point can be a file', async () => {
    const ds = new DirectoryScanner(await folderify({ 'a/b/c': '' }))

    const acc: string[] = []
    await ds.scanTree('a/b/c', p => acc.push(p))
    expect(acc).toEqual(['a/b/c'])
  })
  test('trims trailing slashes', async () => {
    const ds = new DirectoryScanner(await folderify({ 'a/b/c/d/e/f.txt': '' }))

    expect(await scanPaths(ds, 'a/b/c/d/e/')).toEqual(['a/b/c/d/e/f.txt'])
    expect(await scanPaths(ds, 'a/b/c/')).toEqual(['a/b/c/d/e/f.txt'])
    expect(await scanPaths(ds, 'a/b/c////')).toEqual(['a/b/c/d/e/f.txt'])
    expect(await scanPaths(ds, 'a/')).toEqual(['a/b/c/d/e/f.txt'])
    expect(await scanPaths(ds, 'a//')).toEqual(['a/b/c/d/e/f.txt'])
  })
  test('when the starting point is the empty path, returns everything under the root dir', async () => {
    const ds = new DirectoryScanner(
      await folderify({
        'a/b/c': '',
        'a/d/e1': '',
        'a/d/e2': '',
        f: '',
      }),
    )

    expect(await scanPaths(ds, '')).toEqual(['a/b/c', 'a/d/e1', 'a/d/e2', 'f'])
    expect(await scanPaths(ds, '.')).toEqual(['a/b/c', 'a/d/e1', 'a/d/e2', 'f'])
  })
  test('yells if the starting point does not exist', async () => {
    const ds = new DirectoryScanner(await folderify({ 'a/b/c': '' }))

    await expect(ds.scanTree('a/b/d', () => {})).rejects.toThrow(`Starting point does not exist`)
    await expect(ds.scanTree('a/b/d', { startingPointMustExist: true }, () => {})).rejects.toThrow(
      `Starting point does not exist`,
    )
  })
  test('succeeds when the starting point does not exist if the corresponding option flag is set to false', async () => {
    const ds = new DirectoryScanner(await folderify({ 'a/b/c': '' }))

    const acc: string[] = []
    await ds.scanTree('a/b/d', { startingPointMustExist: false }, p => {
      acc.push(p)
    })
    expect(acc).toEqual([])
  })
  test(`passes a symlink's target to the callback function`, async () => {
    const dir = await folderify({ 'x/y/z': 'zoo', 'x/y/f': 'foo', 'x/y/p/q/r/s1': '' })
    fs.symlinkSync('../../../z', path.join(dir, 'x/y/p/q/r/s2'))
    const ds = new DirectoryScanner(dir)

    const acc: Record<string, string> = {}
    await ds.scanTree('.', (p, c) => {
      acc[p] = c.toString('utf-8')
    })
    expect(acc).toMatchObject({
      'x/y/p/q/r/s2': '../../../z',
    })
  })
  describe('ignore', () => {
    test('does not output files that match the given ignore pattern', async () => {
      const d = await folderify({
        'a/f1.txt': 'foo',
        'a/b/c/x.txt': 'boo',
        'a/b/d/x.txt': 'moo',
        'a/f2.txt': 'zoo',
      })

      const ds = new DirectoryScanner(d)

      expect(await run(ds, '', ['a/f1.txt'])).toEqual([
        { loc: 'a/b/c/x.txt', content: 'boo' },
        { loc: 'a/b/d/x.txt', content: 'moo' },
        { loc: 'a/f2.txt', content: 'zoo' },
      ])
      expect(await run(ds, '', ['a/b/c/x.txt'])).toEqual([
        { loc: 'a/b/d/x.txt', content: 'moo' },
        { loc: 'a/f1.txt', content: 'foo' },
        { loc: 'a/f2.txt', content: 'zoo' },
      ])
      expect(await run(ds, '', ['a/b/d/x.txt'])).toEqual([
        { loc: 'a/b/c/x.txt', content: 'boo' },
        { loc: 'a/f1.txt', content: 'foo' },
        { loc: 'a/f2.txt', content: 'zoo' },
      ])
      expect(await run(ds, '', ['a/f2.txt'])).toEqual([
        { loc: 'a/b/c/x.txt', content: 'boo' },
        { loc: 'a/b/d/x.txt', content: 'moo' },
        { loc: 'a/f1.txt', content: 'foo' },
      ])
    })
    test('supports multiple ignore patterns', async () => {
      const d = await folderify({
        'f1.txt': 'P',
        'f2.txt': 'Q',
        'f3.txt': 'R',
        'f4.txt': 'S',
        'f5.txt': 'T',
      })

      const ds = new DirectoryScanner(d)

      expect(await run(ds, '', ['f1.txt', 'f3.txt'])).toEqual([
        { loc: 'f2.txt', content: 'Q' },
        { loc: 'f4.txt', content: 'S' },
        { loc: 'f5.txt', content: 'T' },
      ])
      expect(await run(ds, '', ['f2.txt', 'f4.txt', 'f3.txt'])).toEqual([
        { loc: 'f1.txt', content: 'P' },
        { loc: 'f5.txt', content: 'T' },
      ])
      expect(await run(ds, '', ['f2.txt', 'f4.txt', 'f3.txt', 'f1.txt', 'f5.txt'])).toEqual([])
    })
    test('can ignore an entire directory', async () => {
      const d = await folderify({
        'a/f1.txt': 'foo',
        'a/b/c/x.txt': 'boo',
        'a/b/d/x.txt': 'moo',
        'a/f2.txt': 'zoo',
      })

      const ds = new DirectoryScanner(d)

      expect(await run(ds, '', ['a/b/c'])).toEqual([
        { loc: 'a/b/d/x.txt', content: 'moo' },
        { loc: 'a/f1.txt', content: 'foo' },
        { loc: 'a/f2.txt', content: 'zoo' },
      ])
      expect(await run(ds, '', ['a/b/d'])).toEqual([
        { loc: 'a/b/c/x.txt', content: 'boo' },
        { loc: 'a/f1.txt', content: 'foo' },
        { loc: 'a/f2.txt', content: 'zoo' },
      ])
      expect(await run(ds, '', ['a/b'])).toEqual([
        { loc: 'a/f1.txt', content: 'foo' },
        { loc: 'a/f2.txt', content: 'zoo' },
      ])
      expect(await run(ds, '', ['a'])).toEqual([])
    })
    test('the predicate can also be passed to the constructor', async () => {
      const d = await folderify({
        'a/f1.txt': 'foo',
        'a/b/c/x.txt': 'boo',
        'a/b/d/x.txt': 'moo',
        'a/f2.txt': 'zoo',
      })

      const ds = new DirectoryScanner(d, { predicate: p => p !== 'a/b' })

      expect(await run(ds, '')).toEqual([
        { loc: 'a/f1.txt', content: 'foo' },
        { loc: 'a/f2.txt', content: 'zoo' },
      ])
    })
    test('a file is picked only if it passed both predicates', async () => {
      const d = await folderify({
        'a/f1.txt': 'foo',
        'a/b/c/x1.txt': 'boo',
        'a/b/d/x2.txt': 'moo',
        'a/f2.txt': 'zoo',
      })

      const ds = new DirectoryScanner(d, { predicate: p => p !== 'a/b' })

      const acc: string[] = []
      await ds.scanTree('', { predicate: p => !p.endsWith('.txt') || p.endsWith('2.txt') }, p => acc.push(p))
      expect(acc).toEqual(['a/f2.txt'])
    })
    test('the starting directory (.) is not subjected to the predicate', async () => {
      const d = await folderify({
        ax: '',
        ay: '',
        bx: '',
        by: '',
      })

      const ds1 = new DirectoryScanner(d, { predicate: p => p.startsWith('a') })

      const acc1: string[] = []
      await ds1.scanTree('', p => acc1.push(p))
      expect(acc1).toEqual(['ax', 'ay'])

      const ds2 = new DirectoryScanner(d, { predicate: p => p !== '.' })

      const acc2: string[] = []
      await ds2.scanTree('', p => acc2.push(p))
      expect(acc2).toEqual(['ax', 'ay', 'bx', 'by'])
    })
  })
  describe('listPaths', () => {
    test('returns a list of paths to all files', async () => {
      const d = await folderify({
        'd1/q.txt': 'lorem',
        'd1/r.txt': 'ipsum',
        'd1/c/d/e/f/r.txt': 'dolor',
        'd2/u.txt': 'elit',
        'd1/c/r.txt': 'sit',
        'd1/c/s.txt': 'amet',
        'd1/c/d/e/t.txt': 'consectetur',
        'd1/c/d/e/f/t.txt': 'adipiscing',
      })

      const ds = new DirectoryScanner(d)
      const acc = await ds.listPaths('')
      expect(acc).toEqual([
        'd1/c/d/e/f/r.txt',
        'd1/c/d/e/f/t.txt',
        'd1/c/d/e/t.txt',
        'd1/c/r.txt',
        'd1/c/s.txt',
        'd1/q.txt',
        'd1/r.txt',
        'd2/u.txt',
      ])
    })
    test('returns only paths that are under the give startpoit', async () => {
      const d = await folderify({
        'd1/q.txt': 'lorem',
        'd1/r.txt': 'ipsum',
        'd1/c/d/e/f/r.txt': 'dolor',
        'd2/u.txt': 'elit',
        'd1/c/g/h/r.txt': 'sit',
        'd1/c/g/h/s.txt': 'amet',
        'd1/c/d/e/t.txt': 'consectetur',
        'd1/c/d/e/f/t.txt': 'adipiscing',
      })

      const ds = new DirectoryScanner(d)
      expect(await ds.listPaths('d1/c/d')).toEqual(['d1/c/d/e/f/r.txt', 'd1/c/d/e/f/t.txt', 'd1/c/d/e/t.txt'])
      expect(await ds.listPaths('d1/c/g')).toEqual(['d1/c/g/h/r.txt', 'd1/c/g/h/s.txt'])
      expect(await ds.listPaths('d2')).toEqual(['d2/u.txt'])
    })
    test('the returned paths are relative to the root path passed to the construcotr', async () => {
      const d = await folderify({
        'd1/q.txt': 'lorem',
        'd1/r.txt': 'ipsum',
        'd1/c/d/e/f/r.txt': 'dolor',
        'd2/u.txt': 'elit',
        'd1/c/g/h/r.txt': 'sit',
        'd1/c/g/h/s.txt': 'amet',
        'd1/c/d/e/t.txt': 'consectetur',
        'd1/c/d/e/f/t.txt': 'adipiscing',
      })

      const a = new DirectoryScanner(path.join(d, 'd1/c'))
      expect(await a.listPaths('')).toEqual(['d/e/f/r.txt', 'd/e/f/t.txt', 'd/e/t.txt', 'g/h/r.txt', 'g/h/s.txt'])
      const b = new DirectoryScanner(path.join(d, 'd1/c/d'))
      expect(await b.listPaths('')).toEqual(['e/f/r.txt', 'e/f/t.txt', 'e/t.txt'])
    })
  })
  describe('listPaths() static method', () => {
    test('returns a list of paths to all files', async () => {
      const d = await folderify({
        'd1/q.txt': 'lorem',
        'd1/r.txt': 'ipsum',
        'd1/c/d/e/f/r.txt': 'dolor',
        'd2/u.txt': 'elit',
        'd1/c/r.txt': 'sit',
        'd1/c/s.txt': 'amet',
        'd1/c/d/e/t.txt': 'consectetur',
        'd1/c/d/e/f/t.txt': 'adipiscing',
      })

      const files = await DirectoryScanner.listPaths(d)
      expect(files).toEqual([
        'd1/c/d/e/f/r.txt',
        'd1/c/d/e/f/t.txt',
        'd1/c/d/e/t.txt',
        'd1/c/r.txt',
        'd1/c/s.txt',
        'd1/q.txt',
        'd1/r.txt',
        'd2/u.txt',
      ])
    })
    test('returns an empty list if the starting directory does not exist (option-controlled)', async () => {
      const d = await folderify({ 'd1/q.txt': 'lorem', 'd1/r.txt': 'ipsum' })

      const here = path.join(d, 'here')
      expect(await DirectoryScanner.listPaths(here, { startingPointMustExist: false })).toEqual([])
    })
    test('by default throws if the starting directory does not exist', async () => {
      const d = await folderify({ 'd1/q.txt': 'lorem', 'd1/r.txt': 'ipsum' })

      const here = path.join(d, 'here')
      await expect(DirectoryScanner.listPaths(here, { startingPointMustExist: true })).rejects.toThrowError(
        /Starting point does not exist.*\/here/,
      )
      await expect(DirectoryScanner.listPaths(here, {})).rejects.toThrowError(/Starting point does not exist.*\/here/)
      await expect(DirectoryScanner.listPaths(here)).rejects.toThrowError(/Starting point does not exist.*\/here/)
    })
  })
})
