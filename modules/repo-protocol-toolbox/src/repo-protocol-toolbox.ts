import { Graph, recordToPairs, uniqueBy } from 'misc'
import { CatalogOfTasks, OutputLocation, TaskDefinition, TaskInfo } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

export class TaskInfoGenerator {
  computeInfos(catalog: CatalogOfTasks, units: UnitMetadata[], graph: Graph<UnitId>) {
    const kinds = this.collectKinds(catalog)
    const ret: TaskInfo[] = []
    const tasksFromDepList = catalog.complete ? new Set<TaskName>(catalog.depList?.flatMap(x => x) ?? []) : undefined
    for (const unit of units) {
      for (const k of kinds) {
        const info = this.generateInfo(unit, k, graph, catalog, tasksFromDepList)
        if (info) {
          ret.push(info)
        }
      }
    }
    return ret
  }

  private collectKinds(catalog: CatalogOfTasks) {
    const kindsA = recordToPairs(catalog.inUnit).flatMap(([k, v]) => [k, ...v])
    const kindsB = recordToPairs(catalog.onDeps).flatMap(([k, v]) => [k, ...v])
    const kindsC = (catalog.depList ?? []).flat().map(tn => TaskName().undo(tn).taskKind)
    const kindsD = (catalog.tasks ?? []).map(td => td.taskKind)
    return uniqueBy([...kindsA, ...kindsB, ...kindsC, ...kindsD], x => x)
  }

  private generateInfo(
    unit: UnitMetadata,
    t: TaskKind,
    graph: Graph<UnitId>,
    catalog: CatalogOfTasks,
    allowed: Set<TaskName> | undefined,
  ): TaskInfo | undefined {
    const taskName = TaskName(unit.id, t)
    if (allowed) {
      if (!allowed.has(taskName)) {
        return undefined
      }
    }
    const definition = this.findDefinition(taskName, catalog)

    if (definition === 'NONE') {
      return undefined
    }

    const deps = this.computeTaskDeps(taskName, graph, catalog)
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

  private findDefinition(taskName: TaskName, catalog: CatalogOfTasks): 'DEFAULT' | 'NONE' | TaskDefinition {
    const { unitId, taskKind } = TaskName().undo(taskName)
    if (!catalog.tasks) {
      return 'DEFAULT'
    }

    const filtered = (catalog.tasks ?? []).filter(at => {
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

  private computeTaskDeps(taskName: TaskName, graph: Graph<UnitId>, catalog: CatalogOfTasks): TaskName[] {
    const { taskKind, unitId } = TaskName().undo(taskName)
    const inUnit = catalog.inUnit[taskKind] ?? []
    const onDeps = catalog.onDeps[taskKind] ?? []
    const unitDeps = graph.neighborsOf(unitId)

    const ret = (catalog.depList ?? []).filter(([f, _t]) => f === taskName).map(([_f, t]) => t)
    for (const at of inUnit) {
      ret.push(TaskName(unitId, at))
    }

    for (const at of onDeps) {
      for (const depUnitId of unitDeps) {
        ret.push(TaskName(depUnitId, at))
      }
    }
    return ret
  }
}
