export type Verdict = 'UNKNOWN' | 'CRASH' | 'FAIL' | 'OK'
import { TaskName } from 'task-name'

import { ExecutionType } from './execution-type'
import { Phase } from './phase'
import { SlotIndex } from './slot-index'

export interface ExecutionRecord {
  readonly verdict?: Verdict
  readonly outputFile?: string
  readonly executionType: ExecutionType
  readonly startedAt: SlotIndex
  readonly endedAt: SlotIndex
  readonly rootCause?: TaskName
  readonly phases: { phase: Phase; timestampMillis: number }[]
}
