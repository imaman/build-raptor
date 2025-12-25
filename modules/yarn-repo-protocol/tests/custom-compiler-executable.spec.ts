import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(120000)

describe('custom-compiler-executable', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }

  const testName = () => expect.getState().currentTestName

  test('should use custom compiler executable when configured', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })

    const recipe = {
      '.build-raptor.json': JSON.stringify({
        repoProtocol: {
          compilerExecutable: 'fake-tsc',
        },
      }),
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': `export const x = 1`,
      // Create a fake compiler that outputs a marker, creates expected outputs, and exits successfully
      'node_modules/.bin/fake-tsc': [
        '#!/bin/bash',
        'echo "CUSTOM_COMPILER_EXECUTABLE_WAS_INVOKED"',
        'echo "Arguments: $@"',
        '# Create the expected dist directory for each module passed as argument',
        'for arg in "$@"; do',
        '  if [[ "$arg" != "--build" && -d "$arg" ]]; then',
        '    mkdir -p "$arg/dist"',
        '  fi',
        'done',
        'exit 0',
      ].join('\n'),
    }

    const fork = await driver.repo(recipe).fork()
    fork.file('node_modules/.bin/fake-tsc').chmod(0o755)

    const run = await fork.run('OK', { taskKind: 'build' })
    const output = await run.outputOf('build', 'a')

    expect(output).toEqual(expect.arrayContaining([expect.stringContaining('CUSTOM_COMPILER_EXECUTABLE_WAS_INVOKED')]))
  })
})
