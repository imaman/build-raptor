import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(120000)
describe('install-task', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName
  test('build when dormant', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      '.build-raptor.json': { repoProtocol: { install: 'dormant' } },
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', []),
      'modules/a/src/a.ts': `export function a(n: number) { return n*101 }`,
      'modules/a/tests/a.spec.ts': ``,
    }

    const fork = await driver.repo(recipe).fork()
    const run = await fork.run('OK', { taskKind: 'build' })
    expect(run.taskNames()).toEqual(['.:install', 'a:build'])
  })
})
