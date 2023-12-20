import { Brand } from 'brand'
import { threeWaySplit } from 'misc'
import * as path from 'path'

export function RepoRoot(input: string) {
  input = path.normalize(input)
  if (!path.isAbsolute(input)) {
    throw new Error(`Repo root must be absolute (got: ${input})`)
  }
  return {
    resolve: (pathInRepo?: PathInRepo) => (pathInRepo ? path.join(input, pathInRepo.val) : input),
    unresolve: (absolutePath: string) => PathInRepo(path.relative(input, absolutePath)),
    toString: () => input,
    toJSON: () => input,
  }
}
export type RepoRoot = ReturnType<typeof RepoRoot>

type Mark = Brand<string, 'PathInRepo'>

export type PathInRepo = {
  readonly mark: Mark
  val: string
  isPrefixOf(other: PathInRepo): boolean
  /**
   * Returns a new PathInRepo object that points to a subdirectory of this path. Fails if "relativePath" tries to climb
   * up.
   * @param relativePath an addition to this path
   */
  expand(relativePath: string): PathInRepo
  /**
   * Similr to expand() but allows relative paths that climb up as long as they are still inside the repo
   * @param relativePath an addition to this path
   */
  to(relativePath: string): PathInRepo
  toJSON(): string
  toString(): string
}

export function PathInRepo(input: string): PathInRepo {
  const val = norm(input)

  if (val.startsWith('..')) {
    throw new Error(`cannot go up outside of the repo (got: '${val}')`)
  }

  const isPrefixOf = (other: PathInRepo) => other.val.startsWith(val)

  return {
    mark: '' as Mark, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    val,
    isPrefixOf,
    expand: (relativePath: string) => {
      if (val === '.') {
        return PathInRepo(relativePath)
      }
      const ret = PathInRepo(path.normalize(path.join(val, relativePath)))
      if (!isPrefixOf(ret)) {
        throw new Error(`Cannot expand '${val}' to '${ret}'`)
      }
      return ret
    },
    to: (relativePath: string) => {
      const joined = path.normalize(path.join(val, relativePath))
      return PathInRepo(joined)
    },
    toJSON: () => val,
    toString: () => val,
  }
}

const norm = (s: string) =>
  threeWaySplit(
    path.normalize(s),
    () => false,
    c => c === '/',
  ).mid
