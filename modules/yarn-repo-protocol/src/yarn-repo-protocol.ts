import escapeStringRegexp from 'escape-string-regexp'
import execa from 'execa'
import * as fse from 'fs-extra'
import { Logger } from 'logger'
import { failMe, Graph, pairsToRecord, promises, recordToPairs, sortBy, uniqueBy } from 'misc'
import * as path from 'path'
import { ExitStatus, RepoProtocol } from 'repo-protocol'
import { CatalogOfTasks } from 'repo-protocol'
import { TaskKind } from 'task-name'
import { PackageJson } from 'type-fest'
import { UnitId, UnitMetadata } from 'unit-metadata'
import webpack, { Stats, WebpackPluginInstance } from 'webpack'
import ShebangPlugin from 'webpack-shebang-plugin'
import { z } from 'zod'

const yarnWorkspacesInfoSchema = z.record(
  z.object({
    location: z.string(),
    workspaceDependencies: z.string().array(),
  }),
)

type YarnWorkspacesInfo = z.infer<typeof yarnWorkspacesInfoSchema>

interface State {
  readonly yarnInfo: YarnWorkspacesInfo
  readonly graph: Graph<UnitId>
  readonly rootDir: string
  readonly units: UnitMetadata[]
  readonly packageByUnitId: Map<UnitId, PackageJson>
}

export class YarnRepoProtocol implements RepoProtocol {
  constructor(private readonly logger: Logger) {}

  private state_: State | undefined

  private get state() {
    return this.state_ ?? failMe('state was not set')
  }

  async initialize(rootDir: string): Promise<void> {
    const yarnInfo = await this.getYarnInfo(rootDir)

    const units = computeUnits(yarnInfo)
    const packageByUnitId = await readPackages(rootDir, units)

    const graph = new Graph<UnitId>(x => x)
    for (const [p, data] of Object.entries(yarnInfo)) {
      const uid = UnitId(p)
      graph.vertex(uid)
      for (const dep of data.workspaceDependencies) {
        graph.edge(uid, UnitId(dep))
      }
    }
    this.state_ = { yarnInfo, graph, rootDir, units, packageByUnitId }
  }

  async close() {}

  private async run(cmd: string, args: string[], dir: string, outputFile: string): Promise<ExitStatus> {
    const summary = `<${dir}$ ${cmd} ${args.join(' ')}>`
    this.logger.info(`Dispatching ${summary}. output: ${outputFile}`)

    const out = await fse.open(outputFile, 'w')
    try {
      const p = await execa(cmd, args, { cwd: dir, stdout: out, stderr: out, reject: false })
      this.logger.info(`exitCode of ${cmd} ${args.join(' ')} is ${p.exitCode}`)
      if (p.exitCode === 0) {
        return 'OK'
      }
      return 'FAIL'
    } catch (e) {
      this.logger.error(`execution of ${summary} failed`, e)
      return 'CRASH'
    } finally {
      await fse.close(out)
    }
  }

  async execute(u: UnitMetadata, dir: string, task: TaskKind, outputFile: string): Promise<ExitStatus> {
    if (task === 'build') {
      return await this.run('npm', ['run', 'build'], dir, outputFile)
    }

    if (task === 'test') {
      const jestOutputFile = 'jest-output.json'
      const testsToRun = await this.computeTestsToRun(path.join(dir, jestOutputFile))
      return await this.run('yarn', ['jest', ...testsToRun, '--json', '--outputFile', jestOutputFile], dir, outputFile)
    }

    if (task === 'pack') {
      const stat = await this.pack(u, dir)
      if (stat?.hasErrors()) {
        await fse.writeFile(outputFile, JSON.stringify(stat?.toJson('errors-only'), null, 2))
      } else {
        await fse.writeFile(outputFile, '')
      }
      return stat?.hasErrors ? 'FAIL' : 'OK'
    }

    throw new Error(`Unknown task ${task} (at ${dir})`)
  }

  private getPackageJson(uid: UnitId) {
    return this.state.packageByUnitId.get(uid) ?? failMe(`Unit ID not found (${uid})`)
  }

  async computePackingPackageJson(unitId: UnitId) {
    const units = this.state.units
    const inrepo = new Set<string>(units.map(u => u.id))

    const ret = this.getPackageJson(unitId)
    const visited = new Set<UnitId>()

    const scan = (u: string) => {
      if (!inrepo.has(u)) {
        return
      }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const uid = u as UnitId
      if (visited.has(uid)) {
        return
      }
      visited.add(uid)

      const pd = this.getPackageJson(uid)
      for (const d of Object.keys(pd.dependencies ?? {})) {
        scan(d)
      }
    }

    scan(unitId)
    const allDeps = [...visited]

    const packageDefs = allDeps.map(d => this.getPackageJson(d))

    const map = new Map<string, string>()
    for (const at of packageDefs) {
      for (const [d, v] of recordToPairs(at.dependencies ?? {})) {
        if (!inrepo.has(d)) {
          map.set(d, v)
        }
      }
    }

    ret.dependencies = pairsToRecord(sortBy(map.entries(), ([d]) => d))
    ret.main = MAIN_FILE_NAME
    delete ret.devDependencies
    return ret
  }

