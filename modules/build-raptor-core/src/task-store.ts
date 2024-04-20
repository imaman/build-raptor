import { Brand } from 'brand'
import { BuildFailedError } from 'build-failed-error'
import { PathInRepo, RepoRoot } from 'core-types'
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
import { TarStream } from './tar-stream'
import { TaskStoreEvent } from './task-store-event'

type OutputDescriptor = { pathInRepo: PathInRepo; isPublic: boolean }

const pipeline = util.promisify(stream.pipeline)
const unzip = util.promisify(zlib.unzip)

const Metadata = z.object({
  /**
   * An array of output locations (paths in repo)
   */
  outputs: z.string().array(),
  /**
   * A record that maps output locations (path in repo) to content hashes. Include output location that were defined in
   * the TaskInfo with isPublic: true. This allows downloading the content from a content-addressable storage.
   */
  publicFiles: z.record(z.string(), z.string()).default({}),
})
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

  private async bundle(outputs: OutputDescriptor[]) {
    if (!outputs.length) {
      return { buffer: emptyBuffer(), publicFiles: {} }
    }

    this.trace?.push(`bundling ${JSON.stringify(outputs)}`)

    const pairs = await promises(outputs.filter(o => o.isPublic))
      .map(async o => {
        const resolved = this.repoRootDir.resolve(o.pathInRepo)
        const stat = fs.statSync(resolved)
        if (!stat.isFile()) {
          throw new BuildFailedError(`cannot publish an output location that is not a file: "${o.pathInRepo.val}"`)
        }
        const content = fs.readFileSync(resolved)
        const h = await this.client.putContentAddressable(content)
        return [o.pathInRepo.val, h] as const
      })
      .reify(STORAGE_CONCURRENCY)

    const m: Metadata = { outputs: outputs.map(o => o.pathInRepo.val), publicFiles: Object.fromEntries(pairs) }
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
    for (const curr of outputs.filter(o => !o.isPublic)) {
      const o = curr.pathInRepo
      const exists = await fse.pathExists(this.repoRootDir.resolve(o))
      if (!exists) {
        // TODO(imaman): turn this into a user-build-error? move it out of this file?
        throw new Error(`Output location <${o}> does not exist (under <${this.repoRootDir}>)`)
      }
      await scanner.scanTree(o.val, (p, content, stat) => {
        if (stat.isDirectory()) {
          return
        }

        if (!stat.isSymbolicLink() && !stat.isFile()) {
          throw new Error(`Cannot handle non-files in output: ${p} (under ${this.repoRootDir})`)
        }

        const resolved = this.repoRootDir.resolve(PathInRepo(p))

        // the return value of fs.stat() and friends has counterintuitive behavior: .mtimeMs will undeterministically
        // include fractions of ms (e.g., 1690808418692.3323). Thus we're sticking with .mtime.getTime(). Similarly for
        // atime, ctime.
        const { mtime, atime, ctime } = fs.statSync(resolved)
        this.trace?.push(`adding an entry: ${stat.mode.toString(8)} ${p} ${mtime.toISOString()}`)

        if (stat.isSymbolicLink()) {
          const to = path.normalize(path.join(path.dirname(p), content.toString('utf-8')))
          pack.symlink({ from: p, mtime, to })
        } else {
          pack.entry({ path: p, mode: stat.mode, mtime, ctime, atime }, content)
        }
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
    return { buffer: ret, publicFiles: m.publicFiles }
  }

  private async unbundle(buf: Buffer) {
    if (buf.length === 0) {
      return { files: [], publicFiles: {} }
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

    await promises(Object.keys(metadata.publicFiles)).forEach(STORAGE_CONCURRENCY, async pir => {
      const pathInRepo = PathInRepo(pir)
      const resolved = this.repoRootDir.resolve(pathInRepo)

      const hash = metadata.publicFiles[pathInRepo.val]
      if (!hash) {
        throw new Error(`hash not found for "${pathInRepo}"`)
      }
      const buf = await this.client.getContentAddressable(hash)
      fs.writeFileSync(resolved, buf)
    })
    return { files: outputs, publicFiles: metadata.publicFiles }
  }

  async recordTask(
    taskName: TaskName,
    fingerprint: Fingerprint,
    outputs: PathInRepo[],
    verdict: 'OK' | 'FAIL',
  ): Promise<void> {
    await this.recordTask2(
      taskName,
      fingerprint,
      outputs.map(o => ({ pathInRepo: o, isPublic: false })),
      verdict,
    )
  }

  async recordTask2(
    taskName: TaskName,
    fingerprint: Fingerprint,
    outputs: OutputDescriptor[],
    verdict: 'OK' | 'FAIL',
  ): Promise<void> {
    const { blobId, publicFiles } = await this.recordBlob(taskName, outputs)
    this.logger.info(`task=${taskName}, outputs=${JSON.stringify(outputs)}, publicFiles=${JSON.stringify(publicFiles)}`)
    this.putVerdict(taskName, fingerprint, verdict, blobId)
    await Promise.all([
      this.publisher?.publish('taskStore', {
        opcode: 'RECORDED',
        taskName,
        blobId,
        fingerprint,
        files: [...outputs.map(o => o.pathInRepo.val)],
      }),
      this.publisher?.publish('publicFiles', { taskName, publicFiles }),
    ])
  }

  private async recordBlob(taskName: TaskName, outputs: OutputDescriptor[]) {
    const { buffer, publicFiles } = await this.bundle(outputs)
    const blobId = await this.putBlob(buffer, taskName)
    return { blobId, publicFiles }
  }

  async restoreTask(taskName: TaskName, fingerprint: Fingerprint): Promise<'FAIL' | 'OK' | 'FLAKY' | 'UNKNOWN'> {
    const [verdict, blobId] = await this.getVerdict(taskName, fingerprint)
    const { files, publicFiles } = await this.restoreBlob(blobId)
    await Promise.all([
      this.publisher?.publish('taskStore', {
        opcode: 'RESTORED',
        taskName,
        blobId,
        fingerprint,
        files: files.map(o => o.val),
      }),
      this.publisher?.publish('publicFiles', { taskName, publicFiles }),
    ])
    return verdict
  }

  async restoreBlob(blobId: BlobId) {
    const buf = await this.getBlob(blobId)
    const ret = await this.unbundle(buf)
    return ret
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
const STORAGE_CONCURRENCY = 100
