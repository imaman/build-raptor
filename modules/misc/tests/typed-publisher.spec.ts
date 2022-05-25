import { aTimeoutOf } from '../src'
import { TypedPublisher } from '../src/typed-publisher'

describe('typed-publisher', () => {
  test('relays an event to a subscriber', () => {
    const p = new TypedPublisher<{ a: number }>()

    const acc: number[] = []
    p.on('a', (e: number) => {
      acc.push(e)
    })

    p.publish('a', 1)
    expect(acc).toEqual([1])
  })

  test('does not mix event names', () => {
    const p = new TypedPublisher<{ a: number; b: number }>()

    const as: number[] = []
    p.on('a', (e: number) => {
      as.push(e)
    })

    const bs: number[] = []
    p.on('b', (e: number) => {
      bs.push(e)
    })

    p.publish('b', 3)
    p.publish('a', 1)
    p.publish('a', 4)
    p.publish('b', 1)
    p.publish('b', 5)
    p.publish('a', 9)

    expect(bs).toEqual([3, 1, 5])
    expect(as).toEqual([1, 4, 9])
  })

  test('each event name can have a different event payload type', () => {
    const p = new TypedPublisher<{ a: number; b: string; c: { x: number; y: Date } }>()

    const as: number[] = []
    p.on('a', (e: number) => {
      as.push(e)
    })

    const bs: string[] = []
    p.on('b', (e: string) => {
      bs.push(e)
    })

    const cs: { x: number; y: Date }[] = []
    p.on('c', e => {
      cs.push(e)
    })

    p.publish('a', 100)
    p.publish('c', { x: 8000, y: new Date(9000) })
    p.publish('b', 'Balloon')
    p.publish('c', { x: 8001, y: new Date(9001) })

    expect(as).toEqual([100])
    expect(bs).toEqual(['Balloon'])
    expect(cs).toEqual([
      { x: 8000, y: new Date(9000) },
      { x: 8001, y: new Date(9001) },
    ])
  })

  test('subscriber can be async', async () => {
    const p = new TypedPublisher<{ a: number }>()

    const as: number[] = []
    p.on('a', async (e: number) => {
      await new Promise<void>(res => {
        as.push(e)
        res()
      })
    })

    await p.publish('a', 2)
    await p.publish('a', 7)
    await p.publish('a', 1)
    await p.publish('a', 8)
    await p.publish('a', 2)
    await p.publish('a', 8)

    expect(as).toEqual([2, 7, 1, 8, 2, 8])
  })
  test('when the subscriber is async, the publish() call awaits for all the subscribers to finish', async () => {
    const p = new TypedPublisher<{ a: number }>()

    const as: number[] = []
    p.on('a', async (e: number) => {
      await new Promise<void>(res => {
        as.push(e)
        res()
      })
    })
    const bs: number[] = []
    p.on('a', async (e: number) => {
      await new Promise<void>(res => {
        bs.push(e)
        res()
      })
    })
    const cs: number[] = []
    p.on('a', async (e: number) => {
      await new Promise<void>(res => {
        cs.push(e)
        res()
      })
    })

    await p.publish('a', 2)
    expect(as).toEqual([2])
    expect(bs).toEqual([2])
    expect(cs).toEqual([2])

    await p.publish('a', 7)
    expect(as).toEqual([2, 7])
    expect(bs).toEqual([2, 7])
    expect(cs).toEqual([2, 7])
  })
  describe('once', () => {
    test('allows registering a listener that will be invoked just once', async () => {
      const p = new TypedPublisher<{ a: number }>()

      const as: number[] = []
      p.once('a', async (e: number) => {
        as.push(e)
      })

      const bs: number[] = []
      p.once('a', async (e: number) => {
        bs.push(e)
      })

      await p.publish('a', 900)
      expect(as).toEqual([900])
      expect(bs).toEqual([900])

      for (let i = 0; i < 100; ++i) {
        await p.publish('a', i)
      }
      expect(as).toEqual([900])
      expect(bs).toEqual([900])
    })
  })
  describe('awaitFor', () => {
    test('returns a promise that is resolved once an event the satisfies the given predicate has been published', async () => {
      const p = new TypedPublisher<{ a: number }>()

      const promise = p.awaitFor('a', (e: number) => e === 10)

      let n = 5
      const id = setInterval(async () => await p.publish('a', ++n), 2)
      try {
        await promise
        expect(n).toEqual(10)
      } finally {
        clearInterval(id)
      }
    })
    test('the returned promise resolves to the value of the event that satisfied the predicate', async () => {
      const p = new TypedPublisher<{ x: string }>()

      const promise = p.awaitFor('x', (e: string) => e.toUpperCase() === e)

      const words = ['the', 'quick', 'brown', 'FOX', 'jumps', 'over', 'the', 'lazy', 'dog']
      for (const w of words) {
        await p.publish('x', w)
        await aTimeoutOf(2).hasPassed()
      }

      expect(await promise).toEqual('FOX')
    })
    test('the promise resolves to the value of the first satisfying event', async () => {
      const p = new TypedPublisher<{ x: string }>()

      const promise = p.awaitFor('x', (e: string) => e.toUpperCase() === e)

      const words = ['the', 'QUICK', 'BROWN', 'FOX']
      for (const w of words) {
        await p.publish('x', w)
        await aTimeoutOf(2).hasPassed()
      }

      expect(await promise).toEqual('QUICK')
    })
  })
})
