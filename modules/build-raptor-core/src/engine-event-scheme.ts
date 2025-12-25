import { ExitStatus } from 'repo-protocol'
import { RepoProtocolEvent } from 'repo-protocol'
import { TaskName } from 'task-name'

import { Phase } from './phase.js'
import { TaskStoreEvent } from './task-store-event.js'

export type EngineEventScheme = TaskStoreEvent &
  RepoProtocolEvent & {
    executionSkipped: TaskName
    executionStarted: TaskName
    executionEnded: { taskName: TaskName; status: ExitStatus; outputFile: string; pathInRepo: string; time: number }
    taskPhaseEnded: { taskName: TaskName; phase: Phase }
  }
