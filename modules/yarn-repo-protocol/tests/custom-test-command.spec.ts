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

  test('should use Jest when custom test commands are disabled globally', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      '.build-raptor.json': JSON.stringify({
        repoProtocol: {
          enableCustomTestCommands: false,
        },
      }),
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { ...driver.packageJson('a'), buildRaptor: { testCommand: 'tools/etc/testme' } },
      'modules/a/src/a.ts': `//`,
      'modules/a/tests/a.spec.ts': [`test('a', () => {`, `  expect("zxcvbnm").toEqual("qwerty");`, `});`].join('\n'),
      'tools/etc/testme': ['#!/bin/bash', '', 'echo "THIS SHOULD NOT RUN"', 'exit 1'].join('\n'),
    }

    const fork = await driver.repo(recipe).fork()
    fork.file('tools/etc/testme').chmod(0o755)

    const run = await fork.run('FAIL', { taskKind: 'test' })
    const output = await run.outputOf('test', 'a')

    // Verify Jest output (not the custom test command output)
    expect(output).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Expected: "qwerty"'),
        expect.stringContaining('Received: "zxcvbnm"'),
      ]),
    )
    // Verify custom test command was NOT executed
    expect(output).not.toEqual(expect.arrayContaining([expect.stringContaining('THIS SHOULD NOT RUN')]))
  })

  test('should use Jest when enableCustomTestCommands is not specified (default behavior)', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': {
        ...driver.packageJson('a'),
        buildRaptor: { testCommand: 'tools/etc/testme' },
      },
      'modules/a/src/a.ts': `//`,
      'modules/a/tests/a.spec.ts': [
        `import { test } from 'node:test';`,
        `import assert from 'node:assert/strict';`,
        ``,
        `test('a', () => {`,
        `  assert.strictEqual("hello", "world");`,
        `});`,
      ].join('\n'),
      'tools/etc/testme': ['#!/bin/bash', '', 'cd $1', 'node --test --test-reporter spec dist/tests/a.spec.js'].join(
        '\n',
      ),
    }

    const fork = await driver.repo(recipe).fork()
    fork.file('tools/etc/testme').chmod(0o755)

    const run = await fork.run('FAIL', { taskKind: 'test' })

    // Should use custom test command by default (when not explicitly disabled)
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([
        '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
        '  + actual - expected',
        '  ',
        "  + 'hello'",
        "  - 'world'",
      ]),
    )
  })
})
