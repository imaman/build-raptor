import { Int } from '.'
import { shouldNeverHappen } from './constructs'
import { computeHash, computeObjectHash } from './misc'
import { Key, StorageClient } from './storage-client'

export class InMemoryStorageClient implements StorageClient {
  private byteCount_: Int = Int(0)
  constructor(private readonly sizeLimitInBytes: Int = Int(-1)) {}

  private readonly store = new Map<Key, string>()

  async putObject(key: Key, content: string | Buffer): Promise<void> {
    this.putObjectImpl(this.keyToString(key), content)
  }

  private putObjectImpl(s: string, content: string | Buffer) {
    const existing = this.store.get(s) ?? ''
    const newCount = this.byteCount_ + Buffer.from(content).length - Buffer.from(existing).length
    if (this.sizeLimitInBytes >= 0 && newCount > this.sizeLimitInBytes) {
      throw new Error(`size limit (${this.sizeLimitInBytes} bytes) will be exceeded.`)
    }

    this.store.set(s, typeof content === 'string' ? content : content.toString('utf-8'))
    this.byteCount_ = Int(newCount)
  }

  async putContentAddressable(content: string | Buffer): Promise<string> {
    const ret = `cas/${computeHash(content)}`
    this.putObjectImpl(ret, content)
    return ret
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
    return `std/${computeObjectHash({ key })}`
  }
}
