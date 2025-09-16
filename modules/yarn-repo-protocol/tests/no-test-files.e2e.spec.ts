import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(120000)
describe('no-test-files.e2e', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName

  test('test task succeeds when no spec files exist in tests directory', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      'modules/a/tests/.gitkeep': '// empty directory placeholder',
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(run.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([expect.stringContaining('No test files found')]),
    )
  })

  test('test task succeeds when tests directory does not exist', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      // No tests directory at all
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(run.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([expect.stringContaining('No test files found')]),
    )
  })

  test('test task runs normally when spec files exist', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      'modules/a/tests/hello.spec.ts': `
        import {hello} from '../src'
        test('hello', () => { expect(hello()).toEqual("world") })
      `,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(run.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining(['PASS dist/tests/hello.spec.js', 'Test Suites: 1 passed, 1 total']),
    )
  })

  test('test task with validation still runs validate when no spec files exist', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { validate: 'echo "validation ran successfully"' }),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      'modules/a/tests/integration.test.ts': '// not a spec file',
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(run.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    const output = await run.outputOf('test', 'a')
    expect(output).toEqual(expect.arrayContaining([expect.stringContaining('No test files found')]))
    expect(output).toEqual(expect.arrayContaining([expect.stringContaining('validation ran successfully')]))
  })

  test('test task fails if validation fails even when no spec files exist', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { validate: 'exit 1' }),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      'modules/a/tests/.gitkeep': '// empty directory',
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })
    expect(run.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([expect.stringContaining('No test files found')]),
    )
  })

  test('test-runs.json is created with empty content when no spec files exist', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      'modules/a/tests/README.md': '# Test documentation',
    }

    const fork = await driver.repo(recipe).fork()

    await fork.run('OK', { taskKind: 'test' })
    const testRuns = JSON.parse(await fork.getPublicOutput('modules/a/.out/test-runs.json'))
    expect(testRuns).toEqual({})
  })

  test('build-raptor.test-output.json is created with empty array when no spec files exist', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      // No tests directory
    }

    const fork = await driver.repo(recipe).fork()

    await fork.run('OK', { taskKind: 'test' })
    const jestOutput = await fork.file('modules/a/.out/build-raptor.test-output.json').lines()
    expect(jestOutput).toBeDefined()
    expect(JSON.parse(jestOutput!.join('\n'))).toEqual([])
  })

  test('multiple modules with mixed test file presence', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/index.ts': 'export function a() { return "a" }',
      'modules/a/tests/a.spec.ts': `
        import {a} from '../src'
        test('a', () => { expect(a()).toEqual("a") })
      `,
      'modules/b/package.json': driver.packageJson('b'),
      'modules/b/src/index.ts': 'export function b() { return "b" }',
      // module b has no tests directory
      'modules/c/package.json': driver.packageJson('c'),
      'modules/c/src/index.ts': 'export function c() { return "c" }',
      'modules/c/tests/.gitkeep': '// empty tests directory',
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })

    // Module a should run tests normally
    expect(run.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run.outputOf('test', 'a')).toContain('PASS dist/tests/a.spec.js')

    // Module b should skip test execution
    expect(run.executionTypeOf('b', 'test')).toEqual('EXECUTED')
    expect(await run.outputOf('test', 'b')).toContain('No test files found')

    // Module c should skip test execution
    expect(run.executionTypeOf('c', 'test')).toEqual('EXECUTED')
    expect(await run.outputOf('test', 'c')).toContain('No test files found')
  })

  test('caching works correctly when no spec files exist', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      'modules/a/tests/docs.md': '# Documentation',
    }

    const fork = await driver.repo(recipe).fork()

    // First run - should execute
    const run1 = await fork.run('OK', { taskKind: 'test' })
    expect(run1.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run1.outputOf('test', 'a')).toContain('No test files found')

    // Second run - should be cached
    const run2 = await fork.run('OK', { taskKind: 'test' })
    expect(run2.executionTypeOf('a', 'test')).toEqual('CACHED')
    expect(await run2.outputOf('test', 'a')).toEqual([])
  })

  test('adding a spec file after initial run with no tests triggers re-execution', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/index.ts': 'export function hello() { return "world" }',
      'modules/a/tests/.gitkeep': '// placeholder',
    }

    const fork = await driver.repo(recipe).fork()

    // First run with no tests
    const run1 = await fork.run('OK', { taskKind: 'test' })
    expect(run1.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run1.outputOf('test', 'a')).toContain('No test files found')

    // Add a spec file
    await fork.file('modules/a/tests/hello.spec.ts').write(`
      import {hello} from '../src'
      test('hello', () => { expect(hello()).toEqual("world") })
    `)

    // Second run should execute tests normally
    const run2 = await fork.run('OK', { taskKind: 'test' })
    expect(run2.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run2.outputOf('test', 'a')).toContain('PASS dist/tests/hello.spec.js')
  })
})
