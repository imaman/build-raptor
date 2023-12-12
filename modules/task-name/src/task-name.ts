import { Brand } from 'brand'
import { threeWaySplit } from 'misc'
import { UnitId } from 'unit-metadata'

export type TaskName = Brand<string, 'TaskId'>

class TaskNameUtils {
  undo(input: TaskName) {
    return this.undoImpl(input)
  }

  private undoImpl(input: string) {
    const primary = threeWaySplit(
      input,
      () => false,
      c => c !== ':',
    )
    const secondary = threeWaySplit(
      primary.mid,
      () => false,
      c => c === ':',
    )
    if (secondary.suffix.length > 1) {
      throw new Error(`Bad task name: "${input}"`)
    }
    return {
      unitId: UnitId(secondary.mid),
      taskKind: TaskKind(primary.suffix),
    }
  }

  parse(input: string) {
    const { unitId, taskKind } = this.undoImpl(input)
    return TaskName(unitId, taskKind, '')
  }
}

export function TaskName(): TaskNameUtils
export function TaskName(unitId: UnitId, taskKind: TaskKind, selector?: string): TaskName
export function TaskName(unitId?: UnitId, taskKind?: TaskKind, selector = ''): TaskNameUtils | TaskName {
  if (unitId === undefined && taskKind === undefined) {
    return new TaskNameUtils()
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return `${unitId}:${taskKind}${selector ? ':' + selector : ''}` as TaskName
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
