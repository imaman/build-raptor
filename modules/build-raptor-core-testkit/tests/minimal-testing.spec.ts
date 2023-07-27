import { Driver } from '../src/driver'
import { RepoProtocolTestkit } from '../src/repo-protocol-testkit'

jest.setTimeout(30000)
describe('minimal testing', () => {
  const testName = () => expect.getState().currentTestName

  test('runs only the tests of units whose code changed', async () => {
    const driver = new Driver(testName())
    const recipe = {
      '.gitignore': 'o',
      'package.json': { private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/a/myfile': 'foo',
      'modules/b/package.json': {
        name: 'b',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/b/myfile': 'boo',
      'modules/c/package.json': {
        name: 'c',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/c/myfile': 'goo',
    }

    const fork = await driver.repo(recipe).fork()

    await fork.run('OK')
    expect(await fork.file('modules/a/o').lines()).toEqual(['foo'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boo'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo'])

    await fork.file('modules/a/myfile').write('zen')
    await fork.run('OK')
    expect(await fork.file('modules/a/o').lines()).toEqual(['foozen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boo'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo'])

    await fork.file('modules/b/myfile').write('pen')
    await fork.run('OK')
    expect(await fork.file('modules/a/o').lines()).toEqual(['foozen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boopen'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo'])

    await fork.file('modules/c/myfile').write('jen')
    await fork.run('OK')
    expect(await fork.file('modules/a/o').lines()).toEqual(['foozen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boopen'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goojen'])
  })
  test.skip('when code of a dependency changes, the tests of its dependents do run', async () => {
    const driver = new Driver(testName())
    const recipe = {
      '.gitignore': 'o',
      'package.json': { private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        dependencies: { b: '1.0.0' },
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/a/myfile': 'foo',
      'modules/b/package.json': {
        name: 'b',
        version: '1.0.0',
        dependencies: { c: '1.0.0' },
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/b/myfile': 'boo',
      'modules/c/package.json': {
        name: 'c',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/c/myfile': 'goo',
    }
    const fork = await driver.repo(recipe).fork()
    await fork.run('OK')

    await fork.file('modules/a/myfile').write('_zen')
    await fork.run('OK')
    expect(await fork.file('modules/a/o').lines()).toEqual(['foo_zen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boo'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo'])

    await fork.file('modules/b/myfile').write('_pen')
    await fork.run('OK')
    expect(await fork.file('modules/a/o').lines()).toEqual(['foo_zen_zen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boo_pen'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo'])

    await fork.file('modules/c/myfile').write('_jen')
    await fork.run('OK')
    expect(await fork.file('modules/a/o').lines()).toEqual(['foo_zen_zen_zen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boo_pen_pen'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo_jen'])
  })
  test('when code of a unit changes, does not run test of units which do not depend on it', async () => {
    const driver = new Driver(testName())
    const recipe = {
      '.gitignore': 'o',
      'package.json': { private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        dependencies: { b: '1.0.0' },
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/a/myfile': 'foo\n',
      'modules/b/package.json': {
        name: 'b',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/b/myfile': 'boo\n',
      'modules/c/package.json': {
        name: 'c',
        version: '1.0.0',
        dependencies: { b: '1.0.0' },
        scripts: { build: 'exit 0', test: 'cat myfile >> o' },
      },
      'modules/c/myfile': 'goo\n',
    }

    const fork = await driver.repo(recipe).fork()
    await fork.run('OK')

    await fork.file('modules/a/myfile').write('zen\n')
    await fork.run('OK')

    expect(await fork.file('modules/a/o').lines()).toEqual(['foo', 'zen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boo'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo'])

    await fork.file('modules/b/myfile').write('pen\n')
    await fork.run('OK')

    expect(await fork.file('modules/a/o').lines()).toEqual(['foo', 'zen', 'zen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boo', 'pen'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo', 'goo'])

    await fork.file('modules/c/myfile').write('jen\n')
    await fork.run('OK')

    expect(await fork.file('modules/a/o').lines()).toEqual(['foo', 'zen', 'zen'])
    expect(await fork.file('modules/b/o').lines()).toEqual(['boo', 'pen'])
    expect(await fork.file('modules/c/o').lines()).toEqual(['goo', 'goo', 'jen'])
  })
  test('does not run test if build failed', async () => {
    const protocol = new RepoProtocolTestkit({
      xyz: [],
    })
    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = {
      'xyz/somefile': '',
    }

    const fork = await driver.repo(recipe).fork()

    expect(protocol.countOf('xyz', 'build')).toEqual(0)
    expect(protocol.countOf('xyz', 'test')).toEqual(0)

    await fork.run('OK')
    expect(protocol.countOf('xyz', 'build')).toEqual(1)
    expect(protocol.countOf('xyz', 'test')).toEqual(1)

    protocol.setTaskResult('xyz', 'build', 'FAIL')
    await fork.file('xyz/somefile').write('foo') // Just so that the fingerprint will change.
    await fork.run('FAIL')
    expect(protocol.countOf('xyz', 'build')).toEqual(2)
    expect(protocol.countOf('xyz', 'test')).toEqual(1)
  })
  test('when a task fails due to short-circuiting, the root-cause for this failure is reported', async () => {
    const protocol = new RepoProtocolTestkit({
      xyz: [],
    })
    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = {
      'xyz/somefile': '',
    }

    const fork = await driver.repo(recipe).fork()

    protocol.setTaskResult('xyz', 'build', 'FAIL')
    const r = await fork.run('FAIL')

    expect(r.getSummary('xyz', 'build').rootCause).toBe(undefined)
    expect(r.getSummary('xyz', 'test').rootCause).toEqual('xyz:build')
  })
  // test('error propagation', async () => {
  //   const protocol = new RepoProtocolTestkit(
  //     {
  //       a: [],
  //       b: ['a'],
  //     },
  //     {
  //       inUnit: {
  //         test: ['build'],
  //       },
  //       onDeps: {
  //         build: ['build'],
  //         test: ['test'],
  //       },
  //     },
  //   )
  //   const driver = new Driver(testName(), { repoProtocol: protocol.create() })
  //   const recipe = {
  //     'a/somefile': '',
  //     'b/somefile': '',
  //   }

  //   const fork = await driver.repo(recipe).fork()

  //   await fork.run('OK')
  //   expect(protocol.countOf('a', 'build')).toEqual(1)
  //   expect(protocol.countOf('a', 'test')).toEqual(1)
  //   expect(protocol.countOf('b', 'build')).toEqual(1)
  //   expect(protocol.countOf('b', 'test')).toEqual(1)

  //   protocol.setTaskResult('a', 'test', 'FAIL')
  //   await fork.file('a/somefile').write('foo') // Just so that the fingerprint will change.

  //   await fork.run('FAIL')
  //   expect(protocol.countOf('a', 'build')).toEqual(2)
  //   expect(protocol.countOf('a', 'test')).toEqual(2)
  //   expect(protocol.countOf('b', 'build')).toEqual(2)
  //   expect(protocol.countOf('b', 'test')).toEqual(1)
  // })
})
