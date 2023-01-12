import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(90000)
describe('yarn-repo-protocol.e2e', () => {
  const logger = createNopLogger()
  const testName = () => expect.getState().currentTestName

  test('runs tsc and jest when building and testing (respectively)', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/times-two.ts': 'export function timesTwo(n: number) { return n * 2 }',
      'modules/a/tests/times-two.spec.ts': `
        import {timesTwo} from '../src/times-two'
        test('timesTwo', () => { expect(timesTwo(6)).toEqual(12) })
      `,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(await run.outputOf('build', 'a')).toEqual(['> a@1.0.0 build', '> tsc -b'])
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([
        'PASS dist/tests/times-two.spec.js',
        'Test Suites: 1 passed, 1 total',
        'Tests:       1 passed, 1 total',
        'Test results written to: jest-output.json',
      ]),
    )
  })
  test('deletes dist/src/*.{js,d.ts} files that do not have a matching *.ts file under src/', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
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
  test('deletes dist/tests/*.{js,d.ts} files that do not have a matching *.ts file under tests/', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
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
  test('can run code that imports code from another package', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', ['b']),
      'modules/a/src/a.ts': `
        import {b} from 'b'
        export function a(n: number) { return b(n)+2 }`,
      'modules/a/tests/a.spec.ts': `
        import {a} from '../src/a'
        test('a', () => { expect(a(7)).toEqual(703) })
      `,
      'modules/b/package.json': driver.packageJson('b'),
      'modules/b/src/index.ts': `export function b(n: number) { return n*100 }`,
      'modules/b/tests/b.spec.ts': `import {b} from '../src'; test('b', () => {expect(b(2)).toEqual(200)})`,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })

    expect(await run.outputOf('test', 'a')).toEqual(expect.arrayContaining(['    Expected: 703', '    Received: 702']))
  })
  test('publish-assets runs prepare-assets', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { 'prepare-assets': 'touch prepared-assets/x' }),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 100 }`,
      'modules/a/tests/a.spec.ts': ``,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'publish-assets' })

    expect(await run.outputOf('publish-assets', 'a')).toEqual(['> a@1.0.0 prepare-assets', '> touch prepared-assets/x'])
  })
  test('publish-assets runs only in packages which define a prepare-assets run script', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
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

    expect(await run.outputOf('publish-assets', 'a')).toEqual(['> a@1.0.0 prepare-assets', '> touch prepared-assets/x'])
    expect(run.taskNames()).toEqual(['a:build', 'a:publish-assets'])
  })
  test('publish-assets publishes a blob', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { 'prepare-assets': 'echo "a" > prepared-assets/x' }),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 100 }`,
      'modules/a/tests/a.spec.ts': ``,
    }

    const fork = await driver.repo(recipe).fork()
    await fork.run('OK', { taskKind: 'publish-assets' })

    const stepByStep = await fork.readStepByStepFile()
    const blobId = stepByStep.find(at => at.taskName === 'a:publish-assets')?.blobId
    expect(await driver.slurpBlob(blobId)).toEqual({ 'prepared-assets/x': 'a\n' })
  })
  test('takes just the current files when publishing an asset', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { 'prepare-assets': 'echo "a" > prepared-assets/x1' }),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 100 }`,
      'modules/a/tests/a.spec.ts': ``,
    }

    const fork = await driver.repo(recipe).fork()

    const readBlob = async (taskName: string) => {
      const stepByStep = await fork.readStepByStepFile()
      const blobId = stepByStep.find(at => at.taskName === taskName)?.blobId
      return await driver.slurpBlob(blobId)
    }

    await fork.run('OK', { taskKind: 'publish-assets' })
    expect(Object.keys(await readBlob('a:publish-assets'))).toEqual(['prepared-assets/x1'])

    await fork
      .file('modules/a/package.json')
      .write(driver.packageJson('a', [], { 'prepare-assets': 'echo "a" > prepared-assets/x2' }))
    await fork.run('OK', { taskKind: 'publish-assets' })
    expect(Object.keys(await readBlob('a:publish-assets'))).toEqual(['prepared-assets/x2'])
  })
  test('when the test fails, the task output includes the failure message prodcued by jest', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/times-two.ts': 'export function timesTwo(n: number) { return n * 2 }',
      'modules/a/tests/times-two.spec.ts': `
        import {timesTwo} from '../src/times-two'
        test('timesTwo', () => { expect(timesTwo(6)).toEqual(-12) })
      `,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })
    expect(await run.outputOf('build', 'a')).toEqual(['> a@1.0.0 build', '> tsc -b'])
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([
        'FAIL dist/tests/times-two.spec.js',
        '    Expected: -12',
        '    Received: 12',
        'Tests:       1 failed, 1 total',
      ]),
    )
  })

  test('runs tasks and captures their output', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': '// something',
      'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)}); console.log('the quick BROWN fox'); `,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(await run.outputOf('build', 'a')).toEqual(['> a@1.0.0 build', '> tsc -b'])
    expect(await run.outputOf('test', 'a')).toContain('    the quick BROWN fox')
  })

  test('reruns tests when the source code changes', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/times-two.ts': 'export function timesTwo(n: number) { return n * 3 }',
      'modules/a/tests/times-two.spec.ts': `
        import {timesTwo} from '../src/times-two'
        test('timesTwo', () => { expect(timesTwo(216)).toEqual(432) })
      `,
    }

    const fork = await driver.repo(recipe).fork()

    const runA = await fork.run('FAIL', { taskKind: 'test' })
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runA.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(await runA.outputOf('test', 'a')).toContain('    Received: 648')

    await fork.file('modules/a/src/times-two.ts').write('export function timesTwo(n: number) { return n * 2 }')
    const runB = await fork.run('OK', { taskKind: 'test' })
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runB.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(await runB.outputOf('test', 'a')).toContain('PASS dist/tests/times-two.spec.js')
  })
  test('if nothing has changed the tasks are cached', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', ['b']),
      'modules/a/src/a.ts': `
        import {b} from 'b'
        export function a(n: number) { return b(n)+2 }`,
      'modules/a/tests/a.spec.ts': `
        import {a} from '../src/a'
        test('a', () => { expect(a(7)).toEqual(702) })
      `,
      'modules/b/package.json': driver.packageJson('b'),
      'modules/b/src/index.ts': `export function b(n: number) { return n*100 }`,
      'modules/b/tests/b.spec.ts': `import {b} from '../src'; test('b', () => {expect(b(2)).toEqual(200)})`,
    }

    const fork = await driver.repo(recipe).fork()

    const run1 = await fork.run('OK', { taskKind: 'test' })
    expect(await run1.outputOf('test', 'a')).toContain('PASS dist/tests/a.spec.js')
    expect(run1.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(run1.executionTypeOf('b', 'test')).toEqual('EXECUTED')

    const run2 = await fork.run('OK', { taskKind: 'test' })
    expect(await run2.outputOf('test', 'a')).toEqual([])
    expect(run2.executionTypeOf('a', 'test')).toEqual('CACHED')
    expect(run2.executionTypeOf('b', 'test')).toEqual('CACHED')

    const run3 = await fork.run('OK', { taskKind: 'test' })
    expect(await run3.outputOf('test', 'a')).toEqual([])
    expect(run3.executionTypeOf('a', 'test')).toEqual('CACHED')
    expect(run3.executionTypeOf('b', 'test')).toEqual('CACHED')

    const run4 = await fork.run('OK', { taskKind: 'test' })
    expect(await run4.outputOf('test', 'a')).toEqual([])
    expect(run4.executionTypeOf('a', 'test')).toEqual('CACHED')
    expect(run4.executionTypeOf('b', 'test')).toEqual('CACHED')
  })
  test('code is rebuilt when package.json changes', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 333 }`,
      'modules/a/tests/a.spec.ts': `test('a', () => { expect(1).toEqual(1) })`,
    }

    const fork = await driver.repo(recipe).fork()

    const run1 = await fork.run('OK', { taskKind: 'build' })
    expect(run1.executionTypeOf('a', 'build')).toEqual('EXECUTED')

    const run2 = await fork.run('OK', { taskKind: 'build' })
    expect(run2.executionTypeOf('a', 'build')).toEqual('CACHED')

    fork.file('modules/a/package.json').write(driver.packageJson('a', [], { foo: '# nothing' }))
    const run3 = await fork.run('OK', { taskKind: 'build' })
    expect(run3.executionTypeOf('a', 'build')).toEqual('EXECUTED')
  })
  describe('validations', () => {
    test('invokes the "validate" run script', async () => {
      const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a', [], { validate: 'node dist/tests/a.pqr' }),
        'modules/a/src/a.ts': `export function a(n: number) { return n * 333 }`,
        'modules/a/tests/a.pqr.ts': `console.log("pqr test is running")`,
      }

      const fork = await driver.repo(recipe).fork()

      const run1 = await fork.run('OK', { taskKind: 'validate' })
      expect(run1.executionTypeOf('a', 'build')).toEqual('EXECUTED')
      expect(run1.executionTypeOf('a', 'validate')).toEqual('EXECUTED')
      expect(await run1.outputOf('validate', 'a')).toContain('pqr test is running')
    })
  })
})
