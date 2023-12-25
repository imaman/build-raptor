import { PathInRepo } from 'core-types'
import { TaskName } from 'task-name'

import { TaskOutputRegistry, UpdateableTaskOutputRegistry } from '../src/updatable-task-output-registry'

describe('updatable-task-output-registry', () => {
  const add = (reg: UpdateableTaskOutputRegistry, taskName: string, pathInRepo: string) => {
    reg.add(TaskName().parse(taskName), PathInRepo(pathInRepo))
  }

  const lookup = (reg: TaskOutputRegistry, pathInRepo: string) => reg.lookup(PathInRepo(pathInRepo))

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
  })
})
