import * as fs from 'fs'
import { Logger } from 'logger'
import { shouldNeverHappen } from 'misc'
import * as path from 'path'
import { z } from 'zod'

const Info = z.object({
  path: z.string(),
  mode: z.number(),
  mtime: z.string(),
  contentLen: z.number(),
  // when true, content will be the (relative) path to the target
  isSymlink: z.boolean().optional(),
})
type Info = z.infer<typeof Info>

interface Entry {
  content: Buffer
  info: Info
}

function dateToString(d: Date) {
  // The Math.trunc() is probably not needed but I could not find a statement which explicitly says that
  // Date.getTime() always returns an integer.
  return String(Math.trunc(d.getTime()))
}

function findDirectories(p: string) {
  p = path.normalize(p)
  const ret: string[] = []
  while (true) {
    const parent = path.dirname(p)
    if (parent === p) {
      return ret.reverse()
    }

    ret.push(parent)
    p = parent
  }
}

// TOOD(imaman): rename
export class TarStream {
  private readonly entires: Entry[] = []

  static pack() {
    return new TarStream()
  }

  private checkPaths(absolute: 'allow' | 'disallow', ...paths: string[]) {
    for (const at of paths) {
      if (path.isAbsolute(at)) {
        if (absolute === 'allow') {
          continue
        } else if (absolute === 'disallow') {
          throw new Error(`path must be relative (got: ${at})`)
        }
        shouldNeverHappen(absolute)
      }

      const fakeRoot = '/fake-root'
      const resolved = path.resolve(fakeRoot, at)

      const parents = findDirectories(resolved)
      if (!parents.includes(fakeRoot)) {
        throw new Error(`path to a file outside of the subtree (got: ${at})`)
      }
    }
  }

  entry(inf: { path: string; mode: number; mtime: Date; atime: Date; ctime: Date }, content: Buffer) {
    this.checkPaths('disallow', inf.path)
    const info: Info = {
      path: inf.path,
      contentLen: content.length,
      mtime: dateToString(inf.mtime),
      mode: inf.mode,
      isSymlink: false,
    }
    this.entires.push({ content, info })
  }

  symlink(inf: { from: string; to: string; mtime: Date }) {
    this.checkPaths('disallow', inf.from)
    this.checkPaths('allow', inf.to)
    const content = Buffer.from(
      path.isAbsolute(inf.to) ? inf.to : path.normalize(path.relative(path.dirname(inf.from), inf.to)),
    )
    const info: Info = {
      path: inf.from,
      contentLen: content.length,
      mode: 0, // meaningless in symlinks
      mtime: dateToString(inf.mtime),
      isSymlink: true,
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
    const resolve = (info: Info) => path.join(dir, info.path)

    const updateStats = (parsedInfo: Info) => {
      const resolved = resolve(parsedInfo)
      const date = new Date(Number(parsedInfo.mtime))
      try {
        fs.utimesSync(resolved, date, date)
      } catch (e) {
        logger.error(`utimeSync failure: ${JSON.stringify({ resolved, date, parsedInfo })}`, e)
        throw new Error(`could not update time of ${resolved} to ${date.toISOString()}: ${e}`)
      }
    }
    const symlinks: { info: Info; content: Buffer }[] = []

    let offset = 0
    let prevOffset = -1
    while (offset < source.length) {
      if (offset === prevOffset) {
        throw new Error(`Buffer seems to be corrupted: no offset change at the last pass ${offset}`)
      }
      prevOffset = offset

      const infoLen = source.readInt32BE(offset)
      offset += 4

      const infoBuf = Buffer.alloc(infoLen)
      const endOffset = offset + infoLen
      source.copy(infoBuf, 0, offset, endOffset)
      offset = endOffset

      const untyped = JSON.parse(infoBuf.toString('utf-8'))
      const parsedInfo = Info.parse(untyped)
      parsedInfo.isSymlink = parsedInfo.isSymlink ?? false

      const { contentLen } = parsedInfo

      const contentBuf = Buffer.alloc(contentLen)

      const contentEndOffset = offset + contentLen
      source.copy(contentBuf, 0, offset, contentEndOffset)
      offset = contentEndOffset

      const resolved = resolve(parsedInfo)
      fs.mkdirSync(path.dirname(resolved), { recursive: true })

      if (parsedInfo.isSymlink) {
        symlinks.push({ info: parsedInfo, content: contentBuf })
      } else {
        fs.writeFileSync(resolved, contentBuf, { mode: parsedInfo.mode })
        updateStats(parsedInfo)
      }
    }

    for (const { info, content } of symlinks) {
      const resolved = resolve(info)
      fs.mkdirSync(path.dirname(resolved), { recursive: true })
      const c = content.toString('utf-8')
      fs.symlinkSync(c, resolved)
      if (!path.isAbsolute(c)) {
        updateStats(info)
      }
    }
  }
}
