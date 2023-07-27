import { Graph, uniqueBy } from 'misc'
import { OutputLocation, TaskInfo } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { TaskDefinition } from './task-definition'
export class TaskInfoGenerator {
  computeInfos(defs: readonly TaskDefinition[] | undefined, units: UnitMetadata[], graph: Graph<UnitId>) {
    const kinds = this.collectKinds(defs)
    const ret: TaskInfo[] = []
    for (const unit of units) {
      for (const k of kinds) {
        const info = this.generateInfo(unit, k, graph, defs)
        if (info) {
          ret.push(info)
        }
      }
    }
    return ret
  }

  private collectKinds(defs?: readonly TaskDefinition[]) {
    const kinds = (defs ?? []).map(td => td.taskKind)
    return uniqueBy(kinds, x => x)
  }

  private generateInfo(
    unit: UnitMetadata,
    t: TaskKind,
    graph: Graph<UnitId>,
    defs?: readonly TaskDefinition[],
  ): TaskInfo | undefined {
    const taskName = TaskName(unit.id, t)
    const definition = this.findDefinition(taskName, defs)

    if (definition === 'NONE') {
      return undefined
    }

    const deps: TaskName[] = []
    if (definition === 'DEFAULT') {
      const ret: TaskInfo = {
        taskName,
        deps,
        outputLocations: [],
        inputsInDeps: [''],
        inputsInUnit: [''],
      }

      return ret
    }

    const outputLocations: OutputLocation[] = (definition?.outputs ?? []).map(at => {
      if (typeof at === 'string') {
        return { pathInRepo: unit.pathInRepo.expand(at), purge: 'NEVER' }
      }

      return {
        pathInRepo: unit.pathInRepo.expand(at.pathInUnit),
        purge: at.purge,
      }
    })

    const ret: TaskInfo = {
      taskName,
      deps,
      outputLocations,
      inputsInDeps: definition.inputsInDeps ?? [''],
      inputsInUnit: definition.inputsInUnit ?? [''],
    }

    return ret
  }

  private findDefinition(taskName: TaskName, defs?: readonly TaskDefinition[]): 'DEFAULT' | 'NONE' | TaskDefinition {
    const { unitId, taskKind } = TaskName().undo(taskName)
    if (!defs) {
      return 'DEFAULT'
    }

    const filtered = (defs ?? []).filter(at => {
      if (at.taskKind !== taskKind) {
        return false
      }

      if (at.unitIds === undefined) {
        return true
      }

      return at.unitIds.includes(unitId)
    })
    if (filtered.length === 0) {
      return 'NONE'
    }

    return filtered[filtered.length - 1]
  }
}
