import { NopAssetPublisher } from 'build-raptor-core'
import { Driver } from 'build-raptor-core-testkit'
import { createNopLogger } from 'logger'

import { YarnRepoProtocol } from '../src/yarn-repo-protocol'

jest.setTimeout(120000)
describe('yarn-repo-protocol.e2e', () => {
  const logger = createNopLogger()

  function newYarnRepoProtocol() {
    return new YarnRepoProtocol(logger, new NopAssetPublisher())
  }
  const testName = () => expect.getState().currentTestName

  test('runs jest when testing', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/times-two.ts': 'export function timesTwo(n: number) { return n * 2 }',
      'modules/a/tests/times-two.spec.ts': `
        import {timesTwo} from '../src/times-two'
        test('timesTwo', () => { expect(timesTwo(6)).toEqual(12) })
      `,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([
        'PASS dist/tests/times-two.spec.js',
        'Test Suites: 1 passed, 1 total',
        'Tests:       1 passed, 1 total',
      ]),
    )
  })
  test('supports the importing of *.json files', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': `import * as z from './z.json'; export const a = () => z.z1 + z.z2`,
      'modules/a/src/z.json': { z1: 'foo', z2: 'boo' },
      'modules/a/tests/a.spec.ts': `import {a} from '../src/a'; test('a', () => expect(a()).toEqual('x'))`,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })
    expect(await run.outputOf('test', 'a')).toEqual(expect.arrayContaining([`    Received: \"fooboo\"`]))
  })
  test('can run code that imports code from another package', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', ['b']),
      'modules/a/src/a.ts': `
        import {b} from 'b'
        export function a(n: number) { return b(n)+2 }`,
      'modules/a/tests/a.spec.ts': `
        import {a} from '../src/a'
        test('a', () => { expect(a(7)).toEqual(703) })
      `,
      'modules/b/package.json': driver.packageJson('b'),
      'modules/b/src/index.ts': `export function b(n: number) { return n*100 }`,
      'modules/b/tests/b.spec.ts': `import {b} from '../src'; test('b', () => {expect(b(2)).toEqual(200)})`,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })

    expect(await run.outputOf('test', 'a')).toEqual(expect.arrayContaining(['    Expected: 703', '    Received: 702']))
  })
  test('when the test fails, the task output includes the failure message produced by jest', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/times-two.ts': 'export function timesTwo(n: number) { return n * 2 }',
      'modules/a/tests/times-two.spec.ts': `
        import {timesTwo} from '../src/times-two'
        test('timesTwo', () => { expect(timesTwo(6)).toEqual(-12) })
      `,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('FAIL', { taskKind: 'test' })
    expect(await run.outputOf('test', 'a')).toEqual(
      expect.arrayContaining([
        'FAIL dist/tests/times-two.spec.js',
        '    Expected: -12',
        '    Received: 12',
        'Tests:       1 failed, 1 total',
      ]),
    )
  })

  test('runs tasks and captures their output', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': '// something',
      'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)}); console.log('the quick BROWN fox'); `,
    }

    const fork = await driver.repo(recipe).fork()

    const run = await fork.run('OK', { taskKind: 'test' })
    expect(await run.outputOf('test', 'a')).toContain('    the quick BROWN fox')
  })

  test('reruns tests when the source code changes', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/times-two.ts': 'export function timesTwo(n: number) { return n * 3 }',
      'modules/a/tests/times-two.spec.ts': `
        import {timesTwo} from '../src/times-two'
        test('timesTwo', () => { expect(timesTwo(216)).toEqual(432) })
      `,
    }

    const fork = await driver.repo(recipe).fork()

    const runA = await fork.run('FAIL', { taskKind: 'test' })
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runA.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(await runA.outputOf('test', 'a')).toContain('    Received: 648')

    await fork.file('modules/a/src/times-two.ts').write('export function timesTwo(n: number) { return n * 2 }')
    const runB = await fork.run('OK', { taskKind: 'test' })
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runB.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(await runB.outputOf('test', 'a')).toContain('PASS dist/tests/times-two.spec.js')
  })
  test('does not run tests when test code of a dependnecy changes', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      // This behavior is controlled by a switch
      '.build-raptor.json': { tightFingerprints: true },
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', ['b']),
      'modules/a/src/index.ts': `
        import {b} from 'b'
        export function a(n: number) { return '<' + b(n) + '>' }`,
      'modules/a/tests/a.spec.ts': `
        import {a} from '../src'
        test('a', () => { expect(a(100)).toEqual('<_100_>') })
      `,
      'modules/b/package.json': driver.packageJson('b'),
      'modules/b/src/index.ts': `export function b(n: number) { return '_' + n + '_' }`,
      'modules/b/tests/b.spec.ts': `
        import {b} from '../src'
        test('b', () => { expect(b(200)).toEqual('_200_') })
      `,
    }

    const fork = await driver.repo(recipe).fork()

    const runA = await fork.run('OK', { taskKind: 'test' })
    expect(runA.getSummary('a', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runA.getSummary('a', 'test')).toMatchObject({ execution: 'EXECUTED' })
    expect(runA.getSummary('b', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runA.getSummary('b', 'test')).toMatchObject({ execution: 'EXECUTED' })

    await fork.file('modules/b/tests/b.spec.ts').write(`
        import {b} from '../src'
        test('b', () => { expect(b(222)).toEqual('_222_') })
      `)

    const runB = await fork.run('OK', { taskKind: 'test' })
    expect(runB.getSummary('a', 'build')).toMatchObject({ execution: 'CACHED' })
    expect(runB.getSummary('a', 'test')).toMatchObject({ execution: 'CACHED' })
    expect(runB.getSummary('b', 'build')).toMatchObject({ execution: 'EXECUTED' })
    expect(runB.getSummary('b', 'test')).toMatchObject({ execution: 'EXECUTED' })
  })
  test('if nothing has changed the tasks are cached', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a', ['b']),
      'modules/a/src/a.ts': `
        import {b} from 'b'
        export function a(n: number) { return b(n)+2 }`,
      'modules/a/tests/a.spec.ts': `
        import {a} from '../src/a'
        test('a', () => { expect(a(7)).toEqual(702) })
      `,
      'modules/b/package.json': driver.packageJson('b'),
      'modules/b/src/index.ts': `export function b(n: number) { return n*100 }`,
      'modules/b/tests/b.spec.ts': `import {b} from '../src'; test('b', () => {expect(b(2)).toEqual(200)})`,
    }

    const fork = await driver.repo(recipe).fork()

    const run1 = await fork.run('OK', { taskKind: 'test' })
    expect(await run1.outputOf('test', 'a')).toContain('PASS dist/tests/a.spec.js')
    expect(run1.executionTypeOf('a', 'test')).toEqual('EXECUTED')
    expect(run1.executionTypeOf('b', 'test')).toEqual('EXECUTED')

    const run2 = await fork.run('OK', { taskKind: 'test' })
    expect(await run2.outputOf('test', 'a')).toEqual([])
    expect(run2.executionTypeOf('a', 'test')).toEqual('CACHED')
    expect(run2.executionTypeOf('b', 'test')).toEqual('CACHED')

    const run3 = await fork.run('OK', { taskKind: 'test' })
    expect(await run3.outputOf('test', 'a')).toEqual([])
    expect(run3.executionTypeOf('a', 'test')).toEqual('CACHED')
    expect(run3.executionTypeOf('b', 'test')).toEqual('CACHED')

    const run4 = await fork.run('OK', { taskKind: 'test' })
    expect(await run4.outputOf('test', 'a')).toEqual([])
    expect(run4.executionTypeOf('a', 'test')).toEqual('CACHED')
    expect(run4.executionTypeOf('b', 'test')).toEqual('CACHED')
  })
  test(`a module is rebuilt when the module's package.json file changes`, async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': `export function a(n: number) { return n * 333 }`,
      'modules/a/tests/a.spec.ts': `test('a', () => { expect(1).toEqual(1) })`,
    }

    const fork = await driver.repo(recipe).fork()

    const run1 = await fork.run('OK', { taskKind: 'build' })
    expect(run1.executionTypeOf('a', 'build')).toEqual('EXECUTED')

    const run2 = await fork.run('OK', { taskKind: 'build' })
    expect(run2.executionTypeOf('a', 'build')).toEqual('CACHED')

    await fork.file('modules/a/src/b.ts').write('export function goo() {}')
    const run25 = await fork.run('OK', { taskKind: 'build' })
    expect(run25.executionTypeOf('a', 'build')).toEqual('EXECUTED')

    await fork.file('modules/a/package.json').write(driver.packageJson('a', [], { foo: '# nothing' }))
    const run3 = await fork.run('OK', { taskKind: 'build' })
    expect(run3.executionTypeOf('a', 'build')).toEqual('EXECUTED')
  })
  test('all modules are rebuilt when yarn.lock file changes', async () => {
    const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
    const recipe = {
      // turn install off because the install task is already depending on yarn.lock
      '.build-raptor.json': { repoProtocol: { install: 'off' } },
      'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
      'yarn.lock': '# abc',
      'modules/a/package.json': driver.packageJson('a'),
      'modules/a/src/a.ts': `export function a() { }`,
      'modules/a/tests/a.spec.ts': ``,
    }

    const fork = await driver.repo(recipe).fork()

    const run1 = await fork.run('OK', { taskKind: 'build' })
    expect(run1.executionTypeOf('a', 'build')).toEqual('EXECUTED')

    await fork.file('yarn.lock').write('# xyz')
    const run2 = await fork.run('OK', { taskKind: 'build' })
    expect(run2.executionTypeOf('a', 'build')).toEqual('EXECUTED')

    await fork.file('yarn.lock').write('# abc')
    const run3 = await fork.run('OK', { taskKind: 'build' })
    expect(run3.executionTypeOf('a', 'build')).toEqual('CACHED')
  })
  describe('custom build tasks', () => {
    test('is defined in the package.json file', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, { 'do-abc': `echo "pretzels" > .out/p` }),
          buildTasks: {
            'do-abc': {
              labels: ['build'],
              inputs: [],
              outputs: ['.out/p'],
            },
          },
        },
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()

      await fork.run('OK', { taskKind: 'build', subKind: 'do-abc' })
      expect(await fork.file('modules/a/.out/p').lines()).toEqual(['pretzels'])
    })
    test('emits a build error if the buildTask object (the package.json file) is not well formed', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, { 'do-abc': `#` }),
          buildTasks: {
            'do-abc': {
              inputs: [],
              outputs: 555,
            },
          },
        },
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()

      const run = await fork.run('FAIL', { taskKind: 'build', subKind: 'do-abc' })
      expect(run.message).toContain(`found a buildTasks object (in modules/a/package.json) which is not well formed`)
    })
    test('emits a build error if there is a task definition without a matching run script', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, { 'do-abc': `#` }),
          buildTasks: {
            'do-xyz': {
              inputs: [],
              outputs: [],
            },
          },
        },
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()

      const run = await fork.run('FAIL', { taskKind: 'build', subKind: 'do-abc' })
      expect(run.message).toContain(
        `found a build task named "do-xyz" but no run script with that name is defined in modules/a/package.json`,
      )
    })
    test('runs dependencies before running the custom task', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, {
            'do-abc': `echo "pretzels" > .out/lower`,
            'do-xyz': `cat .out/lower | tr [:lower:] [:upper:] > .out/upper`,
          }),
          buildTasks: {
            'do-abc': {
              labels: ['build'],
              inputs: [],
              outputs: ['.out/lower'],
            },
            'do-xyz': {
              labels: ['build'],
              inputs: ['.out/lower'],
              outputs: ['.out/upper'],
            },
          },
        },
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()

      await fork.run('OK', { taskKind: 'build', subKind: 'do-xyz' })
      expect(await fork.file('modules/a/.out/lower').lines()).toEqual(['pretzels'])
      expect(await fork.file('modules/a/.out/upper').lines()).toEqual(['PRETZELS'])
    })
    test(`if a the inputs attribute is set to '_ALWAYS_' the task will always run`, async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, {
            'do-kramer': `echo "pretzels" > .out/k`,
          }),
          buildTasks: {
            'do-kramer': {
              labels: 'build',
              inputs: '_ALWAYS_',
              outputs: '.out/k',
            },
          },
        },
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()

      const run1 = await fork.run('OK', { taskKind: 'build' })
      expect(run1.taskNames('EXECUTED')).toEqual(['a:build', 'a:build:do-kramer'])

      const run2 = await fork.run('OK', { taskKind: 'build' })
      expect(run2.taskNames('EXECUTED')).toEqual(['a:build:do-kramer'])
    })
  })
  describe('out dir', () => {
    test('the name of the created outdir is taken from the config file', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        '.build-raptor.json': {
          outDirName: 'asdfg',
        },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
        'modules/b/package.json': driver.packageJson('b'),
        'modules/b/src/b.ts': '// something',
        'modules/b/tests/b.spec.ts': `test('b', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()

      expect(await fork.file('modules/a/asdfg').exists()).toBe(false)
      expect(await fork.file('modules/b/asdfg').exists()).toBe(false)
      await fork.run('OK', { taskKind: 'build' })
      expect(await fork.file('modules/a/asdfg').exists()).toBe(true)
      expect(await fork.file('modules/b/asdfg').exists()).toBe(true)
    })
  })
  describe('labels', () => {
    test('runs only the tasks that match the given labels', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, {
            'do-kramer': `echo "pretzels" > .out/kramer`,
            'do-george': `echo "marine biologist" > .out/george`,
          }),
          buildTasks: {
            'do-kramer': {
              inputs: [],
              outputs: ['.out/kramer'],
              labels: ['k', 'seinfeld'],
            },
            'do-george': {
              inputs: [],
              outputs: ['.out/george'],
              labels: ['g', 'seinfeld'],
            },
          },
        },
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()
      const outGeorge = fork.file('modules/a/.out/george')
      const outKramer = fork.file('modules/a/.out/kramer')

      await fork.run('OK', { taskKind: 'build', labels: ['g'] })
      expect(await outGeorge.lines()).toEqual(['marine biologist'])
      expect(await outKramer.lines()).toBeUndefined()

      await fork.file('modules/a/.out').rm()
      await fork.run('OK', { taskKind: 'build', labels: ['k'] })
      expect(await outGeorge.lines()).toBeUndefined()
      expect(await outKramer.lines()).toEqual(['pretzels'])

      await fork.file('modules/a/.out').rm()
      await fork.run('OK', { taskKind: 'build', labels: ['seinfeld'] })
      expect(await outGeorge.lines()).toEqual(['marine biologist'])
      expect(await outKramer.lines()).toEqual(['pretzels'])
    })
    test('empty list of labels means "none", a non empty list means "at-least-1"', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, {
            'do-kramer': `echo "pretzels" > .out/kramer`,
            'do-george': `echo "marine biologist" > .out/george`,
          }),
          buildTasks: {
            'do-kramer': {
              inputs: [],
              outputs: ['.out/kramer'],
              labels: ['k', 'seinfeld'],
            },
            'do-george': {
              inputs: [],
              outputs: ['.out/george'],
              labels: ['g', 'seinfeld'],
            },
          },
        },
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()
      const outGeorge = fork.file('modules/a/.out/george')
      const outKramer = fork.file('modules/a/.out/kramer')

      await fork.run('OK', { taskKind: 'build', labels: ['k', 'g'] })
      expect(await outGeorge.lines()).toEqual(['marine biologist'])
      expect(await outKramer.lines()).toEqual(['pretzels'])

      await fork.file('modules/a/.out').rm()
      await fork.run('OK', { taskKind: 'build', labels: [] })
      expect(await outGeorge.lines()).toBeUndefined()
      expect(await outKramer.lines()).toBeUndefined()
    })
    test('a task with an empty list of labels cannot be matched by a label', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, {
            'do-kramer': `echo "pretzels" > .out/kramer`,
          }),
          buildTasks: {
            'do-kramer': {
              inputs: [],
              outputs: ['.out/kramer'],
              labels: [],
            },
          },
        },
        'modules/a/src/a.ts': '// something',
        'modules/a/tests/a.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()
      await fork.run('OK', { taskKind: 'build', labels: ['a1'] })
      expect(await fork.file('modules/a/.out/kramer').lines()).toEqual(undefined)
    })
    test.todo('invokes a task without a matching label if it is needed by a task that does have a matching label')
    test.todo('input files from root dir')
    test.todo('a special input which means "always"')
    test.todo('globs in inputs/allow to say "all source files"')
    test.todo('consolidate prepare-assets into build with label')
  })
  describe('goals', () => {
    test('when a goal is specified runs only the tasks that are needed to produce this goal', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': {
          ...driver.packageJson('a', undefined, {
            'do-abc': `echo "the sea was" > .out/marine-biologist`,
          }),
          buildTasks: {
            'do-abc': {
              inputs: [],
              outputs: ['.out/marine-biologist'],
            },
          },
        },
        'modules/a/src/index.ts': '// something-a',
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
        'modules/b/package.json': {
          ...driver.packageJson('b', undefined, {
            'do-abc': `echo "angry that day, my friends" > .out/marine-biologist`,
          }),
          buildTasks: {
            'do-abc': {
              inputs: [],
              outputs: ['.out/marine-biologist'],
            },
          },
        },
        'modules/b/src/index.ts': '// something-b',
        'modules/b/tests/index.spec.ts': `test('b', () => {expect(1).toEqual(1)});`,
      }

      const fork1 = await driver.repo(recipe).fork()
      await fork1.run('OK', { goals: ['modules/a/.out/marine-biologist'] })
      expect(await fork1.file('modules/a/.out/marine-biologist').lines()).toContain('the sea was')
      expect(await fork1.file('modules/b/.out/marine-biologist').lines()).toBe(undefined)

      const fork2 = await driver.repo(recipe).fork()
      await fork2.run('OK', { goals: ['modules/b/.out/marine-biologist'] })
      expect(await fork2.file('modules/a/.out/marine-biologist').lines()).toBe(undefined)
      expect(await fork2.file('modules/b/.out/marine-biologist').lines()).toContain('angry that day, my friends')
    })
    test('a goal can specify multiple tasks if it points to an ancestor direcory of the outputs of multiple tasks', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/index.ts': '// something-a',
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
        'modules/b/package.json': driver.packageJson('b'),
        'modules/b/src/index.ts': '// something-b',
        'modules/b/tests/index.spec.ts': `test('b', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()
      const run1 = await fork.run('OK', { goals: ['modules/a/dist'] })
      expect(run1.taskNames()).toEqual(['a:build'])

      const run2 = await fork.run('OK', { goals: ['modules/a'] })
      expect(run2.taskNames()).toEqual(['a:build', 'a:pack', 'a:test'])

      const run3 = await fork.run('OK', { goals: ['modules'] })
      expect(run3.taskNames()).toEqual(['a:build', 'a:pack', 'a:test', 'b:build', 'b:pack', 'b:test'])
    })
    test('filters the goal-prescribed task(s) with the given labels', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/index.ts': '// something-a',
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()
      const run1 = await fork.run('OK', { goals: ['modules/a'], labels: ['build'] })
      expect(run1.taskNames()).toEqual(['a:build'])

      const run2 = await fork.run('OK', { goals: ['modules/a'], labels: ['build', 'pack'] })
      expect(run2.taskNames()).toEqual(['a:build', 'a:pack'])

      const run3 = await fork.run('FAIL', { goals: ['modules/a'], labels: ['foo'] })
      expect(run3.message).toEqual('No task that matches the given goals/labels was found')
    })
    test('fails with a build error when no task is found for a goal', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/index.ts': '// something-a',
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()
      const run = await fork.run('FAIL', { goals: ['modules/a/.out/mulligatawny'] })
      expect(run.message).toEqual(`no task found for goal "modules/a/.out/mulligatawny"`)
    })
    test('the goal is interepreted as relative path from the user directory (cwd)', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/index.ts': '// something-a',
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()
      const run = await fork.run('OK', { userDir: 'modules/a', goals: ['dist/src'] })
      expect(run.executionTypeOf('a', 'build')).toEqual('EXECUTED')
      expect(run.taskNames()).toEqual(['a:build'])
    })
    test('the goal can be a relative path that climbs up', async () => {
      const driver = new Driver(testName(), { repoProtocol: newYarnRepoProtocol() })
      const recipe = {
        'package.json': { name: 'foo', private: true, workspaces: ['modules/*'] },
        'modules/a/package.json': driver.packageJson('a'),
        'modules/a/src/index.ts': '// something-a',
        'modules/a/tests/index.spec.ts': `test('a', () => {expect(1).toEqual(1)});`,
        'modules/b/src/index.ts': '// something-b',
        'modules/b/tests/index.spec.ts': `test('b', () => {expect(1).toEqual(1)});`,
      }

      const fork = await driver.repo(recipe).fork()
      const run = await fork.run('OK', { userDir: 'modules/b', goals: ['../a/dist/src'] })
      expect(run.executionTypeOf('a', 'build')).toEqual('EXECUTED')
      expect(run.taskNames()).toEqual(['a:build'])
    })
  })
})
