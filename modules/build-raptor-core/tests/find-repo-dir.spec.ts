import { folderify } from 'misc'
import path from 'path'

import { findRepoDir } from '../src'
describe('find-repo-dir', () => {
  const run = (d: string, subPath: string) => {
    const repoDir = findRepoDir(path.join(d, subPath))
    return repoDir ? path.relative(d, repoDir) : undefined
  }
  test('returns the first directory up the directory up that has a package.json file with a "workspaces" attribute', async () => {
    const d = await folderify({
      'package.json': { workspaces: [] },
      'a/b': '// dont-care',
      'a/x/y/z': '// dont-care',
      'a/w/y/z': '// dont-care',
    })

    expect(run(d, '')).toEqual('')
    expect(run(d, 'a')).toEqual('')
    expect(run(d, 'a/x')).toEqual('')
    expect(run(d, 'a/x/y')).toEqual('')
    expect(run(d, 'a/w')).toEqual('')
    expect(run(d, 'a/w/y')).toEqual('')
  })
  test('if there is more than one, returns the first (inner most one)', async () => {
    const d = await folderify({
      'package.json': { workspaces: [] },
      'a/b/c/package.json': { workspaces: [] },
      'a/b/c/d/e/package.json': { workspaces: [] },
    })

    expect(run(d, 'a')).toEqual('')
    expect(run(d, 'a/b')).toEqual('')
    expect(run(d, 'a/b/c')).toEqual('a/b/c')
    expect(run(d, 'a/b/c/d')).toEqual('a/b/c')
    expect(run(d, 'a/b/c/d/e')).toEqual('a/b/c/d/e')
    expect(run(d, 'a/b/c/d/e/f')).toEqual('a/b/c/d/e')
  })
  test('if none is found, returns undefined', async () => {
    const d = await folderify({
      'a/b/c/package.json': { workspaces: [] },
    })

    expect(run(d, 'a')).toBe(undefined)
    expect(run(d, 'a/b')).toBe(undefined)
    expect(run(d, 'a/b/c')).toEqual('a/b/c')
  })
})
