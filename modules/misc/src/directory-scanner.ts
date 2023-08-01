import * as fs from 'fs'
import * as fse from 'fs-extra'
import * as path from 'path'

import { shouldNeverHappen } from '.'
import { trimTrailing } from './strings'

type Predicate = (relativePath: string, stat: fs.Stats) => boolean

interface Options {
  // A callback to determine whether a file should be included in the output. Defaults to `() => true`.
  predicate?: Predicate
  // Whether to fail if the starting point path does not exist under `rootDir`. Defaults to `true`.
  startingPointMustExist?: boolean
}

interface ListPathsOptions {
  // Whether to fail if the starting point path does not exist under `rootDir`. Defaults to `true`.
  startingPointMustExist?: boolean
}

interface ConstructorOptions {
  // A callback to determine whether a file should be included in the output. Defaults to `() => true`. Will be used in
  // conjunction with the predicate passed to `scanTree`.
  predicate?: Predicate
}

const DEFAULT_OPTIONS: Required<Options> = { predicate: () => true, startingPointMustExist: true }

type ScanTreeCallback = (relativePath: string, content: Buffer, stat: fs.Stats) => void
type ListPathsCallback = (relativePath: string) => void

type RelativePath = string

// TODO(imaman): use RepoRoot, PathInRepo
export class DirectoryScanner {
  private readonly options: Options
  constructor(readonly rootDir: string, options?: ConstructorOptions) {
    if (!path.isAbsolute(rootDir)) {
      throw new Error(`rootDir must be absolute`)
    }
    this.rootDir = path.normalize(rootDir)
    this.options = options ?? DEFAULT_OPTIONS
  }

  isValid(relativePath: string, stat: fs.Stats) {
    if (!this.options.predicate) {
      return true
    }

    return this.options.predicate(relativePath, stat)
  }

  /**
   * Iterates over all the files located under `startingPoint` and calls `cb` for each file.
   * @param startingPoint a relative path to start scanning files at. It is resolved to an absolute path by joining it
   * to the root-dir value passed to the constructor. Trailing path separators are omitted (i.e. `'a/b///'` is
   * equivalent to `'a/b'`).
   * @param cb
   */
  async scanTree(startingPoint: RelativePath, cb: ScanTreeCallback): Promise<void>
  async scanTree(startingPoint: RelativePath, options: Options, cb: ScanTreeCallback): Promise<void>
  async scanTree(...a: [p: RelativePath, c: ScanTreeCallback] | [s: RelativePath, o: Options, c: ScanTreeCallback]) {
    const cb: ScanTreeCallback = a.length === 2 ? a[1] : a.length === 3 ? a[2] : shouldNeverHappen(a)
    const options: Options = a.length === 2 ? DEFAULT_OPTIONS : a.length === 3 ? a[1] : shouldNeverHappen(a)
    const startingPoint = a.length === 2 ? a[0] : a.length === 3 ? a[0] : shouldNeverHappen(a)
    await this.scanTreeImpl(startingPoint, options, undefined, cb)
  }

  /**
   * Recursively scans a file tree, returning relative paths to all files.
   * @param startingPoint a relative path to start scanning files at. It is resolved to an absolute path by joining it
   * to the root-dir value passed to the constructor. Trailing path separators are omitted (i.e. `'a/b///'` is
   * equivalent to `'a/b'`).
   * @returns an array of relative paths (relative from the `root` path  passed to the constructor)
   */
  async listPaths(startingPoint: RelativePath, options?: ListPathsOptions): Promise<string[]> {
    const ret: string[] = []
    await this.scanTreeImpl(startingPoint, { ...DEFAULT_OPTIONS, ...options }, p => {
      ret.push(p)
    })
    return ret
  }

  /**
   * Returns relative paths to all files at the file tree rooted at the given directory.
   * @param dir directory to scan files under
   * @returns an array of relative paths (relative to `dir`)
   */
  static async listPaths(dir: string, options?: ListPathsOptions) {
    return await new DirectoryScanner(dir).listPaths('', options)
  }

  private async scanTreeImpl(
    startingPoint: RelativePath,
    options: Options,
    pathCallback?: ListPathsCallback,
    cb?: ScanTreeCallback,
  ) {
    const startingPointMustExist = options.startingPointMustExist ?? true
    if (path.isAbsolute(startingPoint)) {
      throw new Error(`relativePath must be relative`)
    }

    const trimmedStartingPoint = trimTrailing(startingPoint, path.sep)
    const resolvedPath = path.normalize(path.join(this.rootDir, trimmedStartingPoint))

    const exists = await fse.pathExists(resolvedPath)
    if (!exists) {
      if (startingPointMustExist) {
        throw new Error(`Starting point does not exist (${resolvedPath})`)
      }
      return
    }
    const predicate = (relativePath: string, stats: fs.Stats) =>
      runPred(relativePath, stats, this.options.predicate) && runPred(relativePath, stats, options.predicate)
    await this.scanFileTree(resolvedPath, predicate, pathCallback, cb)
  }

  private async scanFileTree(
    resolvedPath: string,
    predicate: Predicate,
    pathCallback?: ListPathsCallback,
    cb?: ScanTreeCallback,
  ) {
    const relativePath = path.normalize(path.relative(this.rootDir, resolvedPath))
    const stat: fs.Stats = await this.getStat(resolvedPath)
    if (relativePath !== '.' && !predicate(relativePath, stat)) {
      return
    }
    if (!stat.isDirectory()) {
      if (cb) {
        try {
          const content = stat.isSymbolicLink() ? Buffer.from('') : await fse.readFile(resolvedPath)
          cb(relativePath, content, stat)  
        } catch (e) {
          throw new Error(`could not read ${resolvedPath}: ${e}`)
        }
      }

      if (pathCallback) {
        pathCallback(relativePath)
      }
      return
    }

    const files = await this.readDirSorted(resolvedPath)
    // TODO(imaman): make this loop concurrent. we need to use p-qeueu to avoid too much concurrency.
    for (const file of files) {
      await this.scanFileTree(path.join(resolvedPath, file), predicate, pathCallback, cb)
    }
  }

  // IMPORTANT!
  // It is very hard to properly test this function because it is hard to create a situation in which the underlying
  // readdir() call will actually return a list which is not sortred. On the other hand, we cannot assume that, so
  // we do have to proactively sort the list (but we cannot really write a test that will fail if we drop the line that
  // does the sorting).
  private async readDirSorted(resolvedPath: string) {
    try {
      const ret = await fse.readdir(resolvedPath)
      ret.sort()
      return ret
    } catch (e) {
      throw new Error(`Cannot readdir ${resolvedPath}: ${e}`)
    }
  }

  private async getStat(resolvedPath: string) {
    // This function is mainly for providing a human-readable error message with a menaingful stacktrace (fs-extra uses
    // native calls which do not have a stacktrace).
    try {
      return fs.lstatSync(resolvedPath)
    } catch (e) {
      throw new Error(`Cannot stat ${resolvedPath}: ${e}`)
    }
  }
}

const runPred = (relativePath: string, stats: fs.Stats, p?: Predicate) => (p ? p(relativePath, stats) : true)
