import * as core from '@actions/core'
import { EngineBootstrapper } from 'build-raptor-core'
import { Breakdown } from 'build-raptor-core'
import { TaskSummary } from 'build-raptor-core'
import * as fse from 'fs-extra'
import { createDefaultLogger } from 'logger'
import { dumpFile, failMe, Int, shouldNeverHappen } from 'misc'
import * as path from 'path'
import { getS3StorageClientFactory } from 's3-storage-client'
import { YarnRepoProtocol } from 'yarn-repo-protocol'

interface Options {
  command: 'build' | 'test'
  dir: string | undefined
  units: string[]
  concurrency: Int
  printPassing: boolean
}

async function run() {
  const t0 = Date.now()

  // Should be called as early as possible to secure the secret.
  const storageClientFactory = getS3StorageClientFactory() ?? failMe('Could not create a storage client')

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

  const repoProtocol = new YarnRepoProtocol(logger)
  const { storageClient } = await storageClientFactory(logger)
  const bootstrapper = await EngineBootstrapper.create(rootDir, storageClient, repoProtocol, t0, '', logger)

  bootstrapper.subscribable.on('executionEnded', async arg => {
    await core.group(arg.taskName, async () => {
      await dumpFile(arg.outputFile, process.stdout)
    })
  })

  const runner = await bootstrapper.makeRunner(options.command, options.units, {
    concurrency: options.concurrency,
    buildRaptorDir,
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