  private async pack(u: UnitMetadata, dir: string): Promise<Stats | undefined> {
    const inrepo: string[] = this.state.units.map(u => u.id)
    const ret = await new Promise<Stats | undefined>(resolve => {
      webpack(
        {
          context: dir,
          entry: './dist/src/index.js',
          output: {
            filename: `${PACK_DIR}/${MAIN_FILE_NAME}`,
            path: dir,
          },
          mode: 'development',
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
          plugins: [new ShebangPlugin() as WebpackPluginInstance],
          externals: [
            function (arg, callback) {
              const req = arg.request ?? ''
              let decision = 'R'
              if (req.startsWith('.')) {
                decision = 'bundle'
              }

              if (inrepo.includes(req)) {
                decision = 'bundle'
              }

              if (decision === 'bundle') {
                callback()
              } else {
                callback(undefined, 'commonjs ' + req)
              }
            },
          ],
        },
        async (err, stats) => {
          if (err) {
            this.logger.error(`packing of ${dir} failed`, err)
            throw new Error(`packing ${u.id} failed`)
          }

          resolve(stats)
        },
      )
    })

    const packageDef = await this.computePackingPackageJson(u.id)
    this.logger.info(`updated packagejson is ${JSON.stringify(packageDef)}`)
    const packageJsonPath = path.join(dir, PACK_DIR, 'package.json')

    try {
      await fse.writeFile(packageJsonPath, JSON.stringify(packageDef, null, 2))
    } catch (e) {
      throw new Error(`Failed to write new package definition at ${packageJsonPath}: ${e}`)
    }

    return ret
  }

  private async getYarnInfo(rootDir: string): Promise<YarnWorkspacesInfo> {
    if (!path.isAbsolute(rootDir)) {
      throw new Error(`rootDir must be absolute`)
    }

    const p = await execa('yarn', ['--silent', 'workspaces', 'info', '--json'], { cwd: rootDir, reject: false })
    if (p.exitCode === 0) {
      const parsed = JSON.parse(p.stdout)
      return yarnWorkspacesInfoSchema.parse(parsed)
    }

    this.logger.info(`running "yarn workspaces info" failed:\n${p.stderr}}`)
    throw new Error(`Failed to get yarn info for ${rootDir}`)
  }

  async getGraph() {
    return this.state.graph
  }

  async getUnits() {
    return this.state.units
  }

  async getTasks(): Promise<CatalogOfTasks> {
    const build = TaskKind('build')
    const pack = TaskKind('pack')
    const test = TaskKind('test')

    return {
      inUnit: {
        [test]: [build],
        [pack]: [build],
      },
      onDeps: {},
      tasks: [
        {
          taskKind: build,
          outputs: ['dist'],
          shadowing: false,
          inputsInDeps: ['dist/src'],
        },
        {
          taskKind: test,
          outputs: ['jest-output.json'],
          inputsInUnit: ['dist/src', 'dist/tests'],
          inputsInDeps: ['dist/src'],
        },
        {
          taskKind: pack,
          outputs: [PACK_DIR],
          inputsInUnit: ['dist/src'],
          inputsInDeps: ['dist/src'],
        },
      ],
    }
  }

  async computeTestsToRun(resolved: string): Promise<string[]> {
    const exists = await fse.pathExists(resolved)
    if (!exists) {
      this.logger.info('jest-output.json does not exist. running everything!')
      return ['tests']
    }

    const parsed = await fse.readJSON(resolved)
    const jestJson: JestJson = jestJsonSchema.parse(parsed)

    const failedTests = jestJson.testResults.filter(x => x.status !== 'passed')
    this.logger.info(
      `file level jest data: ${JSON.stringify(
        jestJson.testResults.map(x => ({ name: x.name, status: x.status })),
        null,
        2,
      )}`,
    )
    if (failedTests.length === 0) {
      this.logger.info(`No failed tests found in ${resolved}`)
      // TODO(imaman): rethink this. maybe we want to run nothing if there are no failed tests.
      // It boilsdown to whether we trust jest-output.json or not.
      return ['tests']
    }

    const synopsis = failedTests.map(ft => ft.assertionResults.map(x => ({ fullName: x.fullName, status: x.status })))
    this.logger.info(`assertionResults is:\n${JSON.stringify(synopsis, null, 2)}`)
    const failedAssertionResults = failedTests.flatMap(ft =>
      ft.assertionResults.filter(ar => ar.status === 'failed').map(ar => ar.fullName),
    )
    const names = uniqueBy(failedAssertionResults, x => x).sort()
    const ret = [...failedTests.map(x => x.name), '-t', names.map(x => escapeStringRegexp(x)).join('|')]
    this.logger.info(`tests to run: ${JSON.stringify(ret)}`)
    return ret
  }
}

