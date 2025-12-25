import { BuildFailedError } from 'build-failed-error'
import { failMe, findDups, groupBy, hardGet, recordToPairs, sortBy } from 'misc'
import { TaskInfo } from 'repo-protocol'
import { TaskName } from 'task-name'

import { TaskOutputRegistry, UpdateableTaskOutputRegistry } from './updatable-task-output-registry.js'

export function validateTaskInfos(infos: TaskInfo[]): TaskOutputRegistry {
  checkNameCollision(infos)

  const ret = new UpdateableTaskOutputRegistry()
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

  throw new BuildFailedError(`Task name collison: ${highest[0]} (${highest[1].length} occurrences)`)
}

function checkOutputCollisions(infos: TaskInfo[], reg: UpdateableTaskOutputRegistry) {
  const sorted = sortBy(infos, at => at.taskName)
  const taskNameByOutput = new Map<string, TaskName>()
  for (const info of sorted) {
    for (const loc of info.outputLocations ?? []) {
      taskNameByOutput.set(loc.pathInRepo.val, info.taskName)
    }
  }

  const allLocations = sorted.flatMap(x => (x.outputLocations ?? []).map(x => x.pathInRepo))
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
    for (const loc of i.outputLocations ?? []) {
      reg.add(i.taskName, loc.pathInRepo)
    }
  }
}
