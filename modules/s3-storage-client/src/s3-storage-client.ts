import { S3 } from '@aws-sdk/client-s3'
import { computeObjectHash, Key, shouldNeverHappen, StorageClient, streamTobuffer } from 'misc'
import { Stream } from 'stream'
import * as util from 'util'

export class S3StorageClient implements StorageClient {
  private readonly s3 = new S3({})

  constructor(private readonly bucketName: string, private readonly pathPrefix: string) {
    if (pathPrefix.endsWith('/')) {
      throw new Error(`Illegal path prefix value`)
    }

    if (!pathPrefix.match(/^[a-zA-Z0-9][a-zA-Z0-9/_\-]*$/)) {
      throw new Error(`path prefix value is invalid`)
    }

    if (pathPrefix.includes('//')) {
      throw new Error(`path prefix value cannot include two consecutive slashes`)
    }
  }

  private resolvePath(key: Key): string {
    return `${this.pathPrefix}/${computeObjectHash({ key })}`
  }

  async putObject(key: Key, content: string | Buffer): Promise<void> {
    await this.s3.putObject({ Bucket: this.bucketName, Key: this.resolvePath(key), Body: content })
    return
  }

  getObject(key: Key): Promise<string>
  getObject(key: Key, type: 'string'): Promise<string>
  getObject(key: Key, type: 'buffer'): Promise<Buffer>
  async getObject(key: Key, type?: 'string' | 'buffer'): Promise<string | Buffer> {
    let resp
    try {
      resp = await this.s3.getObject({ Bucket: this.bucketName, Key: this.resolvePath(key) })
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
    if (type === 'buffer') {
      return buffer
    }

    if (type === 'string' || type === undefined) {
      return buffer.toString('utf-8')
    }

    shouldNeverHappen(type)
  }

  async objectExists(key: Key): Promise<boolean> {
    try {
      await this.s3.headObject({ Bucket: this.bucketName, Key: this.resolvePath(key) })
      return true
    } catch (e) {
      return false
    }
  }
}
