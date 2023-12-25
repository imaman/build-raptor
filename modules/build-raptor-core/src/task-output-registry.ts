import { PathInRepo } from 'core-types'
import * as path from 'path'
import { TaskName } from 'task-name'

export interface TaskOutputRegistry {
  lookup(outputLoc: PathInRepo): TaskName | undefined
}

export interface UpdateableTaskOutputRegistry extends TaskOutputRegistry {
  add(taskName: TaskName, outputLoc: PathInRepo): void
}

export function createTaskOutputRegistry() {
  return new TaskOutputRegistryImpl()
}

class TaskOutputRegistryImpl implements UpdateableTaskOutputRegistry {
  private readonly map = new Map<string, TaskName>()
  constructor() {}

  add(taskName: TaskName, outputLoc: PathInRepo) {
    this.map.set(outputLoc.val, taskName)
  }

  lookup(outputLoc: PathInRepo): TaskName | undefined {
    let normed = outputLoc.val
    while (true) {
      if (normed === '.') {
        return undefined
      }
      const tn = this.map.get(normed)
      if (tn) {
        return tn
      }
      normed = path.dirname(normed)
    }
  }
}
