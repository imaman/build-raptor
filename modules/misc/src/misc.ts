import * as crypto from 'crypto'
import * as fse from 'fs-extra'
import jsonStringify from 'safe-stable-stringify'
import * as util from 'util'

type Jsonable = string | number | boolean | null | readonly Jsonable[] | { readonly [key: string]: Jsonable }

// 17
export function computeObjectHash(input: Record<string, Jsonable>): string {
  // TODO(imaman): add a test where a nested (sub) object of the input is not sorted.
  return computeHash(jsonStringify(input))
}

/**
 * @param input buffer or string to hash
 * @returns a 224 bit hash, in "hex" encoding.
 */
export function computeHash(input: Buffer | string): string {
  const hasher = crypto.createHash('sha224')
  return hasher.update(input).digest('hex')
}

/**
 * Represents an event that should happen at some point in the future.
 */
export class Timeout {
  constructor(private readonly promise: Promise<void>) {}

  /**
   * Returns a promise that is resvoled when the timeout expires.
   */
  hasPassed(): Promise<void> {
    return this.promise
  }
}

export function aTimeoutOf(ms: number): Timeout {
  return new Timeout(new Promise(resolve => setTimeout(resolve, ms)))
}

export async function dumpFile(inputPath: string, output: NodeJS.WritableStream) {
  if (!(await fse.pathExists(inputPath))) {
    throw new Error(`Cannot dump non existing file: ${inputPath}`)
  }
  return new Promise<void>((res, rej) => {
    const inputStream = fse.createReadStream(inputPath)
    inputStream.on('end', () => {
      res()
    })
    inputStream.on('error', e => {
      rej(new Error(`failed to read ${inputPath}: ${util.inspect(e)}`))
    })
    inputStream.pipe(output, { end: false })
  })
}
