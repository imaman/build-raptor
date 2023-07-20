import { PathInRepo } from 'core-types'
import { TaskName } from 'task-name'

export type OutputLocation = { pathInRepo: PathInRepo; purge: 'ALWAYS' | 'NEVER' }

export type TaskInfo = {
  readonly taskName: TaskName
  readonly deps: readonly TaskName[]
  readonly outputLocations: readonly OutputLocation[]
  readonly inputsInUnit: readonly string[]
  readonly inputsInDeps: readonly string[]
  inputs?: PathInRepo[]
}