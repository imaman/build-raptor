import { Brand } from 'brand'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { computeHash, DirectoryScanner, Key, promises, StorageClient } from 'misc'
import * as path from 'path'
import * as stream from 'stream'
import { TaskName } from 'task-name'
import * as Tmp from 'tmp-promise'
import * as util from 'util'
import * as zlib from 'zlib'
import { z } from 'zod'

import { Fingerprint } from './fingerprint'

const metadataSchema = z.object({ outputs: z.string().array() })
type Metadata = z.infer<typeof metadataSchema>

type BlobId = Brand<string, 'BlobId'>

function validate(input: string): asserts input is BlobId {
  if (input.length === 0) {
    throw new Error(`Bad BlobId: <${input}>`)
  }
}

const BlobId: (s: string) => BlobId = (s: string) => {
  validate(s)
  return s
}

export class TaskStore {
  constructor(private readonly client: StorageClient, private readonly logger: Logger) {
    this.logger.info(`TaskStore created`)
  }

  private async putBlob(content: Buffer, hint: string): Promise<BlobId> {
    const ret = blobIdOf(content)
    if (content.length === 0) {
      return ret
    }
    const key = { type: 'blob', blobId: ret }
    if (await this.client.objectExists(key)) {
      return ret
    }

    const putResult = await this.client.putObject(key, content)
    this.logger.info(`>>> uploaded ${hint} to ${putResult}`)
    return ret
  }

  private async getBlob(blobId: BlobId): Promise<Buffer> {
    const nothing = emptyBuffer()
    if (blobId === blobIdOf(nothing)) {
      return nothing
    }
    return await this.client.getObject({ type: 'blob', blobId }, 'buffer')
  }

  private async getIfExists(k: Key): Promise<string | undefined> {
    const exists = await this.client.objectExists(k)
    if (!exists) {
      return undefined
    }

    return await this.client.getObject(k, 'string')
  }

  private async putVerdict(
    taskName: TaskName,
    fingerprint: Fingerprint,
    verdict: 'OK' | 'FAIL',
    blobId: BlobId,
  ): Promise<void> {
    const key = { type: 'verdict', taskName, fingerprint, verdict, version: 2 }
    // we put the key in the content for debugging purposes: it allows humans to understand what this object is
    // about when inspecting underlying storage (the key underwhich the object is stored key is likely to be hashed so
    // it is totally unreadable).
    await this.client.putObject(key, JSON.stringify({ key, blobId }))
  }

  private async getVerdict(
    taskName: TaskName,
    fingerprint: Fingerprint,
  ): Promise<['FLAKY' | 'OK' | 'FAIL' | 'UNKNOWN', BlobId]> {
    const baseKey = { type: 'verdict', taskName, fingerprint, version: 2 }
    const [ok, fail] = await Promise.all([
      this.getIfExists({ ...baseKey, verdict: 'OK' }),
      this.getIfExists({ ...baseKey, verdict: 'FAIL' }),
    ])

    const getBlobId = (content: string) => {
      const parsed = JSON.parse(content)
      // TODO(imaman): use zod to validate parsed
      return BlobId(parsed.blobId)
    }

    if (ok && fail) {
      return ['FLAKY', getBlobId(ok)]
    }

    if (ok) {
      return ['OK', getBlobId(ok)]
    }

    if (fail) {
      return ['FAIL', getBlobId(fail)]
    }

    return ['UNKNOWN', blobIdOf(emptyBuffer())]
  }

  private async bundle(dir: string, outputs: readonly string[]) {
    if (!outputs.length) {
      return emptyBuffer()
    }

    const metadata = JSON.stringify(metadataSchema.parse({ outputs }))

    const metadataBuf = Buffer.from(metadata, 'utf-8')
    if (metadataBuf.length > 100000) {
      // Just for sanity.
      throw new Error('metadata is too big')
    }
    const lenBuf = Buffer.alloc(LEN_BUF_SIZE)
    lenBuf.writeInt32BE(metadataBuf.length)

    const tempFile = await Tmp.file()
    // const destination = fse.createWriteStream(tempFile.path)

    const pack = TarStream.pack()
    const scanner = new DirectoryScanner(dir)
    for (const o of outputs) {
      const exists = await fse.pathExists(path.join(dir, o))
      if (!exists) {
        // TODO(imaman): turn this into a user-build-error? move it out of this file?
        throw new Error(`Output location <${o}> does not exist (under <${dir}>)`)
      }
      await scanner.scanTree(o, (p, content, stat) => {
        if (stat.isDirectory()) {
          return
        }

        if (stat.isSymbolicLink()) {
          throw new Error(`Cannot handle symlinks in output: ${p} (under ${dir})`)
        }

        if (!stat.isFile()) {
          throw new Error(`Cannot handle non-files in output: ${p} (under ${dir})`)
        }

        pack.entry({ name: p, size: stat.size, mode: stat.mode, mtime: stat.mtime, type: 'file' }, content)
      })
    }
    pack.finalize()

    await pack.writeTo(tempFile.path)

    const gzipped = await fse.readFile(tempFile.path)

    return Buffer.concat([lenBuf, metadataBuf, gzipped])
  }

  private async unbundle(buf: Buffer, dir: string) {
    if (buf.length === 0) {
      return
    }
    const metadataLen = buf.slice(0, LEN_BUF_SIZE).readInt32BE()

    const unparsed = JSON.parse(buf.slice(LEN_BUF_SIZE, LEN_BUF_SIZE + metadataLen).toString('utf-8'))
    const metadata: Metadata = metadataSchema.parse(unparsed)

    const removeOutputDir = async (o: string) => await fse.rm(path.join(dir, o), { recursive: true, force: true })
    await promises(metadata.outputs)
      .map(async o => await removeOutputDir(o))
      .reify(20)

    const source = buf.slice(LEN_BUF_SIZE + metadataLen)
    try {
      await TarStream.extract(source, dir)
    } catch (e) {
      throw new Error(`unbundling a buffer (${buf.length} bytes) into ${dir} has failed: ${e}`)
    }
  }

  async recordTask(
    taskName: TaskName,
    fingerprint: Fingerprint,
    dir: string,
    outputs: readonly string[],
    verdict: 'OK' | 'FAIL',
  ): Promise<void> {
    const buf = await this.bundle(dir, outputs)
    const blobId = await this.putBlob(buf, taskName)
    this.putVerdict(taskName, fingerprint, verdict, blobId)
  }

  async restoreTask(
    taskName: TaskName,
    fingerprint: Fingerprint,
    dir: string,
  ): Promise<'FAIL' | 'OK' | 'FLAKY' | 'UNKNOWN'> {
    const [verdict, blobId] = await this.getVerdict(taskName, fingerprint)
    const buf = await this.getBlob(blobId)
    await this.unbundle(buf, dir)
    return verdict
  }
}

function emptyBuffer() {
  return Buffer.from('')
}

function blobIdOf(buf: Buffer) {
  return BlobId(computeHash(buf))
}

const LEN_BUF_SIZE = 8


class TarStream {
  static pack() {
    return new TarStream()
  } 

  entry(u: unknown, content: Buffer) {}
  finalize() {}

  async writeTo(pathToFile: string) {
  }

  static async extract(source: Buffer, dir: string) {

  }
}
