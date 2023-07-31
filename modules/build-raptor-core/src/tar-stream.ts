import { Brand } from 'brand'
import * as child_process from 'child_process'
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
import { TaskStoreEvent } from './task-store-event'

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
export class TarStream {
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
      console.log(`++entry.info.mtime=${JSON.stringify(entry.info.mtime)}`)
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
      fs.mkdirSync(path.dirname(resolved), { recursive: true  })
      fs.writeFileSync(resolved, contentBuf, { mode: parsedInfo.mode })

      const RATIO = 1000000n
      const ns = BigInt(parsedInfo.mtime)
      console.log(`parsedInfo=${JSON.stringify(parsedInfo)}`)
      const d = new Date(Number(ns / RATIO))
      if (useTouch) {
        const ts = d.toISOString().slice(0, -1)
        const decimal = String(ns % RATIO).padStart(6, '0')
        const command = `touch -d "${ts}${decimal}Z" "${resolved}"`
        child_process.execSync(command, { stdio: 'inherit' })
      } else {
        fs.utimesSync(resolved, d, d)

        // const m2 = fs.statSync(resolved).mtime
        // if (d.toISOString() !== new Date(m2).toISOString()){
        //   console.log(`mismatch: ${d} vs. ${m2}`)
        // }
      }

      if (offset === atStart) {
        throw new Error(`Buffer seems to be corrupted: no offset change at the last pass ${offset}`)
      }
    }
  }
}
export const useTouch = false
