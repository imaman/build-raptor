import { DefaultAssetPublisher, EngineBootstrapper } from 'build-raptor-core'
import * as fse from 'fs-extra'
import { createDefaultLogger, Logger } from 'logger'
import {
  assigningGet,
  dumpFile,
  failMe,
  FilesystemStorageClient,
  groupBy,
  Int,
  shouldNeverHappen,
  sortBy,
  switchOn,
  toReasonableFileName,
} from 'misc'
import * as os from 'os'
import * as path from 'path'
import { RepoProtocolEvent } from 'repo-protocol'
import { getS3StorageClientFactory } from 's3-storage-client'
import { TaskName } from 'task-name'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { YarnRepoProtocol } from 'yarn-repo-protocol'

import { getPrForCommit } from './get-pr-for-commit'
import { RegisterAssetRequest } from './register-asset-request'

type TestReporting = 'just-failing' | 'tree' | 'tree-just-failing'

interface Options {
  command: 'build' | 'test' | 'pack' | 'publish-assets'
  dir: string | undefined
  units: string[]
  githubActions: boolean
  printPassing: boolean
  compact: boolean
  buildOutputLocation: string[]
  concurrency: number
  testReporting?: TestReporting
  testCaching?: boolean
  callRegisterAsset?: boolean
}

type TestEndedEvent = RepoProtocolEvent['testEnded']

type EnvVarName = 'GITHUB_SHA' | 'GITHUB_REPOSITORY' | 'GITHUB_REF' | 'GITHUB_REPOSITORY_OWNER' | 'GITHUB_TOKEN' | 'CI'

export function getEnv(envVarName: EnvVarName) {
  return process.env[envVarName] // eslint-disable-line no-process-env
}

const GB = 1024 * 1024 * 1024
async function createStorageClient() {
  return {
    storageClient: await FilesystemStorageClient.create(path.join(os.homedir(), '.build-raptor/storage'), {
      triggerCleanupIfByteSizeExceeds: 2 * GB,
    }),
    lambdaClient: undefined,
  }
}

