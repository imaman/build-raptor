import { BuildFailedError } from 'build-failed-error'
import { PathInRepo } from 'core-types'
import { Logger } from 'logger'
import { Graph, hardGet } from 'misc'
import { TaskName } from 'task-name'

import { Task } from './task'
import { TaskOutputRegistry } from './updatable-task-output-registry'

// TODO(imaman): rethink the name. It is not exactly a "Plan".
export class ExecutionPlan {
  private readonly taskByName = new Map<TaskName, Task>()
  readonly errorPropagationGraph: Graph<TaskName>
  constructor(
    readonly taskGraph: Graph<TaskName>,
    tasks: Task[],
    private readonly logger: Logger,
    private readonly registry: TaskOutputRegistry,
  ) {
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

  apply(units: string[], goals: PathInRepo[], labels: string[]) {
    this.logger.info(`apply(${JSON.stringify(units)}, ${JSON.stringify(goals)}, ${JSON.stringify(labels)}) called`)
    const startingPoints = this.computeStartingPoints(units, goals, labels)
    this.dropOutOfScope(startingPoints)
    this.logger.info(`computed these startingPoints: ${JSON.stringify(startingPoints)}`)
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

  private computeStartingPoints(units: string[], goals: PathInRepo[], labels: string[]) {
    const setOfUnitId = new Set<string>(units)
    this.logger.info(`setOfUnitId=${[...setOfUnitId].join('; ')}`)
    const ret = goals.flatMap(ol => {
      const tns = this.registry.wideLookup(ol)
      if (tns.length === 0) {
        throw new BuildFailedError(`no task found for this output location: ${ol}`)
      }
      return tns
    })
    const matchesUnit =
      setOfUnitId.size === 0 && goals.length === 0 ? () => true : (t: Task) => setOfUnitId.has(t.unitId)
    const matchesLabel = labels.length === 0 ? () => true : (t: Task) => labels.some(label => t.labels.includes(label))
    ret.push(
      ...this.tasks()
        .filter(t => matchesUnit(t) && matchesLabel(t))
        .map(t => t.name),
    )
    ret.sort()

    this.logger.info(`Found ${ret.length} starting points`)
    return ret
  }

  toString() {
    return `(ExecutionPlan ${this.taskGraph.toString()})`
  }
}
