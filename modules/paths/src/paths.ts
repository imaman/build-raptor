import { Brand } from 'brand'
import * as path from 'path'

export type Relative = Brand<string, 'Relative'>
export type Absolute = Brand<string, 'Absolute'>

export function relative(s: string): Relative {
  if (path.isAbsolute(s)) {
    throw new Error(`path must be relative (got: "${s}")`)
  }

  return s as Relative
}

export function absolute(s: string): Absolute {
  if (!path.isAbsolute(s)) {
    throw new Error(`path must be absolute (got: "${s}")`)
  }

  return s as Absolute
}
