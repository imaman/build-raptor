import { Brand } from 'brand'
import { PathInRepo, RepoRoot } from 'core-types'
import * as fs from 'fs'
import { createWriteStream } from 'fs'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { computeHash, computeObjectHash, DirectoryScanner, Key, promises, StorageClient, TypedPublisher } from 'misc'
import * as stream from 'stream'
import { TaskName } from 'task-name'
import * as Tmp from 'tmp-promise'
import * as util from 'util'
import * as zlib from 'zlib'
import { z } from 'zod'

import { Fingerprint } from './fingerprint'
import { TarStream } from './tar-stream'
import { TaskStoreEvent } from './task-store-event'

const pipeline = util.promisify(stream.pipeline)
const unzip = util.promisify(zlib.unzip)

const Metadata = z.object({ outputs: z.string().array() })
type Metadata = z.infer<typeof Metadata>

export type BlobId = Brand<string, 'BlobId'>

function validate(input: string): asserts input is BlobId {
  if (input.length === 0) {
    throw new Error(`Bad BlobId: <${input}>`)
  }
}

export const BlobId: (s: string) => BlobId = (s: string) => {
  validate(s)
  return s
}

export class TaskStore {
  constructor(
    readonly repoRootDir: RepoRoot,
    private readonly client: StorageClient,
    private readonly logger: Logger,
    private readonly publisher?: TypedPublisher<TaskStoreEvent>,
    private readonly trace?: string[],
  ) {
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

    this.trace?.push(`putting object: ${JSON.stringify(ret)} (hint: ${hint})=> ${content.length}`)
    await this.client.putObject(key, content)
    this.logger.info(`>>> uploaded ${hint}`)
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

  private async bundle(outputs: PathInRepo[]) {
    if (!outputs.length) {
      return emptyBuffer()
    }

    this.trace?.push(`bundling ${JSON.stringify(outputs)}`)

    const m: Metadata = { outputs: outputs.map(o => o.val) }
    const metadataBuf = Buffer.from(JSON.stringify(Metadata.parse(m)), 'utf-8')
    if (metadataBuf.length > 100000) {
      // Just for sanity.
      throw new Error('metadata is too big')
    }
    const lenBuf = Buffer.alloc(LEN_BUF_SIZE)
    lenBuf.writeInt32BE(metadataBuf.length)

    const tempFile = await Tmp.file()

    const pack = TarStream.pack()
    const scanner = new DirectoryScanner(this.repoRootDir.resolve())
    for (const o of outputs) {
      const exists = await fse.pathExists(this.repoRootDir.resolve(o))
      if (!exists) {
        // TODO(imaman): turn this into a user-build-error? move it out of this file?
        throw new Error(`Output location <${o}> does not exist (under <${this.repoRootDir}>)`)
      }
      await scanner.scanTree(o.val, (p, content, stat) => {
        if (stat.isDirectory()) {
          return
        }

        if (stat.isSymbolicLink()) {
          throw new Error(`Cannot handle symlinks in output: ${p} (under ${this.repoRootDir})`)
        }

        if (!stat.isFile()) {
          throw new Error(`Cannot handle non-files in output: ${p} (under ${this.repoRootDir})`)
        }

        const resolved = this.repoRootDir.resolve(PathInRepo(p))

        // the return value of fs.stat() and friends has counterintuitive behavior: .mtimeMs will undeterministically
        // include fractions of ms (e.g., 1690808418692.3323). Thus we're sticking with .mtime.getTime(). Similarly for
        // atime, ctime.
        const { mtime, atime, ctime } = fs.statSync(resolved)
        this.trace?.push(`adding an entry: ${stat.mode.toString(8)} ${p} ${mtime.toISOString()}`)
        pack.entry({ path: p, mode: stat.mode, mtime, ctime, atime, isSymlink: false }, content)
      })
    }

    const b = pack.toBuffer()
    this.trace?.push(`digest of b is ${computeObjectHash({ data: b.toString('hex') })}`)
    const source = stream.Readable.from(b)
    const gzip = zlib.createGzip()
    const destination = createWriteStream(tempFile.path)
    await pipeline(source, gzip, destination)

    const gzipped = await fse.readFile(tempFile.path)
    this.trace?.push(`gzipped is ${gzipped.length} long`)

    const ret = Buffer.concat([lenBuf, metadataBuf, gzipped])
    this.trace?.push(`bundling digest of ret is ${computeObjectHash({ data: ret.toString('hex') })}`)
    return ret
  }

  private async unbundle(buf: Buffer) {
    if (buf.length === 0) {
      return []
    }
    const metadataLen = buf.slice(0, LEN_BUF_SIZE).readInt32BE()

    const unparsed = JSON.parse(buf.slice(LEN_BUF_SIZE, LEN_BUF_SIZE + metadataLen).toString('utf-8'))
    const metadata: Metadata = Metadata.parse(unparsed)
    const outputs = metadata.outputs.map(at => PathInRepo(at))

    const removeOutputDir = async (o: PathInRepo) =>
      await fse.rm(this.repoRootDir.resolve(o), { recursive: true, force: true })
    await promises(outputs)
      .map(async o => await removeOutputDir(o))
      .reify(20)

    const source = buf.slice(LEN_BUF_SIZE + metadataLen)
    const unzipped = await unzip(source)
    try {
      await TarStream.extract(unzipped, this.repoRootDir.resolve(), this.logger)
    } catch (e) {
      throw new Error(`unbundling a buffer (${buf.length} bytes) has failed: ${e}`)
    }
    return outputs
  }

  async recordTask(
    taskName: TaskName,
    fingerprint: Fingerprint,
    outputs: PathInRepo[],
    verdict: 'OK' | 'FAIL',
  ): Promise<void> {
    const blobId = await this.recordBlob(taskName, outputs)
    this.putVerdict(taskName, fingerprint, verdict, blobId)
    this.publisher?.publish('taskStore', {
      opcode: 'RECORDED',
      taskName,
      blobId,
      fingerprint,
      files: [...outputs.map(o => o.val)],
    })
  }

  private async recordBlob(taskName: TaskName, outputs: PathInRepo[]) {
    const buf = await this.bundle(outputs)
    const blobId = await this.putBlob(buf, taskName)
    return blobId
  }

  async restoreTask(taskName: TaskName, fingerprint: Fingerprint): Promise<'FAIL' | 'OK' | 'FLAKY' | 'UNKNOWN'> {
    const [verdict, blobId] = await this.getVerdict(taskName, fingerprint)
    const files = await this.restoreBlob(blobId)
    this.publisher?.publish('taskStore', {
      opcode: 'RESTORED',
      taskName,
      blobId,
      fingerprint,
      files: files.map(o => o.val),
    })
    return verdict
  }

  async restoreBlob(blobId: BlobId) {
    const buf = await this.getBlob(blobId)
    const files = await this.unbundle(buf)
    return files
  }

  async checkVerdict(taskName: TaskName, fingerprint: Fingerprint): Promise<'FAIL' | 'OK' | 'FLAKY' | 'UNKNOWN'> {
    const [verdict] = await this.getVerdict(taskName, fingerprint)
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
