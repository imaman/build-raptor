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
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
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

  const build = [
    'mkdir -p dist/src dist/tests',
    `cat src/*.ts | tr '[:upper:]' '[:lower:]' > dist/src/index.js`,
    `cat tests/*.spec.ts | tr '[:upper:]' '[:lower:]' > dist/tests/index.spec.js`,
    `echo "build finished"`,
  ].join(' && ')

  const jest = [`cat dist/src/index.js dist/tests/index.spec.js`, `echo '{}' > jest-output.json`].join(' && ')

  test('reruns tests when the source code changes', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build, jest } },
      'modules/a/src/a.ts': 'N/A',
      'modules/a/tests/a.spec.ts': 'TUESDAY',
    }

    const fork = await driver.repo(recipe).fork()

    await fork.file('modules/a/src/a.ts').write('SUNDAY')
    const runA = await fork.run('OK', { taskKind: 'test' })
    expect(await fork.file('modules/a/dist/src/index.js').lines({ trimEach: true })).toEqual(['sunday'])
    expect(await fork.file('modules/a/dist/tests/index.spec.js').lines({ trimEach: true })).toEqual(['tuesday'])
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runA.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(await runA.outputOf('test', 'a')).toContain('sundaytuesday')

    await fork.file('modules/a/src/a.ts').write('MONDAY')
    const runB = await fork.run('OK', { taskKind: 'test' })
    expect(await fork.file('modules/a/dist/src/index.js').lines({ trimEach: true })).toEqual(['monday'])
    expect(await fork.file('modules/a/dist/tests/index.spec.js').lines({ trimEach: true })).toEqual(['tuesday'])
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runB.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(await runB.outputOf('test', 'a')).toContain('mondaytuesday')
  })
  test.skip('capture', async () => {
    const driver = new Driver(testName(), { repoProtocol: new YarnRepoProtocol(logger) })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build, jest } },
      'modules/a/src/a.ts': 'N/A',
      'modules/a/tests/a.spec.ts': 'TUESDAY',
    }

    const fork = await driver.repo(recipe).fork()

    await fork.file('modules/a/src/a.ts').write('SUNDAY')
    const runA = await fork.run('OK', { taskKind: 'test' })
    expect(await fork.file('modules/a/dist/src/index.js').lines({ trimEach: true })).toEqual(['sunday'])
    expect(await fork.file('modules/a/dist/tests/index.spec.js').lines({ trimEach: true })).toEqual(['tuesday'])
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runA.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(await runA.outputOf('test', 'a')).toContain('sundaytuesday')

    await fork.file('modules/a/src/a.ts').write('MONDAY')
    const runB = await fork.run('OK', { taskKind: 'test' })
    expect(await fork.file('modules/a/dist/src/index.js').lines({ trimEach: true })).toEqual(['monday'])
    expect(await fork.file('modules/a/dist/tests/index.spec.js').lines({ trimEach: true })).toEqual(['tuesday'])
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runB.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(await runB.outputOf('test', 'a')).toContain('mondaytuesday')
  })
})
