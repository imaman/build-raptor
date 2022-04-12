import * as cache from '@actions/cache'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { computeObjectHash, Key, shouldNeverHappen, StorageClient } from 'misc'
import * as path from 'path'

export class ActionsCacheStorageClient implements StorageClient {
  static async create(rootDir: string, logger: Logger) {
    const ret = new ActionsCacheStorageClient(rootDir, logger)
    await fse.ensureDir(ret.workingDir)
    return ret
  }

  private readonly workingDir = '.build-raptor/cache/actions'

  private constructor(private readonly rootDir: string, private readonly logger: Logger) {
    if (!path.isAbsolute(rootDir)) {
      throw new Error(`rootDir must be an absolute path, got ${rootDir}`)
    }
  }

  private hash(key: Key): string {
    return computeObjectHash({ key })
  }

  private hashToFile(hash: string): string {
    return path.join(this.workingDir, hash)
  }

  async putObject(key: Key, content: string): Promise<void> {
    const h = this.hash(key)
    const f = this.hashToFile(h)
    await fse.writeFile(f, content)
    try {
      const t0 = Date.now()
      const cacheId = await cache.saveCache([f], h)
      this.logger.info(`putObject() took ${Date.now() - t0}ms`)
      this.logger.info(`successfully saved ${JSON.stringify(key)} to cache (cacheId=${cacheId}, hash=${h})`)
    } catch (e) {
      this.logger.error(`failed to save ${JSON.stringify(key)} to cache (hash=${h})`, e)
      throw e
    }
  }

  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  async getObject(key: Key, type: 'string' | 'buffer' = 'string'): Promise<string | Buffer> {
    const o = await this.restore(key)
    if (!o.restoredKey) {
      throw new Error(`Object not found (key=${JSON.stringify(key)})`)
    }
    const content = await fse.readFile(o.pathToRead)
    this.logger.info(`returning content for hash=${o.hash} buffer size=${content.length}`)
    return type === 'string' ? content.toString('utf-8') : type === 'buffer' ? content : shouldNeverHappen(type)
  }

  private async restore(key: Key) {
    const h = this.hash(key)
    const f = this.hashToFile(h)
    try {
      const t0 = Date.now()
      const restoredKey = await cache.restoreCache([f], h)
      this.logger.info(`restore() took ${Date.now() - t0}ms`)
      const pathToRead = path.join(this.rootDir, f)

      const ret = {
        restoredKey,
        pathToRead,
        key: JSON.stringify(key),
        hash: h,
      }
      this.logger.info(`Is ${JSON.stringify(key)} cached? ${restoredKey ? 'yes' : 'no'}`)
      return ret
    } catch (e) {
      this.logger.error(`failed to restore ${JSON.stringify(key)} from cache (hash=${h})`, e)
      throw e
    }
  }

  async objectExists(key: Key): Promise<boolean> {
    const o = await this.restore(key)
    const ret = o.restoredKey !== undefined
    this.logger.info(`object exists (key=${JSON.stringify(key)} ? ${ret}`)
    return ret
  }
}
