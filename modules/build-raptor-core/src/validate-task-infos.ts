import { BuildFailedError } from 'build-failed-error'
import { failMe, findDups, groupBy, hardGet, recordToPairs, sortBy, threeWaySplit } from 'misc'
import * as path from 'path'
import { TaskName } from 'task-name'
import { UnitId } from 'unit-metadata'

import { TaskInfo } from './task-info'

export function validateTaskInfos(infos: TaskInfo[]): TaskOutputRegistry {
  checkNameCollision(infos)
  const byUnits = groupBy(infos, x => TaskName().undo(x.taskName).unitId)

  const ret = new TaskOutputRegistryImpl()
  for (const [_, infosOfUnit] of recordToPairs(byUnits)) {
    checkOutputCollisions(infosOfUnit, ret)
  }
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
  const taskNameByOutput = new Map<string, TaskName>(
    infos.flatMap(x => x.outputLocations.map(o => [norm(o.pathInRepo), x.taskName])),
  )
  const allLocations = infos.flatMap(x => x.outputLocations).map(x => norm(x.pathInRepo))

  for (const a of allLocations) {
    for (const b of allLocations) {
      if (a === b) {
        continue
      }

      if (a.startsWith(b)) {
        const ta = hardGet(taskNameByOutput, a)
        const tb = hardGet(taskNameByOutput, b)
        throw new BuildFailedError(
          `Output collison: tasks ${ta}, ${tb} have colliding outputs: ${a}, ${b} (respectively)`,
        )
      }
    }
  }

  for (const i of infos) {
    for (const loc of i.outputLocations) {
      const normed = norm(loc.pathInRepo)
      reg.add(i.taskName, normed)
    }
  }
}

export interface TaskOutputRegistry {
  lookup(unitId: UnitId, outputLoc: string): TaskName | undefined
}

class TaskOutputRegistryImpl implements TaskOutputRegistry {
  private readonly map = new Map<string, TaskName>()
  constructor() {}

  add(taskName: TaskName, outputLoc: string) {
    const { unitId } = TaskName().undo(taskName)
    const key = JSON.stringify([unitId, norm(outputLoc)])
    this.map.set(key, taskName)
  }

  lookup(unitId: UnitId, outputLoc: string): TaskName | undefined {
    let normed = norm(outputLoc)

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

const norm = (s: string) =>
  threeWaySplit(
    path.normalize(s),
    () => false,
    c => c === '/',
  ).mid
