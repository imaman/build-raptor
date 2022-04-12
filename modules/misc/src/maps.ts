interface MapLike<K, V> {
  get(k: K): V | undefined
  set(k: K, v: V): void
}

/**
 * Returns a value from a map, or throws an error if not found.
 * @param map the map to fetch from
 * @param key a key to look up
 * @returns the value assoicated with `key` in `map`.
 */
export function hardGet<K, V>(map: MapLike<K, V>, key: K): V {
  const ret = map.get(key)
  if (ret === undefined) {
    throw new Error(`Could not find <${key}> in the given map`)
  }
  return ret
}

/**
 * Increment the value associated with `key` in `map` by `inc`.
 * @param map a map to increment one of its values
 * @param key the key to increment
 * @param inc the amount to increment by
 * @returns the incremented value
 */
export function mapIncrement<K>(map: MapLike<K, number>, key: K, inc: number): number {
  const ret = assigningGet(map, key, () => 0) + inc
  map.set(key, ret)
  return ret
}

/**
 * Returns the value with `key` in `map`. If not found, set it to the value returned by the given supplier function
 * and returns it.
 * @param map a map to get a value from
 * @param key the key to get
 * @param supplier a zero-arguments callback to provide a value if `key` is not found in `map`
 * @returns the value associated with `key` in `map`
 */
export function assigningGet<K, V>(map: MapLike<K, V>, key: K, supplier: () => V): V {
  let v = map.get(key)
  if (v === undefined) {
    v = supplier()
    map.set(key, v)
  }
  return v
}
