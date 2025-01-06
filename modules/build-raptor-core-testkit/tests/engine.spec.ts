import { PathInRepo } from 'core-types'
import { aTimeoutOf, Graph, Key, StorageClient } from 'misc'
import { ExitStatus, RepoProtocol, TaskInfo } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { Driver } from '../src/driver'
import { RepoProtocolTestkit } from '../src/repo-protocol-testkit'
import { SimpleNodeRepoProtocol } from '../src/simple-node-repo-protocol'

class FailingStorageClient implements StorageClient {
  getContentAddressable(_hash: string): Promise<Buffer> {
    throw new Error(`getContentAddressable() is intentionally failing`)
  }
  putContentAddressable(_content: string | Buffer): Promise<string> {
    throw new Error('putContentAddressable() is intentionally failing')
  }

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

  const mod = (folder: string, name: string, scripts: Record<string, string>, dependsOn?: string) => ({
    [`${folder}/${name}/package.json`]: {
      name,
      version: '1.0.0',
      scripts,
      ...(dependsOn ? { dependencies: { [dependsOn]: '1.0.0' } } : {}),
    },
  })

  test('stores build run ID in a file', async () => {
    const driver = new Driver(testName())
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: '#' } },
    }

    const fork = await driver.repo(recipe).fork()
    const run = await fork.run('OK', { taskKind: 'build' })
    expect(await fork.file('.build-raptor/build-run-id').lines()).toEqual([run.buildRunId])
  })
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
      getTasks(): Promise<TaskInfo[]> {
        return Promise.resolve(
          g.vertices().map(g => ({
            taskName: TaskName(g, TaskKind('build')),
            inputs: [],
            outputLocations: [],
          })),
        )
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
  test('generates a step-by-step file', async () => {
    const driver = new Driver(testName(), { repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules'), ['dist']) })
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      ...mod('modules', 'a', { build: 'mkdir -p dist/src && echo "A" > dist/src/a.o' }, 'b'),
      ...mod('modules', 'b', { build: 'mkdir -p dist/src && echo "B" > dist/src/b.o' }),
    }

    const fork = await driver.repo(recipe).fork()

    const { buildRunId } = await fork.run('OK', { taskKind: 'build' })
    const stepByStep = fork.readStepByStepFile()
    expect(stepByStep).toMatchObject([
      { step: 'BUILD_RUN_STARTED', buildRunId },
      { step: 'PLAN_PREPARED' },
      { step: 'TASK_STORE_PUT', taskName: 'b:build', files: ['modules/b/dist'] },
      { step: 'TASK_ENDED', taskName: 'b:build', status: 'OK' },
      { step: 'TASK_STORE_PUT', taskName: 'a:build', files: ['modules/a/dist'] },
      { step: 'TASK_ENDED', taskName: 'a:build', status: 'OK' },
      { step: 'BUILD_RUN_ENDED' },
    ])
  })
  test('the step-by-step file is overwritten at the next build run', async () => {
    const driver = new Driver(testName())
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      ...mod('modules', 'a', { build: 'exit 0', test: 'echo "A" > o' }, 'b'),
      ...mod('modules', 'b', { build: 'exit 0', test: 'echo "B" > o' }),
    }

    const fork = await driver.repo(recipe).fork()

    const r1 = await fork.run('OK', { taskKind: 'build' })
    const steps1 = fork.readStepByStepFile()
    expect(steps1).toMatchObject([
      { step: 'BUILD_RUN_STARTED', buildRunId: r1.buildRunId },
      { step: 'PLAN_PREPARED' },
      { step: 'TASK_STORE_PUT', taskName: 'b:build' },
      { step: 'TASK_ENDED', taskName: 'b:build' },
      { step: 'TASK_STORE_PUT', taskName: 'a:build' },
      { step: 'TASK_ENDED', taskName: 'a:build' },
      { step: 'BUILD_RUN_ENDED' },
    ])

    const r2 = await fork.run('OK', { taskKind: 'build' })
    expect(r2.buildRunId).not.toEqual(r1.buildRunId)
    const steps2 = fork.readStepByStepFile()
    expect(steps2).toMatchObject([
      { step: 'BUILD_RUN_STARTED', buildRunId: r2.buildRunId },
      { step: 'PLAN_PREPARED' },
      { step: 'TASK_STORE_GET', taskName: 'b:build' },
      { step: 'TASK_ENDED', taskName: 'b:build' },
      { step: 'TASK_STORE_GET', taskName: 'a:build' },
      { step: 'TASK_ENDED', taskName: 'a:build' },
      { step: 'BUILD_RUN_ENDED' },
    ])
  })
  test(`TASK_ENDED status reflects task execution result`, async () => {
    const driver = new Driver(testName())
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0', test: 'exit 1' } },
    }

    const fork = await driver.repo(recipe).fork()

    await fork.run('FAIL')
    expect(fork.readStepByStepFile().filter(at => at.step === 'TASK_ENDED')).toMatchObject([
      { step: 'TASK_ENDED', taskName: 'a:build', status: 'OK' },
      { step: 'TASK_ENDED', taskName: 'a:test', status: 'FAILED' },
    ])
  })
  test(`in TASK_ENDED step previously successful tasks get a SKIPPED status`, async () => {
    const driver = new Driver(testName())
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      ...mod('modules', 'a', { build: 'exit 0', test: 'echo "A" > o' }, 'b'),
      ...mod('modules', 'b', { build: 'exit 0', test: 'echo "B" > o' }),
    }

    const fork = await driver.repo(recipe).fork()

    const r1 = await fork.run('OK', { taskKind: 'build' })
    const steps1 = fork.readStepByStepFile()
    expect(steps1.filter(at => at.step === 'TASK_ENDED')).toMatchObject([
      { step: 'TASK_ENDED', taskName: 'b:build', status: 'OK' },
      { step: 'TASK_ENDED', taskName: 'a:build', status: 'OK' },
    ])

    const r2 = await fork.run('OK', { taskKind: 'build' })
    expect(r2.buildRunId).not.toEqual(r1.buildRunId)
    const steps2 = fork.readStepByStepFile()
    expect(steps2.filter(at => at.step === 'TASK_ENDED')).toMatchObject([
      { step: 'TASK_ENDED', taskName: 'b:build', status: 'SKIPPED' },
      { step: 'TASK_ENDED', taskName: 'a:build', status: 'SKIPPED' },
    ])
  })
  test(`taskEnded not emitted when a task cannot run due to failures`, async () => {
    const driver = new Driver(testName(), { repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('here')) })
    const recipe = {
      'package.json': { private: true, workspaces: ['here/*'] },
      ...mod('here', 'a', { build: 'exit 0' }, 'b'),
      ...mod('here', 'b', { build: 'exit 0' }, 'c'),
      ...mod('here', 'c', { build: 'exit 1' }, 'd'),
      ...mod('here', 'd', { build: 'exit 0' }),
    }
    const fork = await driver.repo(recipe).fork()

    await fork.run('FAIL', { taskKind: 'build' })
    expect(fork.readStepByStepFile().filter(at => at.step === 'TASK_ENDED')).toMatchObject([
      { step: 'TASK_ENDED', taskName: 'd:build', status: 'OK' },
      { step: 'TASK_ENDED', taskName: 'c:build', status: 'FAILED' },
    ])
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
    expect(r1.message).toEqual('No task that matches the given goals/labels was found')
  })
  test('build output recording', async () => {
    const repoProtocol = new SimpleNodeRepoProtocol(PathInRepo('modules'), ['dist'], {
      tasks: [
        {
          taskName: TaskName(UnitId('a'), TaskKind('build')),
          inputs: [PathInRepo('modules/a')],
          outputLocations: [{ pathInRepo: PathInRepo('modules/a/dist'), purge: 'ALWAYS' }],
        },
        {
          taskName: TaskName(UnitId('a'), TaskKind('test')),
          inputs: [PathInRepo('modules/a/dist/out')],
        },
      ],
    })
    const driver = new Driver(testName(), { repoProtocol })
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
  test('keeps output location before running a task (so that incremental compilation can work)', async () => {
    const driver = new Driver(testName(), {
      repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules'), ['build-out', 'bin']),
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
    expect(await copyOfBin.lines()).toEqual(['the force awakens'])
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
  test('the build fails if the out dir is not ignored', async () => {
    const driver = new Driver(testName(), { repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')) })
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      '.gitignore': '.build-raptor',
      '.build-raptor.json': { outDirName: '.qwerty' },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0', test: 'exit 0' } },
    }

    const fork = await driver.repo(recipe).fork()
    const r1 = await fork.run('FAIL', { checkGitIgnore: true })
    expect(r1.message).toEqual(`the out dir (.qwerty) should be .gitignore-d`)

    await fork.file('.gitignore').write('.build-raptor\n.qwerty')
    await fork.run('OK', { checkGitIgnore: true })
  })
  test('the build fails if the .build-raptor directory is not ignored (controlled by a flag)', async () => {
    const driver = new Driver(testName(), { repoProtocol: new SimpleNodeRepoProtocol(PathInRepo('modules')) })
    const recipe = {
      'package.json': { private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': { name: 'a', version: '1.0.0', scripts: { build: 'exit 0', test: 'exit 0' } },
    }

    const fork = await driver.repo(recipe).fork()
    const r1 = await fork.run('FAIL', { checkGitIgnore: true })
    expect(r1.message).toMatch(/^the .build-raptor directory should be .gitignore-d/)

    await fork.run('OK', { checkGitIgnore: false })
  })
  describe('inputs', () => {
    describe('a task should run after the task that generates its inputs', () => {
      test(`when the input is an exact match on another task's output`, async () => {
        const protocol = new RepoProtocolTestkit(
          { a: [] },
          {
            taskDefs: [
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
            taskDefs: [
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
            taskDefs: [
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
          taskDefs: [
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
      const repoProtocol = new SimpleNodeRepoProtocol(PathInRepo('code'), undefined, {
        tasks: [
          {
            taskName: TaskName().parse('a:build'),
            inputs: [PathInRepo('code/a'), PathInRepo('code/b/dist/src')],
            outputLocations: [{ pathInRepo: PathInRepo('code/a/dist'), purge: 'ALWAYS' }],
          },
          {
            taskName: TaskName().parse('a:test'),
            inputs: [PathInRepo('code/a/dist/tests'), PathInRepo('code/a/dist/src'), PathInRepo('code/b/dist/src')],
            outputLocations: [{ pathInRepo: PathInRepo('code/a/dist/words'), purge: 'ALWAYS' }],
          },
          {
            taskName: TaskName().parse('b:build'),
            inputs: [PathInRepo('code/b')],
            outputLocations: [{ pathInRepo: PathInRepo('code/b/dist'), purge: 'ALWAYS' }],
          },
          {
            taskName: TaskName().parse('b:test'),
            inputs: [PathInRepo('code/b/dist/tests'), PathInRepo('code/b/dist/src')],
            outputLocations: [{ pathInRepo: PathInRepo('code/b/dist/words'), purge: 'ALWAYS' }],
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
