import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(240000)
describe('uber-building-and-deletion', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName

  describe('uber-building', () => {
    test('the build output contains errors from all modules', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', ['b']),
        'modules/a/src/a.ts': `
          import {b} from 'b'
          export function a(n: number) { return b(n)*10+1 }`,
        'modules/a/tests/a.spec.ts': `import {a} from '../src/a';  test('a', () => { expect(a(0)).toEqual(-321) })`,
        'modules/b/package.json': driver.packageJson('b', ['c']),
        'modules/b/src/index.ts': `
          import {c} from 'c'
          export function b(n: number) { return c(n)*10+2 }`,
        'modules/b/tests/b.spec.ts': `import {b} from '../src'; test('b', () => {expect(b(0)).toEqual(32)})`,
        'modules/c/package.json': driver.packageJson('c'),
        'modules/c/src/index.ts': `export function c(s: string) { return s.length }`,
        'modules/c/tests/c.spec.ts': `import {c} from '../src'; test('xyz', () => {expect(c('a')).toEqual(3)})`,
      }

      const fork = await driver.repo(recipe).fork()

      const run1 = await fork.run('FAIL', { taskKind: 'build' })
      expect(await run1.outputOf('build', 'c')).toEqual([
        `modules/b/src/index.ts(3,51): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.`,
      ])

      await fork.file('modules/c/src/index.ts').write(`export function c(n: number) { return n+3 }`)
      await fork
        .file('modules/c/tests/c.spec.ts')
        .write(`import {c} from '../src'; test('xyz', () => {expect(c(90)).toEqual(93)})`)
      const run2 = await fork.run('OK', { taskKind: 'build' })
      expect(await run2.outputOf('build', 'c')).toEqual([``])

      const run3 = await fork.run('FAIL', { taskKind: 'test' })
      expect(await run3.outputOf('test', 'a')).toContain('    Received: 321')

      await fork
        .file('modules/a/tests/a.spec.ts')
        .write(`import {a} from '../src/a';  test('a', () => { expect(a(0)).toEqual(321) })`)
      await fork.run('OK', { taskKind: 'test' })
    })
    test('runs build:post after compilation', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], {
          'build:post': `cat dist/src/a.js && echo "brown fox"`,
        }),
        'modules/a/src/a.ts': `export const a = "the quick"`,
        'modules/a/tests/a.spec.ts': ``,
      }

      const fork = await driver.repo(recipe).fork()
      const run1 = await fork.run('OK', { taskKind: 'build' })
      const output = await run1.outputOf('build', 'a')
      expect(output.join('\n')).toContain('the quick')
      expect(output[output.length - 1]).toMatch(/brown fox$/)
    })
    test('fails the task if build:post failed', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], { 'build:post': `cat foo/boo/non-existing-file` }),
        'modules/a/src/a.ts': `export const a = "the quick"`,
        'modules/a/tests/a.spec.ts': ``,
      }

      const fork = await driver.repo(recipe).fork()
      const run1 = await fork.run('FAIL', { taskKind: 'build' })
      expect(await run1.outputOf('build', 'a')).toContainEqual(
        expect.stringMatching('foo/boo/non-existing-file: No such file or directory'),
      )
    })
  })
  describe('deletion', () => {
    test('deletes dist/src/*.{js,d.ts} files that do not have a matching *.ts file under src/', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/a.ts': 'export function a() {}',
        'modules/a/tests/a.spec.ts': '//',
      }

      const fork = await driver.repo(recipe).fork()

      const xjs = fork.file('modules/a/dist/src/x.js')
      const xdts = fork.file('modules/a/dist/src/x.d.ts')

      await Promise.all([xjs.write('//'), xdts.write('//')])
      expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([true, true])
      await fork.run('OK', { taskKind: 'build' })
      expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([false, false])

      await Promise.all([xjs.write('//'), xdts.write('//')])
      expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([true, true])
      await fork.run('OK', { taskKind: 'build' })
      expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([false, false])
    })
    test('does not delete dist/src/*.{js,d.ts} files that have a matching *.tsx file under src/', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/a.tsx': 'export function a() {}',
        'modules/a/tests/a.spec.ts': '//',
      }

      const fork = await driver.repo(recipe).fork()

      const ajs = fork.file('modules/a/dist/src/a.js')
      const adts = fork.file('modules/a/dist/src/a.d.ts')

      await fork.run('OK', { taskKind: 'build' })
      expect(await Promise.all([ajs.exists(), adts.exists()])).toEqual([true, true])
    })
    test('deletes dist/tests/*.{js,d.ts} files that do not have a matching *.ts file under tests/', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/a.ts': 'export function a() {}',
        'modules/a/tests/a.spec.ts': '//',
      }

      const fork = await driver.repo(recipe).fork()

      const xjs = fork.file('modules/a/dist/tests/x.js')
      const xdts = fork.file('modules/a/dist/tests/x.d.ts')

      await Promise.all([xjs.write('//'), xdts.write('//')])
      expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([true, true])
      await fork.run('OK', { taskKind: 'build' })
      expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([false, false])

      await Promise.all([xjs.write('//'), xdts.write('//')])
      expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([true, true])
      await fork.run('OK', { taskKind: 'build' })
      expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([false, false])
    })
    test('does not delete files that were produced by a build:post run script', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], {
          'build:post': `echo "brown fox" > dist/src/myfile`,
        }),
        'modules/a/src/a.ts': 'export function a() {}',
        'modules/a/tests/a.spec.ts': '//',
      }

      const fork = await driver.repo(recipe).fork()
      const myfile = fork.file('modules/a/dist/src/myfile')

      expect(await myfile.exists()).toBe(false)
      await fork.run('OK', { taskKind: 'build' })
      expect(await myfile.lines()).toEqual(['brown fox'])
    })
  })
  describe('chmoding', () => {
    test('copies the mode of the source file to the output file', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/a.ts': '// a',
        'modules/a/src/b.ts': '// b',
        'modules/a/tests/a.spec.ts': '//',
      }

      const fork = await driver.repo(recipe).fork()

      fork.file('modules/a/src/a.ts').chmod(0o450)
      fork.file('modules/a/src/b.ts').chmod(0o644)
      fork.file('modules/a/tests/a.spec.ts').chmod(0o754)

      await fork.run('OK', { taskKind: 'build' })

      expect(fork.file('modules/a/dist/src/a.js').getMode().toString(8)).toEqual('450')
      expect(fork.file('modules/a/dist/src/b.js').getMode().toString(8)).toEqual('644')
      expect(fork.file('modules/a/dist/tests/a.spec.js').getMode().toString(8)).toEqual('754')
    })
  })
})
