import { PathInRepo } from 'core-types'
import { OutputLocation, TaskInfo } from 'repo-protocol'
import { TaskName } from 'task-name'

import { validateTaskInfos } from '../src/validate-task-infos.js'

function locs(arr: string[]): OutputLocation[] {
  return arr.map(at => ({
    pathInRepo: PathInRepo(at),
    purge: 'NEVER',
  }))
}

describe('validate-task-infos', () => {
  const base = { deps: [], inputsInDeps: [], inputsInUnit: [] }
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
      expect(() => validateTaskInfos(input)).toThrowError(`Task name collison: u:k (3 occurrences)`)
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
    test('allows multiple tasks in the same unit as long as the output locations are distinct', () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('a:T_1'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('a:T_2'), outputLocations: locs(['boo']) },
        { ...base, taskName: TaskName().parse('a:T_3'), outputLocations: locs(['goo']) },
        { ...base, taskName: TaskName().parse('a:T_4'), outputLocations: locs(['zoo']) },
      ]
      expect(validateTaskInfos(input)).toBeTruthy()
    })
    test('yells on two tasks which declare the same output location', () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('a:T_1'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('a:T_2'), outputLocations: locs(['bar']) },
        { ...base, taskName: TaskName().parse('a:T_3'), outputLocations: locs(['foo']) },
      ]
      expect(() => validateTaskInfos(input)).toThrowError(`Output collision in tasks a:T_3, a:T_3: foo`)
    })
    test(`yells on two tasks in the same unit if one of them outputs to a sub-directory which is under the other's output directory`, () => {
      const input: TaskInfo[] = [
        { ...base, taskName: TaskName().parse('a:T_1'), outputLocations: locs(['foo']) },
        { ...base, taskName: TaskName().parse('a:T_2'), outputLocations: locs(['bar/too/zoo']) },
        { ...base, taskName: TaskName().parse('a:T_3'), outputLocations: locs(['goo']) },
        { ...base, taskName: TaskName().parse('a:T_4'), outputLocations: locs(['bar']) },
      ]
      expect(() => validateTaskInfos(input)).toThrowError(
        `Output collision in tasks a:T_4, a:T_2: bar, bar/too/zoo (respectively)`,
      )
    })
  })
  test.todo('every input is the output of some other task?')
})
