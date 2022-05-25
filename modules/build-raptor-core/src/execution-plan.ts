import { Logger } from 'logger'
import { Graph, hardGet } from 'misc'
import { TaskName } from 'task-name'

import { Task } from './task'

// TODO(imaman): rethink the name. It is not exactly a "Plan".
export class ExecutionPlan {
  private readonly taskByName = new Map<TaskName, Task>()
  readonly errorPropagationGraph: Graph<TaskName>
  constructor(readonly taskGraph: Graph<TaskName>, tasks: Task[], private readonly logger: Logger) {
    for (const t of tasks) {
      this.taskByName.set(t.name, t)
    }

    this.errorPropagationGraph = taskGraph.copy()
  }

  getTask(taskName: TaskName) {
    return hardGet(this.taskByName, taskName)
  }

  tasks() {
    const taskNames = this.taskGraph.vertices()
    return taskNames.map(tn => this.getTask(tn))
  }

  apply(command: string, units: string[]) {
    const startingPoints = this.computeStartingPoints(command, units)
    this.dropOutOfScope(startingPoints)
    return startingPoints
  }

  private dropOutOfScope(startingPoints: TaskName[]) {
    const inscope = new Set<TaskName>(this.taskGraph.traverseFrom(startingPoints, { direction: 'forward' }))
    this.logger.info(`scope of ${startingPoints.join('; ')} is ${[...inscope].join('; ')}`)
    for (const v of this.taskGraph.vertices()) {
      if (!inscope.has(v)) {
        this.taskGraph.remove(v)
      }
    }
    this.logger.info(`Task graph (only in-scope):\n${this.taskGraph}`)
  }

  private computeStartingPoints(command: string, units: string[]) {
    const setOfUnitId = new Set<string>(units)
    this.logger.info(`setOfUnitId=${[...setOfUnitId].join('; ')}`)
    this.logger.info(`command=<${command}>`)
    const matchesUnit = setOfUnitId.size === 0 ? () => true : (t: Task) => setOfUnitId.has(t.unitId)
    const matchesCommand = command === '' ? () => true : (t: Task) => t.kind === command
    const ret = this.tasks()
      .filter(t => matchesUnit(t) && matchesCommand(t))
      .map(t => t.name)
      .sort()

    this.logger.info(`Found ${ret.length} starting points`)
    return ret
  }

  toString() {
    return `(ExecutionPlan ${this.taskGraph.toString()})`
  }
}
