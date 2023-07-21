import { PathInRepo } from 'core-types'
import { computeObjectHash, failMe, Jsonable, shouldNeverHappen, sortBy, uniqueBy } from 'misc'
import { OutputLocation, TaskInfo } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { Mutable } from 'type-fest'
import { UnitId } from 'unit-metadata'

import { ExecutionRecord } from './execution-record'
import { Fingerprint } from './fingerprint'
import { Phase } from './phase'
import { SlotIndex } from './slot-index'

export class Task {
  readonly name: TaskName
  readonly id: string
  private fingerprint: Fingerprint | undefined
  private readonly executionRecord: Mutable<ExecutionRecord>
  readonly inputs: readonly PathInRepo[]

  constructor(
    private readonly buildRunId: string,
    readonly kind: TaskKind,
    readonly unitId: UnitId,
    readonly taskInfo: TaskInfo,
    inputs: PathInRepo[],
  ) {
    this.inputs = uniqueBy(
      sortBy(inputs, t => t.val),
      t => t.val,
    )
    this.name = TaskName(unitId, kind)
    this.id = computeObjectHash({ buildRunId: this.buildRunId, name: this.name })
    this.executionRecord = {
      verdict: 'UNKNOWN',
      executionType: 'UNKNOWN',
      startedAt: SlotIndex(-1),
      endedAt: SlotIndex(-1),
      phases: [],
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
      info: this.taskInfo as unknown as Jsonable, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    })
    this.fingerprint = Fingerprint(fp)
  }

  setPhase(phase: Phase) {
    this.executionRecord.phases.push({ phase, timestampMillis: Date.now() })
  }

  getPhase(): Phase {
    const pos = this.executionRecord.phases.length - 1
    return pos >= 0 ? this.executionRecord.phases[pos].phase : 'UNSTARTED'
  }

  hasPhase(): boolean {
    return this.executionRecord.phases.length > 0
  }

  get record(): ExecutionRecord {
    return this.executionRecord
  }

  get outputLocations(): readonly OutputLocation[] {
    return this.taskInfo.outputLocations
  }

  assignVerdict(
    verdict: 'OK' | 'FAIL' | 'CRASH',
    executionType: 'EXECUTED' | 'CACHED' | 'CANNOT_START',
    rootCause?: TaskName,
  ) {
    this.executionRecord.verdict = verdict
    this.executionRecord.executionType = executionType
    this.executionRecord.rootCause = rootCause
  }

  setOutputFile(outputFile: string) {
    this.executionRecord.outputFile = outputFile
  }
}
