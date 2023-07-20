import { Brand } from 'brand'
import { BuildRunId } from 'build-run-id'
import { RepoRoot } from 'core-types'
import * as fse from 'fs-extra'
import {
  FolderifyRecipe,
  Graph,
  mapIncrement,
  mapRecord,
  pair,
  pairsToRecord,
  recordToPairs,
  shouldNeverHappen,
  slurpDir,
  writeRecipe,
} from 'misc'
import { CatalogOfTasks, ExitStatus, RepoProtocol, TaskDefinition } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'

import { Run } from './driver'

type TaskInRun = Brand<string, 'TaskInRun'>

function validate(input: string): asserts input is TaskInRun {
  new TaskInRunUtils().undo(input)
}

class TaskInRunUtils {
  undo(input: string): { taskName: TaskName; buildRunId: BuildRunId } {
    const parsed = JSON.parse(input)
    if (!Array.isArray(parsed) || parsed.length !== 2) {
      throw new Error(`Bad TaskInRun value: <${input}>`)
    }
    const [taskName, buildRunId] = parsed
    return { taskName, buildRunId }
  }
}

function TaskInRun(tn: TaskName, buildRunId: BuildRunId): TaskInRun
function TaskInRun(): TaskInRunUtils
function TaskInRun(...args: [tn: TaskName, buildRunId: BuildRunId] | []) {
  if (args.length === 2) {
    const [tn, buildRunId] = args
    const ret = JSON.stringify([tn, buildRunId])
    validate(ret)
    return ret
  }

  if (args.length === 0) {
    return new TaskInRunUtils()
  }

  shouldNeverHappen(args)
}

interface State {
  map: Map<TaskName, TaskCallback>
  countByTask: Map<TaskName, number>
  countByTaskInRun: Map<TaskInRun, number>
  getGraph: () => Graph<UnitId>
  readonly getCatalogSpec: () => CatalogSpec | undefined
}

// A TaskName written in a "unit-id:task-kind" notation. It used only in tests (it improves conciseness) - it is not
// part of the build-raptor API.
type TaskLabel = string

function labelToTaskName(label: TaskLabel): TaskName {
  return TaskName().parse(label)
}

type CatalogSpec = CatalogSpecA | CatalogSpecB

type CatalogSpecA = {
  readonly inUnit?: Record<string, readonly string[]>
  readonly onDeps?: Record<string, readonly string[]>
}

type CatalogSpecB = {
  readonly tasks?: readonly TaskDefinition[]
  readonly depList?: readonly [string, string][]
  readonly complete?: boolean
}

type TaskCallback = ((dir: string) => Promise<ExitStatus>) | ((dir: string) => ExitStatus)

export class RepoProtocolTestkit {
  private map = new Map<TaskName, TaskCallback>()
  private countByTask = new Map<TaskName, number>()
  private countByTaskInRun = new Map<TaskInRun, number>()
  private readonly units: readonly UnitMetadata[]

  constructor(private readonly graphJson: Record<string, string[]>, private spec?: CatalogSpec) {
    this.units = Object.keys(graphJson).map(u => new UnitMetadata(u, UnitId(u)))
  }

  changeCatalog(spec: CatalogSpec) {
    this.spec = spec
  }

  private assertUnitId(unitId: string): asserts unitId is UnitId {
    if (!this.units.find(at => at.id === unitId)) {
      throw new Error(`Unit <${unitId}> not found in ${JSON.stringify(this.units)}`)
    }
  }

  countOf(unitId: string, taskKind: string, run?: Run): number
  countOf(run: Run): Record<TaskName, number>
  countOf(...args: [unitId: string, taskKind: string, run?: Run] | [run: Run]) {
    if (args.length === 3 || args.length === 2) {
      const [unitId, taskKind, run] = args
      this.assertUnitId(unitId)
      const tn = TaskName(unitId, TaskKind(taskKind))
      if (!run) {
        return this.countByTask.get(tn) ?? 0
      }

      return this.countByTaskInRun.get(TaskInRun(tn, run.buildRunId)) ?? 0
    }
    if (args.length === 1) {
      const [run] = args
      const triplets = [...this.countByTaskInRun.entries()].map(([k, count]) => {
        const { buildRunId, taskName } = TaskInRun().undo(k)
        return { buildRunId, taskName, count }
      })
      const pairs = triplets.filter(at => at.buildRunId === run.buildRunId).map(at => pair(at.taskName, at.count))
      return pairsToRecord(pairs)
    }

    shouldNeverHappen(args.length)
  }

  invokedAt(run: Run) {
    const pairs = recordToPairs(this.countOf(run))
    return pairs.filter(([_k, v]) => v > 0).map(([k, _v]) => k)
  }

  setTask(taskLabel: TaskLabel, cb: TaskCallback) {
    const tn = TaskName().parse(taskLabel)
    this.map.set(tn, cb)
  }

