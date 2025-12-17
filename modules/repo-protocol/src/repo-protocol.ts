import { BuildRunId } from 'build-run-id'
import { RepoRoot } from 'core-types'
import { Graph, TypedPublisher } from 'misc'
import { TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'
import { z } from 'zod'

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
  /**
   * Initializes the repo protocol for running a build at the given directory.
   * All other methods will be called only after this call has returned. A close() call will be made before the next
   * initialize() call is made.
   *
   * The repo protocol is expected to do the following (in addition to any implemetation-specific setup):
   * - create an output directory at each module
   * - report dependency violations
   *
   * @param rootDir
   * @param publisher
   * @param outDirName - name of the output directory to create in each module.
   * @param repoProtocolConfig
   */
  initialize(
    rootDir: RepoRoot,
    publisher: TypedPublisher<RepoProtocolEvent>,
    outDirName: string,
    repoProtocolConfig?: unknown,
  ): Promise<void>
  execute(taskName: TaskName, outputFile: string, buildRunId: BuildRunId): Promise<ExitStatus>
  getGraph(): Promise<Graph<UnitId>>
  getUnits(): Promise<UnitMetadata[]>
  getTasks(): Promise<TaskInfo[]>
  getConfigSchema(): z.AnyZodObject
  close(): Promise<void>
}

export interface Publisher {
  publishAsset(u: UnitMetadata, content: Buffer, name: string): Promise<string>
}
