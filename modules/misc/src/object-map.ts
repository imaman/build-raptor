export class ObjectMap<K, V> {
  private readonly map = new Map<string, V>()

  constructor(private readonly translator: (key: K) => string) {}

  set(k: K, v: V) {
    this.map.set(this.translator(k), v)
  }

  get(k: K) {
    return this.map.get(this.translator(k))
  }

  has(k: K) {
    return this.map.has(this.translator(k))
  }

  values() {
    return this.map.values()
  }

  delete(k: K) {
    this.map.delete(this.translator(k))
  }
}
