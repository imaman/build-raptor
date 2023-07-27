import { PathInRepo } from 'core-types'
import { TaskName } from 'task-name'

export type OutputLocation = { pathInRepo: PathInRepo; purge: 'ALWAYS' | 'NEVER' }

export type TaskInfo = {
  readonly taskName: TaskName
  readonly deps?: TaskName[]
  readonly outputLocations?: OutputLocation[]
  readonly inputs?: PathInRepo[]
}
