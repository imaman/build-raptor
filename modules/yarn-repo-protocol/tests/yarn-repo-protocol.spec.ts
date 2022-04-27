import { createDefaultLogger } from 'logger'
import { folderify } from 'misc'
import { UnitId } from 'unit-metadata'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

describe('yarn-repo-protocol', () => {
  const logger = createDefaultLogger('/tmp/abc')
  describe('computePackingPackageJson', () => {
    test('includes out-of-repo deps of all in-repo deps (sorted)', async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0', foo: '400.1.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { goo: '100.1.0', boo: '200.1.0' } },
      })

      const yrp = new YarnRepoProtocol(logger)
      await yrp.initialize(d)

      expect(await yrp.computePackingPackageJson(UnitId('a'))).toMatchObject({
        name: 'a',
        version: '1.0.0',
        dependencies: {
          boo: '200.1.0',
          foo: '400.1.0',
          goo: '100.1.0',
        },
      })
    })
    test('does not include out-of-repo deps of an in-repo module that is not a dependency', async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { x: '100.1.0' } },
        'modules/c/package.json': { name: 'c', version: '1.0.0', dependencies: { y: '200.1.0' } },
      })

      const yrp = new YarnRepoProtocol(logger)
      await yrp.initialize(d)

      expect(await yrp.computePackingPackageJson(UnitId('a'))).toEqual({
        name: 'a',
        version: '1.0.0',
        dependencies: { x: '100.1.0' },
      })
      expect(await yrp.computePackingPackageJson(UnitId('b'))).toEqual({
        name: 'b',
        version: '1.0.0',
        dependencies: { x: '100.1.0' },
      })
      expect(await yrp.computePackingPackageJson(UnitId('c'))).toEqual({
        name: 'c',
        version: '1.0.0',
        dependencies: { y: '200.1.0' },
      })
    })
  })
  test('does not include out-of-repo dev-dependencies of an in-repo dep', async () => {
    const d = await folderify({
      'package.json': { workspaces: ['modules/*'], private: true },
      'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0', c: '1.0.0' } },
      'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { x: '100.1.0' } },
      'modules/c/package.json': { name: 'c', version: '1.0.0', devDependencies: { y: '200.1.0' } },
    })

    const yrp = new YarnRepoProtocol(logger)
    await yrp.initialize(d)

    expect(await yrp.computePackingPackageJson(UnitId('a'))).toEqual({
      name: 'a',
      version: '1.0.0',
      dependencies: { x: '100.1.0' },
    })
  })
  test('does not include dependencies (dev or not) of an in-repo dev-dependency', async () => {
    const d = await folderify({
      'package.json': { workspaces: ['modules/*'], private: true },
      'modules/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { b: '1.0.0' } },
      'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { c: '1.0.0', x: '100.1.0' } },
      'modules/c/package.json': { name: 'c', version: '1.0.0', devDependencies: { y: '200.1.0' } },
    })

    const yrp = new YarnRepoProtocol(logger)
    await yrp.initialize(d)

    expect(await yrp.computePackingPackageJson(UnitId('a'))).toEqual({
      name: 'a',
      version: '1.0.0',
      dependencies: {},
    })
  })
})
