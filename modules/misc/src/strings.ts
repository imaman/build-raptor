import { computeHash } from './misc.js'

export function trimTrailing(s: string, suffix: string) {
  if (suffix.length === 0) {
    return s
  }

  while (s.endsWith(suffix)) {
    s = s.slice(0, -suffix.length)
  }

  return s
}

export function chaoticDeterministicString(n: number, seed: string) {
  const acc = []
  let size = 0
  while (size < n) {
    const s = computeHash(`${seed}-${size}-${n}`)
    acc.push(s)
    size += s.length
  }

  return acc.join('').slice(0, n)
}

/**
 * Sanitizes a string such that it can be used as a file name.
 */
export function toReasonableFileName(input: string) {
  return input
    .split('')
    .map(c => (c.match(ALLOWED_FILE_NAME_SYMBOLS) ? c : '_'))
    .join('')
}
const ALLOWED_FILE_NAME_SYMBOLS = /[a-zA-Z0-9_-]/

export function partition(input: string, ...predicates: ((c: string) => boolean)[]) {
  const ret = []
  let i = 0

  for (const p of predicates) {
    const start = i
    while (i < input.length && p(input[i])) {
      ++i
    }

    ret.push(input.slice(start, i))
  }

  if (i < input.length) {
    throw new Error(`The input string could not be fully partitioned (remainder: "${input.slice(i, i + 100)}")`)
  }

  return ret
}

export function threeWaySplit(
  input: string,
  prefixPredicate: (c: string) => boolean,
  suffixPredicate: (c: string) => boolean,
) {
  let i = 0
  while (i < input.length && prefixPredicate(input[i])) {
    ++i
  }

  let j = input.length - 1
  while (j >= i && suffixPredicate(input[j])) {
    --j
  }

  return {
    prefix: input.slice(0, i),
    mid: input.slice(i, j + 1),
    suffix: input.slice(j + 1),
  }
}
