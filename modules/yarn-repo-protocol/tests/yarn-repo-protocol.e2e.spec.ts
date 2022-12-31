import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(30000)
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
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        scripts: {
          build: 'mkdir -p dist/src dist/tests && echo "building now" && touch dist/src/a.js dist/tests/a.spec.js',
          jest: `echo "testing now" && echo '{}' > jest-output.json && echo 'x' > /dev/null`,
        },
      },
      'modules/a/src/a.ts': 'N/A',
      'modules/a/tests/a.spec.ts': 'N/A',
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(await run.outputOf('build', 'a')).toContain('building now')
    expect(await run.outputOf('test', 'a')).toContain('testing now')
  })

  const build = [
    'mkdir -p dist/src dist/tests',
    `cat src/*.ts | tr '[:upper:]' '[:lower:]' > dist/src/index.js`,
    `cat tests/*.spec.ts | tr '[:upper:]' '[:lower:]' > dist/tests/index.spec.js`,
    `echo "build finished"`,
  ].join(' && ')

  const jest = [
    `cat dist/src/index.js dist/tests/index.spec.js`,
    `echo '{"testResults": []}' > jest-output.json`,
    `echo 'x' > /dev/null`, // prevents the `yarn jest` command line options from being echoed into jest-output.json
  ].join(' && ')

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
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger, false, undefined, false) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build, jest }, dependencies: { b: '1.0.0' } },
      'modules/a/src/a.ts': 'ARGENTINA',
      'modules/a/tests/a.spec.ts': 'ALGERIA',
      'modules/b/package.json': { name: 'b', version: '1.0.0', scripts: { build, jest } },
      'modules/b/src/b.ts': 'BRAZIL',
      'modules/b/tests/b.spec.ts': 'BELGIUM',
    }

    const fork = await driver.repo(recipe).fork()

    const run1 = await fork.run('OK', { taskKind: 'build' })
    expect(await fork.file('modules/a/dist/src/index.js').lines({ trimEach: true })).toEqual(['argentina'])
    expect(await fork.file('modules/a/dist/tests/index.spec.js').lines({ trimEach: true })).toEqual(['algeria'])
    expect(run1.executionTypeOf('a', 'build')).toEqual('EXECUTED')
    expect(run1.executionTypeOf('b', 'build')).toEqual('EXECUTED')

    const run2 = await fork.run('OK', { taskKind: 'build' })
    expect(run2.executionTypeOf('a', 'build')).toEqual('CACHED')
    expect(run2.executionTypeOf('b', 'build')).toEqual('CACHED')

    const run3 = await fork.run('OK', { taskKind: 'build' })
    expect(run3.executionTypeOf('a', 'build')).toEqual('CACHED')
    expect(run3.executionTypeOf('b', 'build')).toEqual('CACHED')

    const run4 = await fork.run('OK', { taskKind: 'build' })
    expect(run4.executionTypeOf('a', 'build')).toEqual('CACHED')
    expect(run4.executionTypeOf('b', 'build')).toEqual('CACHED')
  })
  test.skip('the build task uses shadowing', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build, jest }, dependencies: { b: '1.0.0' } },
      'modules/a/src/a.ts': 'ARGENTINA',
      'modules/a/tests/a.spec.ts': 'ALGERIA',
      'modules/b/package.json': { name: 'b', version: '1.0.0', scripts: { build, jest } },
      'modules/b/src/b.ts': 'BRAZIL',
      'modules/b/tests/b.spec.ts': 'BELGIUM',
    }

    const fork = await driver.repo(recipe).fork()

    const run1 = await fork.run('OK', { taskKind: 'build' })
    expect(run1.executionTypeOf('a', 'build')).toEqual('EXECUTED')
    expect(run1.executionTypeOf('b', 'build')).toEqual('SHADOWED')

    await fork.file('modules/a/src/a.ts').write('AUSTRALIA')
    const run2 = await fork.run('OK', { taskKind: 'build' })
    expect(run2.executionTypeOf('a', 'build')).toEqual('EXECUTED')
    expect(run2.executionTypeOf('b', 'build')).toEqual('SHADOWED')

    await fork.file('modules/b/src/b.ts').write('BAHAMAS')
    const run3 = await fork.run('OK', { taskKind: 'build' })
    expect(run3.executionTypeOf('a', 'build')).toEqual('EXECUTED')
    expect(run3.executionTypeOf('b', 'build')).toEqual('SHADOWED')

    const run4 = await fork.run('OK', { taskKind: 'build' })
    expect(run4.executionTypeOf('a', 'build')).toEqual('CACHED')
    expect(run4.executionTypeOf('b', 'build')).toEqual('CACHED')
  })
})
