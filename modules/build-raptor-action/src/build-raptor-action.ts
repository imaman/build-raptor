import * as core from '@actions/core'
import { EngineBootstrapper } from 'build-raptor-core'
import { Breakdown } from 'build-raptor-core'
import { TaskSummary } from 'build-raptor-core'
import * as fse from 'fs-extra'
import { createDefaultLogger, Logger } from 'logger'
import { dumpFile, failMe, FilesystemStorageClient, Int, shouldNeverHappen } from 'misc'
import * as path from 'path'
import { YarnRepoProtocol } from 'yarn-repo-protocol'

interface Options {
  command: 'build' | 'test'
  dir: string | undefined
  units: string[]
  concurrency: Int
  printPassing: boolean
}

async function createStorageClient(rootDir: string, _logger: Logger) {
  // return await ActionsCacheStorageClient.create(rootDir, logger)
  return await FilesystemStorageClient.create(rootDir)
}

async function run() {
  const t0 = Date.now()
  const options: Options = {
    // eslint-disable-next-line no-process-env
    dir: process.env['GITHUB_WORKSPACE'] || failMe(),
    command: 'test',
    units: [],
    printPassing: false,
    concurrency: Int().parse(core.getInput('concurrency', { trimWhitespace: true })),
  }
  const rootDir = options.dir ?? process.cwd()

  const buildRaptorDir = path.join(rootDir, '.build-raptor')
  await fse.ensureDir(buildRaptorDir)
  const logFile = path.join(buildRaptorDir, 'main.log')
  const logger = createDefaultLogger(logFile)

  logger.info(`Logger initialized`)
  logger.print(`logging to ${logFile}`)

  const storageClient = await createStorageClient(rootDir, logger)
  const repoProtocol = new YarnRepoProtocol(logger)
  const bootstrapper = await EngineBootstrapper.create(rootDir, storageClient, repoProtocol, t0, '', logger)

  bootstrapper.subscribable.on('executionEnded', async arg => {
    await core.group(arg.taskName, async () => {
      await dumpFile(arg.outputFile, process.stdout)
    })
  })

  const runner = await bootstrapper.makeRunner(options.command, options.units, {
    concurrency: options.concurrency,
  })
  const out = await runner()

  logger.info(summarize('All tasks', () => true, out))
  logger.print(summarize('Executed tasks', s => s.execution === 'EXECUTED', out))
  logger.print(summarize('Failing tasks', s => s.verdict === 'FAIL', out))

  if (out.overallVerdict === 'OK') {
    logger.print('  -- PASSED! --')
    return
  }

  if (out.overallVerdict === 'FAIL') {
    core.setFailed('at least one task did not pass')
    return
  }

  if (out.crashCause) {
    throw out.crashCause
  }

  if (out.overallVerdict === 'CRASH') {
    throw new Error(`Encounered a problem and crashed`)
  }

  shouldNeverHappen(out.overallVerdict)
}

function format(s: TaskSummary) {
  return `${s.taskName}: ${JSON.stringify({ verdict: s.verdict, execution: s.execution })}`
}

function summarize(title: string, predicate: (s: TaskSummary) => boolean, breakdown: Breakdown) {
  const summaries = breakdown.getSummaries()
  const formatted = breakdown
    .getSummaries()
    .filter(s => predicate(s))
    .map(s => format(s))

  if (formatted.length === 0) {
    return `${title} ${formatted.length}/${summaries.length}: <None>`
  }

  return `${title} (${formatted.length}/${summaries.length}):\n  ${formatted.join('\n  ')}`
}

run()

export default run
