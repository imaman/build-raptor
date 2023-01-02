import { Brand } from 'brand'
import * as child_process from 'child_process'
import * as fs from 'fs'
import { createWriteStream } from 'fs'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { computeHash, computeObjectHash, DirectoryScanner, Key, promises, StorageClient, TypedPublisher } from 'misc'
import * as path from 'path'
import * as stream from 'stream'
import { TaskName } from 'task-name'
import * as Tmp from 'tmp-promise'
import * as util from 'util'
import * as zlib from 'zlib'
import { z } from 'zod'

import { Fingerprint } from './fingerprint'
import { TaskStoreEvent } from './task-store-event'

const pipeline = util.promisify(stream.pipeline)
const unzip = util.promisify(zlib.unzip)

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
  constructor(
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

  private async bundle(dir: string, outputs: readonly string[]) {
    if (!outputs.length) {
      return emptyBuffer()
    }

    this.trace?.push(`bundling ${dir}, outputs=${JSON.stringify(outputs)}`)

    const metadata = JSON.stringify(metadataSchema.parse({ outputs }))

    const metadataBuf = Buffer.from(metadata, 'utf-8')
    if (metadataBuf.length > 100000) {
      // Just for sanity.
      throw new Error('metadata is too big')
    }
    const lenBuf = Buffer.alloc(LEN_BUF_SIZE)
    lenBuf.writeInt32BE(metadataBuf.length)

    const tempFile = await Tmp.file()

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

        const resolved = path.join(dir, p)
        const { atimeNs, ctimeNs, mtimeNs } = fs.statSync(resolved, { bigint: true })
        this.trace?.push(`adding an entry: ${stat.mode.toString(8)} ${p} ${mtimeNs}`)
        pack.entry({ path: p, mode: stat.mode, mtime: mtimeNs, ctime: ctimeNs, atime: atimeNs }, content)
      })
    }

    const b = pack.toBuffer()
    this.trace?.push(`bundling of ${dir} -- digest of b is ${computeObjectHash({ data: b.toString('hex') })}`)
    const source = stream.Readable.from(b)
    const gzip = zlib.createGzip()
    const destination = createWriteStream(tempFile.path)
    await pipeline(source, gzip, destination)

    const gzipped = await fse.readFile(tempFile.path)
    this.trace?.push(`gzipped of ${dir} is ${gzipped.length} long`)

    const ret = Buffer.concat([lenBuf, metadataBuf, gzipped])
    this.trace?.push(`bundling of ${dir} -- digest of ret is ${computeObjectHash({ data: ret.toString('hex') })}`)
    return ret
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
    const unzipped = await unzip(source)
    try {
      await TarStream.extract(unzipped, dir)
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
    this.publisher?.publish('taskRecorded', { taskName, blobId })
  }

  async restoreTask(
    taskName: TaskName,
    fingerprint: Fingerprint,
    dir: string,
  ): Promise<'FAIL' | 'OK' | 'FLAKY' | 'UNKNOWN'> {
    const [verdict, blobId] = await this.getVerdict(taskName, fingerprint)
    const buf = await this.getBlob(blobId)
    await this.unbundle(buf, dir)
    this.publisher?.publish('taskRestored', { taskName, blobId })
    return verdict
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

const Info = z.object({
  path: z.string(),
  mode: z.number(),
  mtime: z.string(),
  contentLen: z.number(),
})
type Info = z.infer<typeof Info>

interface Entry {
  content: Buffer
  info: Info
}

// TOOD(imaman): move to its own file + rename
class TarStream {
  private readonly entires: Entry[] = []
  static pack() {
    return new TarStream()
  }

  entry(inf: { path: string; mode: number; mtime: bigint; atime: bigint; ctime: bigint }, content: Buffer) {
    const info: Info = {
      path: inf.path,
      contentLen: content.length,
      mtime: String(inf.mtime),
      mode: inf.mode,
    }
    this.entires.push({ content, info })
  }

  toBuffer() {
    let sum = 0
    for (const entry of this.entires) {
      const b = Buffer.from(JSON.stringify(Info.parse(entry.info)))
      sum += 4 + b.length + entry.content.length
    }

    const ret = Buffer.alloc(sum)
    let offset = 0

    for (const entry of this.entires) {
      const b = Buffer.from(JSON.stringify(Info.parse(entry.info)))
      offset = ret.writeInt32BE(b.length, offset)
      offset += b.copy(ret, offset)
      offset += entry.content.copy(ret, offset)
    }

    if (sum !== offset) {
      throw new Error(`Mismatch: sum=${sum}, offset=${offset}`)
    }

    return ret
  }

  static async extract(source: Buffer, dir: string) {
    const resolve = (p: string) => path.join(dir, p)
    let offset = 0

    while (offset < source.length) {
      const atStart = offset

      const infoLen = source.readInt32BE(offset)
      offset += 4

      const infoBuf = Buffer.alloc(infoLen)
      const endOffset = offset + infoLen
      source.copy(infoBuf, 0, offset, endOffset)
      offset = endOffset

      const untyped = JSON.parse(infoBuf.toString('utf-8'))
      const parsedInfo = Info.parse(untyped)

      const { contentLen } = parsedInfo

      const contentBuf = Buffer.alloc(contentLen)

      const contentEndOffset = offset + contentLen
      source.copy(contentBuf, 0, offset, contentEndOffset)
      offset = contentEndOffset

      const resolved = resolve(parsedInfo.path)
      await fse.mkdirp(path.dirname(resolved))
      await fse.writeFile(resolved, contentBuf)
      await fse.chmod(resolved, parsedInfo.mode)

      const ns = BigInt(parsedInfo.mtime)

      const RATIO = 1000000n
      const ts = new Date(Number(ns / RATIO)).toISOString().slice(0, -1)
      const decimal = String(ns % RATIO).padStart(6, '0')
      const command = `touch -d "${ts}${decimal}Z" "${resolved}"`
      child_process.execSync(command, { stdio: 'inherit' })

      if (offset === atStart) {
        throw new Error(`Buffer seems to be corrupted: no offset change at the last pass ${offset}`)
      }
    }
  }
}

// 1
