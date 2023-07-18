import { TaskKind, TaskName } from 'task-name'
import { UnitId } from 'unit-metadata'

type OutputDefinition = string | { pathInUnit: string; purge: 'ALWAYS' | 'NEVER' }

export type TaskDefinition = {
  // The task kind this definition applies to.
  readonly taskKind: TaskKind
  // The units this definition applies to. An empty array means "nothing". An undefined means "everything".
  readonly unitIds?: readonly UnitId[]
  readonly outputs?: readonly OutputDefinition[]

  readonly inputsInUnit?: readonly string[]
  readonly inputsInDeps?: readonly string[]
}

// TODO(imaman): document this.
export interface CatalogOfTasks {
  readonly inUnit: Record<TaskKind, readonly TaskKind[]>
  readonly onDeps: Record<TaskKind, readonly TaskKind[]>

  readonly tasks?: readonly TaskDefinition[]
  readonly depList?: readonly [TaskName, TaskName][]
  readonly complete?: boolean
}
