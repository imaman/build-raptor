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
  expand(relativePath: string): PathInRepo
  toJSON(): string
  toString(): string
}

export function PathInRepo(input: string): PathInRepo {
  const val = norm(input)
  const isPrefixOf = (other: PathInRepo) => other.val.startsWith(val)
  return {
    mark: '' as Mark, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    val,
    isPrefixOf,
    expand: (relativePath: string) => {
      const ret = PathInRepo(path.join(val, relativePath))
      if (!isPrefixOf(ret)) {
        console.log(`val=${val}, relativePath=${relativePath}, joined=${path.join(val, relativePath)}`)
        throw new Error(`Cannot expand (${val}) with a ${relativePath}`)
      }
      return ret
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
