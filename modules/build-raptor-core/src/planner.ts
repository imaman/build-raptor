import { BuildFailedError } from 'build-failed-error'
import { Logger } from 'logger'
import { Graph } from 'misc'
import { TaskInfo } from 'repo-protocol'
import { TaskName } from 'task-name'

import { ExecutionPlan } from './execution-plan'
import { Model } from './model'
import { Task } from './task'
import { TaskOutputRegistry, validateTaskInfos } from './validate-task-infos'

export class Planner {
  private readonly taskGraph = new Graph<TaskName>(t => t)
  private readonly tasks: Task[] = []

  constructor(private readonly logger: Logger) {}

  async computePlan(infos: TaskInfo[], model: Model): Promise<ExecutionPlan> {
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

  private registerTask(model: Model, info: TaskInfo, reg: TaskOutputRegistry) {
    const taskName = info.taskName
    const { unitId, taskKind } = TaskName().undo(taskName)

    const inputs = info.inputs ?? []

    const task = new Task(model.buildRunId, taskKind, unitId, info, inputs)
    this.tasks.push(task)
    this.taskGraph.vertex(taskName)

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
