import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { promises, switchOn } from 'misc'
import * as path from 'path'

import { Model } from './model'
import { Task } from './task'
import { OutputLocation } from './task-info'

export class Purger {
  constructor(private readonly logger: Logger) {}

  private async removeLocations(dir: string, outputLocations: readonly string[], isRestore: boolean) {
    await promises(outputLocations).forEach(20, async o => {
      const p = path.join(dir, o)
      this.logger.info(`purging ${p} ${isRestore ? 'RESTORE' : ''}`)
      await fse.rm(p, { recursive: true, force: true })
    })
  }

  async purgeOutputsOfTask(task: Task, model: Model, isRestore: boolean) {
    const unit = model.getUnit(task.unitId)
    const dir = path.join(model.rootDir, unit.pathInRepo)
    const locationsToPurge = task.outputLocations.filter(at => shouldPurge(at, isRestore)).map(at => at.pathInUnit)
    await this.removeLocations(dir, locationsToPurge, isRestore)
    this.logger.info(`purged output locations of task ${task.name}: ${locationsToPurge}`)
    return task.outputLocations
  }
}

function shouldPurge(loc: OutputLocation, isRestore: boolean) {
  return switchOn(loc.purge, {
    ALWAYS: () => true,
    BEFORE_RESTORE: () => isRestore,
  })
}
