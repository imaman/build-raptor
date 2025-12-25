import PQueue from 'p-queue'

import { sortBy } from './arrays.js'
import { shouldNeverHappen } from './constructs.js'
import { Executor } from './executor.js'
import { GraphExecutor } from './internal/graph-executor.js'
import { hardGet, mapIncrement } from './maps.js'
import { ObjectMap } from './object-map.js'

interface TraverseOptions {
  direction: 'forward' | 'backwards'
}

class Vertex<V> {
  private readonly neighbors_: Vertex<V>[] = []
  private readonly backNeighbors_: Vertex<V>[] = []
  constructor(readonly id: string, readonly payload: V) {}

  addNeighbor(v: Vertex<V>) {
    this.neighbors_.push(v)
  }

  addBackNeighbor(v: Vertex<V>) {
    this.backNeighbors_.push(v)
  }

  remove(v: Vertex<V>) {
    const index = this.neighbors_.indexOf(v)
    if (index >= 0) {
      this.neighbors_.splice(index, 1)
    }

    const index2 = this.backNeighbors_.indexOf(v)
    if (index2 >= 0) {
      this.backNeighbors_.splice(index2, 1)
    }
  }

  get neighbors(): ReadonlyArray<Vertex<V>> {
    return sortBy(this.neighbors_, v => v.id)
  }

  get backNeighbors(): ReadonlyArray<Vertex<V>> {
    return sortBy(this.backNeighbors_, v => v.id)
  }
}

export class Graph<V> {
  private readonly vertexMap

  constructor(private readonly vToId: (v: V) => string) {
    this.vertexMap = new ObjectMap<V, Vertex<V>>(vToId)
  }

  // TODO(imaman): cover
  copy(): Graph<V> {
    const ret = new Graph<V>(this.vToId)

    const vs = sortBy(this.vertexMap.values(), v => v.id)
    for (const v of vs) {
      ret.vertex(v.payload)
      for (const u of v.neighbors) {
        ret.edge(v.payload, u.payload)
      }
    }

    return ret
  }

  edge(from: V, to: V) {
    this.vertex(from)
    this.vertex(to)

    const f = this.toVertex(from)
    const t = this.toVertex(to)

    f.addNeighbor(t)
    t.addBackNeighbor(f)
  }

  private toVertex(v: V): Vertex<V> {
    return hardGet(this.vertexMap, v)
  }

  vertex(v: V) {
    const existing = this.vertexMap.get(v)
    if (!existing) {
      const id = this.vToId(v)
      this.vertexMap.set(v, new Vertex(id, v))
    }
  }

  remove(v: V) {
    const existing = this.vertexMap.get(v)
    if (!existing) {
      throw new Error(`Cannot remove non-existing vertex: <${v}>`)
    }

    this.vertexMap.delete(v)
    for (const n of existing.backNeighbors) {
      n.remove(existing)
    }

    for (const n of existing.neighbors) {
      n.remove(existing)
    }
  }

  vertices(): V[] {
    return sortBy(this.vertexMap.values(), v => v.id).map(v => v.payload)
  }

  outDegree(v: V) {
    return this.neighborsOf(v).length
  }

  neighborsOf(v: V): V[] {
    return this.toVertex(v).neighbors.map(v => v.payload)
  }

  backNeighborsOf(v: V): V[] {
    return this.toVertex(v).backNeighbors.map(v => v.payload)
  }

  roots() {
    return this.vertices().filter(v => this.toVertex(v).backNeighbors.length === 0)
  }

  traverseFrom(startingPoints: V, options?: TraverseOptions): V[]
  traverseFrom(startingPoints: V[], options?: TraverseOptions): V[]
  traverseFrom(arg: V | V[], options?: TraverseOptions): V[] {
    const direction = options?.direction ?? 'forward'
    const seen = new Set<string>()
    const visited: Vertex<V>[] = []

    const traverse = (v: Vertex<V>) => {
      if (seen.has(v.id)) {
        return
      }
      seen.add(v.id)
      const ns =
        direction === 'forward'
          ? v.neighbors
          : direction === 'backwards'
          ? v.backNeighbors
          : shouldNeverHappen(direction)

      for (let i = ns.length - 1; i >= 0; --i) {
        traverse(ns[i])
      }

      visited.push(v)
    }

    const arr = Array.isArray(arg) ? arg : [arg]
    const startingPoints = sortBy(
      arr.map(v => this.toVertex(v)),
      v => v.id,
    )

    for (const at of startingPoints) {
      traverse(at)
    }
    return visited.map(v => v.payload)
  }

  toJSON(): Record<string, string[]> {
    const vs = sortBy(this.vertexMap.values(), v => v.id)

    const ret: Record<string, string[]> = {}
    for (const v of vs) {
      ret[v.id] = v.neighbors.map(n => n.id)
    }

    return ret
  }

  toString() {
    const vs = sortBy(this.vertexMap.values(), v => v.id)
    if (vs.length === 0) {
      return '<EMPTY>'
    }
    return vs.map(v => `${v.id} -> ${v.neighbors.map(n => n.id).join(', ')}`.trim()).join('\n')
  }

  static fromJSON(json: Record<string, string[]>): Graph<string> {
    const ret = new Graph<string>(x => x)
    for (const [v, neighbors] of Object.entries(json)) {
      ret.vertex(v)
      for (const n of neighbors) {
        ret.edge(v, n)
      }
    }
    return ret
  }

  isCyclic() {
    const vs = this.vertices().map(v => this.toVertex(v))
    // TODO(imaman): use a proper impl. of LIFO (and also introduce a FIFO arrays.ts)
    const lifo: Vertex<V>[] = []

    const map = new Map<string, number>()
    for (const v of vs) {
      const deg = v.neighbors.length
      map.set(v.id, deg)
      if (deg === 0) {
        lifo.push(v)
      }
    }

    const seen = new Set<string>()
    while (true) {
      const v = lifo.pop()
      if (!v) {
        break
      }
      if (seen.has(v.id)) {
        continue
      }
      seen.add(v.id)
      for (const n of v.backNeighbors) {
        const deg = mapIncrement(map, n.id, -1)
        if (deg === 0) {
          lifo.push(n)
        }
      }
    }

    return seen.size !== vs.length
  }

  async execute(concurrency: number, workToDo: (v: V) => Promise<void>, batchScheduler?: BatchScheduler<V>) {
    const queue = new PQueue({ concurrency })
    const executor = new Executor<V>(queue, workToDo)
    const ge = new GraphExecutor<V>(this, executor, batchScheduler ?? (() => undefined))
    await ge.execute()
  }

  makeVertexMap<T>() {
    return new ObjectMap<V, T>(this.vToId)
  }
}

export type BatchScheduler<V> = (batch: V[]) => Graph<V> | undefined
