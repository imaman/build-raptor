import { PathInRepo } from 'core-types'
import { TaskName } from 'task-name'

import { TaskOutputRegistry, UpdateableTaskOutputRegistry } from '../src/updatable-task-output-registry.js'

describe('updatable-task-output-registry', () => {
  const add = (reg: UpdateableTaskOutputRegistry, taskName: string, pathInRepo: string) => {
    reg.add(TaskName().parse(taskName), PathInRepo(pathInRepo))
  }

  const lookup = (reg: TaskOutputRegistry, pathInRepo: string) => reg.lookup(PathInRepo(pathInRepo))
  const wideLookup = (reg: TaskOutputRegistry, pathInRepo: string) => reg.wideLookup(PathInRepo(pathInRepo))

  describe('lookup', () => {
    test('returns the task name that generates the given output path', () => {
      const reg = new UpdateableTaskOutputRegistry()
      add(reg, 'a:build:x', 'modules/a/out-dir/x')
      add(reg, 'a:build:y', 'modules/a/out-dir/y')
      add(reg, 'a:build:z', 'modules/a/out-dir/z')
      expect(lookup(reg, 'modules/a/out-dir/x')).toEqual('a:build:x')
      expect(lookup(reg, 'modules/a/out-dir/y')).toEqual('a:build:y')
      expect(lookup(reg, 'modules/a/out-dir/z')).toEqual('a:build:z')
    })
    test('returns undefined if no task was found', () => {
      const reg = new UpdateableTaskOutputRegistry()

      expect(lookup(reg, 'modules/a/out-dir/x')).toBeUndefined()
      add(reg, 'a:build:x', 'modules/a/out-dir/x')
      expect(lookup(reg, 'modules/a/out-dir/x')).toEqual('a:build:x')
      expect(lookup(reg, 'modules/a/out-dir/y')).toBeUndefined()
    })
    test(`can return the right task name even if the path is a (deep) sub-directory of the tasks's output location`, () => {
      const reg = new UpdateableTaskOutputRegistry()

      add(reg, 'luke:skywalker', 'some/out-dir')
      add(reg, 'han:solo', 'a/different/out-dir')
      expect(lookup(reg, 'some/out-dir/starwars')).toEqual('luke:skywalker')
      expect(lookup(reg, 'some/out-dir/the-empire-strikes-back')).toEqual('luke:skywalker')
      expect(lookup(reg, 'a/different/out-dir/starwars')).toEqual('han:solo')
      expect(lookup(reg, 'a/different/out-dir/the-empire-strikes-back')).toEqual('han:solo')
    })
  })
  describe('wideLookup', () => {
    test('returns the list of tasks that produce outputs under the given path', () => {
      const reg = new UpdateableTaskOutputRegistry()

      add(reg, 'luke:skywalker', 'a/w/x')
      add(reg, 'han:solo', 'a/w/y')
      add(reg, 'obi-wan:kenobi', 'a/u/y')
      expect(wideLookup(reg, 'a/w')).toEqual(['han:solo', 'luke:skywalker'])
      expect(wideLookup(reg, 'a/u')).toEqual(['obi-wan:kenobi'])
      expect(wideLookup(reg, 'a')).toEqual(['han:solo', 'luke:skywalker', 'obi-wan:kenobi'])
    })
    test(`just like lookup(), returns a single task if the path is (deep) sub-directory of a task's output location`, () => {
      const reg = new UpdateableTaskOutputRegistry()

      add(reg, 'luke:skywalker', 'a/w/x')
      add(reg, 'han:solo', 'a/w/y')
      add(reg, 'obi-wan:kenobi', 'a/u/y')
      expect(wideLookup(reg, 'a/w')).toEqual(['han:solo', 'luke:skywalker'])
      expect(wideLookup(reg, 'a/u')).toEqual(['obi-wan:kenobi'])
      expect(wideLookup(reg, 'a')).toEqual(['han:solo', 'luke:skywalker', 'obi-wan:kenobi'])
    })
  })
})
