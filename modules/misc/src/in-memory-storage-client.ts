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
    const encoded = this.store.get(this.keyToString(key))
    if (encoded === undefined) {
      throw new Error(`No object with key ${JSON.stringify(key)}`)
    }

    const buf = Buffer.from(encoded, 'base64')
    return type === 'string' ? buf.toString('utf-8') : type === 'buffer' ? buf : shouldNeverHappen(type)
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
        throw new Error(`entry ${i} is not an array (got: ${typeof at})`)
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
