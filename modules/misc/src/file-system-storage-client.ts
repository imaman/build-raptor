import * as fse from 'fs-extra'
import * as path from 'path'

import { shouldNeverHappen } from '.'
import { computeHash, computeObjectHash } from './misc'
import { Key, StorageClient } from './storage-client'

export class FilesystemStorageClient implements StorageClient {
  private constructor(private readonly dir: string) {}

  static async create(dir: string): Promise<FilesystemStorageClient> {
    await fse.ensureDir(dir)
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
    const ret = this.hashToPath('cas', computeHash(content))
    await fse.writeFile(ret, content)
    return ret
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
