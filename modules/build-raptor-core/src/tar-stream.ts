import * as fs from 'fs'
import { Logger } from 'logger'
import * as path from 'path'
import { z } from 'zod'

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

  entry(inf: { path: string; mode: number; mtime: Date; atime: Date; ctime: Date }, content: Buffer) {
    const info: Info = {
      path: inf.path,
      contentLen: content.length,
      // The Math.trunc() is probably not needed but I could not find a statement which explicitly says that
      // Date.getTime() always returns an integer.
      mtime: String(Math.trunc(inf.mtime.getTime())),
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

  static async extract(source: Buffer, dir: string, logger: Logger) {
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
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      fs.writeFileSync(resolved, contentBuf, { mode: parsedInfo.mode })

      const date = new Date(Number(parsedInfo.mtime))
      try {
        fs.utimesSync(resolved, date, date)
      } catch (e) {
        logger.error(`utimeSync failure: ${JSON.stringify({ resolved, date, parsedInfo })}`, e)
        throw new Error(`could not update time of ${resolved} to ${date.toISOString()}`)
      }

      if (offset === atStart) {
        throw new Error(`Buffer seems to be corrupted: no offset change at the last pass ${offset}`)
      }
    }
  }
}
