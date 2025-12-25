import { sortBy } from './arrays'

/**
 * Translates a given record into an array of key,value pairs. Unlike Object.entires() it correctly preserves the types
 * of the keys and the values.
 */
export function recordToPairs<K extends string, V>(record: Record<K, V>): [K, V][] {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const pairs = Object.entries(record) as [K, V][]
  return sortBy(pairs, ([k]) => k)
}

/**
 * Translates a given array of key,value pairs into a record. Unlike Object.fromEntries() it correctly preserves the
 * types of the keys and the values.
 */
export function pairsToRecord<K extends string, V>(pairs: Iterable<[K, V]> | ArrayLike<[K, V]>): Record<K, V> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const ret: Record<K, V> = {} as Record<K, V>
  for (const [k, v] of Array.from(pairs)) {
    ret[k] = v
  }
  return ret
}

export function mapRecord<K extends string, V, K2 extends string, V2>(
  record: Record<K, V>,
  f: (a: [K, V]) => [K2, V2]|undefined,
): Record<K2, V2> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const ret = {} as Record<K2, V2>
  for (const [k, v] of recordToPairs(record)) {
    const mapped = f([k, v])
    if (mapped) {
      const [k2, v2] = mapped
      ret[k2] = v2
    }
  }
  return ret
}
