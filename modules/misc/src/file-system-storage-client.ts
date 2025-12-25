import * as fse from 'fs-extra'
import * as path from 'path'

import { shouldNeverHappen } from '.'
import { cleanDirectory } from './clean-directory'
import { computeHash, computeObjectHash } from './misc'
import { Key, StorageClient } from './storage-client'

interface Options {
  /**
   * If defined, cleanup of the directory will be triggered if the toal size (in bytes) of all files in the directory
   * exceeds this value. If undefined, no cleanup will take place.
   */
  triggerCleanupIfByteSizeExceeds?: number
}

export class FilesystemStorageClient implements StorageClient {
  private constructor(private readonly dir: string) {}

  static async create(dir: string, options?: Options): Promise<FilesystemStorageClient> {
    await fse.ensureDir(dir)

    const { triggerCleanupIfByteSizeExceeds } = options ?? {}
    if (triggerCleanupIfByteSizeExceeds) {
      cleanDirectory(dir, 0.5, triggerCleanupIfByteSizeExceeds)
    }
    return new FilesystemStorageClient(dir)
  }

  private keyToPath(key: Key): string {
    return this.hashToPath('std', computeObjectHash({ key }))
  }

  private hashToPath(middle: string, s: string) {
    return path.join(this.dir, `${middle}-${s}`)
  }

  async putObject(key: Key, content: string | Buffer): Promise<void> {
    await fse.writeFile(this.keyToPath(key), content)
  }

  async putContentAddressable(content: string | Buffer): Promise<string> {
    const ret = computeHash(content)
    const p = this.hashToPath('cas', ret)
    await fse.writeFile(p, content)
    return ret
  }

  async getContentAddressable(hash: string): Promise<Buffer> {
    const p = this.hashToPath('cas', hash)
    return await fse.readFile(p)
  }

  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  async getObject(key: Key, type: 'string' | 'buffer' = 'string'): Promise<string | Buffer> {
    const p = this.keyToPath(key)
    try {
      if (type === 'string') {
        return await fse.readFile(p, 'utf-8')
      }
      if (type === 'buffer') {
        return await fse.readFile(p)
      }
      shouldNeverHappen(type)
    } catch (e) {
      throw new Error(`getObject() failed to read file for key: ${JSON.stringify(key)}: ${e}`)
    }
  }

  async objectExists(key: Key): Promise<boolean> {
    return await fse.pathExists(this.keyToPath(key))
  }
}
