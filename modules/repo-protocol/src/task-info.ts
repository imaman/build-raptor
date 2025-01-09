import { PathInRepo } from 'core-types'
import { TaskName } from 'task-name'

export type OutputLocation = { pathInRepo: PathInRepo; purge: 'ALWAYS' | 'NEVER'; isPublic?: boolean }

export type TaskInfo = {
  readonly taskName: TaskName
  readonly inputs?: PathInRepo[]
  readonly outputLocations?: OutputLocation[]
  readonly deps?: TaskName[]
  readonly labels?: string[]
  /**
   * Whether to use previously stored outputs for this task. Defaults to true.
   */
  useCaching?: boolean
}
