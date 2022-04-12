import { folderify } from '../src/folderify'
import { slurpDir } from '../src/slurp-dir'

describe('folderify', () => {
  test('returns the names of the files under the given directory and their content', async () => {
    const dir = await folderify({ a: 'X', b: 'Y' })
    const recipe = await slurpDir(dir)

    expect(recipe).toEqual({ a: 'X', b: 'Y' })
  })
  test('handles sub-directories', async () => {
    const dir = await folderify({ 'a/f1': 'X', 'a/f3': 'Z', 'b/f2': 'Y' })
    const recipe = await slurpDir(dir)

    expect(recipe).toEqual({ 'a/f1': 'X', 'a/f3': 'Z', 'b/f2': 'Y' })
  })
  test('handles deep directory structures', async () => {
    const dir = await folderify({
      'a/b/c/d/e/f/g/a/x/b/w': 'foo',
      'a/b/c/d/e/f/g/a/x/c/w': 'bar',
      'a/b/c/d/e/f/g/a/x/d/w': 'goo',
    })
    const recipe = await slurpDir(dir)

    expect(recipe).toEqual({
      'a/b/c/d/e/f/g/a/x/b/w': 'foo',
      'a/b/c/d/e/f/g/a/x/c/w': 'bar',
      'a/b/c/d/e/f/g/a/x/d/w': 'goo',
    })
  })
  test.skip('when the content is valid JSON, parses it and returns it as an object', async () => {
    const dir = await folderify({
      'file.1': 'some-text',
      'file.2': {
        a: 1,
        b: 2,
        c: { apollo9: 'spider', apollo10: 'snoopy', apollo11: 'eagle', apollo12: 'interpid' },
        d: ['gumdrop', 'charlie brown', 'columbia', 'yankee clipper'],
      },
    })

    const recipe = await slurpDir(dir)

    expect(recipe).toEqual({
      'file.1': 'some-text',
      'file.2': {
        a: 1,
        b: 2,
        c: { apollo9: 'spider', apollo10: 'snoopy', apollo11: 'eagle', apollo12: 'interpid' },
        d: ['gumdrop', 'charlie brown', 'columbia', 'yankee clipper'],
      },
    })
  })
})
