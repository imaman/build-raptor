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
  toJSON: () => string
}

export function PathInRepo(input: string): PathInRepo {
  const val = norm(input)
  return {
    mark: '' as Mark, // eslint-disable-line @typescript-eslint/consistent-type-assertions
    val,
    toJSON: () => val,
  }
}

const norm = (s: string) =>
  threeWaySplit(
    path.normalize(s),
    () => false,
    c => c === '/',
  ).mid
