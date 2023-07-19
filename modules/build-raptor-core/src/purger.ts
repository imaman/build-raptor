import { PathInRepo } from 'core-types'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { promises, switchOn } from 'misc'

import { Task } from './task'
import { OutputLocation } from './task-info'

export class Purger {
  constructor(private readonly logger: Logger) {}

  private async removeLocations(outputLocations: readonly PathInRepo[]) {
    await promises(outputLocations).forEach(20, async p => {
      this.logger.info(`purging ${p}`)
      await fse.rm(p, { recursive: true, force: true })
    })
  }

  async purgeOutputsOfTask(task: Task) {
    const locationsToPurge = task.outputLocations.filter(at => shouldPurge(at)).map(at => at.pathInRepo)
    await this.removeLocations(locationsToPurge)
    this.logger.info(`purged output locations of task ${task.name}: ${locationsToPurge}`)
    return task.outputLocations
  }
}

function shouldPurge(loc: OutputLocation) {
  return switchOn(loc.purge, {
    ALWAYS: () => true,
    NEVER: () => false,
  })
}
