import { BuildRunId } from 'build-run-id'
import * as fse from 'fs-extra'
import { shouldNeverHappen, switchOn } from 'misc'
import * as path from 'path'
import { TaskKind, TaskName } from 'task-name'
import { UnitId } from 'unit-metadata'

import { PerformanceReport } from './performance-report'
import { TaskSummary } from './task-summary'

export class Breakdown {
  constructor(
    readonly overallVerdict: 'OK' | 'FAIL' | 'CRASH',
    readonly buildRunId: BuildRunId,
    private readonly summaries: TaskSummary[],
    private readonly rootDir: string,
    readonly performanceReport?: PerformanceReport,
    readonly crashCause?: unknown,
    readonly message?: string,
  ) {}

  get exitCode() {
    return switchOn(this.overallVerdict, {
      OK: () => 0,
      CRASH: () => 1,
      FAIL: () => 2,
    })
  }

  getSummaries(): readonly TaskSummary[] {
    return this.summaries
  }

  outputOf(taskKind: string, unitId: string, format: 'string'): Promise<string>
  outputOf(taskKind: string, unitId: string, format?: 'lines'): Promise<string[]>
  async outputOf(taskKind: string, unitId: string, format: 'string' | 'lines' = 'lines'): Promise<string | string[]> {
    const taskName = TaskName(UnitId(unitId), TaskKind(taskKind))
    const finishedTask = this.summaries.find(t => t.taskName === taskName)
    if (finishedTask === undefined) {
      throw new Error(`No task with kind ${taskKind} and unitId ${unitId}`)
    }

    const status = finishedTask.verdict
    if (status === undefined) {
      throw new Error(`status of ${unitId}/${taskKind} is ${status}`)
    }

    if (status === 'OK' || status === 'FAIL') {
      const outputFile = finishedTask.outputFile
      if (!outputFile) {
        return []
      }
      const content = await fse.readFile(outputFile, 'utf8')
      const trimmed = content.trim()
      return format === 'string' ? trimmed : trimmed.split('\n')
    }

    if (status === 'CRASH') {
      throw new Error(`Task ${finishedTask.taskName} crashed while running`)
    }

    if (status === 'UNKNOWN') {
      throw new Error(`Task ${finishedTask.taskName} did not run`)
    }

    shouldNeverHappen(status)
  }

  async readLines(relativePath: string) {
    const resolved = path.join(this.rootDir, relativePath)
    if (!(await fse.pathExists(resolved))) {
      return undefined
    }
    const content = await fse.readFile(resolved, 'utf8')
    return content.trim().split('\n')
  }
}
