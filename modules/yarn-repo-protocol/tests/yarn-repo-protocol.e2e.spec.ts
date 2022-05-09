import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(30000)
describe('yarn-repo-protocol.e2e', () => {
  const logger = createNopLogger()
  const testName = () => expect.getState().currentTestName

  test('runs tasks and captures their output', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': {
        name: 'foo',
        private: true,
        workspaces: ['modules/*'],
      },
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        scripts: {
          build: 'mkdir -p dist/src dist/tests && echo "building now" && touch dist/src/a.js dist/tests/a.spec.js',
          jest: `echo "testing now" && echo '{}' > jest-output.json`,
        },
      },
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(await run.outputOf('build', 'a')).toContain('building now')
    expect(await run.outputOf('test', 'a')).toContain('testing now')
  })
})
