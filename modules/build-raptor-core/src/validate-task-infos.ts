import { BuildFailedError } from 'build-failed-error'
import { PathInRepo } from 'core-types'
import { failMe, findDups, groupBy, hardGet, recordToPairs, sortBy } from 'misc'
import * as path from 'path'
import { TaskName } from 'task-name'
import { UnitId } from 'unit-metadata'

import { TaskInfo } from './task-info'

export function validateTaskInfos(infos: TaskInfo[]): TaskOutputRegistry {
  checkNameCollision(infos)

  const ret = new TaskOutputRegistryImpl()
  checkOutputCollisions(infos, ret)
  return ret
}

function checkNameCollision(infos: TaskInfo[]) {
  const dups = findDups(infos, at => at.taskName)
  if (!dups.length) {
    return
  }

  const pairs = recordToPairs(groupBy(dups, at => at.taskName))
  const sorted = sortBy(pairs, ([_, infos]) => -infos.length)
  const highest = sorted[0] || failMe(`list of sorted task infos is unexplainably empty`)

  throw new BuildFailedError(`Task name collison: ${highest[0]} (${highest[1].length} occurences)`)
}

function checkOutputCollisions(infos: TaskInfo[], reg: TaskOutputRegistryImpl) {
  const sorted = sortBy(infos, at => at.taskName)
  const taskNameByOutput = new Map<string, TaskName>()
  for (const info of sorted) {
    for (const loc of info.outputLocations) {
      taskNameByOutput.set(loc.pathInRepo.val, info.taskName)
    }
  }

  const allLocations = sorted.flatMap(x => x.outputLocations.map(x => x.pathInRepo))
  sortBy(allLocations, at => at.val)

  for (let ia = 0; ia < allLocations.length; ++ia) {
    const a = allLocations[ia]
    for (let ib = 0; ib < allLocations.length; ++ib) {
      if (ia === ib) {
        continue
      }
      const b = allLocations[ib]

      if (a.isPrefixOf(b)) {
        const ta = hardGet(taskNameByOutput, a.val)
        const tb = hardGet(taskNameByOutput, b.val)
        throw new BuildFailedError(
          `Output collision in tasks ${ta}, ${tb}: ${a === b ? a : `${a}, ${b} (respectively)`}`,
        )
      }
    }
  }

  for (const i of sorted) {
    for (const loc of i.outputLocations) {
      reg.add(i.taskName, loc.pathInRepo)
    }
  }
}

export interface TaskOutputRegistry {
  lookup(unitId: UnitId, outputLoc: PathInRepo): TaskName | undefined
}

class TaskOutputRegistryImpl implements TaskOutputRegistry {
  private readonly map = new Map<string, TaskName>()
  constructor() {}

  add(taskName: TaskName, outputLoc: PathInRepo) {
    const { unitId } = TaskName().undo(taskName)
    const key = JSON.stringify([unitId, outputLoc.val])
    this.map.set(key, taskName)
  }

  lookup(unitId: UnitId, outputLoc: PathInRepo): TaskName | undefined {
    let normed = outputLoc.val
    while (true) {
      if (normed === '.') {
        return undefined
      }
      const key = JSON.stringify([unitId, normed])
      const tn = this.map.get(key)
      if (tn) {
        return tn
      }
      normed = path.dirname(normed)
    }
  }
}
