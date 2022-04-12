import * as fse from 'fs-extra'
import * as path from 'path'

import { shouldNeverHappen } from '.'
import { computeObjectHash } from './misc'
import { Key, StorageClient } from './storage-client'

export class FilesystemStorageClient implements StorageClient {
  private constructor(private readonly dir: string) {}

  static async create(dir: string): Promise<FilesystemStorageClient> {
    await fse.ensureDir(dir)
    return new FilesystemStorageClient(dir)
  }

  private resolvePath(key: Key): string {
    return path.join(this.dir, computeObjectHash({ key }))
  }

  async putObject(key: Key, content: string): Promise<void> {
    await fse.writeFile(this.resolvePath(key), content)
  }

  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  async getObject(key: Key, type: 'string' | 'buffer' = 'string'): Promise<string | Buffer> {
    const p = this.resolvePath(key)
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
    return await fse.pathExists(this.resolvePath(key))
  }
}
