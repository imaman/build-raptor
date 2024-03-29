import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(90000)
describe('test-reporting', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName
  test('publishes test events', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': `//`,
      'modules/a/tests/a.spec.ts': `
          describe('a', () => {
            test('foo', () => { expect(1).toEqual(1) })
            test('bar', () => { expect(1).toEqual(2) })
          })`,
    }

    const fork = await driver.repo(recipe).fork()

    await fork.run('FAIL', { taskKind: 'test' })
    const steps = await fork.readStepByStepFile()
    expect(steps.filter(at => at.step === 'TEST_ENDED')).toEqual([
      expect.objectContaining({
        step: 'TEST_ENDED',
        taskName: 'a:test',
        fileName: 'modules/a/dist/tests/a.spec.js',
        testPath: ['a', 'foo'],
        verdict: 'TEST_PASSED',
      }),
      expect.objectContaining({
        step: 'TEST_ENDED',
        taskName: 'a:test',
        fileName: 'modules/a/dist/tests/a.spec.js',
        testPath: ['a', 'bar'],
        verdict: 'TEST_FAILED',
      }),
    ])
  })
})
