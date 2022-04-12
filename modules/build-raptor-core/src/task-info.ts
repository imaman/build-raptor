import { TaskName } from 'task-name'

export type TaskInfo = {
  readonly taskName: TaskName
  readonly deps: readonly TaskName[]
  readonly shadowing: boolean
  readonly outputLocations: readonly string[]
  readonly inputsInUnit: readonly string[]
  readonly inputsInDeps: readonly string[]
}
