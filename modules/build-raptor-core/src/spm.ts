import { createDefaultLogger } from 'logger'
import * as path from 'path'

export async function spm() {
  const t0 = Date.now()
  const logger = createDefaultLogger(path.join(process.cwd(), 'spm.log'))
  logger.info(`SPM is running`, { a: 1, b: 2, c: 3 })
  try {
    logger.info(`things are about to get interesting`)
    throw new Error(`Houston, we have a problem`)
  } catch (err) {
    logger.error(`Oh-no`, err)
    process.exitCode = 1
  } finally {
    const dt = Date.now() - t0
    logger.info(`SPM out in ${dt}ms`)
  }
}

spm()
