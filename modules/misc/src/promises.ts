import PQueue from 'p-queue'

import { sortBy } from './arrays.js'
import { shouldNeverHappen } from './constructs.js'

/**
 * An array-like collection of items allowing map() and filter() operations to be used with async functions with minimal
 * boilerplate. Concrete instances are typically constructed via the `promises()` function.
 *
 * Using this interface eliminates the need to use the cumbersome `await Promise.all(items.map(f))`.
 */
export interface AsyncArray<T> {
  /**
   * Applies `mapper` to each element in the collection, returning a new AsyncArray object that contains the respective
   * results. This method is non-async even if the mapper function is async. It will immediately return the result.
   * The actual eapplication of the predicate will take place only when `.refiy()` is subsequently called on the result.
   * @param mapper A function to apply to each element in the collection. Receives the element being processed as its
   * first argument, and the index of this element in the collection as its second argument.
   */
  map<V>(mapper: (item: T, index: number) => Promise<V> | V): AsyncArray<V>
  /**
   * Returns a new AsyncArray object with all elements that pass the test implemented by the provided predicate. This
   * method is non-async even if the mapper function is async. It will immediately return the result.
   * The actual application of the predicate will take place only when `.refiy()` is subsequently called on the result.
   * @param predicate a function to test each element of the array. Returns `true` to keep the element, or to `false` otherwise. Receives the element being tested as its first argument,
   * and the index of this element in the collection as its second argument.
   */
  filter(predicate: (item: T, index: number) => boolean | Promise<boolean>): AsyncArray<T>
  /**
   * Asynchronosuly invokes the provided function once for each element in the collection.
   * @param callback a function to call for each element. Receives the element being processed as its first argument,
   * and the index of this element in the collection as its second argument.
   */
  // TODO(imaman): add a concurrency option.
  forEach(concurrency: number, callback: (item: T, index: number) => void | Promise<void>): Promise<void>
  forEach(callback: (item: T, index: number) => void | Promise<void>): Promise<void>
  /**
   * Asynchronosuly returns the items in the collection.
   */
  reify(concurrency?: number): Promise<T[]>
}

type ForEachCallback<T> = (item: T, index: number) => void | Promise<void>
/**
 * Translates the input array into an `AsyncArray` object.
 */
export function promises<T>(input: readonly Promise<T>[] | readonly T[]): AsyncArray<T> {
  const adjusted = new DefaultReifiable<T>(input.map(p => Promise.resolve(p)))
  return new PromisesImpl<T, T>(
    adjusted,
    t => Promise.resolve(t),
    () => Promise.resolve(true),
  )
}

interface Reifiable<T> {
  reify(concurrency?: number): Promise<T[]>
}

class PromisesImpl<T, U> implements AsyncArray<U> {
  constructor(
    private readonly data: Reifiable<T>,
    private readonly mapper: (t: T, index: number) => Promise<U>,
    private readonly predicate: (u: U, index: number) => Promise<boolean>,
  ) {}

  map<V>(mapper: (item: U, index: number) => Promise<V> | V): PromisesImpl<U, V> {
    return new PromisesImpl<U, V>(
      this,
      (t, i) => Promise.resolve(mapper(t, i)),
      async () => true,
    )
  }

  filter(predicate: (item: U, index: number) => boolean | Promise<boolean>): PromisesImpl<U, U> {
    return new PromisesImpl<U, U>(
      this,
      async t => t,
      (u, i) => Promise.resolve(predicate(u, i)),
    )
  }

  forEach(concurrency: number, callback: ForEachCallback<U>): Promise<void>
  forEach(callback: ForEachCallback<U>): Promise<void>
  async forEach(...args: [ForEachCallback<U>] | [number, ForEachCallback<U>]): Promise<void> {
    const len = args.length

    if (len === 1) {
      await this.map(args[0]).reify()
    } else if (len === 2) {
      await this.map(args[1]).reify(args[0])
    } else {
      shouldNeverHappen(len)
    }
  }

  async reify(concurrency = 16): Promise<U[]> {
    const ts = await this.data.reify(concurrency)
    // TODO(imaman): pass this queue also when calling this.data.refiy()
    const queue = new PQueue({ concurrency })

    let captured
    const pairs: [U, number][] = []
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]
      queue.add(async () => {
        try {
          const u = await this.mapper(t, i)
          const b = await this.predicate(u, i)
          if (b) {
            pairs.push([u, i])
          }
        } catch (e) {
          // TODO(imaman): should capture only the first one.
          captured = e
        }
      })
    }

    await queue.onIdle()
    if (captured) {
      throw captured
    }
    return sortBy(pairs, ([_, i]) => i).map(([u, _]) => u)
  }
}

class DefaultReifiable<T> implements Reifiable<T> {
  constructor(private readonly ps: Promise<T>[]) {}

  async reify() {
    return await Promise.all(this.ps)
  }
}
