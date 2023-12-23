import { PathInRepo } from 'core-types'
import { TaskName } from 'task-name'

export type OutputLocation = { pathInRepo: PathInRepo; purge: 'ALWAYS' | 'NEVER' }

export type TaskInfo = {
  readonly taskName: TaskName
  readonly inputs?: PathInRepo[]
  readonly outputLocations?: OutputLocation[]
  readonly deps?: TaskName[]
  readonly labels?: string[]
}
