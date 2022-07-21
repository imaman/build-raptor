import { BuildRunId } from 'build-run-id'
import { Graph } from 'misc'
import { TaskKind } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { CatalogOfTasks } from './catalog-of-tasks'

export type ExitStatus = 'OK' | 'FAIL' | 'CRASH'

export interface RepoProtocol {
  initialize(rootDir: string): Promise<void>
  execute(u: UnitMetadata, dir: string, task: TaskKind, outputFile: string, buildRunId: BuildRunId): Promise<ExitStatus>
  getGraph(): Promise<Graph<UnitId>>
  getUnits(): Promise<UnitMetadata[]>
  getTasks(): Promise<CatalogOfTasks>
  close(): Promise<void>
}

export interface Publisher {}
