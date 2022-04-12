export type Subscriber<T> = <K extends keyof T>(k: K, e: T[K]) => Promise<void> | void

class SinglePublisher<E> {
  private subscribers: ((e: E) => void | Promise<void>)[] = []

  on(subscriber: (e: E) => void | Promise<void>): void {
    this.subscribers.push(subscriber)
  }

  async publish(e: E): Promise<void> {
    const promises = this.subscribers.map(s => s(e))
    await Promise.all(promises)
  }
}

export interface Subscribable<T> {
  on<K extends keyof T>(k: K, subscriber: (e: T[K]) => Promise<void> | void): void
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedPublisher<T extends Record<string, any>> implements Subscribable<T> {
  private readonly map: {
    [K in keyof T]: SinglePublisher<T[K]>
  } = {} as {
    [K in keyof T]: SinglePublisher<T[K]>
  }

  async publish<K extends keyof T>(k: K, e: T[K]) {
    await this.map[k]?.publish(e)
  }

  on<K extends keyof T>(k: K, subscriber: (e: T[K]) => Promise<void> | void) {
    let x = this.map[k]
    if (!x) {
      x = new SinglePublisher<T[K]>()
      this.map[k] = x
    }
    x.on(subscriber)
  }
}
