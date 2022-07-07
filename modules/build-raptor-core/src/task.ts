import { computeObjectHash, failMe, shouldNeverHappen } from 'misc'
import { TaskKind, TaskName } from 'task-name'
import { Mutable } from 'type-fest'
import { UnitId } from 'unit-metadata'

import { ExecutionRecord } from './execution-record'
import { Fingerprint } from './fingerprint'
import { Phase } from './phase'
import { SlotIndex } from './slot-index'
import { TaskInfo } from './task-info'

type PathInRepo = string

export class Task {
  readonly name: TaskName
  readonly id: string
  private fingerprint: Fingerprint | undefined
  private readonly executionRecord: Mutable<ExecutionRecord>

  constructor(
    private readonly buildRunId: string,
    readonly kind: TaskKind,
    readonly unitId: UnitId,
    readonly taskInfo: TaskInfo,
    readonly inputs: readonly PathInRepo[],
  ) {
    this.name = TaskName(unitId, kind)
    this.id = computeObjectHash({ buildRunId: this.buildRunId, name: this.name })
    this.executionRecord = {
      verdict: 'UNKNOWN',
      executionType: 'UNKNOWN',
      startedAt: SlotIndex(-1),
      endedAt: SlotIndex(-1),
      phases: []
    }
  }

  changeStatus(status: 'RUNNING' | 'DONE', counter: SlotIndex) {
    if (status === 'RUNNING') {
      this.executionRecord.startedAt = counter
    } else if (status === 'DONE') {
      this.executionRecord.endedAt = counter
    } else {
      shouldNeverHappen(status)
    }
  }

  getFingerprint(): Fingerprint {
    return this.fingerprint ?? failMe(`fingerprint not set in ${this.name}`)
  }

  computeFingerprint(fingerprintsOfInputs: Fingerprint[]) {
    if (this.fingerprint !== undefined) {
      throw new Error(`Fingerprint was already set in ${this.name}`)
    }

    const fp = computeObjectHash({
      fingerprintsOfInputs,
      info: this.taskInfo,
    })
    this.fingerprint = Fingerprint(fp)
  }

  setPhase(phase: Phase) {
    this.executionRecord.phases.push(phase)
  }

  getPhase(): Phase {
    const pos = this.executionRecord.phases.length - 1
    return pos >= 0 ? this.executionRecord.phases[pos] : 'UNSTARTED'
  }

  hasPhase(): boolean {
    return this.executionRecord.phases.length > 0
  }


  get record(): ExecutionRecord {
    return this.executionRecord
  }

  get outputLocations(): readonly string[] {
    return this.taskInfo.outputLocations
  }

  assignVerdict(
    verdict: 'OK' | 'FAIL' | 'CRASH',
    executionType: 'EXECUTED' | 'CACHED' | 'CANNOT_START' | 'SHADOWED',
    rootCause?: TaskName,
  ) {
    this.executionRecord.verdict = verdict
    this.executionRecord.executionType = executionType
    this.executionRecord.rootCause = rootCause
  }

  setOutputFile(outputFile: string) {
    this.executionRecord.outputFile = outputFile
  }

  get shadowingEnabled(): boolean {
    return this.taskInfo.shadowing
  }
}
