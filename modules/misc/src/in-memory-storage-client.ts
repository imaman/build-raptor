import { Int } from '.'
import { failMe, shouldNeverHappen } from './constructs'
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
    const existing = Buffer.from(this.store.get(s) ?? '', 'base64')

    const bufferToStore = Buffer.from(content).toString('base64')

    const newCount = this.byteCount_ + bufferToStore.length - existing.length
    if (this.sizeLimitInBytes >= 0 && newCount > this.sizeLimitInBytes) {
      throw new Error(`size limit (${this.sizeLimitInBytes} bytes) will be exceeded.`)
    }

    this.store.set(s, bufferToStore)
    this.byteCount_ = Int(newCount)
  }

  async putContentAddressable(content: string | Buffer): Promise<string> {
    const ret = computeHash(content)
    const p = `cas/${ret}`
    this.putObjectImpl(p, content)
    return ret
  }

  async getContentAddressable(hash: string): Promise<Buffer> {
    return await this.getObjectImpl(`cas/${hash}`)
  }

  get byteCount() {
    return this.byteCount_
  }

  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  async getObject(key: Key, type: 'string' | 'buffer' = 'string'): Promise<string | Buffer> {
    const buf = await this.getObjectImpl(this.keyToString(key))
    return type === 'string' ? buf.toString('utf-8') : type === 'buffer' ? buf : shouldNeverHappen(type)
  }

  private async getObjectImpl(p: string): Promise<Buffer> {
    const encoded = this.store.get(p)
    if (encoded === undefined) {
      throw new Error(`No object with key ${JSON.stringify(p)}`)
    }
    return Buffer.from(encoded, 'base64')
  }

  async objectExists(key: Key): Promise<boolean> {
    return this.store.has(this.keyToString(key))
  }

  private keyToString(key: Key): string {
    return `std/${computeObjectHash({ key })}`
  }

  toJSON() {
    return [...this.store]
  }

  load(u: unknown) {
    if (!Array.isArray(u)) {
      throw new Error(`not an array`)
    }

    u.forEach((at, i) => {
      if (!Array.isArray(at)) {
        throw new Error(`entry ${i} is not a pair (got: ${typeof at})`)
      }
      if (at.length !== 2) {
        throw new Error(`entry ${i} is not a pair (length: ${at.length})`)
      }

      const strings = at.map(x =>
        typeof x === 'string' ? x : failMe(`expected a pair of strings but found a ${typeof x} at pair ${i}`),
      )
      this.putObjectImpl(strings[0], Buffer.from(strings[1], 'base64'))
    })
  }
}
