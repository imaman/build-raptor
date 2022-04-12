// We probably do not need this anymore since we started computing fingerprints of inputs, and these tests

import * as fse from 'fs-extra'
import { createNopLogger } from 'logger'
import { DirectoryScanner, folderify, FolderifyRecipe } from 'misc'
import * as path from 'path'

import { Fingerprinter } from '../src/fingerprinter'

describe('fingerprinter', () => {
  async function create(recipe: FolderifyRecipe, predicate: (path: string) => boolean) {
    const dir = await folderify(recipe)
    const dirScanner = new DirectoryScanner(dir, { predicate })
    const fingerprinter = new Fingerprinter(dirScanner, createNopLogger())
    return { fingerprinter, dir }
  }
  test('an ignored-and-empty sub directory does not affect the fingerprint', async () => {
    const { fingerprinter: fingerprinterA } = await create({ 'x/y': 'foo' }, p => p !== 'x/z')
    const { fingerprinter: fingerprinterB, dir } = await create({ 'x/y': 'foo' }, p => p !== 'x/z')

    await fse.ensureDir(path.join(dir, 'x/z'))
    await fse.writeFile(path.join(dir, 'x/z/z1'), 'foo')
    expect(await fingerprinterA.computeFingerprint('x')).toEqual(await fingerprinterB.computeFingerprint('x'))
  })
  test.todo('fingerprint of a directroy with an ignored file should not change when this file changes')
  test('same result when an ignored directory is fingerprinted directrly or via its parent', async () => {
    const { fingerprinter: fingerprinterA } = await create({ 'x/y': 'foo', 'x/z/z1': 'bar' }, p => p !== 'x/z')
    const { fingerprinter: fingerprinterB } = await create({ 'x/y': 'foo', 'x/z/z1': 'bar' }, p => p !== 'x/z')

    await fingerprinterA.computeFingerprint('x')
    expect(await fingerprinterA.computeFingerprint('x/z')).toEqual(await fingerprinterB.computeFingerprint('x/z'))
  })
  test('same result when an ignored file is fingerprinted directrly or via its parent', async () => {
    const { fingerprinter: fingerprinterA } = await create({ 'x/y': 'foo', 'x/z': 'bar' }, p => p !== 'x/z')
    const { fingerprinter: fingerprinterB } = await create({ 'x/y': 'foo', 'x/z': 'bar' }, p => p !== 'x/z')

    await fingerprinterA.computeFingerprint('x')
    expect(await fingerprinterA.computeFingerprint('x/z')).toEqual(await fingerprinterB.computeFingerprint('x/z'))
  })
  test.todo('computes a fingerprint')
  test.todo('a change in the source code of a package changes its fingerprint')
  test.todo('takes into account only the files under the given prefixes')
  test.todo('identical packages in different repos have the same fingerprint')
  test.todo('a change in a unit changes the fingeprints of all of its (direct) dependents')
  test.todo('a change in a unit changes the fingeprints of all of its (transitive) dependents')
  test.todo('changes in package.json file change the fingerprint of the unit')
})
