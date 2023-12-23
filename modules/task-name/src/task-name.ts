import { Brand } from 'brand'
import { UnitId } from 'unit-metadata'

export type TaskName = Brand<string, 'TaskId'>

class TaskNameUtils {
  undo(input: TaskName) {
    return this.undoImpl(input)
  }

  private undoImpl(input: string) {
    const parts = input.split(':')
    if (parts.length !== 2 && parts.length !== 3) {
      throw new Error(`Bad task name: "${input}"`)
    }

    return {
      unitId: UnitId(parts[0]),
      taskKind_: TaskKind(parts[1]),
      subKind: parts.at(2) ?? '',
    }
  }

  parse(input: string) {
    const { unitId, taskKind_: taskKind, subKind } = this.undoImpl(input)
    return TaskName(unitId, taskKind, subKind)
  }
}

export function TaskName(): TaskNameUtils
export function TaskName(unitId: UnitId, taskKind: TaskKind, subKind?: string): TaskName
export function TaskName(unitId?: UnitId, taskKind?: TaskKind, subKind = ''): TaskNameUtils | TaskName {
  if (unitId === undefined && taskKind === undefined) {
    return new TaskNameUtils()
  }

  // TODO(imaman): fail if subKind contains a ':' character

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return `${unitId}:${taskKind}${subKind ? ':' + subKind : ''}` as TaskName
}

export type TaskKind = Brand<string, 'TaskKind'>

function validateTaskKind(input: string): asserts input is TaskKind {
  if (input.length === 0 || input.includes(':')) {
    throw new Error(`Bad TaskKind: <${input}>`)
  }
}
export const TaskKind: (input: string) => TaskKind = (input: string) => {
  validateTaskKind(input)
  return input
}
