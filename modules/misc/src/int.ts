import { Brand } from 'brand'

export type Int = Brand<number, 'Int'>

class IntUtils {
  parse(s: string) {
    return intify(s)
  }

  product(lhs: Int, rhs: number): Int {
    return intify(lhs * Int(rhs))
  }
  sum(lhs: Int, rhs: number): Int {
    return intify(lhs + Int(rhs))
  }
}

export function Int(): IntUtils
export function Int(value: number): Int
export function Int(value?: number) {
  if (value === undefined) {
    return new IntUtils()
  }

  return intify(value)
}

function intify(input: string | number): Int {
  const ret = Number(input)
  if (Number.isInteger(ret)) {
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return ret as Int
  }

  throw new Error(`<${input}> is not an integer`)
}
