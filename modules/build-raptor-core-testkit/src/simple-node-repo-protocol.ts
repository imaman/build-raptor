import { BuildRunId } from 'build-run-id'
import execa from 'execa'
import * as fse from 'fs-extra'
import { Graph, promises } from 'misc'
import * as path from 'path'
import { CatalogOfTasks, ExitStatus, RepoProtocol } from 'repo-protocol'
import { TaskKind, TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'
import * as util from 'util'

export class SimpleNodeRepoProtocol implements RepoProtocol {
  constructor(
    private readonly pathToModulesDir: string = 'modules',
    private readonly buildOutputLocations: string[] = [],
    private readonly catalog?: CatalogOfTasks,
  ) {}

  private units: UnitMetadata[] = []
  private graph: Graph<UnitId> = new Graph<UnitId>(x => x)

  async initialize(rootDir: string): Promise<void> {
    const list = await this.read(rootDir)
    this.units = list.map(at => new UnitMetadata(at.pathInRepo, at.id))
    const ids = new Set<string>(this.units.map(at => at.id))
    for (const at of list) {
      this.graph.vertex(at.id)
      const deps = { ...at.packageJson.dependencies, ...at.packageJson.devDependencies }
      for (const dep of Object.keys(deps)) {
        if (ids.has(dep)) {
          this.graph.edge(at.id, UnitId(dep))
        }
      }
    }
  }

  async close() {
    this.units = []
    this.graph = new Graph<UnitId>(x => x)
  }

  private async readPackageJsonAt(dir: string) {
    const resolved = path.join(dir, 'package.json')
    try {
      const content = await fse.readFile(resolved, 'utf-8')
      return JSON.parse(content)
    } catch (e) {
      throw new Error(`Failed to read package.json in ${resolved}: ${e}`)
    }
  }

  async execute(
    _u: UnitMetadata,
    dir: string,
    taskName: TaskName,
    outputFile: string,
    _buildRunId: BuildRunId,
  ): Promise<ExitStatus> {
    const task = TaskName().undo(taskName).taskKind
    const packageJson = await this.readPackageJsonAt(dir)
    const script = packageJson?.scripts[task]
    if (script === undefined) {
      throw new Error(`Missing script: "${task}"`)
    }

    const fd = await fse.open(outputFile, 'w')
    try {
      const p = await execa.command(script, { cwd: dir, stdout: fd, stderr: fd, reject: false, shell: true })
      if (p.exitCode === 0) {
        return 'OK'
      }

      return 'FAIL'
    } catch (e) {
      throw new Error(`Crashed when running task ${task} in ${dir} (command: ${script}): ${util.inspect(e)}`)
    } finally {
      await fse.close(fd)
    }
  }
  async getGraph(): Promise<Graph<UnitId>> {
    return this.graph
  }

  private async read(rootDir: string) {
    const resolvedModulesDir = path.join(rootDir, this.pathToModulesDir)
    const list = await fse.readdir(resolvedModulesDir)
    return await promises(
      list.map(async name => {
        const resolved = path.join(resolvedModulesDir, name)
        const parsed = await this.readPackageJsonAt(resolved)
        return {
          pathInRepo: path.relative(rootDir, resolved),
          id: UnitId(parsed.name),
          packageJson: parsed,
        }
      }),
    ).reify()
  }

  async getUnits(): Promise<UnitMetadata[]> {
    return this.units
  }

  async getTasks(): Promise<CatalogOfTasks> {
    if (this.catalog) {
      return this.catalog
    }
    const b = TaskKind('build')
    const t = TaskKind('test')
    return {
      inUnit: {
        [t]: [b],
      },
      onDeps: {
        [b]: [b],
      },
      tasks: [
        {
          taskKind: b,
          outputs: this.buildOutputLocations,
        },
        {
          taskKind: t,
          outputs: [],
        },
      ],
    }
  }
}
