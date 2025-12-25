import { mapIncrement } from './maps.js'

export function sortBy<T>(input: readonly T[], key: (item: T) => number): T[]
export function sortBy<T>(input: readonly T[], key: (item: T) => string): T[]
export function sortBy<T>(input: IterableIterator<T>, key: (item: T) => number): T[]
export function sortBy<T>(input: IterableIterator<T>, key: (item: T) => string): T[]
export function sortBy<T>(input: IterableIterator<T> | readonly T[], key: (item: T) => string | number): T[] {
  return [...input].sort((a, b) => comp(a, b, key))
}

function comp<T, R extends string | number>(a: T, b: T, key: (item: T) => R): number {
  const ak = key(a)
  const bk = key(b)

  if (typeof ak === 'string' && typeof bk === 'string') {
    return ak.localeCompare(bk)
  }

  if (typeof ak === 'number' && typeof bk === 'number') {
    return ak - bk
  }

  throw new Error(`Cannot compare ${ak} and ${bk}`)
}

export function findDups<T, K extends number | symbol | string>(
  input: ArrayLike<T> | Iterable<T>,
  key: (item: T) => K,
): T[] {
  const counts = new Map<K, number>()
  const collidingKeys = new Set<K>()
  const pairs: [T, K][] = []
  for (const item of Array.from(input)) {
    const k = key(item)
    pairs.push([item, k])
    const n = mapIncrement(counts, k, 1)
    if (n > 1) {
      collidingKeys.add(k)
    }
  }

  const ret: T[] = []
  for (const [item, k] of pairs) {
    if (collidingKeys.has(k)) {
      ret.push(item)
    }
  }

  return ret
}

export function uniqueBy<T, K>(input: ArrayLike<T> | Iterable<T>, key: (item: T) => K): T[] {
  const seen = new Set<K>()
  return Array.from(input).filter(item => {
    const k = key(item)
    if (seen.has(k)) {
      return false
    }
    seen.add(k)
    return true
  })
}

export function groupBy<T, K extends number | symbol | string>(
  input: ArrayLike<T> | Iterable<T>,
  key: (item: T) => K,
): Record<K, T[]> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const ret: Record<K, T[]> = {} as Record<K, T[]>

  for (const item of Array.from(input)) {
    const k = key(item)
    let arr = ret[k]
    if (!arr) {
      arr = new Array<T>()
      ret[k] = arr
    }

    arr.push(item)
  }

  return ret
}
