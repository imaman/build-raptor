import { ExitStatus } from 'repo-protocol'
import { TaskName } from 'task-name'

export type EngineEventScheme = {
  executionSkipped: TaskName
  executionShadowed: TaskName
  executionStarted: TaskName
  executionEnded: { taskName: TaskName; status: ExitStatus; outputFile: string; pathInRepo: string }
}
