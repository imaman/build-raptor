import { TaskName } from 'task-name'

export type OutputLocation = { pathInPackage: string; purge: 'ALWAYS' | 'BEFORE_RESTORE' }

export type TaskInfo = {
  readonly taskName: TaskName
  readonly deps: readonly TaskName[]
  readonly shadowing: boolean
  readonly outputLocations: readonly OutputLocation[]
  readonly inputsInUnit: readonly string[]
  readonly inputsInDeps: readonly string[]
}
