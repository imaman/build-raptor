import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { promises } from 'misc'
import * as path from 'path'

import { Task } from './task'

export class Purger {
  constructor(private readonly logger: Logger) {}
  async purgeOutpts(dir: string, t: Task) {
    await promises(t.outputLocations).forEach(20, async o => {
      await fse.rm(path.join(dir, o), { recursive: true, force: true })
    })
    this.logger.info(`purged output locations of task ${t.name}: ${t.outputLocations}`)
  }
}
