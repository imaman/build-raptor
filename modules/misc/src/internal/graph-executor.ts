import { Executor } from '../executor'
import { BatchScheduler, Graph } from '../graph'
import { mapIncrement } from '../maps'

export class GraphExecutor<V> {
  private readonly map
  private numLeft
  private started = false

  constructor(
    private readonly graph: Graph<V>,
    private readonly executor: Executor<V>,
    private readonly batchScheduler: BatchScheduler<V>,
  ) {
    if (graph.isCyclic()) {
      throw new Error(`Cannot execute a cyclic graph`)
    }
    this.numLeft = graph.vertices().length
    this.map = graph.makeVertexMap<number>()
  }

  private start() {
    if (this.started) {
      throw new Error(`A GraphExecutor object can only be started once`)
    }
    this.started = true
    const initialBatch: V[] = []

    for (const v of this.graph.vertices()) {
      const count = this.graph.neighborsOf(v).length
      this.map.set(v, count)
      if (count === 0) {
        initialBatch.push(v)
      }
    }

    this.executor.subscribe(({ lastSettled }) => {
      if (this.map.has(lastSettled)) {
        this.vertexExecuted(lastSettled)
      }
    })

    this.scheduleBatch(initialBatch)
  }

  private scheduleBatch(batch: V[]) {
    const subGraph = this.batchScheduler(batch)
    if (subGraph) {
      if (subGraph.isCyclic()) {
        throw new Error(`batch scheduler returned a cyclic graph`)
      }
      const set = subGraph.makeVertexMap<unknown>()
      for (const v of batch) {
        set.set(v, {})
      }

      const subVertices = subGraph.vertices()
      const outOfBatch = subVertices.filter(v => !set.has(v))
      if (outOfBatch.length > 0) {
        throw new Error(`batch scheduler returned out-of-batch vertices: ${outOfBatch.join(', ')}`)
      }
      if (subVertices.length !== batch.length) {
        throw new Error(
          `batch scheduler returned a bad grap: number of vertices is ${subVertices.length} (but it should be ${batch.length})`,
        )
      }
      const subExecutor = new GraphExecutor<V>(subGraph, this.executor, () => undefined)
      subExecutor.start()
      return
    }
    for (const v of batch) {
      this.executor.schedule(v)
    }
  }

  private vertexExecuted(v: V) {
    const nextBatch = []
    for (const n of this.graph.backNeighborsOf(v)) {
      const count = mapIncrement(this.map, n, -1)
      if (count === 0) {
        nextBatch.push(n)
      }
    }
    this.scheduleBatch(nextBatch)
  }

  async execute() {
    const ret = new Promise<void>((resolve, reject) => {
      this.executor.subscribe(({ error }) => {
        --this.numLeft
        if (this.numLeft > 0) {
          return
        }

        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
      this.start()
    })

    return ret
  }
}
