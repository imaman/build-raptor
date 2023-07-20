import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { DirectoryScanner, sortBy } from 'misc'
import * as path from 'path'

import { Fingerprint } from './fingerprint'
import { Hasher } from './hasher'

export type OnHasherClose = (h: Hasher, content?: string) => Promise<void>

// TODO(imaman): use PathInRepo
export class Fingerprinter {
  constructor(
    private readonly dirScanner: DirectoryScanner,
    private readonly logger: Logger,
    private readonly onHasherClose: OnHasherClose = async () => {},
  ) {
    this.logger.info('Fingerprinter: constructed')
  }

  async computeFingerprint(pathInRepo: string): Promise<Fingerprint> {
    const { hasher } = await this.scan(pathInRepo)
    return hasher.digest
  }

  private async scan(pathInRepo: string) {
    const resolved = path.join(this.dirScanner.rootDir, pathInRepo)
    const stat = await statPath(resolved)

    const respectGitIgnore = this.dirScanner.isValid(pathInRepo, stat)

    const active = this.dirScanner.isValid(pathInRepo, stat)

    if (!stat.isDirectory()) {
      const content = await readFile(resolved)

      const hasher = new Hasher(pathInRepo)
      hasher.update(content)
      return await this.store(hasher, active, content.toString('utf-8'))
    }

    const hasher = new Hasher(pathInRepo)
    // TODO(imaman): do not fingerprint node_modules directories (and similar directories in other ecosystems)?

    const dirEntries = await readDir(resolved)
    for (const at of sortBy(dirEntries, e => e.name)) {
      const subPath = path.join(pathInRepo, at.name)
      const subResult = await this.scan(subPath)
      if (respectGitIgnore && !subResult.active) {
        continue
      }
      hasher.update(subResult.hasher)
    }

    return await this.store(hasher, active)
  }

  private async store(hasher: Hasher, active: boolean, content?: string) {
    hasher.close()
    try {
      await this.onHasherClose(hasher, content)
    } catch (e) {
      this.logger.error(`onHasherClose() failed`, e)
      throw e
    }

    return { hasher, active }
  }
}

async function readFile(p: string) {
  try {
    return await fse.readFile(p)
  } catch (e) {
    throw new Error(`Failed to read ${p}: ${e}`)
  }
}

async function statPath(p: string) {
  try {
    return await fse.stat(p)
  } catch (e) {
    throw new Error(`Failed to stat ${p}: ${e}`)
  }
}

async function readDir(p: string) {
  try {
    return await fse.readdir(p, { withFileTypes: true })
  } catch (e) {
    throw new Error(`Failed to read dir ${p}: ${e}`)
  }
}
