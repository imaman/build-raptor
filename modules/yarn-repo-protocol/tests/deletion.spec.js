import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(60000)
describe('deletion', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName

  test('deletes dist/src/*.{js,d.ts} files that do not have a matching *.ts file under src/', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': 'export function a() {}',
      'modules/a/tests/a.spec.ts': '//',
    }

    const fork = await driver.repo(recipe).fork()

    const xjs = fork.file('modules/a/dist/src/x.js')
    const xdts = fork.file('modules/a/dist/src/x.d.ts')

    await Promise.all([xjs.write('//'), xdts.write('//')])
    expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([true, true])
    await fork.run('OK', { taskKind: 'build' })
    expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([false, false])

    await Promise.all([xjs.write('//'), xdts.write('//')])
    expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([true, true])
    await fork.run('OK', { taskKind: 'build' })
    expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([false, false])
  })
  test('does not delete dist/src/*.{js,d.ts} files that have a matching *.tsx file under src/', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.tsx': 'export function a() {}',
      'modules/a/tests/a.spec.ts': '//',
    }

    const fork = await driver.repo(recipe).fork()

    const ajs = fork.file('modules/a/dist/src/a.js')
    const adts = fork.file('modules/a/dist/src/a.d.ts')

    await fork.run('OK', { taskKind: 'build' })
    expect(await Promise.all([ajs.exists(), adts.exists()])).toEqual([true, true])
  })
  test('deletes dist/tests/*.{js,d.ts} files that do not have a matching *.ts file under tests/', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': 'export function a() {}',
      'modules/a/tests/a.spec.ts': '//',
    }

    const fork = await driver.repo(recipe).fork()

    const xjs = fork.file('modules/a/dist/tests/x.js')
    const xdts = fork.file('modules/a/dist/tests/x.d.ts')

    await Promise.all([xjs.write('//'), xdts.write('//')])
    expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([true, true])
    await fork.run('OK', { taskKind: 'build' })
    expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([false, false])

    await Promise.all([xjs.write('//'), xdts.write('//')])
    expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([true, true])
    await fork.run('OK', { taskKind: 'build' })
    expect(await Promise.all([xjs.exists(), xdts.exists()])).toEqual([false, false])
  })
})
