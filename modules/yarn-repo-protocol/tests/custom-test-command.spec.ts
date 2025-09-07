import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(120000)

describe('custom-test-command', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }

  const testName = () => expect.getState().currentTestName

  test('should use custom test command when one is specified in the package.json file', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { ...driver.packageJson('a'), buildRaptor: { testCommand: 'tools/etc/testme' } },
      'modules/a/src/a.ts': `//`,
      'modules/a/tests/a.spec.ts': [
        `import { test } from 'node:test';`,
        `import assert from 'node:assert/strict';`,
        ``,
        `test('a', () => {`,
        `  assert.strictEqual("zxcvbnm", "qwerty");`,
        `});`,
      ].join('\n'),
      'tools/etc/testme': ['#!/bin/bash', '', 'cd $1', 'node --test --test-reporter spec dist/tests/a.spec.js'].join(
        '\n',
      ),
    }

    const fork = await driver.repo(recipe).fork()
    fork.file('tools/etc/testme').chmod(0o755)

    const run = await fork.run('FAIL', { taskKind: 'test' })
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([
        '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
        '  + actual - expected',
        '  ',
        "  + 'zxcvbnm'",
        "  - 'qwerty'",
      ]),
    )
  })

  test.skip('should create test summary file even if custom test fails', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/summary-test-package/package.json': {
        ...driver.packageJson('summary-test-package'),
        buildRaptor: {
          testCommand: 'tools/summary-test.sh',
        },
      },
      'modules/summary-test-package/src/index.ts': 'export const foo = 1',
      'tools/summary-test.sh': `#!/bin/bash
echo "Creating summary test"
exit 1
`,
    }

    const fork = await driver.repo(recipe).fork()

    // Make script executable
    fork.file('tools/summary-test.sh').chmod(0o755)

    const result = await fork.run('FAIL', { taskKind: 'test' })

    expect(result.exitCode).toBe(1)

    // Check that the test-runs.json file was created
    const summaryFile = fork.getBuildRaptorDir().to('modules/summary-test-package/test-runs.json')
    const summaryContent = summaryFile.readJson()
    expect(summaryContent).toEqual({})
  })

  test.skip('should create rerun file if custom runner does not provide one', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/no-rerun-package/package.json': {
        ...driver.packageJson('no-rerun-package'),
        buildRaptor: {
          testCommand: 'tools/no-rerun-test.sh',
        },
      },
      'modules/no-rerun-package/src/index.ts': 'export const foo = 1',
      'tools/no-rerun-test.sh': `#!/bin/bash
echo "Test without rerun file"
# Does not create jest-output.json
exit 0
`,
    }

    const fork = await driver.repo(recipe).fork()

    // Make script executable
    fork.file('tools/no-rerun-test.sh').chmod(0o755)

    const result = await fork.run('OK', { taskKind: 'test' })

    expect(result.exitCode).toBe(0)

    // Check that the jest-output.json file was created with empty array
    const rerunFile = fork.file('modules/no-rerun-package/jest-output.json')
    const rerunContent = rerunFile.readJson()
    expect(rerunContent).toEqual([])
  })
})
