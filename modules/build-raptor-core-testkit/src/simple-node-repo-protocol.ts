import { BuildRunId } from 'build-run-id'
import { PathInRepo, RepoRoot } from 'core-types'
import execa from 'execa'
import * as fse from 'fs-extra'
import { failMe, Graph, promises } from 'misc'
import { ExitStatus, RepoProtocol, TaskInfo } from 'repo-protocol'
import { generateTaskInfos } from 'repo-protocol-toolbox'
import { TaskName } from 'task-name'
import { UnitId, UnitMetadata } from 'unit-metadata'
import * as util from 'util'

export class SimpleNodeRepoProtocol implements RepoProtocol {
  constructor(
    private readonly pathToModulesDir = PathInRepo('modules'),
    private readonly buildOutputLocations: string[] = [],
    private readonly catalog?: { tasks: TaskInfo[] },
  ) {}

  private units: UnitMetadata[] = []
  private graph: Graph<UnitId> = new Graph<UnitId>(x => x)
  private rootDir: RepoRoot = RepoRoot('/tmp')

  async initialize(rootDir: RepoRoot): Promise<void> {
    this.rootDir = rootDir
    const list = await this.read()
    this.units = list.map(at => new UnitMetadata(at.pathInRepo.val, at.id))
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

  private async readPackageJsonAt(pir: PathInRepo) {
    const resolved = this.rootDir.resolve(pir.expand('package.json'))
    try {
      const content = await fse.readFile(resolved, 'utf-8')
      return JSON.parse(content)
    } catch (e) {
      throw new Error(`Failed to read package.json in ${resolved}: ${e}`)
    }
  }

  async execute(taskName: TaskName, outputFile: string, _buildRunId: BuildRunId): Promise<ExitStatus> {
    const { taskKind_: taskKind, unitId } = TaskName().undo(taskName)
    const unit = this.units.find(u => u.id === unitId) ?? failMe(`unit not found (unit ID=${unitId})`)
    const dir = this.rootDir.resolve(unit.pathInRepo)
    const packageJson = await this.readPackageJsonAt(unit.pathInRepo)
    const script = packageJson?.scripts[taskKind]
    if (script === undefined) {
      throw new Error(`Missing script for ${taskName}`)
    }

    const fd = await fse.open(outputFile, 'w')
    try {
      const p = await execa.command(script, { cwd: dir, stdout: fd, stderr: fd, reject: false, shell: true })
      if (p.exitCode === 0) {
        return 'OK'
      }

      return 'FAIL'
    } catch (e) {
      throw new Error(`Crashed when running task ${taskName} in ${dir} (command: ${script}): ${util.inspect(e)}`)
    } finally {
      await fse.close(fd)
    }
  }
  async getGraph(): Promise<Graph<UnitId>> {
    return this.graph
  }

  private async read() {
    const list = await fse.readdir(this.rootDir.resolve(this.pathToModulesDir))
    return await promises(
      list.map(async name => {
        const pir = this.pathToModulesDir.expand(name)
        const parsed = await this.readPackageJsonAt(pir)
        return {
          pathInRepo: pir,
          id: UnitId(parsed.name),
          packageJson: parsed,
        }
      }),
    ).reify()
  }

  async getUnits(): Promise<UnitMetadata[]> {
    return this.units
  }

  async getTasks(): Promise<TaskInfo[]> {
    if (this.catalog) {
      return this.catalog.tasks
    }

    return generateTaskInfos(this.units, this.graph, () => [], this.buildOutputLocations)
  }
}