/*
{
  "numFailedTestSuites": 1,
  "numFailedTests": 1,
  "numPassedTestSuites": 15,
  ...
  "startTime": 1642003231059,
  "success": false,
  "testResults": [
    {
      "assertionResults": [
        {
          "ancestorTitles": [
            "misc",
            "computeObjectHash"
          ],
          "failureMessages": [],
          "fullName": "misc computeObjectHash object hash of two identical objects is identical",
          "location": null,
          "status": "passed",
          "title": "object hash of two identical objects is identical"
        },
        {
          "ancestorTitles": [
            "misc",
            "computeObjectHash"
          ],
          "failureMessages": [],
          "fullName": "misc computeObjectHash object hash of two object with different order of keys is the same",
          "location": null,
          "status": "passed",
          "title": "object hash of two object with different order of keys is the same"
        }
      ],
      "endTime": 1642003231453,
      "message": "\u001b[1m\u001b[31m  \u001b[1m● \u001b[22m\u001b[1mmisc › dumpFile › copies the content of a file to the given output stream\u001b[39m\u001b[22m\n\n    \u001b[2mexpect(\u001b[22m\u001b[31mreceived\u001b[39m\u001b[2m).\u001b[22mtoEqual\u001b[2m(\u001b[22m\u001b[32mexpected\u001b[39m\u001b[2m) // deep equality\u001b[22m\n\n    Expected: \u001b[32m\"we choose to go to the moon\u001b[7m_\u001b[27m\"\u001b[39m\n    Received: \u001b[31m\"we choose to go to the moon\"\u001b[39m\n\u001b[2m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 33 |\u001b[39m         \u001b[36mawait\u001b[39m dumpFile(src\u001b[33m,\u001b[39m stream)\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 34 |\u001b[39m         \u001b[36mconst\u001b[39m content \u001b[33m=\u001b[39m \u001b[36mawait\u001b[39m fse\u001b[33m.\u001b[39mreadFile(f\u001b[33m,\u001b[39m \u001b[32m'utf-8'\u001b[39m)\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m\u001b[31m\u001b[1m>\u001b[22m\u001b[2m\u001b[39m\u001b[90m 35 |\u001b[39m         expect(content)\u001b[33m.\u001b[39mtoEqual(\u001b[32m'we choose to go to the moon_'\u001b[39m)\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m    |\u001b[39m                         \u001b[31m\u001b[1m^\u001b[22m\u001b[2m\u001b[39m\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 36 |\u001b[39m       } \u001b[36mfinally\u001b[39m {\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 37 |\u001b[39m         stream\u001b[33m.\u001b[39mclose()\u001b[0m\u001b[22m\n\u001b[2m    \u001b[0m \u001b[90m 38 |\u001b[39m       }\u001b[0m\u001b[22m\n\u001b[2m\u001b[22m\n\u001b[2m      \u001b[2mat Object.<anonymous> (\u001b[22m\u001b[2m\u001b[0m\u001b[36mmodules/misc/tests/misc.spec.ts\u001b[39m\u001b[0m\u001b[2m:35:25)\u001b[22m\u001b[2m\u001b[22m\n",
      "name": "/Users/itay_maman/code/imaman/build-raptor/modules/misc/dist/tests/misc.spec.js",
      "startTime": 1642003231237,
      "status": "failed",
      "summary": ""
    }
  ]
*/
const jestJsonSchema = z.object({
  testResults: z
    .object({
      status: z.string(),
      name: z.string(),
      message: z.string(),
      assertionResults: z.object({ fullName: z.string(), status: z.string() }).array(),
    })
    .array(),
})

type JestJson = z.infer<typeof jestJsonSchema>

const PACK_DIR = 'pack'
const MAIN_FILE_NAME = 'main.js'

function computeUnits(yarnInfo: YarnWorkspacesInfo): UnitMetadata[] {
  const ret: UnitMetadata[] = []
  for (const [p, data] of Object.entries(yarnInfo)) {
    const uid = UnitId(p)
    ret.push(new UnitMetadata(data.location, uid))
  }
  return ret
}

async function readPackages(rootDir: string, units: UnitMetadata[]) {
  const ret = new Map<UnitId, PackageJson>()
  await promises(units).forEach(20, async um => {
    const p = path.join(rootDir, um.pathInRepo, 'package.json')
    const content = await fse.readJSON(p)
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    ret.set(um.id, content as PackageJson)
  })

  return ret
}
