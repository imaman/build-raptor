import { S3 } from '@aws-sdk/client-s3'
import { Logger } from 'logger'
import { computeHash, computeObjectHash, Key, shouldNeverHappen, StorageClient, streamTobuffer } from 'misc'
import { Stream } from 'stream'
import * as util from 'util'

interface Credentials {
  accessKeyId: string
  secretAccessKey: string
}

export class S3StorageClient implements StorageClient {
  private readonly s3

  constructor(
    private readonly bucketName: string,
    private readonly pathPrefix: string,
    credentials: Credentials,
    private readonly logger: Logger,
  ) {
    if (pathPrefix.endsWith('/')) {
      throw new Error(`Illegal path prefix value`)
    }

    if (!pathPrefix.match(/^[a-zA-Z0-9][a-zA-Z0-9/_\-]*$/)) {
      throw new Error(`path prefix value is invalid`)
    }

    if (pathPrefix.includes('//')) {
      throw new Error(`path prefix value cannot include two consecutive slashes`)
    }

    this.s3 = new S3({ credentials, region: 'eu-central-1' })
  }

  private keyToPath(key: Key): string {
    return this.hashToPath('std', computeObjectHash({ key }))
  }

  private hashToPath(middle: string, hash: string): string {
    return `${this.pathPrefix}/${middle}/${hash}`
  }

  async putContentAddressable(content: string | Buffer): Promise<string> {
    const hash = computeHash(content)
    await this.putObjectImpl(this.hashToPath('cas', hash), hash, content)
    return hash
  }

  async putObject(key: Key, content: string | Buffer): Promise<void> {
    await this.putObjectImpl(this.keyToPath(key), key, content)
  }

  private async putObjectImpl(resolved: string, hint: unknown, content: string | Buffer): Promise<string> {
    this.logger.info(`putting object (key hint=${hint}), object length: ${content.toString().length} chars`)

    try {
      await this.s3.putObject({ Bucket: this.bucketName, Key: resolved, Body: content })
    } catch (e) {
      this.logger.error(`putObject error at ${resolved} (key hint=${hint}), `, e)
      throw new Error(`Failed to put an object into the persistent storage`)
    }
    return resolved
  }

  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  async getObject(key: Key, type?: 'string' | 'buffer'): Promise<string | Buffer> {
    let resp
    try {
      resp = await this.s3.getObject({ Bucket: this.bucketName, Key: this.keyToPath(key) })
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const typed = e as { message?: string }
      throw new Error(`Failed to read an object from S3: ${typed.message ?? util.inspect(e)}`)
    }

    const body = resp.Body
    if (!body) {
      throw new Error(`Body is falsy`)
    }

    if (!(body instanceof Stream)) {
      throw new Error(`unsupported type of body (type: ${typeof body})`)
    }

    const buffer = await streamTobuffer(body)
    this.logger.info(`returning an object from key ${JSON.stringify(key)}, buffer length: ${buffer.length} bytes`)
    if (type === 'buffer') {
      return buffer
    }

    if (type === 'string' || type === undefined) {
      return buffer.toString('utf-8')
    }

    shouldNeverHappen(type)
  }

  async objectExists(key: Key): Promise<boolean> {
    this.logger.info(`checking existence of object at key ${JSON.stringify(key)}`)
    try {
      await this.s3.headObject({ Bucket: this.bucketName, Key: this.keyToPath(key) })
      return true
    } catch (e) {
      return false
    }
  }
}
