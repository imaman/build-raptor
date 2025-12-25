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
        '.gitignore': '.build-raptor\nbest-output-dir',
        'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0' } },
      }

      const fork = await driver.repo(recipe).fork()
      const r = await fork.run('FAIL', { taskKind: 'build', checkGitIgnore: true })
      expect(r.message).toMatch('the out dir (.out) should be .gitignore-d')

      await fork.file('.build-raptor.jsonc').write(`{
          // This is a comment - a .jsonc file allows it!
          "outDirName": "best-output-dir",
        }`)

      // Now it should succeed because of the .jsonc config file we just created.
      await fork.run('OK', { taskKind: 'build', checkGitIgnore: true })
    })
    test('when the .jsonc file is parsed a certain level of syntax conformance is enfroced', async () => {
      const driver = new Driver(testName(), {
        repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')),
      })
      const recipe = {
        'package.json': { private: true, workspaces: ['modules/*'] },
        '.build-raptor.jsonc': `{
        //}`, // <-- closing curly-braces are intentionally commented out to make the file syntactically broken
        '.gitignore': '.build-raptor\ndist',
        'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0' } },
      }

      const fork = await driver.repo(recipe).fork()
      await expect(fork.run('CRASH', { taskKind: 'build', checkGitIgnore: true })).rejects.toThrow(
        'Bad format: CloseBraceExpected at position 13',
      )
    })

    test('parses .jsonc with trailing commas', async () => {
      const driver = new Driver(testName(), {
        repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')),
      })
      const recipe = {
        'package.json': { private: true, workspaces: ['modules/*'] },
        '.gitignore': '.build-raptor\nmy-out-dir',
        '.build-raptor.jsonc': `{
          "outDirName": "my-out-dir",
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
        'Found competing config files: ".build-raptor.jsonc", ".build-raptor.json". To avoid confusion, you must keep just one.',
      )
    })
  })
})
