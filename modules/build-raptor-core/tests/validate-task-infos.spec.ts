import { TaskName } from 'task-name'

import { OutputLocation, TaskInfo } from '../src/task-info'
import { validateTaskInfos } from '../src/validate-task-infos'

function locs(arr: string[]): OutputLocation[] {
  return arr.map(at => ({
    pathInPackage: at,
    purge: 'BEFORE_RESTORE',
  }))
}

describe('validate-task-infos', () => {
  const base = { deps: [], inputsInDeps: [], inputsInUnit: [], shadowing: false }
  test('an empty list of task-info is always allowed', () => {
    const input: TaskInfo[] = []
    expect(validateTaskInfos(input)).toBeTruthy()
  })
  describe('task name collision', () => {
    test('yells on two (or more) tasks with the same name', () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('u:k'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('u:k'), outputLocations: locs(['boo']) },
        { ...base, taskName: TaskName().parse('u:j'), outputLocations: locs(['too']) },
        { ...base, taskName: TaskName().parse('u:k'), outputLocations: locs(['goo']) },
      ]
      expect(() => validateTaskInfos(input)).toThrowError(`Task name collison: u:k (3 occurences)`)
    })
    test('does allow tasks with different kinds in the same unit', () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('u:k'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('u:j'), outputLocations: locs(['too']) },
      ]
      expect(validateTaskInfos(input)).toBeTruthy()
    })
  })
  describe('output collision', () => {
    test('allows two tasks to declare the same output location if they are in different units', () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('a:T_1'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('b:T_1'), outputLocations: locs(['foo']) },
      ]
      expect(validateTaskInfos(input)).toBeTruthy()
    })
    test('allows multiple tasks in the same unit as long as the output locations are distinct', () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('a:T_1'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('a:T_2'), outputLocations: locs(['boo']) },
        { ...base, taskName: TaskName().parse('a:T_3'), outputLocations: locs(['goo']) },
        { ...base, taskName: TaskName().parse('a:T_4'), outputLocations: locs(['zoo']) },
      ]
      expect(validateTaskInfos(input)).toBeTruthy()
    })
    test('yells on two tasks in the same unit which decalre the same output location', () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('a:T_1'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('a:T_2'), outputLocations: locs(['bar']) },
        { ...base, taskName: TaskName().parse('a:T_3'), outputLocations: locs(['foo']) },
      ]
      expect(() => validateTaskInfos(input)).toThrowError(
        `Output collison: tasks a:T_1, a:T_3 both declare output 'foo'`,
      )
    })
    test(`yells on two tasks in the same unit if one of them outputs to a sub-directory which is under the other's output directory`, () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('a:T_1'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('a:T_2'), outputLocations: locs(['bar/too/zoo']) },
        { ...base, taskName: TaskName().parse('a:T_3'), outputLocations: locs(['goo']) },
        { ...base, taskName: TaskName().parse('a:T_4'), outputLocations: locs(['bar']) },
      ]
      expect(() => validateTaskInfos(input)).toThrowError(
        `Output collison: tasks a:T_2, a:T_4 both declare output 'bar'`,
      )
    })
  })
  test.todo('every input is the output of some other task?')
})