async function run(options: Options) {
  process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1' // eslint-disable-line no-process-env
  const t0 = Date.now()

  // Should be called as early as possible to secure the secret.
  const storageClientFactory = getS3StorageClientFactory() ?? createStorageClient

  const rootDir = options.dir ?? process.cwd()
  const buildRaptorDir = path.join(rootDir, '.build-raptor')
  await fse.ensureDir(buildRaptorDir)
  const logFile = path.join(buildRaptorDir, 'main.log')
  const logger = createDefaultLogger(logFile)

  logger.info(`Logger initialized`)
  logger.print(`logging to ${logFile}`)
  const isCi = getEnv('CI') === 'true'

  let pullRequest: number | undefined
  const commitHash = getEnv('GITHUB_SHA')

  if (commitHash) {
    const repoName = getEnv('GITHUB_REPOSITORY')
    const gitToken = getEnv('GITHUB_TOKEN')

    if (!repoName || !gitToken) {
      throw new Error('Required git environment variable(s) missing or invalid.')
    }

    pullRequest = await getPrForCommit(commitHash, repoName, gitToken)
  }

  if (isCi) {
    logger.print(
      `details:\n${JSON.stringify({ isCi, commitHash, pullRequest, startedAt: new Date(t0).toISOString() }, null, 2)}`,
    )
  }

  const buildRaptorDirTasks = path.join(buildRaptorDir, 'tasks')
  await fse.rm(buildRaptorDirTasks, { recursive: true, force: true })

  const { storageClient, lambdaClient } = await storageClientFactory(logger)
  logger.info(`(typeof lambdaClient)=${typeof lambdaClient}`)
  const assetPublisher = new DefaultAssetPublisher(storageClient, logger)
  const repoProtocol = new YarnRepoProtocol(logger, false, assetPublisher)
  const bootstrapper = await EngineBootstrapper.create(
    rootDir,
    storageClient,
    repoProtocol,
    t0,
    '',
    logger,
    buildRaptorDir,
  )

  const testOutput = new Map<TaskName, TestEndedEvent[]>()
  bootstrapper.subscribable.on('testEnded', arg => {
    assigningGet(testOutput, arg.taskName, () => []).push(arg)
  })

  bootstrapper.subscribable.on('executionStarted', arg => {
    logger.print(`=============================== ${arg} =================================`)
  })

  const callRegisterAsset = options.callRegisterAsset ?? true
  bootstrapper.subscribable.on('assetPublished', async arg => {
    if (!callRegisterAsset) {
      logger.info(`NOT calling register-asset endpoint as the command line option is off`)
      return
    }
    if (!lambdaClient || !isCi) {
      return
    }

    const req: RegisterAssetRequest = {
      packageName: TaskName().undo(arg.taskName).unitId,
      commitHash: commitHash ?? 'N/A',
      prNumber: pullRequest,
      casReference: arg.casAddress,
    }

    const payload = {
      endpointName: 'registerAsset',
      endpointRequest: RegisterAssetRequest.parse(req),
    }

    logger.info(`sending lambda payload: ${JSON.stringify(payload)}`)
    await lambdaClient.invoke('d-prod-buildTrackerService', payload)
  })

  bootstrapper.subscribable.on('executionEnded', async arg => {
    const { taskKind } = TaskName().undo(arg.taskName)
    // TODO(imaman): cover (output is indeed written in file structure)
    const d = path.join(buildRaptorDirTasks, arg.pathInRepo)
    await fse.ensureDir(d)
    const fileName = path.join(d, toReasonableFileName(taskKind))
    const stream = fse.createWriteStream(fileName)
    try {
      await dumpFile(arg.outputFile, stream)
      logger.info(`wrote output of ${arg.taskName} to ${fileName}`)
    } finally {
      stream.end()
    }

    reportTests(logger, testOutput.get(arg.taskName) ?? [], options.testReporting ?? 'just-failing')

    const doPrint =
      options.printPassing ||
      switchOn(arg.status, {
        CRASH: () => false,
        OK: () => false,
        FAIL: () => true,
      })
    if (!doPrint) {
      return
    }

    await dumpFile(arg.outputFile, process.stdout)
    logger.info(`output of ${arg.taskName} dumped`)
    logger.print(`\n\n`)
  })

  bootstrapper.subscribable.on('executionSkipped', tn => {
    if (!options.compact) {
      logger.print(`Task ${tn} succeeded earlier. Skipping.\n`)
    }
  })
  bootstrapper.subscribable.on('executionShadowed', tn => {
    if (!options.compact) {
      logger.print(`OVERSHADOWED: task ${tn}.\n`)
    }
  })

  const runner = await bootstrapper.makeRunner(options.command, options.units, {
    concurrency: Int(options.concurrency),
    buildRaptorDir,
    testCaching: options.testCaching ?? true,
    commitHash,
  })
  const { exitCode } = await runner()
  // eslint-disable-next-line require-atomic-updates
  process.exitCode = exitCode
}

function reportTests(logger: Logger, arr: TestEndedEvent[], tr: TestReporting) {
  if (tr === 'just-failing') {
    return
  }

  let printPassing
  if (tr === 'tree') {
    printPassing = true
  } else if (tr === 'tree-just-failing') {
    printPassing = false
  } else {
    shouldNeverHappen(tr)
  }

  function indent(prevKey: string[], key: string[]) {
    let indent = '|    '
    let i = 0
    while (i < prevKey.length) {
      if (prevKey[i] !== key[i]) {
        break
      }
      indent += '  '
      ++i
    }

    for (let j = i; j < key.length; ++j) {
      logger.print(`${indent}${key[j]}`)
      indent += '  '
    }

    return indent
  }

  function isPassing(tests: TestEndedEvent[]) {
    return tests.every(at =>
      switchOn(at.verdict, {
        TEST_CRASHED: () => false,
        TEST_FAILED: () => false,
        TEST_PASSED: () => true,
        TEST_TIMEDOUT: () => false,
      }),
    )
  }

  function printTests(tests: TestEndedEvent[]) {
    let prev: string[] = []
    for (const at of tests) {
      const k = at.testPath.slice(0, -1)
      const spaces = indent(prev, k)
      const v = switchOn(at.verdict, {
        TEST_CRASHED: () => '❌',
        TEST_FAILED: () => '❌',
        TEST_PASSED: () => '✅',
        TEST_TIMEDOUT: () => '⏲️ [timedout]',
      })

      const duration = at.durationMillis === undefined ? '' : ` (${at.durationMillis} ms)`
      logger.print(`${spaces}${v} ${at.testPath.at(-1)}${duration}`)

      prev = k
    }
  }

  const list = Object.entries(groupBy(arr, at => at.fileName)).map(([fileName, tests]) => ({ fileName, tests }))
  const sorted = sortBy(list, at => at.fileName)
  const passing = sorted.filter(at => isPassing(at.tests))
  if (printPassing) {
    for (const at of passing) {
      logger.print(`✅ PASSED ${at.fileName}`)
    }
  }
  for (const at of sorted.filter(at => !isPassing(at.tests))) {
    logger.print(at.fileName)
    printTests(at.tests)
  }
}

