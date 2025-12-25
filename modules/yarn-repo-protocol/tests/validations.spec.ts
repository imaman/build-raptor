import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol.js'

describe('validations', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName

  test('a test tasks runs the "validate" run script and places its output in the tasks output file', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { validate: 'node dist/tests/a.pqr' }),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 333 }`,
      'modules/a/tests/a.pqr.ts': `console.log("pqr test is running")`,
      'modules/a/tests/a.spec.ts': `test('a', () => { expect(1).toEqual(1) })`,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(run.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(await run.outputOf('test', 'a')).toContain('pqr test is running')
  })
  test('if the validation fails, the task fails', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { validate: 'node dist/tests/a.pqr' }),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 333 }`,
      'modules/a/tests/a.pqr.ts': `process.exit(1)`,
      'modules/a/tests/a.spec.ts': `test('a', () => { expect(1).toEqual(1) })`,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })
    expect(run.executionTypeOf('a', 'test')).toEqual('EXECUTED')
  })
  test('the output of the "validate" run script is appended to the tasks output file even if validation failed', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], { validate: 'node dist/tests/a.pqr' }),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 333 }`,
      'modules/a/tests/a.pqr.ts': `throw new Error("WE HAVE A PROBLEM")`,
      'modules/a/tests/a.spec.ts': `test('a', () => { expect(1).toEqual(1) })`,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })
    expect(await run.outputOf('test', 'a')).toContain('Error: WE HAVE A PROBLEM')
  })
})
