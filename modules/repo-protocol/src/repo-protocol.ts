import { BuildRunId } from 'build-run-id'
import { RepoRoot } from 'core-types'
import { Graph, TypedPublisher } from 'misc'
import { TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { TaskInfo } from './task-info'

export type ExitStatus = 'OK' | 'FAIL' | 'CRASH'

export type RepoProtocolEventVerdict = 'TEST_PASSED' | 'TEST_FAILED' | 'TEST_CRASHED' | 'TEST_TIMEDOUT'
export interface RepoProtocolEvent {
  testEnded: {
    verdict: RepoProtocolEventVerdict
    testPath: string[]
    fileName: string
    taskName: TaskName
    durationMillis?: number
  }
  assetPublished: {
    taskName: TaskName
    casAddress: string
    file: string
  }
}

export interface RepoProtocol {
  initialize(
    rootDir: RepoRoot,
    publisher: TypedPublisher<RepoProtocolEvent>,
    repoProtocolConfig?: unknown,
  ): Promise<void>
  execute(taskName: TaskName, outputFile: string, buildRunId: BuildRunId): Promise<ExitStatus>
  getGraph(): Promise<Graph<UnitId>>
  getUnits(): Promise<UnitMetadata[]>
  getTasks(): Promise<TaskInfo[]>
  close(): Promise<void>
}

export interface Publisher {
  publishAsset(u: UnitMetadata, content: Buffer, name: string): Promise<string>
}
