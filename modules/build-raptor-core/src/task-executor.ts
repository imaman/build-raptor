import { BuildFailedError } from 'build-failed-error'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { failMe, promises, shouldNeverHappen, sortBy, TypedPublisher } from 'misc'
import * as path from 'path'
import { ExitStatus, RepoProtocol } from 'repo-protocol'
import { TaskName } from 'task-name'

import { EngineEventScheme } from './engine-event-scheme'
import { Fingerprint } from './fingerprint'
import { FingerprintLedger } from './fingerprint-ledger'
import { Model } from './model'
import { Phase } from './phase'
import { Purger } from './purger'
import { TaskStore } from './task-store'
import { TaskTracker } from './task-tracker'

/**
 * An object that is reponsible for executing a task.
 */
export class TaskExecutor {
  constructor(
    private readonly model: Model,
    private readonly tracker: TaskTracker,
    private readonly logger: Logger,
    private readonly repoProtocol: RepoProtocol,
    private readonly taskStore: TaskStore,
    private readonly taskOutputDir: string,
    private readonly eventPublisher: TypedPublisher<EngineEventScheme>,
    private readonly fingerprintLedger: FingerprintLedger,
    private readonly purger: Purger,
  ) {}

  async executeTask(taskName: TaskName, deps: TaskName[]) {
    const ste = new SingleTaskExecutor(
      taskName,
      deps,
      this.model,
      this.tracker,
      this.logger,
      this.repoProtocol,
      this.taskStore,
      this.taskOutputDir,
      this.eventPublisher,
      this.fingerprintLedger,
      this.purger,
    )
    await ste.executeTask()
  }
}

class SingleTaskExecutor {
  private readonly phasePublisher = new TypedPublisher<{ phase: Phase }>()

  constructor(
    private readonly taskName: TaskName,
    private readonly deps: TaskName[],
    private readonly model: Model,
    private readonly tracker: TaskTracker,
    private readonly logger: Logger,
    private readonly repoProtocol: RepoProtocol,
    private readonly taskStore: TaskStore,
    private readonly taskOutputDir: string,
    private readonly eventPublisher: TypedPublisher<EngineEventScheme>,
    private readonly fingerprintLedger: FingerprintLedger,
    private readonly purger: Purger,
    private readonly taskToDiagnose?: string,
  ) {}

  private diagnose(message: string) {
    if (this.taskName !== this.taskToDiagnose) {
      return
    }

    this.logger.print(message)
  }

  private get task() {
    return this.tracker.getTask(this.taskName)
  }

  private get unit() {
    return this.model.getUnit(this.task.unitId)
  }

  private async postProcess(status: ExitStatus, outputFile: string) {
    // TODO(imaman): cover (await is dropped)
    await this.eventPublisher.publish('executionEnded', {
      taskName: this.taskName,
      status,
      outputFile,
      pathInRepo: this.unit.pathInRepo,
    })
  }

  private async computeFingerprint() {
    const fps: Fingerprint[] = []

    const t = this.task

    // TODO(imaman): test coverage for the sort-by
    // TODO(imaman): concurrent loop

    for (const d of this.deps) {
      const dep = this.tracker.getTask(d)
      fps.push(dep.getFingerprint())
    }
    const parts: Record<string, Fingerprint> = {}

    const sortedInputs = sortBy(t.inputs, t => t)
    for (const loc of sortedInputs) {
      const fingerprint = await this.model.fingerprintOfDir(loc)
      fps.push(fingerprint)
      parts[loc] = fingerprint
    }

    t.computeFingerprint(fps)
    const ret = t.getFingerprint()

    this.fingerprintLedger.updateTask(t.name, ret, parts)
    return ret
  }

  private async validateOutputs() {
    const t = this.task
    const unit = this.unit
    const missing = await promises(t.outputLocations)
      .filter(async loc => {
        const resolved = path.join(this.model.rootDir, unit.pathInRepo, loc.pathInUnit)
        const exists = await fse.pathExists(resolved)
        return !exists
      })
      .reify(100)

    if (!missing.length) {
      return
    }

    const formatted = missing.map(at => `  - ${at}`).join('\n')
    this.logger.info(`missing outputs for task ${t.name}: ${JSON.stringify(missing)}`)
    throw new BuildFailedError(`Task ${this.taskName} failed to produce the following outputs:\n${formatted}`)
  }

  /**
   * Exectues the task.
   */
  async executeTask(): Promise<void> {
    try {
      const t = this.task
      if (this.tracker.hasVerdict(t.name)) {
        return
      }

      await this.runPhases()
    } catch (e) {
      this.logger.error(`Task ${this.taskName} is exiting with an error`, e)
      throw e
    }
  }

  private get dir() {
    return path.join(this.model.rootDir, this.unit.pathInRepo)
  }

  private fp_?: Fingerprint

  private get fp() {
    return this.fp_ ?? failMe(`fingerprint was not set on task ${this.taskName}`)
  }

