import { BuildFailedError } from 'build-failed-error'
import { PathInRepo } from 'core-types'
import { Logger } from 'logger'
import { Graph, recordToPairs, uniqueBy } from 'misc'
import { CatalogOfTasks, TaskDefinition } from 'repo-protocol'
import { OutputLocation, TaskInfo } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitMetadata } from 'unit-metadata'

import { ExecutionPlan } from './execution-plan'
import { Model } from './model'
import { Task } from './task'
import { TaskOutputRegistry, validateTaskInfos } from './validate-task-infos'

export class Planner {
  private readonly taskGraph = new Graph<TaskName>(t => t)
  private readonly tasks: Task[] = []

  constructor(private readonly logger: Logger) {}

  async computePlan(model: Model, catalog: CatalogOfTasks): Promise<ExecutionPlan> {
    const infos: TaskInfo[] = this.computeInfos(catalog, model)
    const reg = validateTaskInfos(infos)

    for (const info of infos) {
      this.registerTask(model, info, reg)
    }

    if (this.taskGraph.isCyclic()) {
      throw new BuildFailedError(`Cyclic task dependency detected ${this.taskGraph}`)
    }

    const allInfos = this.tasks.map(t => t.taskInfo)
    this.logger.info(`Task dump:\n${JSON.stringify(allInfos, null, 2)}`)
    return new ExecutionPlan(this.taskGraph, this.tasks, this.logger)
  }

  private computeInfos(catalog: CatalogOfTasks, model: Model) {
    if (catalog.taskList) {
      return catalog.taskList
    }

    const kinds = this.collectKinds(catalog)
    const ret: TaskInfo[] = []
    const tasksFromDepList = catalog.complete ? new Set<TaskName>(catalog.depList?.flatMap(x => x) ?? []) : undefined
    for (const unit of model.units) {
      for (const k of kinds) {
        const info = this.generateInfo(unit, k, model, catalog, tasksFromDepList)
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
    model: Model,
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

    const deps = this.computeTaskDeps(taskName, model, catalog)
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

  private computeTaskDeps(taskName: TaskName, model: Model, catalog: CatalogOfTasks): TaskName[] {
    const { taskKind, unitId } = TaskName().undo(taskName)
    const inUnit = catalog.inUnit[taskKind] ?? []
    const onDeps = catalog.onDeps[taskKind] ?? []
    const unitDeps = model.graph.neighborsOf(unitId)

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

  private registerTask(model: Model, info: TaskInfo, reg: TaskOutputRegistry) {
    const taskName = info.taskName
    const { unitId, taskKind } = TaskName().undo(taskName)

    const u = model.getUnit(unitId)

    let inputs: PathInRepo[] = info.inputsInUnit.map(i => u.pathInRepo.expand(i))

    for (const d of model.unitDependenciesOf(unitId)) {
      if (d.id === unitId) {
        continue
      }
      for (const i of info.inputsInDeps) {
        const p = d.pathInRepo.expand(i)
        inputs.push(p)

        const other = reg.lookup(p)
        if (!other) {
          continue
          // TODO(imaman): this should be a build error
          // throw new BuildFailedError(`a task (${taskName}) cannot declare as its input the source code of another untit (${d.id})`)
        }

        this.taskGraph.edge(taskName, other)
      }
    }

    if (info.inputs) {
      inputs = info.inputs
    }
    const task = new Task(model.buildRunId, taskKind, unitId, info, inputs)
    this.tasks.push(task)
    this.taskGraph.vertex(taskName)

    for (const inputLoc of info.inputsInUnit) {
      const other = reg.lookup(u.pathInRepo.expand(inputLoc))
      if (other) {
        this.taskGraph.edge(taskName, other)
      }
    }
    for (const input of info.inputs ?? []) {
      const other = reg.lookup(input)
      if (other) {
        this.taskGraph.edge(taskName, other)
      }
    }

    for (const d of info.deps) {
      this.taskGraph.edge(taskName, d)
    }
  }
}
