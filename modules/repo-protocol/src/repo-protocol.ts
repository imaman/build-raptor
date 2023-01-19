import { BuildRunId } from 'build-run-id'
import { Graph, TypedPublisher } from 'misc'
import { TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { CatalogOfTasks } from './catalog-of-tasks'

export type ExitStatus = 'OK' | 'FAIL' | 'CRASH'


export type RepoProtocolEventVerdict =  'TEST_PASSED' | 'TEST_FAILED' | 'TEST_CRASHED' | 'TEST_TIMEDOUT'
export interface RepoProtocolEvent {
  testEnded: {
    verdict: RepoProtocolEventVerdict
    testPath: string[]
    fileName: string
    taskName: TaskName
    durationMillis?: number
  }
}

export interface RepoProtocol {
  initialize(rootDir: string, publisher: TypedPublisher<RepoProtocolEvent>): Promise<void>
  execute(
    u: UnitMetadata,
    dir: string,
    taskName: TaskName,
    outputFile: string,
    buildRunId: BuildRunId,
  ): Promise<ExitStatus>
  getGraph(): Promise<Graph<UnitId>>
  getUnits(): Promise<UnitMetadata[]>
  getTasks(): Promise<CatalogOfTasks>
  close(): Promise<void>
}

export interface Publisher {
  publishAsset(u: UnitMetadata, content: Buffer, name: string): Promise<void>
}
