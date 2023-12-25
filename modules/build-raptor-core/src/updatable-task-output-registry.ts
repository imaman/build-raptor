import { PathInRepo } from 'core-types'
import * as path from 'path'
import { TaskName } from 'task-name'

export interface TaskOutputRegistry {
  lookup(outputLoc: PathInRepo): TaskName | undefined
  wideLookup(outputLoc: PathInRepo): TaskName[]
}

export class UpdateableTaskOutputRegistry implements TaskOutputRegistry {
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

  wideLookup(outputLoc: PathInRepo): TaskName[] {
    const temp = this.lookup(outputLoc)
    if (temp) {
      return [temp]
    }

    const ret: TaskName[] = []
    for (const [loc, tn] of this.map.entries()) {
      const pir = PathInRepo(loc)
      if (outputLoc.isPrefixOf(pir)) {
        ret.push(tn)
      }
    }

    return ret.sort()
  }
}
