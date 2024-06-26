import { NopAssetPublisher } from 'build-raptor-core'
import { PathInRepo, RepoRoot } from 'core-types'
import * as fse from 'fs-extra'
import { createNopLogger } from 'logger'
import { DirectoryScanner, folderify, FolderifyRecipe, slurpDir, TypedPublisher } from 'misc'
import { RepoProtocolEvent } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitId } from 'unit-metadata'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

async function makeFolder(recipe: FolderifyRecipe) {
  return RepoRoot(await folderify(recipe))
}

async function slurp(d: RepoRoot) {
  return await slurpDir(d.resolve())
}

jest.setTimeout(60000)
describe('yarn-repo-protocol', () => {
  const logger = createNopLogger()
  const p = new TypedPublisher<RepoProtocolEvent>()
  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }

  const out = '.out'

  describe('initialize()', () => {
    test('rejects repos with inconsistent versions of out-of-repo deps', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { foo: '3.20.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { foo: '3.20.1' } },
      })

      const yrp = newYarnRepoProtocol()
      await expect(yrp.initialize(d, p, out)).rejects.toThrow(
        'Inconsistent version for depenedency "foo": 3.20.0, 3.20.1',
      )
    })
    test('detects versions inconsistencies that happen between a dependency and a dev-depenedency', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { boo: '4.20.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { boo: '4.20.1' } },
      })

      const yrp = newYarnRepoProtocol()
      await expect(yrp.initialize(d, p, out)).rejects.toThrow(
        'Inconsistent version for depenedency "boo": 4.20.0, 4.20.1',
      )
    })
    test('does not yell if the versions are consistent', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1', dependencies: { w: '1' }, devDependencies: { w: '1' } },
        'modules/b/package.json': { name: 'b', version: '1', dependencies: { x: '2' }, devDependencies: {} },
        'modules/c/package.json': { name: 'c', version: '1', dependencies: { x: '2' }, devDependencies: { x: '2' } },
        'modules/d/package.json': { name: 'd', version: '1', dependencies: { y: '3' } },
        'modules/e/package.json': { name: 'e', version: '1', dependencies: { y: '3' } },
      })

      const yrp = newYarnRepoProtocol()
      expect(await yrp.initialize(d, p, out)).toBeUndefined()
    })
    test('rejects repos with a version mismatch on an in-repo dep', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { b: '1.0.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.1' },
      })

      const yrp = newYarnRepoProtocol()
      await expect(yrp.initialize(d, p, out)).rejects.toThrow(
        'Version mismatch for dependency "b" of "a": 1.0.1 vs. 1.0.0',
      )
    })
  })
  describe('computePackingPackageJson', () => {
    const getPackingDeps = async (yrp: YarnRepoProtocol, uid: UnitId) => {
      const obj = await yrp.computePackingPackageJson(uid)
      return {
        dependencies: obj.dependencies ?? {},
        devDependencies: obj.devDependencies ?? {},
      }
    }

    test('essentials - forbids hoisting, sets a postinstall script', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: {} },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await yrp.computePackingPackageJson(UnitId('a'))
      expect(actual).toEqual({
        name: 'a',
        version: '1.0.0',
        files: ['dist'],
        main: 'dist/src/index.js',
        dependencies: {},
        nohoist: true,
      })
    })
    test('includes out-of-repo deps of all in-repo deps (sorted)', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0', foo: '400.1.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { goo: '100.1.0', boo: '200.1.0' } },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      expect(await getPackingDeps(yrp, UnitId('a'))).toMatchObject({
        dependencies: {
          boo: '200.1.0',
          foo: '400.1.0',
          goo: '100.1.0',
        },
        devDependencies: {},
      })
    })
    test('does not include out-of-repo deps of an in-repo module that is not a dependency', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { x: '100.1.0' } },
        'modules/c/package.json': { name: 'c', version: '1.0.0', dependencies: { y: '200.1.0' } },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      expect(await getPackingDeps(yrp, UnitId('a'))).toEqual({
        dependencies: { x: '100.1.0' },
        devDependencies: {},
      })
      expect(await getPackingDeps(yrp, UnitId('b'))).toEqual({
        dependencies: { x: '100.1.0' },
        devDependencies: {},
      })
      expect(await getPackingDeps(yrp, UnitId('c'))).toEqual({
        dependencies: { y: '200.1.0' },
        devDependencies: {},
      })
    })
    test('does not include out-of-repo dev-dependencies of an in-repo dep', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0', c: '1.0.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { x: '100.1.0' } },
        'modules/c/package.json': { name: 'c', version: '1.0.0', devDependencies: { y: '200.1.0' } },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await yrp.computePackingPackageJson(UnitId('a'))
      expect(actual.dependencies).toEqual({ x: '100.1.0' })
      expect(actual.devDependencies).toBe(undefined)
    })
    test('does not include dependencies (dev or not) of an in-repo dev-dependency', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { b: '1.0.0' } },
        'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { c: '1.0.0', x: '100.1.0' } },
        'modules/c/package.json': { name: 'c', version: '1.0.0', devDependencies: { y: '200.1.0' } },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await yrp.computePackingPackageJson(UnitId('a'))
      expect(actual.dependencies).toEqual({})
      expect(actual.devDependencies).toBe(undefined)
    })
    test('retains run scripts', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { foo: 'I AM FOO', boo: 'I AM BOO' } },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await yrp.computePackingPackageJson(UnitId('a'))
      expect(actual.scripts).toEqual({
        foo: 'I AM FOO',
        boo: 'I AM BOO',
      })
    })
  })
  describe('generation of tsconfig.json files', () => {
    test(`basics`, async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'tsconfig-base.json': {},
        'modules/a/package.json': { name: 'a', version: '1.0.0' },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await slurp(d)
      expect(JSON.parse(actual['modules/a/tsconfig.json'])).toEqual({
        extends: '../../tsconfig-base.json',
        compilerOptions: { composite: true, outDir: 'dist' },
        include: ['src/**/*', 'src/**/*.json', 'tests/**/*', 'tests/**/*.json'],
      })
    })
    test(`extends a local tsconfig-base.json file if one is present`, async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['libs/*', 'apps/mobile/*', 'apps/web/**'], private: true },
        'tsconfig-base.json': {},
        'libs/a/package.json': { name: 'a', version: '1.0.0' },
        'libs/a/tsconfig-base.json': {},
        'libs/b/package.json': { name: 'b', version: '1.0.0' },
        'libs/b/NOT-A-tsconfig-base.json': {},
        'libs/c/package.json': { name: 'c', version: '1.0.0' },
        'libs/c/tsconfig-base.json': {},
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await slurp(d)
      expect(JSON.parse(actual['libs/a/tsconfig.json']).extends).toEqual('./tsconfig-base.json')
      expect(JSON.parse(actual['libs/b/tsconfig.json']).extends).toEqual('../../tsconfig-base.json')
      expect(JSON.parse(actual['libs/c/tsconfig.json']).extends).toEqual('./tsconfig-base.json')
    })
    test(`adds all entries from the include array of the local tsconfig-base file`, async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'tsconfig-base.json': {},
        'modules/a/package.json': { name: 'a', version: '1.0.0' },
        'modules/a/tsconfig-base.json': {
          include: ['abc.ts', 'xyz.ts'],
        },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await slurp(d)
      const parsed = JSON.parse(actual['modules/a/tsconfig.json'])
      expect(parsed.include).toEqual(['src/**/*', 'src/**/*.json', 'tests/**/*', 'tests/**/*.json', 'abc.ts', 'xyz.ts'])
    })
    test(`adds also all entries from the include array of the root tsconfig-base file`, async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'tsconfig-base.json': {
          include: ['pqr.ts', 'stu.ts'],
        },
        'modules/a/package.json': { name: 'a', version: '1.0.0' },
        'modules/a/tsconfig-base.json': {
          include: ['abc.ts'],
        },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await slurp(d)
      const parsed = JSON.parse(actual['modules/a/tsconfig.json'])
      expect(parsed.include).toEqual([
        'src/**/*',
        'src/**/*.json',
        'tests/**/*',
        'tests/**/*.json',
        'abc.ts',
        'pqr.ts',
        'stu.ts',
      ])
    })
    test(`extends a tsconfig-base file at the repo's root`, async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['libs/*', 'apps/mobile/*', 'apps/web/**'], private: true },
        'tsconfig-base.json': {},
        'libs/a/package.json': { name: 'a', version: '1.0.0' },
        'apps/mobile/b/package.json': { name: 'b', version: '1.0.0' },
        'apps/web/static/c/package.json': { name: 'c', version: '1.0.0' },
        'apps/web/fullstack/d/package.json': { name: 'd', version: '1.0.0' },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await slurp(d)
      expect(JSON.parse(actual['libs/a/tsconfig.json']).extends).toEqual('../../tsconfig-base.json')
      expect(JSON.parse(actual['apps/mobile/b/tsconfig.json']).extends).toEqual('../../../tsconfig-base.json')
      expect(JSON.parse(actual['apps/web/static/c/tsconfig.json']).extends).toEqual('../../../../tsconfig-base.json')
      expect(JSON.parse(actual['apps/web/fullstack/d/tsconfig.json']).extends).toEqual('../../../../tsconfig-base.json')
    })
    test(`if no tsconfig-base.json file is present at the root directory, a default compilerOptions object is generated`, async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['libs/*'], private: true },
        'libs/a/package.json': { name: 'a', version: '1.0.0' },
        'libs/b/package.json': { name: 'b', version: '1.0.0' },
        'libs/b/tsconfig-base.json': {},
        'libs/c/package.json': { name: 'c', version: '1.0.0' },
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out)

      const actual = await slurp(d)
      const expectedTsConfigJson = {
        compilerOptions: {
          allowSyntheticDefaultImports: true,
          composite: true,
          declaration: true,
          esModuleInterop: true,
          inlineSourceMap: true,
          lib: ['ES2021', 'DOM'],
          module: 'CommonJS',
          moduleResolution: 'node',
          newLine: 'LF',
          noImplicitAny: true,
          outDir: 'dist',
          strict: true,
          target: 'ES2021',
          resolveJsonModule: true,
        },
        include: ['src/**/*', 'src/**/*.json', 'tests/**/*', 'tests/**/*.json'],
      }
      expect(JSON.parse(actual['libs/a/tsconfig.json'])).toEqual(expectedTsConfigJson)
      expect(JSON.parse(actual['libs/b/tsconfig.json'])).toEqual({
        extends: './tsconfig-base.json',
        compilerOptions: {
          composite: true,
          outDir: 'dist',
        },
        include: ['src/**/*', 'src/**/*.json', 'tests/**/*', 'tests/**/*.json'],
      })
      expect(JSON.parse(actual['libs/c/tsconfig.json'])).toEqual(expectedTsConfigJson)
    })
    describe('references', () => {
      test(`reflect the package's dependencies`, async () => {
        const d = await makeFolder({
          'package.json': { workspaces: ['modules/*'], private: true },
          'tsconfig-base.json': {},
          'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0', c: '1.0.0' } },
          'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { c: '1.0.0' } },
          'modules/c/package.json': { name: 'c', version: '1.0.0' },
        })

        const yrp = newYarnRepoProtocol()
        await yrp.initialize(d, p, out)

        const actual = await slurp(d)
        expect(JSON.parse(actual['modules/a/tsconfig.json'])).toEqual({
          extends: '../../tsconfig-base.json',
          compilerOptions: { composite: true, outDir: 'dist' },
          include: ['src/**/*', 'src/**/*.json', 'tests/**/*', 'tests/**/*.json'],
          references: [{ path: '../b' }, { path: '../c' }],
        })
        expect(JSON.parse(actual['modules/b/tsconfig.json'])).toEqual({
          extends: '../../tsconfig-base.json',
          compilerOptions: { composite: true, outDir: 'dist' },
          include: ['src/**/*', 'src/**/*.json', 'tests/**/*', 'tests/**/*.json'],
          references: [{ path: '../c' }],
        })
      })
      test(`correctly computes the relative path to the dependecy`, async () => {
        const d = await makeFolder({
          'package.json': { workspaces: ['modules/**'], private: true },
          'tsconfig-base.json': {},
          'modules/web/fullstack/a/package.json': { name: 'a', version: '1.0.0', dependencies: { d: '1.0.0' } },
          'modules/web/static/b/package.json': { name: 'b', version: '1.0.0', dependencies: { d: '1.0.0' } },
          'modules/web/utils/c/package.json': { name: 'c', version: '1.0.0', dependencies: {} },
          'modules/libs/d/package.json': { name: 'd', version: '1.0.0', dependencies: { c: '1.0.0' } },
        })

        const yrp = newYarnRepoProtocol()
        await yrp.initialize(d, p, out)

        const actual = await slurp(d)
        expect(JSON.parse(actual['modules/web/fullstack/a/tsconfig.json']).references).toEqual([
          { path: '../../../libs/d' },
        ])
        expect(JSON.parse(actual['modules/web/static/b/tsconfig.json']).references).toEqual([
          { path: '../../../libs/d' },
        ])
        expect(JSON.parse(actual['modules/libs/d/tsconfig.json']).references).toEqual([{ path: '../../web/utils/c' }])
      })
      test(`reflect also the package's dev-dependencies`, async () => {
        const d = await makeFolder({
          'package.json': { workspaces: ['modules/*'], private: true },
          'tsconfig-base.json': {},
          'modules/a/package.json': { name: 'a', version: '1.0.0', devDependencies: { b: '1.0.0' } },
          'modules/b/package.json': { name: 'b', version: '1.0.0' },
        })

        const yrp = newYarnRepoProtocol()
        await yrp.initialize(d, p, out)

        const actual = await slurp(d)
        expect(JSON.parse(actual['modules/a/tsconfig.json']).references).toEqual([{ path: '../b' }])
      })
      test(`reflect only in-repo dependencies`, async () => {
        const d = await makeFolder({
          'package.json': { workspaces: ['modules/*'], private: true },
          'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { b: '1.0.0', x: '3' } },
          'modules/b/package.json': { name: 'b', version: '1.0.0', dependencies: { c: '1.0.0', y: '2' } },
          'modules/c/package.json': { name: 'c', version: '1.0.0' },
        })

        const yrp = newYarnRepoProtocol()
        await yrp.initialize(d, p, out)

        const actual = await slurp(d)
        expect(JSON.parse(actual['modules/a/tsconfig.json']).references).toEqual([{ path: '../b' }])
        expect(JSON.parse(actual['modules/b/tsconfig.json']).references).toEqual([{ path: '../c' }])
      })
      test(`are omitted if there are no in-repo dependencies nor in-repo dev-dependencies`, async () => {
        const d = await makeFolder({
          'package.json': { workspaces: ['modules/*'], private: true },
          'modules/a/package.json': { name: 'a', version: '1.0.0', dependencies: { c: '1.0.0' } },
          'modules/b/package.json': { name: 'b', version: '1.0.0', devDependencies: { c: '1.0.0' } },
          'modules/c/package.json': { name: 'c', version: '1.0.0', dependencies: { x: '1.0.0' } },
          'modules/d/package.json': { name: 'd', version: '1.0.0', devDependencies: { x: '1.0.0' } },
        })

        const yrp = newYarnRepoProtocol()
        await yrp.initialize(d, p, out)

        const actual = await slurp(d)
        expect(JSON.parse(actual['modules/a/tsconfig.json']).references).toEqual([{ path: '../c' }])
        expect(JSON.parse(actual['modules/b/tsconfig.json']).references).toEqual([{ path: '../c' }])
        expect(JSON.parse(actual['modules/c/tsconfig.json']).references).toBeUndefined()
        expect(JSON.parse(actual['modules/d/tsconfig.json']).references).toBeUndefined()
      })
      test(`overwrites a pre-existing tsconfig.json if its content is stale`, async () => {
        const d = await makeFolder({
          'package.json': { workspaces: ['modules/*'], private: true },
          'tsconfig-base.json': {},
          'modules/a/package.json': { name: 'a', version: '1.0.0' },
          'modules/a/tsconfig.json': {
            compilerOptions: {
              composite: false,
              outDir: 'compiled',
            },
          },
        })

        const yrp = newYarnRepoProtocol()
        await yrp.initialize(d, p, out)

        const actual = await slurp(d)
        expect(JSON.parse(actual['modules/a/tsconfig.json'])).toEqual({
          extends: '../../tsconfig-base.json',
          compilerOptions: { composite: true, outDir: 'dist' },
          include: ['src/**/*', 'src/**/*.json', 'tests/**/*', 'tests/**/*.json'],
        })
      })
      test(`does not overwrite a pre-existing tsconfig.json if its content is correct`, async () => {
        const d = await makeFolder({
          'package.json': { workspaces: ['modules/*'], private: true },
          'modules/a/package.json': { name: 'a', version: '1.0.0' },
        })

        const yrpA = newYarnRepoProtocol()
        await yrpA.initialize(d, p, out)

        const tsconfigPath = d.resolve(PathInRepo('modules/a/tsconfig.json'))
        const statA = await fse.stat(tsconfigPath)

        const yrpB = newYarnRepoProtocol()
        await yrpB.initialize(d, p, out)

        const statB = await fse.stat(tsconfigPath)
        expect(statB.mtimeMs).toEqual(statA.mtimeMs)
      })
    })
  })
  describe('building', () => {
    test('deletes output files which do not have a matching source file', async () => {
      const d = await makeFolder({
        'package.json': { workspaces: ['modules/*'], private: true },
        'modules/a/package.json': {
          name: 'a',
          version: '1',
          scripts: { build: `touch dist/src/a.d.ts dist/src/a.js` },
        },
        'modules/a/src/a.ts': '',
        'modules/a/dist/src/b.js': '',
        'modules/a/dist/src/b.d.ts': '',
      })

      const yrp = newYarnRepoProtocol()
      await yrp.initialize(d, p, out, { uberBuild: false })
      const buildResult = await yrp.execute(TaskName(UnitId('a'), TaskKind('build')), '/dev/null', 'my-build-run-id')
      expect(buildResult).toEqual('OK')
      const actual = await DirectoryScanner.listPaths(d.resolve(PathInRepo('modules/a/dist')))
      expect(actual).not.toContain('src/b.d.ts')
      expect(actual).not.toContain('src/b.js')
    })
  })
})
