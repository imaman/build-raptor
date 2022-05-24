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

export class TaskExecutor {
  constructor(
    private readonly taskName: TaskName,
    private readonly model: Model,
    private readonly taskTracker: TaskTracker,
    private readonly logger: Logger,
    private readonly repoProtocol: RepoProtocol,
    private readonly taskStore: TaskStore,
    private readonly taskOutputDir: string,
    private readonly eventPublisher: TypedPublisher<EngineEventScheme>,
    private readonly fingerprintLedger: FingerprintLedger,
    private readonly purger: Purger,
  ) {}

  private get task() {
    return this.taskTracker.getTask(this.taskName)
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

  async executeTask(_taskName: TaskName, _model: Model, _taskTracker: TaskTracker) {
    const { taskTracker, model } = this
    const taskName = this.taskName
    this.taskTracker.changeStatus(taskName, 'RUNNING')

    const t = this.task

    const fp = await this.computeFingerprint()
    const unit = this.unit
    const dir = path.join(model.rootDir, unit.pathInRepo)

    if (taskTracker.isShadowed(t.name)) {
      await this.validateOutputs()
      // TODO(imaman): report the shadowing task it in the event.
      await this.eventPublisher.publish('executionShadowed', taskName)
      taskTracker.registerShadowedVerdict(taskName, 'OK')
      await this.taskStore.recordTask(taskName, fp, dir, t.outputLocations, 'OK')
      return
    }

    const shadowedTasks = taskTracker.getTasksShadowedBy(t.name)
    await this.purgeOutputs([taskName, ...shadowedTasks], model, taskTracker)

    const earlierVerdict = await this.taskStore.restoreTask(taskName, fp, dir)

    if (earlierVerdict === 'OK' || earlierVerdict === 'FLAKY') {
      await this.eventPublisher.publish('executionSkipped', taskName)
      taskTracker.registerCachedVerdict(taskName, earlierVerdict)
      return
    }

    if (earlierVerdict === 'FAIL' || earlierVerdict === 'UNKNOWN') {
      await this.eventPublisher.publish('executionStarted', taskName)
      const outputFile = path.join(this.taskOutputDir, `${t.id}.stdout`)
      const status = await this.repoProtocol.execute(unit, dir, t.kind, outputFile, model.buildRunId)
      await this.postProcess(status, outputFile)
      if (status === 'CRASH') {
        throw new Error(`Task ${JSON.stringify(taskName)} crashed`)
      }

      if (status === 'OK') {
        await this.validateOutputs()
        taskTracker.registerVerdict(taskName, status, outputFile)
        await this.taskStore.recordTask(taskName, fp, dir, t.outputLocations, status)
        return
      }

      if (status === 'FAIL') {
        taskTracker.registerVerdict(taskName, status, outputFile)
        // TODO(imaman): should not record outputs if task has failed.
        await this.taskStore.recordTask(taskName, fp, dir, t.outputLocations, status)
        return
      }

      shouldNeverHappen(status)
    }

    shouldNeverHappen(earlierVerdict)
  }

  private async purgeOutputs(taskNames: TaskName[], model: Model, taskTracker: TaskTracker) {
    await promises(taskNames).forEach(20, async tn => {
      const task = taskTracker.getTask(tn)
      await this.purger.purgeOutputsOfTask(task, model)
    })
  }
}
