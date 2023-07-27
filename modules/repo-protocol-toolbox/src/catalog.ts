import { TaskInfo } from 'repo-protocol'
import { TaskKind } from 'task-name'
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

export interface CatalogOfTasks {
  taskList?: TaskInfo[]
}
