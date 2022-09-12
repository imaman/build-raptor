import { DefaultAssetPublisher, EngineBootstrapper } from 'build-raptor-core'
import * as fse from 'fs-extra'
import { createDefaultLogger } from 'logger'
import { dumpFile, FilesystemStorageClient, Int, switchOn, toReasonableFileName } from 'misc'
import * as os from 'os'
import * as path from 'path'
import { getS3StorageClientFactory } from 's3-storage-client'
import { TaskName } from 'task-name'
import { UnitMetadata } from 'unit-metadata'
import yargs from 'yargs'
import { hideBin } from 'yargs/helpers'
import { YarnRepoProtocol } from 'yarn-repo-protocol'
interface Options {
  command: 'build' | 'test' | 'pack' | 'publish-assets'
  dir: string | undefined
  units: string[]
  githubActions: boolean
  printPassing: boolean
  compact: boolean
  buildOutputLocation: string[]
  concurrency: number
}

async function createStorageClient() {
  return {
    storageClient: await FilesystemStorageClient.create(path.join(os.homedir(), '.build-raptor/storage')),
    lambdaClient: undefined,
  }
}

async function run(options: Options) {
  const t0 = Date.now()
  const rootDir = options.dir ?? process.cwd()
  const buildRaptorDir = path.join(rootDir, '.build-raptor')
  await fse.ensureDir(buildRaptorDir)
  const logFile = path.join(buildRaptorDir, 'main.log')
  const logger = createDefaultLogger(logFile)
  logger.info(`Logger initialized`)
  logger.print(`logging to ${logFile}`)
  const storageClientFactory = getS3StorageClientFactory(logger) ?? createStorageClient

  const buildRaptorDirTasks = path.join(buildRaptorDir, 'tasks')
  await fse.rm(buildRaptorDirTasks, { recursive: true, force: true })

  const { storageClient, lambdaClient } = await storageClientFactory(logger)
  logger.info(`(typeof lambdaClient)=${typeof lambdaClient}`)
  const assetPublisher = new DefaultAssetPublisher(storageClient, logger, async (u: UnitMetadata, resolved: string) => {
    if (!lambdaClient) {
      return
    }

    await lambdaClient.invoke('d-prod-buildTrackerService', {
      endpointName: 'registerAssetRequest',
      endpointRequest: { packageName: u.id, commitHash: 'N/A', casReference: resolved },
    })
  })
  const repoProtocol = new YarnRepoProtocol(logger, undefined, assetPublisher)
  const bootstrapper = await EngineBootstrapper.create(
    rootDir,
    storageClient,
    repoProtocol,
    t0,
    '',
    logger,
    buildRaptorDir,
  )

  bootstrapper.subscribable.on('executionStarted', tn => {
    logger.print(`\n\n\n\n\n\n\n================================= ${tn} =================================`)
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
  })
  const { exitCode } = await runner()
  // eslint-disable-next-line require-atomic-updates
  process.exitCode = exitCode
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
    yargs => withBuildOptions(yargs),
    async argv => {
      await run({
        dir: argv.dir,
        command: 'test',
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
    'publish assets',
    yargs => withBuildOptions(yargs),
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
      })
    },
  )
  .demandCommand(1)
  .parse()