  setTaskOutputs(taskLabel: TaskLabel, recipe: FolderifyRecipe) {
    this.setTask(taskLabel, async dir => {
      await writeRecipe(dir, recipe)
      return Promise.resolve('OK')
    })
  }

  setTaskFunction(
    taskLabel: TaskLabel,
    callback: (inputs: FolderifyRecipe) => FolderifyRecipe | Promise<FolderifyRecipe>,
  ) {
    this.setTask(taskLabel, async dir => {
      const inputs = await slurpDir(dir)
      const recipe = await callback(inputs)
      await writeRecipe(dir, recipe)
      return Promise.resolve('OK')
    })
  }

  setTaskResult(unitId: string, taskKind: 'test' | 'build', result: ExitStatus): void
  setTaskResult(taskLabel: TaskLabel, result: ExitStatus): void
  setTaskResult(
    ...args: [unitId: string, taskKind: 'test' | 'build', result: ExitStatus] | [label: string, result: ExitStatus]
  ): void {
    let tn
    let r: ExitStatus
    if (args.length === 3) {
      const [unitId, taskKind, result] = args
      tn = TaskName(UnitId(unitId), TaskKind(taskKind))
      r = result
    } else if (args.length === 2) {
      const [label, result] = args
      tn = labelToTaskName(label)
      r = result
    } else {
      shouldNeverHappen(args)
    }

    const { unitId } = TaskName().undo(tn)
    this.assertUnitId(unitId)
    this.map.set(tn, () => r)
  }

  create(): RepoProtocol {
    const getGraph = () => {
      const g = new Graph<UnitId>(x => x)

      for (const [dir, deps] of Object.entries(this.graphJson)) {
        g.vertex(UnitId(dir))
        for (const d of deps) {
          g.edge(UnitId(dir), UnitId(d))
        }
      }
      return g
    }

    return new RepoProtocolImpl(this.units, {
      getGraph,
      map: this.map,
      countByTask: this.countByTask,
      countByTaskInRun: this.countByTaskInRun,
      getCatalogSpec: () => this.spec,
    })
  }
}

function computeCatalog(spec: CatalogSpec): CatalogOfTasks {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const a = spec as CatalogSpecA
  if (a.inUnit || a.onDeps) {
    return {
      inUnit: mapRecord(a.inUnit ?? {}, ([x, ys]) => [TaskKind(x), ys.map(y => TaskKind(y))]),
      onDeps: mapRecord(a.onDeps ?? {}, ([x, ys]) => [TaskKind(x), ys.map(y => TaskKind(y))]),
    }
  }

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const b = spec as CatalogSpecB
  if (b.tasks || b.depList) {
    return {
      inUnit: {},
      onDeps: {},
      depList: b.depList?.map(([a, b]) => [labelToTaskName(a), labelToTaskName(b)]),
      tasks: b.tasks,
      complete: b.complete ?? false,
    }
  }
  throw new Error(`Unsupported CatalogSpec value: ${JSON.stringify(spec)}`)
}

const DEFAULT_CATALOG_SPEC = {
  inUnit: {
    test: ['build'],
  },
  onDeps: {
    build: ['build'],
  },
}

class RepoProtocolImpl implements RepoProtocol {
  private rootDir = RepoRoot('/')

  constructor(private readonly units: readonly UnitMetadata[], private readonly state: State) {}

  async initialize(rootDir: string): Promise<void> {
    this.rootDir = RepoRoot(rootDir)
  }

  async close() {}

  async execute(
    _u: UnitMetadata,
    dir: string,
    tn: TaskName,
    outputFile: string,
    buildRunId: BuildRunId,
  ): Promise<ExitStatus> {
    mapIncrement(this.state.countByTask, tn, 1)
    mapIncrement(this.state.countByTaskInRun, TaskInRun(tn, buildRunId), 1)
    const taskCb = this.state.map.get(tn) ?? (() => 'OK')
    const v = await taskCb(dir)
    await fse.writeFile(outputFile, `task ${tn} result is ${v}`)
    return v
  }

  async getGraph(): Promise<Graph<UnitId>> {
    return this.state.getGraph()
  }

  async getUnits(): Promise<UnitMetadata[]> {
    const ret: UnitMetadata[] = [...this.units]
    const arr = await Promise.all(
      ret.map(async u => {
        const exist = await fse.pathExists(this.rootDir.resolve(u.pathInRepo))
        if (exist) {
          return undefined
        }
        return u
      }),
    )
    const filtered = arr.filter(Boolean)
    if (filtered.length) {
      throw new Error(`Missing folders for the following units: ${JSON.stringify(filtered)}`)
    }

    return ret
  }

  async getTasks(): Promise<CatalogOfTasks> {
    return computeCatalog(this.state.getCatalogSpec() ?? DEFAULT_CATALOG_SPEC)
  }
}
