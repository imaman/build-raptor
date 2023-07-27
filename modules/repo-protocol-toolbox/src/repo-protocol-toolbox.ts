import { PathInRepo } from 'core-types'
import { failMe, Graph, uniqueBy } from 'misc'
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
        const info = this.generateInfo(unit, k, units, graph, defs)
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
    units: UnitMetadata[],
    graph: Graph<UnitId>,
    defs?: readonly TaskDefinition[],
  ): TaskInfo | undefined {
    const taskName = TaskName(unit.id, t)
    const definition = this.findDefinition(taskName, defs)

    if (definition === 'NONE') {
      return undefined
    }

    if (definition === 'DEFAULT') {
      const ret: TaskInfo = {
        taskName,
        deps: [],
        outputLocations: [],
        inputsInDeps: [],
        inputsInUnit: [],
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

    const inputs: PathInRepo[] = []
    for (const at of definition.inputsInUnit ?? []) {
      inputs.push(unit.pathInRepo.expand(at))
    }

    const unitOf = (id: UnitId) => units.find(at => at.id === id) ?? failMe(`unit not found (unit ID=${id})`)

    const ds = graph
      .traverseFrom(unit.id)
      .filter(at => at !== unit.id)
      .map(at => unitOf(at))
    for (const at of definition.inputsInUnit ?? []) {
      inputs.push(unit.pathInRepo.expand(at))
    }

    for (const d of ds) {
      for (const at of definition.inputsInDeps ?? []) {
        inputs.push(d.pathInRepo.expand(at))
      }
    }

    const ret: TaskInfo = {
      taskName,
      outputLocations,
      inputs,
      deps: [],
      inputsInUnit: [],
      inputsInDeps: [],
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
