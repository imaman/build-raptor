import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { promises } from 'misc'
import * as path from 'path'

import { Model } from './model'
import { Task } from './task'

export class Purger {
  constructor(private readonly logger: Logger) {}

  private async removeLocations(dir: string, outputLocations: readonly string[]) {
    await promises(outputLocations).forEach(20, async o => {
      await fse.rm(path.join(dir, o), { recursive: true, force: true })
    })
  }

  async purgeOutputsOfTask(task: Task, model: Model, selected: boolean) {
    const unit = model.getUnit(task.unitId)
    const dir = path.join(model.rootDir, unit.pathInRepo)
    const locationsToPurge = task.outputLocations
      .filter(at => (selected ? at.purge === 'ALWAYS' : true))
      .map(at => at.pathInUnit)
    await this.removeLocations(dir, locationsToPurge)
    this.logger.info(`purged output locations of task ${task.name}: ${locationsToPurge}`)
    return task.outputLocations
  }
}