function withBuildOptions<T>(y: yargs.Argv<T>) {
  return y
    .option('units', {
      alias: 'u',
      describe: 'the names of the units',
      type: 'string',
      array: true,
      demandOption: false,
      default: [],
    })
    .option('dir', {
      alias: 'd',
      describe: 'the path to the root dir of the repository',
      type: 'string',
    })
    .option('print-passing', {
      describe: 'whether to print the output of passing tasks to the terminal.',
      type: 'boolean',
      default: false,
    })
    .option('github-actions', {
      describe: 'whether to use the github-actions cache storage client',
      type: 'boolean',
      default: false,
    })
    .option('build-output-locations', {
      describe: 'unit-relative path to files/directories where the output of the build step stored',
      type: 'string',
      array: true,
      demandOption: false,
      default: [],
    })
    .option('concurrency', {
      describe: 'a limit on the number of tasks to run concurrently',
      type: 'number',
      demandOption: false,
      default: 8,
    })
    .options('compact', {
      describe: 'whether to list only executing tasks (i.e., do not print skipped tasks)',
      type: 'boolean',
      default: false,
    })
    .options('step-by-step-processor', {
      describe: 'path to a program to receive events describing the running build over a pipe',
      type: 'string',
      demandOption: false,
    })
}

yargs(hideBin(process.argv))
  .command(
    'build',
    'build the code',
    yargs => withBuildOptions(yargs),
    async argv => {
      await run({
        dir: argv.dir,
        command: 'build',
        units: argv.units,
        githubActions: argv['github-actions'],
        printPassing: argv['print-passing'],
        buildOutputLocation: argv['build-output-locations'],
        concurrency: argv['concurrency'],
        compact: argv.compact,
      })
    },
  )
  .command(
    'test',
    'run tests',
    yargs =>
      withBuildOptions(yargs)
        .option('test-reporting', {
          choices: ['just-failing', 'tree', 'tree-just-failing'],
          describe: 'test reporing policy',
        })
        .option('test-caching', {
          describe: 'whether to skip running tests that have already passed',
          type: 'boolean',
          default: true,
        }),
    async argv => {
      const tr = argv['test-reporting']
      await run({
        dir: argv.dir,
        command: 'test',
        units: argv.units,
        githubActions: argv['github-actions'],
        printPassing: argv['print-passing'],
        buildOutputLocation: argv['build-output-locations'],
        concurrency: argv['concurrency'],
        compact: argv.compact,
        testCaching: argv['test-caching'],
        testReporting:
          tr === 'just-failing' || tr === 'tree' || tr === 'tree-just-failing' || tr === undefined
            ? tr
            : failMe(`unsupported value: ${tr}`),
      })
    },
  )
  .command(
    'pack',
    'create publishable packages',
    yargs => withBuildOptions(yargs),
    async argv => {
      await run({
        dir: argv.dir,
        command: 'pack',
        units: argv.units,
        githubActions: argv['github-actions'],
        printPassing: argv['print-passing'],
        buildOutputLocation: argv['build-output-locations'],
        concurrency: argv['concurrency'],
        compact: argv.compact,
      })
    },
  )
  // TODO(imaman): 'pack', 'publish', etc. should not be an array option (and not separate commands)
  .command(
    'publish-assets',
    'publish deployables (as blobs)',
    yargs =>
      withBuildOptions(yargs).option('register-assets', {
        describe: 'whether to invoke the register-asset-endpoint with the details of each published asset',
        type: 'boolean',
        default: true,
      }),
    async argv => {
      await run({
        dir: argv.dir,
        command: 'publish-assets',
        units: argv.units,
        githubActions: argv['github-actions'],
        printPassing: argv['print-passing'],
        buildOutputLocation: argv['build-output-locations'],
        concurrency: argv['concurrency'],
        compact: argv.compact,
        callRegisterAsset: argv['register-assets'],
      })
    },
  )
  .demandCommand(1)
  .parse()
