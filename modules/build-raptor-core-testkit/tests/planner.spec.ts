import { TaskKind } from 'task-name'
import { UnitId } from 'unit-metadata'

import { Driver } from '../src/driver'
import { RepoProtocolTestkit } from '../src/repo-protocol-testkit'

jest.setTimeout(30000)
describe('planner', () => {
  const testName = () => expect.getState().currentTestName

  test.todo('inputs in deps should not include the outputs of the defininig task')
  // TODO(imaman): imporve the test.
  test('when a task definition changes, the task will run', async () => {
    const t1 = { taskKind: TaskKind('t1'), outputs: ['R'], inputsInDeps: ['R'], unitIds: [UnitId('a')] }
    const t2 = { taskKind: TaskKind('t2'), outputs: ['S'], inputsInDeps: ['R'], unitIds: [UnitId('a')] }
    const t3 = { taskKind: TaskKind('t3'), outputs: ['R'], inputsInDeps: [], unitIds: [UnitId('b')] }
    const t4 = { taskKind: TaskKind('t4'), outputs: ['S'], inputsInDeps: [], unitIds: [UnitId('b')] }

    const protocol = new RepoProtocolTestkit({ a: ['b'], b: [] }, { tasks: [t1, t2, t3, t4] })
    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { '.gitignore': 'R\nS', 'a/somefile': '', 'b/somefile': '' }

    const fork = await driver.repo(recipe).fork()

    protocol.setTaskOutputs('a:t1', { 'R/t1': 'lorem' })
    protocol.setTaskOutputs('a:t2', { 'S/t2': 'lorem' })
    protocol.setTaskOutputs('b:t3', { 'R/t3': 'lorem' })
    protocol.setTaskOutputs('b:t4', { 'S/t4': 'lorem' })

    const run1 = await fork.run('OK')
    expect(protocol.invokedAt(run1)).toEqual(['a:t1', 'a:t2', 'b:t3', 'b:t4'])

    const run2 = await fork.run('OK')
    expect(protocol.invokedAt(run2)).toEqual([])

    // Make some change in the definition of task t1
    t1.inputsInDeps.push('S')

    protocol.changeCatalog({
      tasks: [t1, t2, t3, t4],
    })

    const run3 = await fork.run('OK')
    expect(protocol.invokedAt(run3)).toEqual(['a:t1'])
  })

  test('tasks can be defined even if mentioned only in the list of tasks in the catalog', async () => {
    const protocol = new RepoProtocolTestkit({ a: ['b'], b: ['c'], c: [] }, { tasks: [{ taskKind: TaskKind('s') }] })

    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 'a/f': '', 'b/f': '', 'c/f': '' }

    const fork = await driver.repo(recipe).fork()
    const r1 = await fork.run('OK')
    expect(protocol.invokedAt(r1)).toEqual(['a:s', 'b:s', 'c:s'])
  })
  test('task definitions can be restricted to certain unit IDs', async () => {
    const protocol = new RepoProtocolTestkit(
      { a: [], b: [], c: [] },
      {
        tasks: [
          {
            taskKind: TaskKind('T_1'),
            unitIds: [UnitId('a'), UnitId('c')],
          },
          {
            taskKind: TaskKind('T_2'),
            unitIds: [UnitId('a'), UnitId('b')],
          },
        ],
      },
    )

    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 'a/f': '', 'b/f': '', 'c/f': '' }

    const fork = await driver.repo(recipe).fork()
    const r1 = await fork.run('OK')
    expect(protocol.invokedAt(r1)).toEqual(['a:T_1', 'a:T_2', 'b:T_2', 'c:T_1'])
  })
  test('yells if two task definitions specify the same output', async () => {
    const protocol = new RepoProtocolTestkit(
      { a: [] },
      {
        tasks: [
          { taskKind: TaskKind('T_1'), outputs: ['foo'] },
          { taskKind: TaskKind('T_2'), outputs: ['bar'] },
          { taskKind: TaskKind('T_3'), outputs: ['foo'] },
        ],
      },
    )

    const driver = new Driver(testName(), { repoProtocol: protocol.create() })
    const recipe = { 'a/foo': '', 'a/bar': '' }

    const fork = await driver.repo(recipe).fork()

    const r1 = await fork.run('FAIL')
    expect(r1.message).toMatch(`Output collision in tasks a:T_3, a:T_3: a/foo`)
  })
  test.todo('outputs need to be .gitignored')
})
