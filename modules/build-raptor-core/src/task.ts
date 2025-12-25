import { PathInRepo } from 'core-types'
import { computeObjectHash, failMe, Jsonable, shouldNeverHappen, sortBy, uniqueBy } from 'misc'
import { OutputLocation, TaskInfo } from 'repo-protocol'
import { TaskName } from 'task-name'
import { Mutable } from 'type-fest'

import { ExecutionRecord } from './execution-record.js'
import { Fingerprint } from './fingerprint.js'
import { Phase } from './phase.js'
import { SlotIndex } from './slot-index.js'

export class Task {
  readonly name: TaskName
  readonly id: string
  private fingerprint: Fingerprint | undefined
  private readonly executionRecord: Mutable<ExecutionRecord>
  readonly inputs: readonly PathInRepo[]

  constructor(
    private readonly buildRunId: string,
    readonly taskInfo: TaskInfo,
    inputs: PathInRepo[],
    readonly labels: readonly string[],
  ) {
    this.inputs = uniqueBy(
      sortBy(inputs, t => t.val),
      t => t.val,
    )
    this.name = taskInfo.taskName
    this.id = computeObjectHash({ buildRunId: this.buildRunId, name: this.name })
    this.executionRecord = {
      verdict: 'UNKNOWN',
      executionType: 'UNKNOWN',
      startedAt: SlotIndex(-1),
      endedAt: SlotIndex(-1),
      phases: [],
    }
  }

  get unitId() {
    return TaskName().undo(this.name).unitId
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

  get outputLocations(): OutputLocation[] {
    return this.taskInfo.outputLocations ?? []
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

  getDurationMillis(): number | undefined {
    const phases = this.executionRecord.phases
    if (phases.length < 2) {
      return undefined
    }
    // Find the first RUNNING phase and the last phase
    const runningPhase = phases.find(p => p.phase === 'RUNNING')
    const lastPhase = phases[phases.length - 1]
    if (!runningPhase) {
      return undefined
    }
    return lastPhase.timestampMillis - runningPhase.timestampMillis
  }
}
