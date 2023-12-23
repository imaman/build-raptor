import { DefaultAssetPublisher, EngineBootstrapper, findRepoDir } from 'build-raptor-core'
import * as fse from 'fs-extra'
import { createDefaultLogger, Criticality, Logger } from 'logger'
import {
  assigningGet,
  camelizeRecord,
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

type TestReporting = 'just-failing' | 'tree' | 'tree-just-failing'

interface Options {
  commands: ('build' | 'test' | 'pack' | 'publish-assets' | 'run')[]
  units: string[]
  goals: string[]
  labels: string[]
  program?: string
  programArgs?: string[]
  printPassing: boolean
  compact?: boolean
  criticality: Criticality
  concurrency: number
  testReporting?: TestReporting
  testCaching?: boolean
  stepByStepProcessor?: string
  buildRaptorConfigFile?: string
}

type TestEndedEvent = RepoProtocolEvent['testEnded']

type EnvVarName = 'GITHUB_SHA' | 'GITHUB_REPOSITORY' | 'GITHUB_REF' | 'GITHUB_REPOSITORY_OWNER' | 'GITHUB_TOKEN' | 'CI'

export function getEnv(envVarName: EnvVarName) {
  return process.env[envVarName] // eslint-disable-line no-process-env
}

const GB = 1024 * 1024 * 1024
async function createStorageClient() {
  return await FilesystemStorageClient.create(path.join(os.homedir(), '.build-raptor/storage'), {
    triggerCleanupIfByteSizeExceeds: 2 * GB,
  })
}

export async function run(options: Options) {
  process.env.AWS_SDK_JS_SUPPRESS_MAINTENANCE_MODE_MESSAGE = '1' // eslint-disable-line no-process-env
  if (options.compact !== undefined) {
    options.criticality = options.compact ? 'moderate' : 'low'
  }
  const t0 = Date.now()

  // Should be called as early as possible to secure the secret.
  const storageClientFactory = getS3StorageClientFactory() ?? createStorageClient

  const userDir = process.cwd()
  const rootDir = findRepoDir(userDir)
  if (!rootDir) {
    throw new Error(
      `could not find a repo dir (a directory with a package.json file that has a 'workspace' attribute) in or above ${userDir}`,
    )
  }
  const buildRaptorDir = path.join(rootDir, '.build-raptor')
  await fse.ensureDir(buildRaptorDir)
  const logFile = path.join(buildRaptorDir, 'main.log')
  const logger = createDefaultLogger(logFile, options.criticality)

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

  const storageClient = await storageClientFactory(logger)
  const assetPublisher = new DefaultAssetPublisher(storageClient, logger)
  const repoProtocol = new YarnRepoProtocol(logger, assetPublisher)
  const bootstrapper = await EngineBootstrapper.create(
    rootDir,
    storageClient,
    repoProtocol,
    t0,
    options.criticality,
    '',
    logger,
  )

  const testOutput = new Map<TaskName, TestEndedEvent[]>()
  bootstrapper.subscribable.on('testEnded', arg => {
    assigningGet(testOutput, arg.taskName, () => []).push(arg)
  })

  bootstrapper.subscribable.on('executionStarted', arg => {
    logger.print(`=============================== ${arg} =================================`)
  })

  bootstrapper.subscribable.on('executionEnded', async arg => {
    const { taskKind_: taskKind } = TaskName().undo(arg.taskName)
    // TODO(imaman): cover (output is indeed written in file structure)
    const d = path.join(buildRaptorDirTasks, arg.pathInRepo)
    await fse.ensureDir(d)
    const fileName = path.join(d, toReasonableFileName(taskKind))
    const stream = fse.createWriteStream(fileName)
    try {
      await dumpFile(arg.outputFile, stream)
      logger.info(`wrote output of ${arg.taskName} to ${fileName}`)
    } catch (e) {
      throw new Error(`output file of task ${arg.taskName} (${arg.outputFile}) could not be outputted`)
    } finally {
      stream.end()
    }

    reportTests(logger, testOutput.get(arg.taskName) ?? [], options.testReporting ?? 'tree')

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
    logger.print(`Task ${tn} succeeded earlier. Skipping.\n`, 'low')
  })

  const runner = await bootstrapper.makeRunner(
    options.commands,
    options.units,
    options.goals,
    options.labels,
    options.buildRaptorConfigFile,
    {
      stepByStepProcessorModuleName: options.stepByStepProcessor,
      concurrency: Int(options.concurrency),
      buildRaptorDir,
      testCaching: options.testCaching ?? true,
      commitHash,
      userDir,
      ...(options.program
        ? {
            toRun: {
              program: options.program,
              args: options.programArgs ?? [],
            },
          }
        : {}),
    },
  )
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
      logger.print(`${indent}${key[j]}`, 'high')
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
      logger.print(`${spaces}${v} ${at.testPath.at(-1)}${duration}`, 'high')

      prev = k
    }
  }

  const list = Object.entries(groupBy(arr, at => at.fileName)).map(([fileName, tests]) => ({ fileName, tests }))
  const sorted = sortBy(list, at => at.fileName)
  const passing = sorted.filter(at => isPassing(at.tests))
  if (printPassing) {
    for (const at of passing) {
      logger.print(`✅ PASSED ${at.fileName}`, 'high')
    }
  }
  for (const at of sorted.filter(at => !isPassing(at.tests))) {
    logger.print(at.fileName, 'high')
    printTests(at.tests)
  }
}

