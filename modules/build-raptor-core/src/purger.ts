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

  async purgeOutputsOfTask(task: Task, model: Model) {
    const unit = model.getUnit(task.unitId)
    const dir = path.join(model.rootDir, unit.pathInRepo)
    await this.removeLocations(dir, task.outputLocations)
    this.logger.info(`purged output locations of task ${task.name}: ${task.outputLocations}`)
    return task.outputLocations
  }
}
