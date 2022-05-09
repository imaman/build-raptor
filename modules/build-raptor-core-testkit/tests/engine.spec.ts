import { aTimeoutOf, Graph, Key, StorageClient } from 'misc'
import { CatalogOfTasks, ExitStatus, RepoProtocol } from 'repo-protocol'
import { TaskKind } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { Driver } from './driver'
import { RepoProtocolTestkit } from './repo-protocol-testkit'
import { SimpleNodeRepoProtocol } from './simple-node-repo-protocol'

class FailingStorageClient implements StorageClient {
  putObject(_key: Key, _content: string): Promise<void> {
    throw new Error('putObject() is intentionally failing')
  }
  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  async getObject(_key: Key, _type: 'string' | 'buffer' = 'string'): Promise<string | Buffer> {
    throw new Error('getObject() is intentionally failing')
  }
  objectExists(_key: Key): Promise<boolean> {
    throw new Error('objectExists() is intentionally failing')
  }
}

jest.setTimeout(30000)
describe('engine', () => {
  const testName = () => expect.getState().currentTestName

  test('runs the build and test tasks of a package and captures their output', async () => {
    const driver = new Driver(testName())
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
          build: 'echo "building now"',
          test: 'echo "testing now"',
        },
      },
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK')
    expect(await run.outputOf('build', 'a')).toEqual(['building now'])
    expect(await run.outputOf('test', 'a')).toEqual(['testing now'])
  })
  test('recycles the repo-protocol passed to it by close()-ing it', async () => {
    let n = -1
    const g: Graph<UnitId> = new Graph<UnitId>(x => x)
    const units: UnitMetadata[] = []

    const rp: RepoProtocol = {
      initialize(): Promise<void> {
        ++n
        const s = `a${n}`
        units.push(new UnitMetadata(s, UnitId(s)))
        g.vertex(UnitId(s))
        return Promise.resolve()
      },
      execute(): Promise<ExitStatus> {
        return Promise.resolve('OK')
      },
      getGraph(): Promise<Graph<UnitId>> {
        return Promise.resolve(g)
      },
      getUnits(): Promise<UnitMetadata[]> {
        return Promise.resolve(units)
      },
      getTasks(): Promise<CatalogOfTasks> {
        return Promise.resolve({
          inUnit: {},
          onDeps: { x: 'x' },
        })
      },
      close(): Promise<void> {
        n = -1
        units.length = 0
        return Promise.resolve()
      },
    }
    const driver = new Driver(testName(), { repoProtocol: rp })
    const fork = await driver
      .repo({
        'a0/somefile': 'some content',
      })
      .fork()

    expect(await fork.run('OK')).toBeDefined()
    expect(await fork.run('OK')).toBeDefined()
  })
  test('returns an exit code of 2 if a task has failed', async () => {
    const driver = new Driver(testName())
    const fork = await driver
      .repo({
        'package.json': {
          private: true,
          workspaces: ['modules/*'],
        },
        'modules/a/package.json': {
          name: 'a',
          version: '1.0.0',
          scripts: {
            build: 'echo "building now"',
            test: 'exit 100',
          },
        },
      })
      .fork()

    const run = await fork.run('FAIL')
    expect(run.exitCode).toEqual(2)
  })
  test('returns an exit code of 2 even if just one task has failed', async () => {
    const driver = new Driver(testName())
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'exit 0' },
      },
      'modules/b/package.json': {
        name: 'b',
        version: '1.0.0',
        scripts: { build: 'exit 1', test: 'exit 0' },
      },
      'modules/c/package.json': {
        name: 'c',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'exit 0' },
      },
    }
    const fork1 = await driver.repo(recipe).fork()

    const run1 = await fork1.run('FAIL')
    expect(run1.exitCode).toEqual(2)

    recipe['modules/b/package.json'].scripts.build = 'exit 0'
    const fork2 = await driver.repo(recipe).fork()
    const run2 = await fork2.run('OK')
    expect(run2.exitCode).toEqual(0)
  })
  test('returns an exit code of 1 if the build crashed', async () => {
    const failingDriver = new Driver(testName(), { storageClient: new FailingStorageClient() })
    const fork = await failingDriver
      .repo({
        'package.json': { private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': { name: 'a', version: '1.0.0' },
      })
      .fork()
    const run = await fork.run('CRASH')
    expect(run.exitCode).toEqual(1)
  })
  test('reports the happened-before relationship between tasks', async () => {
    const protocol = new RepoProtocolTestkit({ a: ['b'], b: [] })

    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 'a/f': '', 'b/f': '' }

    const fork = await driver.repo(recipe).fork()
    const r1 = await fork.run('OK')
    expect(r1.happened('b', 'build', 'b', 'test')).toEqual('BEFORE')
    expect(r1.happened('b', 'test', 'b', 'build')).toEqual('AFTER')

    expect(r1.happened('a', 'build', 'a', 'test')).toEqual('BEFORE')
    expect(r1.happened('a', 'test', 'a', 'build')).toEqual('AFTER')

    expect(r1.happened('a', 'build', 'b', 'build')).toEqual('AFTER')
    expect(r1.happened('b', 'build', 'a', 'build')).toEqual('BEFORE')

    expect(r1.happened('b', 'build', 'a', 'test')).toEqual('BEFORE')
    expect(r1.happened('a', 'test', 'b', 'build')).toEqual('AFTER')
  })
  test('builds only the units that were specified', async () => {
    const driver = new Driver(testName())
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': {
        name: 'a',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'echo "A" > o' },
      },
      'modules/b/package.json': {
        name: 'b',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'echo "B" > o' },
      },
      'modules/c/package.json': {
        name: 'c',
        version: '1.0.0',
        scripts: { build: 'exit 0', test: 'echo "C" > o' },
      },
    }

    const fork = await driver.repo(recipe).fork()

    await fork.run('OK', { units: ['a', 'c'] })
    expect(await fork.file('modules/a/o').lines()).toEqual(['A'])
    expect(await fork.file('modules/b/o').lines()).toBeUndefined()
    expect(await fork.file('modules/c/o').lines()).toEqual(['C'])
  })
  test('builds only the units and tasks that were specified', async () => {
    const protocol = new RepoProtocolTestkit({
      a: [],
      b: [],
    })
    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 'a/somefile': '', 'b/somefile': '' }

    const fork = await driver.repo(recipe).fork()

    const r1 = await fork.run('OK', { taskKind: 'build', units: [] })
    expect(protocol.countOf('a', 'build', r1)).toEqual(1)
    expect(protocol.countOf('a', 'test', r1)).toEqual(0)
    expect(protocol.countOf('b', 'build', r1)).toEqual(1)
    expect(protocol.countOf('b', 'test', r1)).toEqual(0)

    const r2 = await fork.run('OK', { taskKind: 'test', units: [] })
    expect(protocol.countOf('a', 'build', r2)).toEqual(0)
    expect(protocol.countOf('a', 'test', r2)).toEqual(1)
    expect(protocol.countOf('b', 'build', r2)).toEqual(0)
    expect(protocol.countOf('b', 'test', r2)).toEqual(1)
  })
  test('the build fails if the requested unit does not exist', async () => {
    const protocol = new RepoProtocolTestkit({
      a: [],
      b: [],
    })
    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 'a/somefile': '', 'b/somefile': '' }

    const fork = await driver.repo(recipe).fork()

    const r1 = await fork.run('FAIL', { units: ['c'] })
    expect(r1.message).toMatch(/^No tasks to run in this build/)
  })
  test('build output recording', async () => {
    const driver = new Driver(testName(), { repoProtocol: new SimpleNodeRepoProtocol('modules', ['dist']) })
    const recipe = {
      '.gitignore': 'dist',
      'modules/a/package.json': {
        name: 'a',
        scripts: {
          build: 'mkdir dist && echo "building..." && echo "GENERATED-BY-THE-BUILD-SCRIPT" > dist/out',
          // Intentionally fail the test, so that a re-run will invoke it.
          test: 'echo ">#>#>" && cat dist/out && exit 1',
        },
      },
    }

    const fork1 = await driver.repo(recipe).fork()
    const run1 = await fork1.run('FAIL')
    expect(await run1.outputOf('build', 'a')).toEqual(['building...'])
    expect(await run1.outputOf('test', 'a')).toEqual(['>#>#>', 'GENERATED-BY-THE-BUILD-SCRIPT'])

    const fork2 = await driver.repo(recipe).fork()
    const run2 = await fork2.run('FAIL')
    // Expect an empty output because the build task succeeded in the earlier run.
    expect(await run2.outputOf('build', 'a')).toEqual([])
    expect(await run2.outputOf('test', 'a')).toEqual(['>#>#>', 'GENERATED-BY-THE-BUILD-SCRIPT'])
  })
  test('generates a performance report', async () => {
    const protocol = new RepoProtocolTestkit({
      s: ['a', 'b', 'c'],
      a: [],
      b: [],
      c: [],
    })
    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 's/somefile': '', 'a/somefile': '', 'b/somefile': '', 'c/somefile': '' }

    const fork = await driver.repo(recipe).fork()
    const r = await fork.run('OK')
    expect(r.performanceReport?.numExecuted).toEqual(8)
    expect(r.performanceReport?.maxUsedConcurrency).toBeGreaterThanOrEqual(3)
    expect(r.performanceReport?.usedConcurrencyLevles).toContain(3)
    expect(r.performanceReport?.usedConcurrencyLevles).toHaveLength(8)
  })
  test('respects the specified concurrency level', async () => {
    const protocol = new RepoProtocolTestkit({
      s: ['a', 'b', 'c'],
      a: [],
      b: [],
      c: [],
    })
    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 's/somefile': '', 'a/somefile': '', 'b/somefile': '', 'c/somefile': '' }

    const fork = await driver.repo(recipe).fork()

    const r1 = await fork.run('OK', { concurrencyLevel: 1 })
    expect(r1.performanceReport?.maxUsedConcurrency).toEqual(1)

    const r2 = await fork.run('OK', { concurrencyLevel: 2 })
    expect(r2.performanceReport?.maxUsedConcurrency).toEqual(2)

    const r3 = await fork.run('OK', { concurrencyLevel: 3 })
    expect(r3.performanceReport?.maxUsedConcurrency).toEqual(3)
  })
  test('purges the output location before running a task', async () => {
    const driver = new Driver(testName(), {
      repoProtocol: new SimpleNodeRepoProtocol('modules', ['build-out', 'bin']),
    })
    const recipe = {
      '.gitignore': 'build-out\nbin',
      'modules/a/package.json': {
        name: 'a',
        scripts: {
          build: 'mkdir build-out; touch bin; cat bin > build-out/copy-of-bin',
          test: 'exit 0',
        },
      },
      'modules/a/bin': 'the force awakens',
      'modules/a/build-out/copy-of-bin': 'the return of the jedi',
    }

    const fork = await driver.repo(recipe).fork()

    const copyOfBin = fork.file('modules/a/build-out/copy-of-bin')
    expect(await copyOfBin.lines()).toEqual(['the return of the jedi'])
    await fork.run('OK')
    expect(await copyOfBin.lines()).toEqual([''])
  })
  test('the build fails if the graph is cyclic', async () => {
    const protocol = new RepoProtocolTestkit({
      s: ['a'],
      a: ['b'],
      b: ['c'],
      c: ['s'],
    })
    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 's/somefile': '', 'a/somefile': '', 'b/somefile': '', 'c/somefile': '' }

    const fork = await driver.repo(recipe).fork()

    const r1 = await fork.run('FAIL')
    expect(r1.message).toMatch(/^Cyclic dependency detected/)
  })
  test('the build fails if the .build-raptor directory is not ignored (controlled by a flag)', async () => {
    const driver = new Driver(testName(), { repoProtocol: new SimpleNodeRepoProtocol('modules') })
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0', test: 'exit 0' } },
    }

    const fork = await driver.repo(recipe).fork()
    const r1 = await fork.run('FAIL', { checkGitIgnore: true })
    expect(r1.message).toMatch(/^the .build-raptor directory should be .gitignore-d/)

    await fork.run('OK', { checkGitIgnore: false })
  })
  test('yells if a task fails to generate one of its declared outputs', async () => {
    const protocol = new RepoProtocolTestkit(
      { a: [] },
      {
        tasks: [
          { taskKind: TaskKind('T_1'), outputs: ['foo'] },
          { taskKind: TaskKind('T_2'), outputs: ['bar'] },
        ],
      },
    )

    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 'a/foo': '', 'a/bar': '' }

    const fork = await driver.repo(recipe).fork()

    protocol.setTaskOutputs('a:T_1', { foo: 'f.o.o' })
    const r1 = await fork.run('FAIL')
    expect(r1.message).toEqual('Task a:T_2 failed to produce the following outputs:\n  - bar')
  })
  describe('shadowing (transitivity)', () => {
    test('a shadowing task is invoked once at least-dependent unit', async () => {
      const protocol = new RepoProtocolTestkit(
        { a: ['b'], b: ['c'], c: [] },
        {
          tasks: [
            { taskKind: TaskKind('build'), shadowing: true },
            { taskKind: TaskKind('test'), shadowing: false },
          ],
          depList: [
            ['a:test', 'a:build'],
            ['b:test', 'b:build'],
            ['c:test', 'c:build'],
          ],
          complete: true,
        },
      )

      const driver = new Driver(testName(), { repoProtocol: protocol.create() })
      const recipe = { 'a/f': '', 'b/f': '', 'c/f': '' }

      const fork = await driver.repo(recipe).fork()
      const r1 = await fork.run('OK')
      expect(protocol.invokedAt(r1)).toEqual(['a:build', 'a:test', 'b:test', 'c:test'])
    })
    test('will not run a shadowing task in a unit that is out of scope', async () => {
      const protocol = new RepoProtocolTestkit(
        { a: ['b'], b: ['c'], c: ['d'], d: ['e'], e: [] },
        { tasks: [{ taskKind: TaskKind('t'), shadowing: true }] },
      )

      const driver = new Driver(testName(), { repoProtocol: protocol.create() })
      const recipe = { 'a/f': '', 'b/f': '', 'c/f': '', 'd/f': '', 'e/f': '' }

      const fork = await driver.repo(recipe).fork()

      await fork.file('e/f').write('1')
      const r1 = await fork.run('OK', { units: ['a'] })
      expect(protocol.invokedAt(r1)).toEqual(['a:t'])

      await fork.file('e/f').write('2')
      const r2 = await fork.run('OK', { units: ['b'] })
      expect(protocol.invokedAt(r2)).toEqual(['b:t'])

      await fork.file('e/f').write('3')
      const r3 = await fork.run('OK', { units: ['c'] })
      expect(protocol.invokedAt(r3)).toEqual(['c:t'])

      await fork.file('e/f').write('4')
      const r4 = await fork.run('OK', { units: ['d'] })
      expect(protocol.invokedAt(r4)).toEqual(['d:t'])

      await fork.file('e/f').write('5')
      const r5 = await fork.run('OK', { units: ['e'] })
      expect(protocol.invokedAt(r5)).toEqual(['e:t'])
    })
    test('invoking at different scopes when the code does not change', async () => {
      const protocol = new RepoProtocolTestkit(
        { a: ['c'], b: ['c'], c: [] },
        { tasks: [{ taskKind: TaskKind('t'), shadowing: true }] },
      )

      const driver = new Driver(testName(), { repoProtocol: protocol.create() })
      const recipe = { 'a/f': '', 'b/f': '', 'c/f': '' }

      const fork = await driver.repo(recipe).fork()

      const r1 = await fork.run('OK', { units: ['c'] })
      expect(protocol.invokedAt(r1)).toEqual(['c:t'])

      const r2 = await fork.run('OK', { units: ['a'] })
      expect(protocol.invokedAt(r2)).toEqual(['a:t'])

      const r3 = await fork.run('OK', { units: ['b'] })
      expect(protocol.invokedAt(r3)).toEqual(['b:t'])
    })
    test.todo(
      'dependents of tasks that were skipped-due-to-transitivity are invoked only after the top-most-task finished',
    )
    test('a failure in the shadowing task is propagagted to the shadowed task', async () => {
      const protocol = new RepoProtocolTestkit(
        { a: ['b'], b: [], c: [] },
        {
          tasks: [{ taskKind: TaskKind('t'), shadowing: true }],
        },
      )

      const driver = new Driver(testName(), { repoProtocol: protocol.create() })
      const recipe = { 'a/f': '', 'b/f': '', 'c/f': '' }

      const fork = await driver.repo(recipe).fork()

      protocol.setTaskResult('a:t', 'FAIL')
      const r = await fork.run('FAIL')
      expect(protocol.invokedAt(r)).toEqual(['a:t', 'c:t'])
      expect(r.getSummary('c', 't')).toMatchObject({ execution: 'EXECUTED', rootCause: undefined, verdict: 'OK' })
      expect(r.getSummary('b', 't')).toMatchObject({ execution: 'CANNOT_START', rootCause: 'a:t', verdict: 'FAIL' })
    })
    test.skip('outputs of shadowed tasks are purged', async () => {
      const protocol = new RepoProtocolTestkit(
        { a: ['b'], b: [] },
        {
          tasks: [{ taskKind: TaskKind('build'), shadowing: true, outputs: ['out'] }],
        },
      )

      const driver = new Driver(testName(), { repoProtocol: protocol.create() })
      const recipe = { 'a/f': '', 'a/out': 'A', 'b/f': '', 'b/out': 'B' }

      const fork = await driver.repo(recipe).fork()

      let captured: Record<string, string[] | string> = {}

      protocol.setTask('a:build', async () => {
        const a = fork.file('a/out')
        const b = fork.file('b/out')
        captured = { a: (await a.lines()) ?? 'NONE', b: (await b.lines()) ?? 'NONE' }
        await a.write('A_1 written by a:build')
        await b.write('B_1 written by a:build')
        return Promise.resolve('OK')
      })
      const r1 = await fork.run('OK')
      expect(protocol.invokedAt(r1)).toEqual(['a:build'])
      expect(await fork.file('b/out').lines()).toEqual(['B_1 written by a:build'])
      expect(captured).toEqual({ a: 'NONE', b: 'NONE' })
    })
    test('correctly restores the output of a shadowed task', async () => {
      const protocol = new RepoProtocolTestkit(
        { a: ['b'], b: [] },
        {
          tasks: [{ taskKind: TaskKind('build'), shadowing: true, outputs: ['out'] }],
        },
      )

      const driver = new Driver(testName(), { repoProtocol: protocol.create() })
      const recipe = { '.gitignore': 'out', 'a/f': '', 'a/out': 'A_0', 'b/f': '', 'b/out': 'B_0' }

      const fork = await driver.repo(recipe).fork()

      protocol.setTask('a:build', async () => {
        await fork.file('a/out').write('A_1')
        await fork.file('b/out').write('B_1')
        return Promise.resolve('OK')
      })
      await fork.run('OK')
      await fork.file('b/out').write('blah blah blah')

      const r = await fork.run('OK', { taskKind: TaskKind('build'), units: ['b'] })
      expect(protocol.invokedAt(r)).toEqual([])
      expect(await fork.file('b/out').lines()).toEqual(['B_1'])
    })
  })

  describe('inputs', () => {
    describe('a task should run after the task that generates its inputs', () => {
      test(`when the input is an exact match on another task's output`, async () => {
        const protocol = new RepoProtocolTestkit(
          { a: [] },
          {
            tasks: [
              { taskKind: TaskKind('x'), inputsInUnit: ['out/oy'], outputs: ['out/ox'] },
              { taskKind: TaskKind('y'), inputsInUnit: [''], outputs: ['out/oy'] },
            ],
          },
        )

        const driver = new Driver(testName(), { repoProtocol: protocol.create() })
        const recipe = { '.gitignore': 'out', 'b/out/oy': 'luke', 'a/out/ox': 'han' }

        const fork = await driver.repo(recipe).fork()
        protocol.setTaskFunction('a:y', async () => {
          await aTimeoutOf(10).hasPassed()
          return { 'out/oy': 'yoda' }
        })
        protocol.setTaskFunction('a:x', inputs => ({ 'out/ox': `<${inputs['out/oy']}>` }))

        await fork.run('OK')
        expect(await fork.file('a/out/ox').lines()).toEqual(['<yoda>'])
      })
      test(`when the input is a sub-directory of another task's output`, async () => {
        const protocol = new RepoProtocolTestkit(
          { a: [] },
          {
            tasks: [
              { taskKind: TaskKind('x'), inputsInUnit: ['out/oy/foo'], outputs: ['out/ox'] },
              { taskKind: TaskKind('y'), inputsInUnit: [''], outputs: ['out/oy'] },
            ],
          },
        )

        const driver = new Driver(testName(), { repoProtocol: protocol.create() })
        const recipe = { '.gitignore': 'out', 'b/out/oy/foo': 'luke', 'b/out/oy/bar': 'leia', 'a/out/ox': 'han' }

        const fork = await driver.repo(recipe).fork()
        protocol.setTaskFunction('a:y', async () => {
          await aTimeoutOf(10).hasPassed()
          return { 'out/oy/foo': 'yoda', 'out/oy/bar': 'ben' }
        })
        protocol.setTaskFunction('a:x', inputs => ({ 'out/ox': `<${inputs['out/oy/foo']}>` }))

        await fork.run('OK')
        expect(await fork.file('a/out/ox').lines()).toEqual(['<yoda>'])
      })
      test('when the other task is in a different unit', async () => {
        const protocol = new RepoProtocolTestkit(
          { a: ['b'], b: [] },
          {
            tasks: [
              { taskKind: TaskKind('x'), inputsInDeps: ['out/f'], outputs: ['out/f'], unitIds: [UnitId('a')] },
              { taskKind: TaskKind('y'), outputs: ['out/f'], unitIds: [UnitId('b')] },
            ],
          },
        )

        const driver = new Driver(testName(), { repoProtocol: protocol.create() })
        const recipe = { '.gitignore': 'out', 'a/out/f': 'luke', 'b/out/f': 'han' }

        const fork = await driver.repo(recipe).fork()
        protocol.setTaskFunction('b:y', async () => {
          await aTimeoutOf(10).hasPassed()
          return { 'out/f': 'yoda' }
        })
        protocol.setTaskFunction('a:x', async () => {
          const c = (await fork.file('b/out/f').lines())?.join('\n')
          return { 'out/f': `<${c}>` }
        })

        await fork.run('OK')
        expect(await fork.file('a/out/f').lines()).toEqual(['<yoda>'])
      })
    })
    test.skip('yells when a task depends on the entire source code of another unit', async () => {
      const protocol = new RepoProtocolTestkit(
        { a: ['b'], b: [] },
        {
          tasks: [
            { taskKind: TaskKind('x'), inputsInDeps: [''], outputs: ['out/f'], unitIds: [UnitId('a')] },
            { taskKind: TaskKind('y'), outputs: ['out/f'], unitIds: [UnitId('b')] },
          ],
        },
      )

      const driver = new Driver(testName(), { repoProtocol: protocol.create() })
      const recipe = { '.gitignore': 'out', 'a/out/f': 'luke', 'b/out/f': 'han' }

      const fork = await driver.repo(recipe).fork()
      const r = await fork.run('FAIL')
      expect(r.message).toEqual(`a task (a:x) cannot declare as its input the source code of another untit (b)`)
    })
    test.skip('should not run tests in dependent when only the tests of a dependency have changed', async () => {
      const build = TaskKind('build')
      const test = TaskKind('test')
      const repoProtocol = new SimpleNodeRepoProtocol('code', undefined, {
        inUnit: {
          [test]: [build],
        },
        onDeps: { [build]: [build] },
        tasks: [
          {
            taskKind: build,
            outputs: ['dist'],
            shadowing: false,
            inputsInUnit: [''],
            inputsInDeps: ['dist/src'],
          },
          {
            taskKind: test,
            outputs: ['dist/words'],
            inputsInUnit: ['dist/tests', 'dist/src'],
            inputsInDeps: ['dist/src'],
          },
        ],
      })
      const driver = new Driver(testName(), { repoProtocol })
      const recipe = {
        '.gitignore': 'dist',
        'code/a/package.json': {
          name: 'a',
          version: '1.0.0',
          dependencies: {
            b: '1.0.0',
          },
          scripts: {
            build: 'rm -rf dist && mkdir -p dist/{src,tests} && cp src/f dist/src/f.o && cp tests/g dist/tests/g.o',
            test: 'wc -w dist/src/f.o dist/tests/g.o > dist/words',
          },
        },
        'code/a/src/f': 'the quick brown fox jumps over ',
        'code/a/tests/g': 'the lazy dog ',
        'code/b/package.json': {
          name: 'b',
          version: '1.0.0',
          scripts: {
            build: 'rm -rf dist && mkdir -p dist/{src,tests} && cp src/f dist/src/f.o && cp tests/g dist/tests/g.o',
            test: 'wc -w dist/src/f.o dist/tests/g.o > dist/words',
          },
        },
        'code/b/src/f': 'it was ',
        'code/b/tests/g': 'the best of times ',
      }

      const fork = await driver.repo(recipe).fork()
      await fork.run('OK')
      expect(await fork.file('code/a/dist/words').lines({ trimEach: true })).toEqual([
        '6 dist/src/f.o',
        '3 dist/tests/g.o',
        '9 total',
      ])
      expect(await fork.file('code/b/dist/words').lines({ trimEach: true })).toEqual([
        '2 dist/src/f.o',
        '4 dist/tests/g.o',
        '6 total',
      ])
      const awords = fork.file('code/a/dist/words')
      const bwords = fork.file('code/b/dist/words')

      const mod1 = { awords: await awords.lastChanged(), bwords: await bwords.lastChanged() }

      await fork.file('code/b/tests/g').write('we were all going direct to Heaven ')
      await fork.run('OK')
      expect(await fork.file('code/a/dist/words').lines({ trimEach: true })).toEqual([
        '6 dist/src/f.o',
        '3 dist/tests/g.o',
        '9 total',
      ])
      expect(await fork.file('code/b/dist/words').lines({ trimEach: true })).toEqual([
        '2 dist/src/f.o',
        '7 dist/tests/g.o',
        '9 total',
      ])

      const mod2 = { awords: await awords.lastChanged(), bwords: await bwords.lastChanged() }

      expect(mod1.bwords).not.toEqual(mod2.bwords)
      expect(mod1.awords).toEqual(mod2.awords)
    })
  })
})