export function main() {
  return (
    yargs(hideBin(process.argv))
      .option('units', {
        alias: 'u',
        describe: 'the names of the units',
        type: 'string',
        array: true,
        demandOption: false,
        default: [],
      })
      .option('goals', {
        alias: 'g',
        describe: 'paths to outputs to be built',
        type: 'string',
        array: true,
        demandOption: false,
        default: [],
      })
      .option('labels', {
        alias: 'l',
        describe: 'labels of tasks to run',
        type: 'string',
        array: true,
        demandOption: false,
        default: [],
      })
      .option('print-passing', {
        describe: 'whether to print the output of passing tasks to the terminal.',
        type: 'boolean',
        default: false,
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
      })
      .options('loudness', {
        describe: `how detailed should the progress report be. Values are T-shirt sizes: 
          s - just critical details/errors are printed
          m - print names of executed tasks
          l - print names of all tasks (including skipped ones)`,
        choices: ['s', 'm', 'l'],
        default: 'm',
      })
      .options('step-by-step-processor', {
        describe: `name of a node module implementing build-raptor's step-by-step-processor protocol`,
        type: 'string',
        demandOption: false,
      })
      .options('config-file', {
        describe: `repo-relative path to a build-raptor config file (defaults to '.build-raptor.json')`,
        type: 'string',
        demandOption: false,
      })
      .option('test-reporting', {
        choices: ['just-failing', 'tree', 'tree-just-failing'],
        describe: 'test reporing policy',
        default: 'tree',
      })
      .option('test-caching', {
        describe: 'whether to skip running tests that have already passed',
        type: 'boolean',
        default: true,
      })
      .command(
        'build',
        'build the code',
        yargs => yargs,
        async rawArgv => {
          const argv = camelizeRecord(rawArgv)
          await run({
            commands: ['build'],
            units: argv.units,
            goals: argv.goals,
            labels: argv.labels,
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
          })
        },
      )
      .command(
        'test',
        'run tests',
        yargs => yargs,
        async rawArgv => {
          const argv = camelizeRecord(rawArgv)
          const tr = argv.testReporting
          await run({
            commands: ['test'],
            units: argv.units,
            goals: argv.goals,
            labels: argv.labels,
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            testCaching: argv.testCaching,
            testReporting:
              tr === 'just-failing' || tr === 'tree' || tr === 'tree-just-failing' || tr === undefined
                ? tr
                : failMe(`unsupported value: ${tr}`),
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
          })
        },
      )
      .command(
        'pack',
        'create publishable packages',
        yargs => yargs,
        async rawArgv => {
          const argv = camelizeRecord(rawArgv)
          await run({
            commands: ['pack'],
            units: argv.units,
            goals: argv.goals,
            labels: argv.labels,
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
          })
        },
      )
      // TODO(imaman): 'pack', 'publish', etc. should not be an array option (and not separate commands)
      .command(
        'publish-assets',
        `runs tests and builds assets (by running 'prepare-assets' run scripts)`,
        yargs =>
          yargs.option('register-assets', {
            describe: 'whether to invoke the register-asset-endpoint with the details of each published asset',
            type: 'boolean',
            default: false,
          }),
        async rawArgv => {
          const argv = camelizeRecord(rawArgv)
          const tr = argv.testReporting
          await run({
            commands: ['publish-assets', 'test'],
            units: argv.units,
            goals: argv.goals,
            labels: argv.labels,
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            testCaching: argv.testCaching,
            testReporting:
              tr === 'just-failing' || tr === 'tree' || tr === 'tree-just-failing' || tr === undefined
                ? tr
                : failMe(`unsupported value: ${tr}`),
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
          })
        },
      )
      .command(
        'run <program>',
        `compiles a program and runs it. use "--" to pass command line options down to the invoked program. E.g., run dist/a.js -- --foo=1 --bar=goo`,
        yargs =>
          yargs.positional('program', {
            describe: 'relative path to the program to run (e.g., "dist/a.js")',
            type: 'string',
          }),
        async rawArgv => {
          const argv = camelizeRecord(rawArgv)
          await run({
            commands: ['run'],
            units: argv.units,
            goals: argv.goals,
            labels: argv.labels,
            program: rawArgv.program,
            // drop the command ("run") which yargs adds into the ._ array
            programArgs: rawArgv._.slice(1).map(at => String(at)),
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            testCaching: argv.testCaching,
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
          })
        },
      )
      .demandCommand(1)
      .parse()
  )
}

function stringToLoudness(s: string): Criticality {
  if (s === 's') {
    return 'high'
  }

  if (s === 'm') {
    return 'moderate'
  }

  if (s === 'l') {
    return 'low'
  }

  throw new Error(`illegal loudness value: "${s}"`)
}