  /**
   * Determines whether this executor can execute its task. It is possible that several executors will try to run the
   * same task. This method ensures that exactly one such executor will actually execute it.
   * @returns true if the task should be executed by this executor, false otherwise.
   */
  private grabExecutionRights(): boolean {
    // This method cannot be async, because it should do a compare-and-set on the task's phase in an atomic manner.
    // This atomicity ensures that a task will only be executed once.
    if (this.task.hasPhase()) {
      return false
    }

    this.task.setPhase('UNSTARTED')
    return true
  }

  private async runPhases() {
    const rightsGrabbed = this.grabExecutionRights()
    if (!rightsGrabbed) {
      await this.eventPublisher.awaitFor('taskPhaseEnded', e => e.taskName === this.taskName && e.phase === 'TERMINAL')
      return
    }

    this.tracker.changeStatus(this.taskName, 'RUNNING')

    let phase: Phase = 'RUNNING'
    while (true) {
      this.task.setPhase(phase)
      await this.eventPublisher.publish('taskPhaseEnded', { taskName: this.taskName, phase })
      if (phase === 'TERMINAL') {
        break
      }
      phase = await this.executePhase(phase)
      await this.phasePublisher.publish('phase', phase)
    }
  }

  private async executePhase(phase: Phase): Promise<Phase> {
    this.logger.info(`Running ${phase} of ${this.taskName}`)
    this.diagnose(`Running phase ${phase}`)
    const t = this.task

    // TODO(imaman): some of the phases are essentially a no-op and can be eliminated.
    if (phase === 'UNSTARTED') {
      return 'RUNNING'
    }

    if (phase === 'RUNNING') {
      return 'COMPUTE_FINGERPRINT'
    }

    if (phase === 'COMPUTE_FINGERPRINT') {
      this.fp_ = await this.computeFingerprint()
      return 'POSSIBLY_RESTORE_OUTPUTS'
    }

    if (phase === 'POSSIBLY_RESTORE_OUTPUTS') {
      const earlierVerdict = await this.getVerdict()
      this.diagnose(`earlierVerdict=${earlierVerdict}`)
      await this.purgeOutputs(true)
      if (earlierVerdict === 'UNKNOWN') {
        return 'RUN_IT'
      }
      await this.purgeOutputs(false)
      await this.restoreOutputs()

      if (earlierVerdict === 'FAIL') {
        return 'RUN_IT'
      }

      if (earlierVerdict === 'OK' || earlierVerdict === 'FLAKY') {
        this.tracker.registerCachedVerdict(t.name, earlierVerdict)
        return 'SKIP'
      }

      shouldNeverHappen(earlierVerdict)
    }

    if (phase === 'SKIP') {
      await this.eventPublisher.publish('executionSkipped', t.name)
      return 'TERMINAL'
    }

    if (phase === 'RUN_IT') {
      this.diagnose('running it')
      await this.runIt()
      return 'TERMINAL'
    }

    if (phase === 'TERMINAL') {
      throw new Error(`task ${t.name} is already in state ${phase}`)
    }

    shouldNeverHappen(phase)
  }

  private async restoreOutputs() {
    this.diagnose(`restoring outputs`)
    const t = this.task
    await this.taskStore.restoreTask(t.name, this.fp, this.dir)
    this.diagnose(`task restored`)
  }

  private async getVerdict() {
    const earlierVerdict = await this.taskStore.checkVerdict(this.task.name, this.fp)
    return earlierVerdict
  }

  private async runIt() {
    const t = this.task

    await this.eventPublisher.publish('executionStarted', t.name)
    const outputFile = path.join(this.taskOutputDir, `${t.id}.stdout`)
    const status = await this.repoProtocol.execute(this.unit, this.dir, t.name, outputFile, this.model.buildRunId)
    await this.postProcess(status, outputFile)
    if (status === 'CRASH') {
      throw new Error(`Task ${JSON.stringify(t.name)} crashed`)
    }

    const locations = t.outputLocations.map(at => at.pathInUnit)
    if (status === 'OK') {
      await this.validateOutputs()
      this.tracker.registerVerdict(t.name, status, outputFile)
      await this.taskStore.recordTask(t.name, this.fp, this.dir, locations, 'OK')
      return
    }

    if (status === 'FAIL') {
      this.tracker.registerVerdict(t.name, status, outputFile)
      // TODO(imaman): should not record outputs if task has failed.
      await this.taskStore.recordTask(t.name, this.fp, this.dir, locations, status)
      return
    }

    shouldNeverHappen(status)
  }

  private async purgeOutputs(selected: boolean) {
    this.diagnose(`purging outputs`)
    const shadowedTasks = this.tracker.getTasksShadowedBy(this.taskName)
    const taskNames = [this.taskName, ...shadowedTasks]
    const tasks = taskNames.map(tn => this.tracker.getTask(tn))

    await promises(tasks).forEach(20, async task => {
      await this.purger.purgeOutputsOfTask(task, this.model, selected)
    })
  }
}
