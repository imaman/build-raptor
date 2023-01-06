import { TaskKind, TaskName } from 'task-name'
import { UnitId } from 'unit-metadata'

export type TaskDefinition = {
  // The task kind this definition applies to.
  readonly taskKind: TaskKind
  // The units this definition applies to. An empty array means "nothing". A value of '*' or undefined means "everything".
  readonly unitIds?: '*' | readonly UnitId[]
  readonly outputs?: readonly string[]
  // When a task has shadowing turned on, the execution engine will try to run it at the depending-most unit it can
  // find and then it will not run it at the units it depends on. Here is a concrete example:
  // Assume we have units 'a', 'b', and 'c', such that 'a' depends on 'b' and on 'c'; and a task kind 't' in which
  // shadowing is on. If 't' needs to run on all of these units, then the execution engine will only run it on 'a'
  // (because 'a' is the depending-most unit) and will not run it on 'b' or 'c'.
  // This is useful for task kinds which are realized by a tool (e.g., a compiler) that is capable of building several
  // units at a single invocation (the Typescript compiler, tsc, fits this bill). Using this we can get better build
  // times: as invoking it once at 'a' (which compiles also 'b' and 'c') is faster than invoking it on each unit
  // separately (i.e., on 'b' and on 'c' in parallel, and then on 'a'). Defaults to false.
  readonly shadowing?: boolean

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
