import { Brand } from 'brand'
import { threeWaySplit } from 'misc'
import * as path from 'path'

export type RepoRoot = Brand<string, 'RepoRoot'>

export function RepoRoot(input: string) {
  return {
    resolve: (pathInRepo: PathInRepo) => path.join(input, pathInRepo.val),
  }
}

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
