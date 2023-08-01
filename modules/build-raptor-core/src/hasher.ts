import * as crypto from 'crypto'
import { pairsToRecord } from 'misc'

import { Fingerprint } from './fingerprint'

export class Hasher {
  private readonly hash = crypto.createHash('sha224').update('3')
  private readonly audit = new Map<string, string>()
  private status: 'OPEN' | 'CLOSED' = 'OPEN'

  private count = 0

  private digest_: Fingerprint | undefined

  constructor(readonly name: string) {}

  update(arg: crypto.BinaryLike | Hasher) {
    if (this.status === 'CLOSED') {
      throw new Error(`Cannot update a hasher that is already closed (name=${this.name})`)
    }

    if (arg instanceof Hasher) {
      if (arg.count === 0) {
        return
      }
      this.hash.update(arg.digest)
      this.audit.set(arg.name, arg.digest)
    } else {
      this.hash.update(arg)
    }

    ++this.count
  }

  close() {
    if (this.status === 'CLOSED') {
      throw new Error(`Hasher already closed (name=${this.name})`)
    }
    this.status = 'CLOSED'
  }

  toJSON() {
    return {
      hasherName: this.name,
      status: this.status,
      digest: this.status === 'OPEN' ? undefined : this.digest,
      audit: pairsToRecord(this.audit),
    }
  }

  toString() {
    return JSON.stringify(this.toJSON())
  }

  get digest() {
    if (this.status === 'OPEN') {
      throw new Error(`Cannot compute digest of an open hasher (name=${this.name})`)
    }
    if (this.digest_) {
      return this.digest_
    }
    this.digest_ = Fingerprint(this.hash.digest('hex'))
    return this.digest_
  }
}
