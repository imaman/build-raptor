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

  test('should use custom test command when testCommand is specified', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { ...driver.packageJson('a'), buildRaptor: { testCommand: 'tools/etc/testme' } },
      'modules/a/src/a.ts': `//`,
      'modules/a/tests/a.spec.ts': [
        `import { test } from 'test';`,
        `import assert from 'assert/strict';`,
        ``,
        `test('a', () => {`,
        `  assert.strictEqual("zxcvbnm", "qwerty");`,
        `});`,
      ].join('\n'),
      'tools/etc/testme': ['#!/bin/bash', '', 'cd $1', 'node --test dist/tests/a.spec.ts'].join('\n'),
    }

    const fork = await driver.repo(recipe).fork()
    fork.file('tools/etc/testme').chmod(0o755)

    const run = await fork.run('FAIL', { taskKind: 'test' })
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining(['    Expected: "qwerty"', '    Received: "zxcvbnm"']),
    )

    expect(100).toEqual(100)

    // const recipe = {
    //   'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
    //   'modules/test-package/package.json': {
    //     ...driver.packageJson('test-package'),
    //     // buildRaptor: {
    //     //   testCommand: 'tools/custom-test.sh',
    //     // },
    //   },
    //   'modules/test-package/src/a.ts': 'export const foo = 1',
    //   'modules/test-package/tests/a.spce.ts': `te_st('a', () => {expect(1).toEqual(1) })`,
    //       'tools/custom-test.sh': `#!/bin/bash
    // echo "Custom test runner executed"
    // echo "Package: $2"
    // echo "Directory: $1"
    // exit 0
    // `,
    // }

    // const fork = await driver.repo(recipe).fork()

    // Make script executable
    // fork.file('tools/custom-test.sh').chmod(0o755)

    // Run the test task
    // await fork.run('OK', { taskKind: 'test' })

    // const output = await result.outputOf('test', 'test-package')
    // expect(output).toEqual(
    //   expect.arrayContaining([
    //     expect.stringContaining('Custom test runner executed'),
    //     expect.stringContaining('Package: test-package'),
    //   ]),
    // )
  })

  test.skip('should use Jest when testCommand is not specified', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/jest-package/package.json': driver.packageJson('jest-package'),
      'modules/jest-package/src/index.ts': 'export const foo = 1',
      'modules/jest-package/tests/foo.spec.ts': `
describe('foo', () => {
  it('should work', () => {
    expect(1).toBe(1)
  })
})`,
    }

    const fork = await driver.repo(recipe).fork()

    // Run the test task - should use Jest
    const result = await fork.run('OK', { taskKind: 'test' })

    // Verify Jest was invoked (look for Jest-specific output)
    const output = await result.outputOf('test', 'jest-package')
    const outputStr = output?.join('\n') ?? ''
    expect(outputStr).toMatch(/PASS|foo\.spec\.ts|Test Suites/)
  })

  test.skip('should handle custom test command failure', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/fail-package/package.json': {
        ...driver.packageJson('fail-package'),
        buildRaptor: {
          testCommand: 'tools/failing-test.sh',
        },
      },
      'modules/fail-package/src/index.ts': 'export const foo = 1',
      'tools/failing-test.sh': `#!/bin/bash
echo "Test failed!"
exit 1
`,
    }

    const fork = await driver.repo(recipe).fork()

    // Make script executable
    fork.file('tools/failing-test.sh').chmod(0o755)

    const result = await fork.run('FAIL', { taskKind: 'test' })

    const output = await result.outputOf('test', 'fail-package')
    expect(output).toEqual(expect.arrayContaining([expect.stringContaining('Test failed!')]))
  })

  test.skip('should resolve testCommand relative to repo root', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/nested-package/package.json': {
        ...driver.packageJson('nested-package'),
        buildRaptor: {
          testCommand: 'shared/test-runners/universal.js',
        },
      },
      'modules/nested-package/src/index.ts': 'export const foo = 1',
      'shared/test-runners/universal.js': `#!/usr/bin/env node
console.log('Universal test runner')
console.log('CWD:', process.cwd())
console.log('Package:', process.argv[3])
process.exit(0)
`,
    }

    const fork = await driver.repo(recipe).fork()

    // Make script executable
    fork.file('shared/test-runners/universal.js').chmod(0o755)

    const result = await fork.run('OK', { taskKind: 'test' })

    const output = await result.outputOf('test', 'nested-package')
    expect(output).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Universal test runner'),
        expect.stringContaining('Package: nested-package'),
      ]),
    )

    // Verify it runs from package directory
    const outputStr = output?.join('\n') ?? ''
    expect(outputStr).toContain('nested-package')
  })

  test.skip('should pass correct arguments to custom test command', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/args-test-package/package.json': {
        ...driver.packageJson('args-test-package'),
        buildRaptor: {
          testCommand: 'tools/args-test.js',
        },
      },
      'modules/args-test-package/src/index.ts': 'export const foo = 1',
      'tools/args-test.js': `#!/usr/bin/env node
const fs = require('fs')
const path = require('path')

const [,, packageDir, packageName, rerunFile] = process.argv

console.log('ARG1_DIR:', packageDir)
console.log('ARG2_NAME:', packageName)
console.log('ARG3_RERUN:', rerunFile)

// Verify directory exists
console.log('DIR_EXISTS:', fs.existsSync(packageDir))

// Verify rerun file path
console.log('RERUN_PATH_CORRECT:', rerunFile === path.join(packageDir, 'jest-output.json'))

// Create an empty rerun file
fs.writeFileSync(rerunFile, JSON.stringify([]))

process.exit(0)
`,
    }

    const fork = await driver.repo(recipe).fork()

    // Make script executable
    fork.file('tools/args-test.js').chmod(0o755)

    const result = await fork.run('OK', { taskKind: 'test' })

    const output = await result.outputOf('test', 'args-test-package')
    expect(output).toEqual(
      expect.arrayContaining([
        expect.stringContaining('ARG2_NAME: args-test-package'),
        expect.stringContaining('DIR_EXISTS: true'),
        expect.stringContaining('RERUN_PATH_CORRECT: true'),
      ]),
    )

    const outputStr = output?.join('\n') ?? ''
    expect(outputStr).toMatch(/ARG1_DIR:.*args-test-package/)
    expect(outputStr).toMatch(/ARG3_RERUN:.*jest-output\.json/)
  })

  test.skip('should run validate script after successful custom test', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/validate-package/package.json': {
        ...driver.packageJson('validate-package', [], {
          test: 'echo "should not run"',
          validate: 'echo "Validation ran successfully"',
        }),
        buildRaptor: {
          testCommand: 'tools/simple-test.sh',
        },
      },
      'modules/validate-package/src/index.ts': 'export const foo = 1',
      'tools/simple-test.sh': `#!/bin/bash
echo "Tests passed"
exit 0
`,
    }

    const fork = await driver.repo(recipe).fork()

    // Make script executable
    fork.file('tools/simple-test.sh').chmod(0o755)

    const result = await fork.run('OK', { taskKind: 'test' })

    const output = await result.outputOf('test', 'validate-package')
    expect(output).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Tests passed'),
        expect.stringContaining('Validation ran successfully'),
      ]),
    )
  })

  test.skip('should not run validate script after failed custom test', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/validate-fail-package/package.json': {
        ...driver.packageJson('validate-fail-package', [], {
          test: 'echo "should not run"',
          validate: 'echo "Validation should not run"',
        }),
        buildRaptor: {
          testCommand: 'tools/failing-test-validate.sh',
        },
      },
      'modules/validate-fail-package/src/index.ts': 'export const foo = 1',
      'tools/failing-test-validate.sh': `#!/bin/bash
echo "Tests failed"
exit 1
`,
    }

    const fork = await driver.repo(recipe).fork()

    // Make script executable
    fork.file('tools/failing-test-validate.sh').chmod(0o755)

    const result = await fork.run('FAIL', { taskKind: 'test' })

    const output = await result.outputOf('test', 'validate-fail-package')
    expect(output).toEqual(expect.arrayContaining([expect.stringContaining('Tests failed')]))

    const outputStr = output?.join('\n') ?? ''
    expect(outputStr).not.toContain('Validation should not run')
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
