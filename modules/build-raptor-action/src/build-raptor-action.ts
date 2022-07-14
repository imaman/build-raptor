import * as core from '@actions/core'
import { EngineBootstrapper } from 'build-raptor-core'
import { Breakdown } from 'build-raptor-core'
import { TaskSummary } from 'build-raptor-core'
import * as fse from 'fs-extra'
import { createDefaultLogger, Logger } from 'logger'
import { expose, dumpFile, failMe, Int, shouldNeverHappen } from 'misc'
import * as path from 'path'
import { S3StorageClient } from 's3-storage-client'
import { YarnRepoProtocol } from 'yarn-repo-protocol'
import { z } from 'zod'


interface Options {
  command: 'build' | 'test'
  dir: string | undefined
  units: string[]
  concurrency: Int
  printPassing: boolean
}

const AwsAccessKey = z.object({
  AccessKey: z.object({
    UserName: z.string(),
    Status: z.string(),
    CreateDate: z.string(),
    SecretAccessKey: z.string(),
    AccessKeyId: z.string(),
  }),
})
type AwsAccessKey = z.infer<typeof AwsAccessKey>

async function createStorageClient(_rootDir: string, logger: Logger, accessKey: AwsAccessKey) {
  const creds = { accessKeyId: accessKey.AccessKey.AccessKeyId, secretAccessKey: accessKey.AccessKey.SecretAccessKey }
  const ret = new S3StorageClient('moojo-dev-infra', 'build-raptor/cache-v1', creds, logger)
  logger.info(`S3StorageClient created successfully`)
  return ret
  // return await ActionsCacheStorageClient.create(rootDir, logger)
  // return await FilesystemStorageClient.create(rootDir)
}

const s3CacheEnvVar = 'S3_CACHE'

async function run() {
  const t0 = Date.now()

  const s3CacheString = process.env[s3CacheEnvVar] ?? '{}' // eslint-disable-line no-process-env
  process.env[s3CacheEnvVar] = '_' // eslint-disable-line no-process-env

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

  const disclosable = s3CacheString
    .split('\n')
    .filter(s => !s.toLowerCase().includes('secret'))
    .join('\n')
    .split('')
    .reverse()
    .join('')

  console.log(`disclosable=${disclosable}`)

  let awsAccessKey
  try {
    const parsed = JSON.parse(s3CacheString)
    expose(parsed)
    console.log("keys of parsed=" + JSON.stringify(Object.keys(parsed)))

    if (parsed) {
        throw new Error(`Type of s3CacheString=${typeof s3CacheString}, typeof parsed=${typeof parsed}, parsed.numkeys=${Object.keys(parsed).length}`)
    }
    console.log("keys of parsed.AccessKey=" + JSON.stringify(Object.keys(parsed.AccessKey)))

    awsAccessKey = AwsAccessKey.parse(parsed)
  } catch (e) {
    const err = new Error(`Failed to parse env variable neede for caching`)
    logger.error(`parsing failed`, err)
    throw e
  }

  const storageClient = await createStorageClient(rootDir, logger, awsAccessKey)
  const repoProtocol = new YarnRepoProtocol(logger)
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
