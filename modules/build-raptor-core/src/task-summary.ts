import { TaskName } from 'task-name'

import { ExecutionType } from './execution-type.js'
import { SlotIndex } from './slot-index.js'

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
