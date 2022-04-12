import { Int } from '.'
import { shouldNeverHappen } from './constructs'
import { computeObjectHash } from './misc'
import { Key, StorageClient } from './storage-client'

export class InMemoryStorageClient implements StorageClient {
  private byteCount_: Int = Int(0)
  constructor(private readonly sizeLimitInBytes: Int = Int(-1)) {}
  private readonly store = new Map<Key, string>()

  async putObject(key: Key, content: string): Promise<void> {
    const s = this.keyToString(key)
    const existing = this.store.get(s) ?? ''
    const newCount = this.byteCount_ + Buffer.from(content).length - Buffer.from(existing).length
    if (this.sizeLimitInBytes >= 0 && newCount > this.sizeLimitInBytes) {
      throw new Error(`size limit (${this.sizeLimitInBytes} bytes) will be exceeded.`)
    }
    this.store.set(s, content)
    this.byteCount_ = Int(newCount)
  }

  get byteCount() {
    return this.byteCount_
  }

  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  async getObject(key: Key, type: 'string' | 'buffer' = 'string'): Promise<string | Buffer> {
    const ret = this.store.get(this.keyToString(key))
    if (ret === undefined) {
      throw new Error(`No object with key ${JSON.stringify(key)}`)
    }

    return type === 'string' ? ret : type === 'buffer' ? Buffer.from(ret) : shouldNeverHappen(type)
  }

  async objectExists(key: Key): Promise<boolean> {
    return this.store.has(this.keyToString(key))
  }

  private keyToString(key: Key): string {
    return computeObjectHash({ key })
  }
}
