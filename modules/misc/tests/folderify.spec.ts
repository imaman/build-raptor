import { DirectoryScanner } from '../src/directory-scanner.js'
import { folderify } from '../src/folderify.js'

describe('folderify', () => {
  test('creates files as specifies in its input', async () => {
    const dir = await folderify({ a: 'X', b: 'Y' })

    const d = new DirectoryScanner(dir)

    const acc: [string, string][] = []
    await d.scanTree('.', (relativePath, buf) => {
      acc.push([relativePath, buf.toString()])
    })
    expect(acc).toEqual([
      ['a', 'X'],
      ['b', 'Y'],
    ])
  })
  test('can create files in sub-directories', async () => {
    const dir = await folderify({ 'a/f1': 'X', 'a/f3': 'Z', 'b/f2': 'Y' })

    const d = new DirectoryScanner(dir)

    const acc: [string, string][] = []
    await d.scanTree('.', (relativePath, buf) => {
      acc.push([relativePath, buf.toString()])
    })
    expect(acc).toEqual([
      ['a/f1', 'X'],
      ['a/f3', 'Z'],
      ['b/f2', 'Y'],
    ])
  })
  test('can create deep directory structures', async () => {
    const dir = await folderify({
      'a/b/c/d/e/f/g/a/x/b/w': 'foo',
      'a/b/c/d/e/f/g/a/x/c/w': 'bar',
      'a/b/c/d/e/f/g/a/x/d/w': 'goo',
    })

    const d = new DirectoryScanner(dir)

    const acc: [string, string][] = []
    await d.scanTree('.', (relativePath, buf) => {
      acc.push([relativePath, buf.toString()])
    })
    expect(acc).toEqual([
      ['a/b/c/d/e/f/g/a/x/b/w', 'foo'],
      ['a/b/c/d/e/f/g/a/x/c/w', 'bar'],
      ['a/b/c/d/e/f/g/a/x/d/w', 'goo'],
    ])
  })
  test('creates files in JSON format when the content in the input is an object', async () => {
    const dir = await folderify({
      'file.1': 'some-text',
      'file.2': {
        a: 1,
        b: 2,
        c: { apollo9: 'spider', apollo10: 'snoopy', apollo11: 'eagle', apollo12: 'interpid' },
        d: ['gumdrop', 'charlie brown', 'columbia', 'yankee clipper'],
      },
    })

    const d = new DirectoryScanner(dir)

    const acc: [string, string][] = []
    await d.scanTree('.', (relativePath, buf) => {
      acc.push([relativePath, buf.toString()])
    })
    expect(acc).toEqual([
      ['file.1', 'some-text'],
      [
        'file.2',
        `{"a":1,"b":2,"c":{"apollo9":"spider","apollo10":"snoopy","apollo11":"eagle","apollo12":"interpid"},` +
          `"d":["gumdrop","charlie brown","columbia","yankee clipper"]}\n`,
      ],
    ])
  })
  test('when a "prefix" value is passed, it is appended to all created files', async () => {
    const dir = await folderify('p/q', {
      'a/b/c': 'foo',
      'a/b/d': 'bar',
      'a/e/f/g': { x: 1, y: 2 },
    })

    const d = new DirectoryScanner(dir)

    const acc: [string, string][] = []
    await d.scanTree('.', (relativePath, buf) => {
      acc.push([relativePath, buf.toString().trim()])
    })
    expect(acc).toEqual([
      ['p/q/a/b/c', 'foo'],
      ['p/q/a/b/d', 'bar'],
      ['p/q/a/e/f/g', '{"x":1,"y":2}'],
    ])
  })
  test('yells if the input contains a file nested under another file', async () => {
    await expect(folderify({ a: '', 'a/b': '' })).rejects.toThrow(
      'bad input - a file (a/b) is nested under another file (a)',
    )
  })
  test('yells if the input contains an empty file name', async () => {
    await expect(folderify({ '': 'foo' })).rejects.toThrow(
      `bad input - the recipe contains a file name which is either empty ('') or a dot ('.')`,
    )
  })
  test('yells if the input contains a dot file name', async () => {
    await expect(folderify({ '.': 'foo' })).rejects.toThrow(
      `bad input - the recipe contains a file name which is either empty ('') or a dot ('.')`,
    )
  })
  test.todo(`test without using DirectoryScanner (because folderify is used in DirectoryScanner's tests`)
})
