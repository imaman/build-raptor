import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { DirectoryScanner, sortBy } from 'misc'
import * as path from 'path'

import { Fingerprint } from './fingerprint'
import { Hasher } from './hasher'

interface CacheEntry {
  hasher: Hasher
  active: boolean
}

export type OnHasherClose = (h: Hasher, content?: string) => Promise<void>

export class Fingerprinter {
  private readonly fingerprintByPathInRepo = new Map<string, CacheEntry>()
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
    const cached = this.fingerprintByPathInRepo.get(pathInRepo)
    if (cached) {
      return cached
    }

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
    if (pathInRepo.endsWith('node_modules')) {
      hasher.close()
      this.logger.info(`not drilling into ${pathInRepo}`)
      return {
        hasher,
        active: false,
      }
    }

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
    this.logger.info(`hasher-closed ${hasher.name} -->`, hasher.toJSON())
    try {
      await this.onHasherClose(hasher, content)
    } catch (e) {
      this.logger.error(`onHasherClose() failed`, e)
      throw e
    }

    const ret = { hasher, active }
    if (!this.fingerprintByPathInRepo.has(hasher.name)) {
      // this.fingerprintByPathInRepo.set(hasher.name, ret)
    }
    return ret
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
