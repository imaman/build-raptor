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
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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

  once<K extends keyof T>(k: K, subscriber: (e: T[K]) => Promise<void> | void) {
    let fired = false
    this.on(k, e => {
      if (fired) {
        return
      }

      fired = true
      subscriber(e)
    })
  }

  /**
   * returns a promise that is resolved once an event the satisfies the given predicate has been published
   * @param k event name
   * @param predicate a function to test the event.
   * @returns a Promise that resolves with the value of the first event for which `predicate` returned `true`
   */
  awaitFor<K extends keyof T>(k: K, predicate: (e: T[K]) => boolean): Promise<T[K]> {
    return new Promise<T[K]>(res => {
      let fired = false
      this.on(k, e => {
        if (fired) {
          return
        }

        if (!predicate(e)) {
          return
        }

        fired = true
        res(e)
      })
    })
  }
}
