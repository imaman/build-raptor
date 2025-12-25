import { aTimeoutOf } from '../src'
import { Graph } from '../src/graph'

describe('graph', () => {
  describe('neighborsOf', () => {
    test('returns neighbors of the given vertex', () => {
      const g = new Graph<string>(x => x)
      g.edge('a', 'b')
      g.edge('a', 'c')
      g.edge('b', 'c')
      g.edge('b', 'd')

      expect(g.neighborsOf('a')).toEqual(['b', 'c'])
      expect(g.neighborsOf('b')).toEqual(['c', 'd'])
      expect(g.neighborsOf('c')).toEqual([])
      expect(g.neighborsOf('d')).toEqual([])
    })
    test('returned list is sorted alphabetically', () => {
      const g = new Graph<string>(x => x)
      g.edge('s', 'c')
      g.edge('s', 'e')
      g.edge('s', 'd')
      g.edge('s', 'a')
      g.edge('s', 'b')

      expect(g.neighborsOf('s')).toEqual(['a', 'b', 'c', 'd', 'e'])
    })
    test('returned list is sorted alphabetically when the type of the vertex is not a string', () => {
      const g1 = new Graph<{ n: number }>(x => String(x.n))
      g1.edge({ n: 100 }, { n: 3 })
      g1.edge({ n: 100 }, { n: 5 })
      g1.edge({ n: 100 }, { n: 4 })
      g1.edge({ n: 100 }, { n: 1 })
      g1.edge({ n: 100 }, { n: 2 })

      expect(g1.neighborsOf({ n: 100 })).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }])

      const g2 = new Graph<Date>(x => String(x.getTime()))
      g2.edge(new Date(5), new Date(200))
      g2.edge(new Date(5), new Date(1))
      g2.edge(new Date(5), new Date(100))
      g2.edge(new Date(5), new Date(1000))
      g2.edge(new Date(5), new Date(10))

      expect(g2.neighborsOf(new Date(5))).toEqual([
        new Date(1),
        new Date(10),
        new Date(100),
        new Date(1000),
        new Date(200),
      ])
    })
  })
  describe('isCyclic()', () => {
    test('returns false on an empty graph', () => {
      expect(Graph.fromJSON({}).isCyclic()).toBe(false)
    })
    test('returns false on simple graphs with no cycles', () => {
      expect(Graph.fromJSON({ a: [] }).isCyclic()).toBe(false)
      expect(Graph.fromJSON({ a: ['b'] }).isCyclic()).toBe(false)
      expect(Graph.fromJSON({ a: ['b', 'c'] }).isCyclic()).toBe(false)
      expect(Graph.fromJSON({ a: ['b'], b: ['c'] }).isCyclic()).toBe(false)
    })
    test('returns false on a DAG', () => {
      expect(Graph.fromJSON({ a: ['b', 'c'], b: ['d'], c: ['d'] }).isCyclic()).toBe(false)
    })
    test('returns true on a graph with self edge', () => {
      expect(Graph.fromJSON({ a: ['a'] }).isCyclic()).toBe(true)
    })
    test('returns true on a graph with a cycle of size two', () => {
      expect(Graph.fromJSON({ a: ['b'], b: ['a'] }).isCyclic()).toBe(true)
    })
    test('returns true on a graph with a cycle of size three', () => {
      expect(Graph.fromJSON({ a: ['b'], b: ['c'], c: ['a'] }).isCyclic()).toBe(true)
    })
    test('returns true on a graph with a cycle of size four', () => {
      const g = Graph.fromJSON({
        a: ['b', 'd'],
        d: ['c', 'e'],
        g: ['f'],
        f: ['b'],
        e: ['h'],
        h: ['d'],
      })
      expect(g.isCyclic()).toBe(true)
    })
  })
  describe('roots', () => {
    test('when the graph is empty return an empty array', () => {
      const g1 = Graph.fromJSON({})
      expect(g1.roots()).toEqual([])
    })
    test('when the graph has a single verex return that vertex', () => {
      const g1 = Graph.fromJSON({ a: [] })
      expect(g1.roots()).toEqual(['a'])
    })
    test('when the graph is strongly connected return an empty array', () => {
      const g1 = Graph.fromJSON({ a: ['b'], b: ['a'] })
      expect(g1.roots()).toEqual([])
    })
    test('returns all vertices in the graph that have no incoming edges', () => {
      const g1 = Graph.fromJSON({ a: ['b'], b: ['c'], d: ['c'] })
      expect(g1.roots()).toEqual(['a', 'd'])
    })
  })
  describe('traverseFrom', () => {
    test('returns all vertices reachable from the given starting point', () => {
      const g1 = new Graph<string>(x => x)
      g1.edge('s', 'a')
      g1.edge('a', 'b')
      g1.edge('b', 'c')
      g1.edge('b', 'd')
      g1.edge('d', 'e')
      g1.edge('e', 'f')
      g1.edge('s', 'e')
      g1.edge('c', 'g')

      expect(g1.traverseFrom('d')).toEqual(['f', 'e', 'd'])
      expect(g1.traverseFrom('b')).toEqual(['f', 'e', 'd', 'g', 'c', 'b'])
      expect(g1.traverseFrom('a')).toEqual(['f', 'e', 'd', 'g', 'c', 'b', 'a'])
    })
    test('can traverse back edges', () => {
      const g1 = new Graph<string>(x => x)
      g1.edge('s', 'a')
      g1.edge('a', 'b')
      g1.edge('b', 'c')
      g1.edge('b', 'd')
      g1.edge('d', 'e')
      g1.edge('e', 'f')
      g1.edge('s', 'e')
      g1.edge('c', 'g')

      expect(g1.traverseFrom('d', { direction: 'backwards' })).toEqual(['s', 'a', 'b', 'd'])
      expect(g1.traverseFrom('e', { direction: 'backwards' })).toEqual(['s', 'a', 'b', 'd', 'e'])
      expect(g1.traverseFrom('f', { direction: 'backwards' })).toEqual(['s', 'a', 'b', 'd', 'e', 'f'])
      expect(g1.traverseFrom('g', { direction: 'backwards' })).toEqual(['s', 'a', 'b', 'c', 'g'])
    })
    test('when given multiple starting points returns all vertices reachable from all of them', () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c'],
        b: ['d', 'e', 'f'],
        d: ['g', 'e'],
        e: ['g', 'h'],
        f: ['g', 'h', 'm'],
        g: ['h'],
        h: ['g', 'l'],
        c: ['i', 'j'],
        i: ['k'],
        j: ['k'],
        k: ['l'],
        n: ['o', 'p'],
        p: ['q'],
      })

      expect(g1.traverseFrom(['i', 'g'])).toEqual(['l', 'h', 'g', 'k', 'i'])
      expect(g1.traverseFrom(['f', 'c'])).toEqual(['l', 'k', 'j', 'i', 'c', 'm', 'g', 'h', 'f'])
      expect(g1.traverseFrom(['f', 'j'])).toEqual(['m', 'l', 'g', 'h', 'f', 'k', 'j'])
      expect(g1.traverseFrom(['m', 'i', 'n'])).toEqual(['l', 'k', 'i', 'm', 'q', 'p', 'o', 'n'])
    })
    test('when given multiple starting points, order of the starting does not affect the order of the output', () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c'],
        b: ['d', 'e', 'f'],
        d: ['g', 'e'],
        e: ['g', 'h'],
        f: ['g', 'h', 'm'],
        g: ['h'],
        h: ['g', 'l'],
        c: ['i', 'j'],
        i: ['k'],
        j: ['k'],
        k: ['l'],
        n: ['o', 'p'],
        p: ['q'],
      })

      expect(g1.traverseFrom(['i', 'm', 'n'])).toEqual(['l', 'k', 'i', 'm', 'q', 'p', 'o', 'n'])
      expect(g1.traverseFrom(['i', 'n', 'm'])).toEqual(['l', 'k', 'i', 'm', 'q', 'p', 'o', 'n'])
      expect(g1.traverseFrom(['m', 'i', 'n'])).toEqual(['l', 'k', 'i', 'm', 'q', 'p', 'o', 'n'])
      expect(g1.traverseFrom(['m', 'n', 'i'])).toEqual(['l', 'k', 'i', 'm', 'q', 'p', 'o', 'n'])
      expect(g1.traverseFrom(['n', 'i', 'm'])).toEqual(['l', 'k', 'i', 'm', 'q', 'p', 'o', 'n'])
      expect(g1.traverseFrom(['n', 'm', 'i'])).toEqual(['l', 'k', 'i', 'm', 'q', 'p', 'o', 'n'])
    })
  })
  describe('toString()', () => {
    test('provides a human readable representation of the graph', () => {
      const g1 = new Graph<string>(x => x)
      g1.edge('s', 'a')
      g1.edge('a', 'b')
      g1.edge('b', 'c')
      g1.edge('b', 'd')
      g1.edge('d', 'e')
      g1.edge('e', 'f')
      g1.edge('s', 'e')
      g1.edge('c', 'g')

      expect(g1.toString().split('\n')).toEqual([
        'a -> b',
        'b -> c, d',
        'c -> g',
        'd -> e',
        'e -> f',
        'f ->',
        'g ->',
        's -> a, e',
      ])
    })
    test('returns "<EMPTY>" when the graph is empty', () => {
      const g1 = new Graph<string>(x => x)
      expect(g1.toString()).toEqual('<EMPTY>')
    })
  })
  describe('toJSON()', () => {
    test('exports the graph', () => {
      const g1 = new Graph<string>(x => x)
      g1.edge('s', 'a')
      g1.edge('a', 'b')
      g1.edge('b', 'c')
      g1.edge('b', 'd')
      g1.edge('d', 'e')
      g1.edge('e', 'f')
      g1.edge('s', 'e')
      g1.edge('c', 'g')

      expect(g1.toJSON()).toEqual({
        s: ['a', 'e'],
        a: ['b'],
        b: ['c', 'd'],
        d: ['e'],
        e: ['f'],
        f: [],
        g: [],
        c: ['g'],
      })
    })
  })
  describe('vertices()', () => {
    test('returns all vertices of the graph', () => {
      const g1 = Graph.fromJSON({
        s: ['a', 'b'],
        a: ['b', 'c', 'd', 'z', 'x'],
        c: ['d'],
      })
      expect(g1.vertices()).toEqual(['a', 'b', 'c', 'd', 's', 'x', 'z'])
    })
  })
  describe('remove', () => {
    test('yells if the vertex does not exist', () => {
      const g = Graph.fromJSON({ a: ['b'], b: [] })
      expect(() => g.remove('x')).toThrowError('Cannot remove non-existing vertex: <x>')
    })
    test('when applied to a graph containing a single vertex, the resulting graph is empty', () => {
      const g = Graph.fromJSON({ a: [] })
      g.remove('a')
      expect(g.toJSON()).toEqual({})
      expect(g.vertices()).toEqual([])
    })
    test('once vertex was removed it is no longer a neighbor', () => {
      const g = Graph.fromJSON({ a: ['b'] })

      expect(g.neighborsOf('a')).toEqual(['b'])
      g.remove('b')
      expect(g.toJSON()).toEqual({ a: [] })
      expect(g.neighborsOf('a')).toEqual([])
    })
    test('once vertex was removed it is no longer a back-neighbor', () => {
      const g = Graph.fromJSON({ a: ['b'] })

      expect(g.backNeighborsOf('b')).toEqual(['a'])
      g.remove('a')
      expect(g.toJSON()).toEqual({ b: [] })
      expect(g.backNeighborsOf('b')).toEqual([])
    })
    test('removal of a vertex from the center of the graph', () => {
      const g = Graph.fromJSON({ a: ['c'], b: ['c'], c: ['d', 'e'] })
      g.remove('c')
      expect(g.toJSON()).toEqual({ a: [], b: [], d: [], e: [] })
    })
    test('other edges are retained', () => {
      const g = Graph.fromJSON({ a: ['c', 'f'], b: ['c', 'g'], c: ['d', 'e'], d: ['f'], e: ['g'], f: ['h'], g: ['h'] })
      g.remove('c')
      expect(g.toJSON()).toEqual({ a: ['f'], b: ['g'], d: ['f'], e: ['g'], f: ['h'], g: ['h'], h: [] })
    })
  })
  describe('fromJSON()', () => {
    test('returns a graph from the given input', () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c'],
        b: ['d'],
        c: ['d'],
      })
      expect(g1.toString().split('\n')).toEqual(['a -> b, c', 'b -> d', 'c -> d', 'd ->'])
    })
  })
  describe('execute', () => {
    test('yells if the graph is cyclic', async () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c'],
        b: ['d'],
        c: ['d'],
        d: ['a'],
      })

      await expect(() => g1.execute(4, async () => {})).rejects.toThrowError(/Cannot execute a cyclic graph/)
    })
    test('traverses pre-order', async () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c'],
        b: ['d'],
        c: ['d'],
      })

      const arr: string[] = []
      await g1.execute(10, async x => {
        arr.push(`${x} started`)
        if (x === 'b') {
          await aTimeoutOf(10).hasPassed()
        }
        if (x === 'c') {
          await aTimeoutOf(1).hasPassed()
        }
        arr.push(`${x} ended`)
      })

      const str = arr.join('; ')
      expect(str).toMatch(/^d started; d ended; b started; c started/)
      expect(str).toMatch(/b ended;.*a started; a ended$/)
      expect(str).toMatch(/c ended;.*a started; a ended$/)
    })
    test('propagates an exception', async () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c'],
        b: ['d'],
        c: ['d'],
      })

      const cb = async (x: string) => {
        if (x === 'b') {
          throw new Error(`Houston, we have a problem`)
        }
      }

      await expect(g1.execute(10, cb)).rejects.toThrowError(/^Houston, we have a problem$/)
    })
    test('emits the first exception that was encountered', async () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c'],
        b: ['d'],
        c: ['d'],
      })

      const cb = async (x: string) => {
        throw new Error(`${x} has a problem`)
      }

      await expect(g1.execute(10, cb)).rejects.toThrowError(/^d has a problem$/)
    })
    test('does not start dependents once an exception was thrown (from a dependency)', async () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c'],
        b: ['d'],
        c: ['d'],
      })

      const arr: string[] = []
      const cb = async (x: string) => {
        arr.push(x)
        if (x == 'b') {
          throw new Error(`b is on fire`)
        }
      }

      await expect(g1.execute(10, cb)).rejects.toThrowError(/^b is on fire$/)
      expect(arr).toEqual(['d', 'b', 'c'])
    })

    test('nothing is scheduled after first exception is fired', async () => {
      const g1 = Graph.fromJSON({
        a: ['b', 'c', 'd', 'e', 'f'],
      })

      const arr: string[] = []
      const cb = async (x: string) => {
        arr.push(x)
        if (x == 'c') {
          throw new Error(`c is on fire`)
        }
      }

      await expect(g1.execute(1, cb)).rejects.toThrowError(/^c is on fire$/)
      expect(arr).toEqual(['b', 'c'])
    })
    test.todo('error message should say (showing first of <n>')

    describe('batch scheduling', () => {
      test('when the scheduler returns a graph, the execution order of siblings is affected', async () => {
        const g1 = Graph.fromJSON({
          a: ['b', 'c'],
          b: ['d'],
          c: ['d'],
        })

        const arr: string[] = []
        await g1.execute(
          10,
          async x => {
            arr.push(`${x} started`)
            if (x === 'b') {
              await aTimeoutOf(10).hasPassed()
            }
            if (x === 'c') {
              await aTimeoutOf(1).hasPassed()
            }
            arr.push(`${x} ended`)
          },
          batch => {
            if (batch.includes('b')) {
              return Graph.fromJSON({ c: ['b'] })
            }
            return undefined
          },
        )

        const str = arr.join('; ')
        expect(str).toEqual('d started; d ended; b started; b ended; c started; c ended; a started; a ended')
      })
      test('while the batch is executed, vertices outside of the batch (dependents of in-batch vertcies) start executing', async () => {
        const g1 = Graph.fromJSON({
          a: ['x', 'y', 'z'],
          b: ['x'],
          c: ['x'],
          d: ['y'],
        })

        const arr: string[] = []
        await g1.execute(
          10,
          async x => {
            arr.push(`+${x}`)
            await aTimeoutOf(1).hasPassed()
            arr.push(`-${x}`)
          },
          batch => {
            if (batch.includes('x')) {
              return Graph.fromJSON({ z: ['y'], y: ['x'] })
            }
            return undefined
          },
        )

        const str = arr.join(' ')
        expect(str).toEqual('+x -x +b +c +y -b -c -y +d +z -d -z +a -a')
      })
      test('scheduler must return vertices that are only in the batch', async () => {
        const g1 = Graph.fromJSON({
          a: ['b', 'c'],
          b: ['d', 'e', 'f', 'g'],
          c: ['d', 'e', 'f', 'g'],
        })

        const rescheduler = (batch: string[]) => {
          if (batch.includes('f')) {
            return Graph.fromJSON({ a: ['b', 'f'] })
          }
          return undefined
        }
        await expect(g1.execute(10, async () => {}, rescheduler)).rejects.toThrowError(
          'batch scheduler returned out-of-batch vertices: a, b',
        )
      })
      test('batch scheduler must return all vertices from the batch', async () => {
        const g1 = Graph.fromJSON({
          a: ['b', 'c', 'd'],
        })

        const rescheduler = (batch: string[]) => {
          if (batch.includes('b')) {
            return Graph.fromJSON({ b: [] })
          }
          return undefined
        }
        await expect(g1.execute(10, async () => {}, rescheduler)).rejects.toThrowError(
          'batch scheduler returned a bad grap: number of vertices is 1 (but it should be 3)',
        )
      })
      test('batch scheduler must return a non cyclic graph', async () => {
        const g1 = Graph.fromJSON({
          a: ['b', 'c'],
        })

        const rescheduler = (batch: string[]) => {
          if (batch.includes('b')) {
            return Graph.fromJSON({ b: ['c'], c: ['b'] })
          }
          return undefined
        }
        await expect(g1.execute(10, async () => {}, rescheduler)).rejects.toThrowError(
          'batch scheduler returned a cyclic graph',
        )
      })
    })
  })
})
