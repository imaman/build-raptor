import { Brand } from 'brand'

export type PathInRepo = Brand<string, 'PathInRepo'>

export function PathInRepo(input: string): PathInRepo {
  return input as PathInRepo // eslint-disable-line @typescript-eslint/consistent-type-assertions
}
