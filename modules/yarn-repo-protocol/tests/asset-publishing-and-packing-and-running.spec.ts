import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import * as ChildProcess from 'child_process'
import { createNopLogger } from 'logger'
import { folderify } from 'misc'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(120000)
describe('asset-publishing-and-packing', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName

  describe('asset-publishing', () => {
    test('publish-assets runs prepare-assets', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], { 'prepare-assets': 'touch prepared-assets/x' }),
        'modules/a/src/a.ts': `export function a(n: number) { return n * 100 }`,
        'modules/a/tests/a.spec.ts': ``,
      }

      const fork = await driver.repo(recipe).fork()

      const run = await fork.run('OK', { taskKind: 'publish-assets' })

      expect(await run.outputOf('publish-assets', 'a')).toEqual([
        '> a@1.0.0 prepare-assets',
        '> touch prepared-assets/x',
      ])
    })
    test('publish-assets runs only in packages which define a prepare-assets run script', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], { 'prepare-assets': 'touch prepared-assets/x' }),
        'modules/a/src/a.ts': `export function a(n: number) { return n * 100 }`,
        'modules/a/tests/a.spec.ts': ``,
        'modules/b/package.json': driver.packageJson('b'),
        'modules/b/src/b.ts': `export function b(n: number) { return n * 200 }`,
        'modules/b/tests/b.spec.ts': ``,
      }

      const fork = await driver.repo(recipe).fork()

      const run = await fork.run('OK', { taskKind: 'publish-assets' })

      expect(await run.outputOf('publish-assets', 'a')).toEqual([
        '> a@1.0.0 prepare-assets',
        '> touch prepared-assets/x',
      ])
      expect(run.taskNames()).toEqual(['a:build', 'a:publish-assets'])
    })
    test('can runs tests in parallel to publish-assets', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], { 'prepare-assets': 'touch prepared-assets/x' }),
        'modules/a/src/a.ts': `export function a(n: number) { return n * 100 }`,
        'modules/a/tests/a.spec.ts': `test('a', () => expect(1).toEqual(1))`,
        'modules/b/package.json': driver.packageJson('b'),
        'modules/b/src/b.ts': `export function b(n: number) { return n * 200 }`,
        'modules/b/tests/b.spec.ts': `test('b', () => expect(20).toEqual(21))`,
      }

      const fork = await driver.repo(recipe).fork()

      const run = await fork.run('FAIL', { taskKind: ['publish-assets', 'test'] })

      expect(await run.outputOf('publish-assets', 'a')).toEqual([
        '> a@1.0.0 prepare-assets',
        '> touch prepared-assets/x',
      ])
      expect(await run.outputOf('test', 'b')).toEqual(expect.arrayContaining(['    Expected: 21', '    Received: 20']))
      expect(run.taskNames()).toEqual(['a:build', 'a:publish-assets', 'a:test', 'b:build', 'b:test'])
    })
    test('publish-assets publishes a blob and generates a matching ASSET_PUBLSIHED step with a fingerprint', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], { 'prepare-assets': 'echo "a" > prepared-assets/x' }),
        'modules/a/src/a.ts': `export function a(n: number) { return n * 100 }`,
        'modules/a/tests/a.spec.ts': ``,
      }

      const fork = await driver.repo(recipe).fork()
      await fork.run('OK', { taskKind: 'publish-assets' })
      const putSteps = await fork.getSteps('TASK_STORE_PUT')
      const blobId = putSteps.find(at => at.taskName === 'a:publish-assets')?.blobId
      expect(await driver.slurpBlob(blobId)).toEqual({ 'modules/a/prepared-assets/x': 'a\n' })

      const assetSteps = await fork.getSteps('ASSET_PUBLISHED')
      expect(assetSteps.find(at => at.taskName === 'a:publish-assets')?.fingerprint).toHaveLength(56)
    })
  })

  test('takes just the current files when publishing an asset', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { 'prepare-assets': 'echo "a" > prepared-assets/x1' }),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 100 }`,
      'modules/a/tests/a.spec.ts': ``,
    }

    const fork = await driver.repo(recipe).fork()

    const readBlob = async (taskName: string) => {
      const steps = await fork.readStepByStepFile()
      const blobId: string | undefined = steps
        .filter(at => at.step !== 'BUILD_RUN_STARTED' && at.step !== 'BUILD_RUN_ENDED' && at.taskName === taskName)
        .flatMap(at => (at.step === 'TASK_STORE_GET' || at.step === 'TASK_STORE_PUT' ? [at] : []))
        .find(Boolean)?.blobId
      return await driver.slurpBlob(blobId)
    }

    await fork.run('OK', { taskKind: 'publish-assets' })
    expect(Object.keys(await readBlob('a:publish-assets'))).toEqual(['modules/a/prepared-assets/x1'])

    await fork
      .file('modules/a/package.json')
      .write(driver.packageJson('a', [], { 'prepare-assets': 'echo "a" > prepared-assets/x2' }))
    await fork.run('OK', { taskKind: 'publish-assets' })
    expect(Object.keys(await readBlob('a:publish-assets'))).toEqual(['modules/a/prepared-assets/x2'])
  })
  describe('packing', () => {
    test('packed module (with in-repo dependencies) can be be NPM install-ed and consumed by a node program', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'my-libs', private: true, workspaces: ['modules/*'] },
        'modules/foo/package.json': driver.packageJson('foo', ['goo'], {}),
        'modules/foo/src/index.ts': `import {goo} from 'goo'; export function foo(s: string) { return 'f:' + goo(s) }`,
        'modules/foo/tests/index.spec.ts': ``,
        'modules/goo/package.json': driver.packageJson('goo', [], {}),
        'modules/goo/src/index.ts': `export function goo(s: string) { return 'g:' + s.toUpperCase() }`,
        'modules/goo/tests/index.spec.ts': ``,
      }

      const fork = await driver.repo(recipe).fork()

      await fork.run('OK', { taskKind: 'pack' })

      const fooPack = fork.file('modules/foo/pack').resolve()

      const dir = await folderify({
        'package.json': { name: 'app', private: true, version: '1.0.0', dependencies: { foo: fooPack } },
        'a.js': [`const {foo} = require('foo')`, `console.log(foo('xyz'))`].join('\n'),
      })

      ChildProcess.execSync(`npm install`, { cwd: dir, encoding: 'utf-8', timeout: 120000 })
      const output = ChildProcess.execSync(`node a.js`, { cwd: dir, encoding: 'utf-8', timeout: 120000 })
      expect(output.trim()).toEqual('f:g:XYZ')
    })
    test('allows the index.ts to define its own imports', async () => {
      // This test verifies that the symlinking code (the "preamble") that is injected into the index.ts file of the
      // packed bundle is isolated from the "real" code in that file. To this end, this test defines an index.ts file
      // which defines `fs` and `path` files (similar to the ones defined by the preamble) and makes sure the package
      // still runs correctly.
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'my-libs', private: true, workspaces: ['modules/*'] },
        'modules/foo/package.json': driver.packageJson('foo', [], {}),
        'modules/foo/src/index.ts': `
          import * as path from 'path'; 
          import * as fs from 'fs'; 
          export function foo(dir: string, f: string) { return fs.readFileSync(path.join(dir, f), 'utf-8')}`,
        'modules/foo/tests/index.spec.ts': ``,
      }

      const fork = await driver.repo(recipe).fork()
      await fork.run('OK', { taskKind: 'pack' })
      const fooPack = fork.file('modules/foo/pack').resolve()

      const dir = await folderify({
        'package.json': { name: 'app', private: true, version: '1.0.0', dependencies: { foo: fooPack } },
        'a.js': `
          const {foo} = require('foo')
          console.log(foo(__dirname, 'myfile'))`,
        myfile: 'four scores and seven years ago',
      })

      ChildProcess.execSync(`npm install`, { cwd: dir, encoding: 'utf-8', timeout: 120000 })
      const output = ChildProcess.execSync(`node a.js`, { cwd: dir, encoding: 'utf-8', timeout: 120000 })
      expect(output.trim()).toEqual('four scores and seven years ago')
    })
  })
  describe('run', () => {
    test('builds and run a program passing command line args to it', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], {
          'build:post': `chmod 700 dist/src/index.js`,
        }),
        'modules/a/src/index.ts': `#!/usr/bin/env node      
          import fs from 'fs'      
          fs.writeFileSync('abc', process.argv.slice(2).join(';').toUpperCase())`,
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()

      await fork.run('OK', { toRun: { program: 'modules/a/dist/src/index.js', args: ['p', 'q', 'r'] } })
      expect(await fork.file('abc').lines()).toEqual(['P;Q;R'])

      await fork.run('OK', { toRun: { program: 'modules/a/dist/src/index.js', args: ['x', 'y', 'z'] } })
      expect(await fork.file('abc').lines()).toEqual(['X;Y;Z'])
    })
    test('the program is not rebuilt if its code stays the same (even if the command line args change)', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], {
          'build:post': `chmod 700 dist/src/index.js`,
        }),
        'modules/a/src/index.ts': `#!/usr/bin/env node      
          console.log('')`,
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()

      const run1 = await fork.run('OK', { toRun: { program: 'modules/a/dist/src/index.js', args: ['p', 'q', 'r'] } })
      expect(run1.executionTypeOf('a', 'build')).toEqual('EXECUTED')

      const run2 = await fork.run('OK', { toRun: { program: 'modules/a/dist/src/index.js', args: ['x', 'y', 'z'] } })
      expect(run2.executionTypeOf('a', 'build')).toEqual('CACHED')
    })
    test('the program is invoked from the user dir', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], {
          'build:post': `chmod 700 dist/src/index.js`,
        }),
        'modules/a/src/index.ts': `#!/usr/bin/env node      
          import fs from 'fs'      
          fs.writeFileSync('abc', process.argv[2].toUpperCase())`,
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
        'this/is/a/very/different/location/myfile': '',
      }

      const fork = await driver.repo(recipe).fork()

      await fork.run('OK', { userDir: 'modules/a/tests', toRun: { program: '../dist/src/index.js', args: ['bee'] } })
      expect(await fork.file('modules/a/tests/abc').lines()).toEqual(['BEE'])

      await fork.run('OK', {
        userDir: 'this/is/a/very/different/location',
        toRun: { program: '../../../../../../modules/a/dist/src/index.js', args: ['coyote'] },
      })
      expect(await fork.file('this/is/a/very/different/location/abc').lines()).toEqual(['COYOTE'])
    })
  })
})
