import { PathInRepo } from 'core-types'

import { Driver } from '../src/driver'
import { SimpleNodeRepoProtocol } from '../src/simple-node-repo-protocol'

jest.setTimeout(30000)

describe('config file resolution', () => {
  const testName = () => expect.getState().currentTestName

  describe('.build-raptor.jsonc', () => {
    test('uses .build-raptor.jsonc when it exists', async () => {
      const driver = new Driver(testName(), {
        repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')),
      })
      const recipe = {
        'package.json': { private: true, workspaces: ['modules/*'] },
        '.gitignore': '.build-raptor\n.custom-json5-out',
        '.build-raptor.jsonc': `{
          // This is a comment - JSON5 allows comments
          outDirName: ".custom-json5-out",
        }`,
        'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0' } },
      }

      const fork = await driver.repo(recipe).fork()
      const r = await fork.run('OK', { taskKind: 'build', checkGitIgnore: true })
      expect(r.exitCode).toEqual(0)
      // If the config wasn't applied, the build would fail because .custom-json5-out wouldn't be in .gitignore check
    })

    test('parses JSON5 with trailing commas', async () => {
      const driver = new Driver(testName(), {
        repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')),
      })
      const recipe = {
        'package.json': { private: true, workspaces: ['modules/*'] },
        '.gitignore': '.build-raptor\n.trailing-comma-out',
        '.build-raptor.jsonc': `{
          "outDirName": ".trailing-comma-out",
        }`,
        'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0' } },
      }

      const fork = await driver.repo(recipe).fork()
      const r = await fork.run('OK', { taskKind: 'build', checkGitIgnore: true })
      expect(r.exitCode).toEqual(0)
    })

    test('parses JSON5 with unquoted keys', async () => {
      const driver = new Driver(testName(), {
        repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')),
      })
      const recipe = {
        'package.json': { private: true, workspaces: ['modules/*'] },
        '.gitignore': '.build-raptor\n.unquoted-out',
        '.build-raptor.jsonc': `{
          outDirName: ".unquoted-out"
        }`,
        'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0' } },
      }

      const fork = await driver.repo(recipe).fork()
      const r = await fork.run('OK', { taskKind: 'build', checkGitIgnore: true })
      expect(r.exitCode).toEqual(0)
    })
  })

  describe('.build-raptor.json', () => {
    test('uses .build-raptor.json when it exists', async () => {
      const driver = new Driver(testName(), {
        repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')),
      })
      const recipe = {
        'package.json': { private: true, workspaces: ['modules/*'] },
        '.gitignore': '.build-raptor\n.custom-json-out',
        '.build-raptor.json': { outDirName: '.custom-json-out' },
        'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0' } },
      }

      const fork = await driver.repo(recipe).fork()
      const r = await fork.run('OK', { taskKind: 'build', checkGitIgnore: true })
      expect(r.exitCode).toEqual(0)
    })
  })

  describe('conflict detection', () => {
    test('fails when both build-raptor.json5 and .build-raptor.json exist', async () => {
      const driver = new Driver(testName(), {
        repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')),
      })
      const recipe = {
        'package.json': { private: true, workspaces: ['modules/*'] },
        '.gitignore': '.build-raptor',
        '.build-raptor.jsonc': `{ outDirName: ".from-json5" }`,
        '.build-raptor.json': { outDirName: '.from-json' },
        'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0' } },
      }

      const fork = await driver.repo(recipe).fork()
      await expect(fork.run('CRASH', { taskKind: 'build' })).rejects.toThrow(
        "Both 'build-raptor.json5' and '.build-raptor.json' exist. Please remove one of them.",
      )
    })
  })
})
