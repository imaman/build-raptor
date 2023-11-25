type CamelizeString<T extends PropertyKey, C extends string = ''> = T extends string
  ? string extends T
    ? string
    : T extends `${infer F}-${infer R}`
    ? CamelizeString<Capitalize<R>, `${C}${F}`>
    : `${C}${T}`
  : T

export type CamelizeRecord<T> = { [K in keyof T as CamelizeString<K>]: T[K] }

export function camelizeRecord<T extends Record<string, boolean | string | number | unknown>>(
  rec: T,
): CamelizeRecord<T> {
  const ret: Record<string, unknown> = {}

  for (const k of Object.keys(rec)) {
    const parts = k.split('-')
    if (parts.length === 1) {
      ret[k] = rec[k]
      continue
    }

    ret[parts.map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1))).join('')] = rec[k]
  }

  return ret as CamelizeRecord<T> // eslint-disable-line @typescript-eslint/consistent-type-assertions
}
