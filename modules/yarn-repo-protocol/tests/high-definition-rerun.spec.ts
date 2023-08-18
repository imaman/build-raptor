import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(90000)
describe('high-definition-rerun', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName

  test('reruns just the tests that did not pass', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/abs.ts': 'export function abs(n: number) { return n }',
      'modules/a/tests/abs.spec.ts': `
          import {abs} from '../src/abs'
          import {writeFileSync} from 'fs'
          test('p', () => { writeFileSync('p', ''); expect(abs(1)).toEqual(1) })
          test('n', () => { writeFileSync('n', ''); expect(abs(-2)).toEqual(2) })
        `,
    }

    const fork = await driver.repo(recipe).fork()

    await fork.run('FAIL', { taskKind: 'test' })
    const p = fork.file('modules/a/p')
    const n = fork.file('modules/a/n')
    expect(await p.exists()).toBe(true)
    expect(await n.exists()).toBe(true)

    await Promise.all([p.rm(), n.rm()])
    await fork.run('FAIL', { taskKind: 'test' })
    expect(await p.exists()).toBe(false)
    expect(await n.exists()).toBe(true)
  })
  test('when the code is changed, all tests run', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const buggyImpl = 'export function abs(n: number) { return n }'
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/abs.ts': buggyImpl,
      'modules/a/tests/abs.spec.ts': `
          import {abs} from '../src/abs'
          import {writeFileSync} from 'fs'
          test('p', () => { writeFileSync('p', ''); expect(abs(1)).toEqual(1) })
          test('n', () => { writeFileSync('n', ''); expect(abs(-2)).toEqual(2) })
        `,
    }

    const fork = await driver.repo(recipe).fork()

    await fork.run('FAIL', { taskKind: 'test' })
    const p = fork.file('modules/a/p')
    const n = fork.file('modules/a/n')
    expect(await p.exists()).toBe(true)
    expect(await n.exists()).toBe(true)

    await Promise.all([p.rm(), n.rm()])
    await fork.run('FAIL', { taskKind: 'test' })
    expect(await p.exists()).toBe(false)
    expect(await n.exists()).toBe(true)

    await Promise.all([p.rm(), n.rm()])
    await fork.file('modules/a/src/abs.ts').write(`export function abs(n: number) { return n < 0 ? -n : n }`)
    await fork.run('OK', { taskKind: 'test' })
    expect(await p.exists()).toBe(true)
    expect(await n.exists()).toBe(true)
  })
  test('when code is reverted, does not run all tests', async () => {
    const buggyImpl = 'export function abs(n: number) { return n }'
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/abs.ts': buggyImpl,
      'modules/a/tests/abs.spec.ts': `
          import {abs} from '../src/abs'
          import {writeFileSync} from 'fs'
          test('p', () => { writeFileSync('p', ''); expect(abs(1)).toEqual(1) })
          test('n', () => { writeFileSync('n', ''); expect(abs(-2)).toEqual(2) })
        `,
    }

    const fork = await driver.repo(recipe).fork()
    const p = fork.file('modules/a/p')
    const n = fork.file('modules/a/n')

    const wipe = async () => await Promise.all([p.rm(), n.rm()])
    const invoked = async () => [(await p.exists()) ? 'P' : '', (await n.exists()) ? 'N' : ''].filter(Boolean).join(',')

    await fork.run('FAIL', { taskKind: 'test' })
    expect(await invoked()).toEqual('P,N')

    await wipe()
    await fork.run('FAIL', { taskKind: 'test' })
    expect(await invoked()).toEqual('N')

    await wipe()
    await fork.file('modules/a/src/abs.ts').write(`export function abs(n: number) { return n < 0 ? -n : n }`)
    await fork.run('OK', { taskKind: 'test' })
    expect(await invoked()).toEqual('P,N')

    await wipe()
    await fork.file('modules/a/src/abs.ts').write(buggyImpl)
    await fork.run('FAIL', { taskKind: 'test' })
    expect(await invoked()).toEqual('N')
  })
  test('when test-caching is false reruns all tests', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/abs.ts': 'export function abs(n: number) { return n }',
      'modules/a/tests/abs.spec.ts': `
          import {abs} from '../src/abs'
          import {writeFileSync} from 'fs'
          test('p', () => { writeFileSync('p', ''); expect(abs(1)).toEqual(1) })
          test('n', () => { writeFileSync('n', ''); expect(abs(-2)).toEqual(2) })
        `,
    }

    const fork = await driver.repo(recipe).fork()
    const p = fork.file('modules/a/p')
    const n = fork.file('modules/a/n')

    const wipe = async () => await Promise.all([p.rm(), n.rm()])
    const invoked = async () => [(await p.exists()) ? 'P' : '', (await n.exists()) ? 'N' : ''].filter(Boolean).join(',')

    await fork.run('FAIL', { taskKind: 'test' })
    expect(await invoked()).toEqual('P,N')

    await wipe()
    await fork.run('FAIL', { taskKind: 'test' })
    expect(await invoked()).toEqual('N')

    await wipe()
    await fork.run('FAIL', { taskKind: 'test', testCaching: false })
    expect(await invoked()).toEqual('P,N')
  })
  test.only('jest configuration errors are yield a FAIL task status and the jest output is dumped to stdout', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', [], {}, obj => {
        const casted = obj as { jest: unknown } // eslint-disable-line @typescript-eslint/consistent-type-assertions
        casted.jest = {
          roots: ['<rootDir>/dist'],
          resolver: 'this-is-an-incorrect-resolver-value',
        }
      }),
      'modules/a/src/a.ts': `//`,
      'modules/a/tests/a.spec.ts': `test('foo', () => { expect(1).toEqual(1) })`,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })
    const actual = await run.outputOf('test', 'a')
    expect(actual.slice(0, 3)).toEqual([
      '● Validation Error:',
      '',
      '  Module this-is-an-incorrect-resolver-value in the resolver option was not found.',
    ])
  })
})
