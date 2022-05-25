import { BuildFailedError } from 'build-failed-error'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { promises, shouldNeverHappen, sortBy, TypedPublisher } from 'misc'
import * as path from 'path'
import { ExitStatus, RepoProtocol } from 'repo-protocol'
import { TaskName } from 'task-name'

import { EngineEventScheme } from './engine-event-scheme'
import { Fingerprint } from './fingerprint'
import { FingerprintLedger } from './fingerprint-ledger'
import { Model } from './model'
import { Purger } from './purger'
import { TaskStore } from './task-store'
import { TaskTracker } from './task-tracker'

/**
 * An object that is reponsible for executing a task.
 */
export class TaskExecutor {
  constructor(
    private readonly taskName: TaskName,
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
        const resolved = path.join(this.model.rootDir, unit.pathInRepo, loc)
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
   *
   * @returns the name of another task to execute. Returning `this.taskName` means "no other task to execute".
   */
  async executeTask(): Promise<TaskName> {
    const t = this.task
    if (this.tracker.hasVerdict(t.name)) {
      return t.name
    }

    const shadowing = this.tracker.getShadowingTask(t.name)
    if (shadowing) {
      return shadowing
    }

    await this.executeUnshadowedTask()
    return t.name
  }

  private async executeUnshadowedTask() {
    const t = this.task
    this.tracker.changeStatus(t.name, 'RUNNING')

    const fp = await this.computeFingerprint()
    const unit = this.unit
    const dir = path.join(this.model.rootDir, unit.pathInRepo)

    if (this.tracker.isShadowed(t.name)) {
      await this.validateOutputs()
      // TODO(imaman): report the shadowing task in the event.
      await this.eventPublisher.publish('executionShadowed', t.name)
      this.tracker.registerShadowedVerdict(t.name, 'OK')
      await this.taskStore.recordTask(t.name, fp, dir, t.outputLocations, 'OK')
      return
    }

    await this.purgeOutputs()

    const earlierVerdict = await this.taskStore.restoreTask(t.name, fp, dir)

    if (earlierVerdict === 'OK' || earlierVerdict === 'FLAKY') {
      await this.eventPublisher.publish('executionSkipped', t.name)
      this.tracker.registerCachedVerdict(t.name, earlierVerdict)
      return
    }

    if (earlierVerdict === 'FAIL' || earlierVerdict === 'UNKNOWN') {
      await this.eventPublisher.publish('executionStarted', t.name)
      const outputFile = path.join(this.taskOutputDir, `${t.id}.stdout`)
      const status = await this.repoProtocol.execute(unit, dir, t.kind, outputFile, this.model.buildRunId)
      await this.postProcess(status, outputFile)
      if (status === 'CRASH') {
        throw new Error(`Task ${JSON.stringify(t.name)} crashed`)
      }

      if (status === 'OK') {
        await this.validateOutputs()
        this.tracker.registerVerdict(t.name, status, outputFile)
        await this.taskStore.recordTask(t.name, fp, dir, t.outputLocations, status)
        return
      }

      if (status === 'FAIL') {
        this.tracker.registerVerdict(t.name, status, outputFile)
        // TODO(imaman): should not record outputs if task has failed.
        await this.taskStore.recordTask(t.name, fp, dir, t.outputLocations, status)
        return
      }

      shouldNeverHappen(status)
    }

    shouldNeverHappen(earlierVerdict)
  }

  private async purgeOutputs() {
    const shadowedTasks = this.tracker.getTasksShadowedBy(this.taskName)
    const taskNames = [this.taskName, ...shadowedTasks]
    const tasks = taskNames.map(tn => this.tracker.getTask(tn))

    await promises(tasks).forEach(20, async task => {
      await this.purger.purgeOutputsOfTask(task, this.model)
    })
  }
}
