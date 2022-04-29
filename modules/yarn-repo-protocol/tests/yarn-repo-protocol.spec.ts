import { createDefaultLogger } from 'logger'
import { folderify, slurpDir } from 'misc'
import { UnitId } from 'unit-metadata'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

describe('yarn-repo-protocol', () => {
  const logger = createDefaultLogger('/tmp/abc')
  describe('initialize()', () => {
    test('rejects repos with inconsistent versions of out-of-repo deps', async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { foo: '3.20.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { foo: '3.20.1' } },
      })

      const yrp = new YarnRepoProtocol(logger)
      await expect(yrp.initialize(d)).rejects.toThrow('Inconsistent version for depenedency "foo": 3.20.0, 3.20.1')
    })
    test('detects versions inconsistencies that happen between a dependency and a dev-depenedency', async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { boo: '4.20.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { boo: '4.20.1' } },
      })

      const yrp = new YarnRepoProtocol(logger)
      await expect(yrp.initialize(d)).rejects.toThrow('Inconsistent version for depenedency "boo": 4.20.0, 4.20.1')
    })
    test('does not yell if the versions are consistent', async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1', dependencies: { w: '1' }, devDependencies: { w: '1' } },
        'modules/b/package.json': { name: 'b', version: '1', dependencies: { x: '2' }, devDependencies: {} },
        'modules/c/package.json': { name: 'c', version: '1', dependencies: { x: '2' }, devDependencies: { x: '2' } },
        'modules/d/package.json': { name: 'd', version: '1', dependencies: { y: '3' } },
        'modules/e/package.json': { name: 'e', version: '1', dependencies: { y: '3' } },
      })

      const yrp = new YarnRepoProtocol(logger)
      expect(await yrp.initialize(d)).toBeUndefined()
    })
  })
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
        main: 'main.js',
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
        main: 'main.js',
        dependencies: { x: '100.1.0' },
      })
      expect(await yrp.computePackingPackageJson(UnitId('b'))).toEqual({
        name: 'b',
        version: '1.0.0',
        main: 'main.js',
        dependencies: { x: '100.1.0' },
      })
      expect(await yrp.computePackingPackageJson(UnitId('c'))).toEqual({
        name: 'c',
        version: '1.0.0',
        main: 'main.js',
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
      main: 'main.js',
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
      main: 'main.js',
      dependencies: {},
    })
  })
  test.todo('yells if in-repo desp are not 1.0.0')
  describe('generation of tsconfig.json files', () => {
    test(`references field reflects the package's dependencies`, async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0', c: '1.0.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { c: '1.0.0' } },
        'modules/c/package.json': { name: 'c', version: '1.0.0' },
      })

      const yrp = new YarnRepoProtocol(logger)
      await yrp.initialize(d)

      const actual = await slurpDir(d)
      expect(JSON.parse(actual['modules/a/tsconfig.json'])).toEqual({
        extends: '../../tsconfig-base.json',
        compilerOptions: { composite: true, outDir: 'dist' },
        include: ['src/**/*', 'tests/**/*'],
        references: [{ path: '../b' }, { path: '../c' }],
      })
      expect(JSON.parse(actual['modules/b/tsconfig.json'])).toEqual({
        extends: '../../tsconfig-base.json',
        compilerOptions: { composite: true, outDir: 'dist' },
        include: ['src/**/*', 'tests/**/*'],
        references: [{ path: '../c' }],
      })
    })
    test(`references field reflects also the package's dev-dependencies`, async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { b: '1.0.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0' },
      })

      const yrp = new YarnRepoProtocol(logger)
      await yrp.initialize(d)

      const actual = await slurpDir(d)
      expect(JSON.parse(actual['modules/a/tsconfig.json'])).toEqual({
        extends: '../../tsconfig-base.json',
        compilerOptions: { composite: true, outDir: 'dist' },
        include: ['src/**/*', 'tests/**/*'],
        references: [{ path: '../b' }],
      })
    })
    test(`references field reflects only in-repo dependencies`, async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0', x: '3' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { c: '1.0.0', y: '2' } },
        'modules/c/package.json': { name: 'c', version: '1.0.0' },
      })

      const yrp = new YarnRepoProtocol(logger)
      await yrp.initialize(d)

      const actual = await slurpDir(d)
      expect(JSON.parse(actual['modules/a/tsconfig.json'])).toEqual({
        extends: '../../tsconfig-base.json',
        compilerOptions: { composite: true, outDir: 'dist' },
        include: ['src/**/*', 'tests/**/*'],
        references: [{ path: '../b' }],
      })
      expect(JSON.parse(actual['modules/b/tsconfig.json'])).toEqual({
        extends: '../../tsconfig-base.json',
        compilerOptions: { composite: true, outDir: 'dist' },
        include: ['src/**/*', 'tests/**/*'],
        references: [{ path: '../c' }],
      })
    })
    test(`references field is omitted if there are no in-repo dependencies nor in-repo dev-dependencies`, async () => {
      const d = await folderify({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { c: '1.0.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', devDependencies: { c: '1.0.0' } },
        'modules/c/package.json': { name: 'c', version: '1.0.0', dependencies: { x: '1.0.0' } },
        'modules/d/package.json': { name: 'd', version: '1.0.0', devDependencies: { x: '1.0.0' } },
      })

      const yrp = new YarnRepoProtocol(logger)
      await yrp.initialize(d)

      const actual = await slurpDir(d)
      expect(JSON.parse(actual['modules/a/tsconfig.json']).references).toEqual([{ path: '../c' }])
      expect(JSON.parse(actual['modules/b/tsconfig.json']).references).toEqual([{ path: '../c' }])
      expect(JSON.parse(actual['modules/c/tsconfig.json']).references).toBeUndefined()
      expect(JSON.parse(actual['modules/d/tsconfig.json']).references).toBeUndefined()
    })
  })
})
