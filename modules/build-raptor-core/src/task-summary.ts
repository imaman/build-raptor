import { TaskName } from 'task-name'

import { ExecutionType } from './execution-record'
import { SlotIndex } from './slot-index'

export interface TaskSummary {
  taskName: TaskName
  outputFile?: string
  verdict: 'OK' | 'FAIL' | 'CRASH' | 'UNKNOWN'
  execution: ExecutionType
  startedAt: SlotIndex
  endedAt: SlotIndex
  // Is set only if the task failed due to another task.
  rootCause?: TaskName
}
