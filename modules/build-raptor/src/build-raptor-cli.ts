import { DefaultAssetPublisher, EngineBootstrapper, findRepoDir, TaskSelector } from 'build-raptor-core'
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

import { TaskExecutionVisualizer } from './task-execution-visualizer'

type TestReporting = 'tree-all' | 'tree-just-failing'

interface Options {
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
  taskProgressOutput?: boolean
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

  const commitHash = getEnv('GITHUB_SHA')
  if (commitHash) {
    const repoName = getEnv('GITHUB_REPOSITORY')
    const gitToken = getEnv('GITHUB_TOKEN')

    if (!repoName || !gitToken) {
      throw new Error('Required git environment variable(s) missing or invalid.')
    }
  }

  if (isCi) {
    logger.info(`details:\n${JSON.stringify({ isCi, commitHash, startedAt: new Date(t0).toISOString() }, null, 2)}`)
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
  const visualizer = options.taskProgressOutput ? new TaskExecutionVisualizer() : undefined

  bootstrapper.transmitter.addProcessor(s => {
    if (
      s.step === 'ASSET_PUBLISHED' ||
      s.step === 'BUILD_RUN_STARTED' ||
      s.step === 'PUBLIC_FILES' ||
      s.step === 'TASK_STORE_GET' ||
      s.step === 'TASK_STORE_PUT' ||
      s.step === 'TEST_ENDED'
    ) {
      return
    }

    if (s.step === 'PLAN_PREPARED') {
      visualizer?.addTasks(s.taskNames)
      return
    }

    if (s.step === 'TASK_ENDED') {
      if (visualizer) {
        const line = visualizer.ended(s.taskName, s.verdict, s.executionType)
        if (line) {
          logger.print(line)
        }
      }
      return
    }

    if (s.step === 'BUILD_RUN_ENDED') {
      const line = visualizer?.summary(Date.now() - t0)
      if (line) {
        logger.print(line)
      }
      return
    }

    shouldNeverHappen(s)
  })

  bootstrapper.subscribable.on('testEnded', arg => {
    assigningGet(testOutput, arg.taskName, () => []).push(arg)
  })

  bootstrapper.subscribable.on('executionStarted', arg => {
    if (visualizer) {
      visualizer.begin(arg)
    } else {
      logger.print(`=============================== ${arg} =================================`)
    }
  })

  bootstrapper.subscribable.on('executionEnded', async arg => {
    // TODO(imaman): cover (output is indeed written in file structure)
    await fse.ensureDir(buildRaptorDirTasks)
    const fileName = path.join(buildRaptorDirTasks, toReasonableFileName(arg.taskName))
    const stream = fse.createWriteStream(fileName)
    try {
      await dumpFile(arg.outputFile, stream)
      logger.info(`wrote output of ${arg.taskName} to ${fileName}`)
    } catch (e) {
      throw new Error(`output file of task ${arg.taskName} (${arg.outputFile}) could not be outputted`)
    } finally {
      stream.end()
    }

    reportTests(logger, testOutput.get(arg.taskName) ?? [], options.testReporting ?? 'tree-all')

    const dumpTaskOutputToTerminal =
      options.printPassing ||
      switchOn(arg.status, {
        CRASH: () => false,
        OK: () => false,
        FAIL: () => true,
      })
    if (!dumpTaskOutputToTerminal) {
      return
    }

    await dumpFile(arg.outputFile, process.stdout)
    logger.info(`output of ${arg.taskName} dumped`)
    logger.print(`\n\n`)
  })

  bootstrapper.subscribable.on('executionSkipped', tn => {
    logger.print(`Task ${tn} succeeded earlier. Skipping.\n`, 'low')
  })

  const selector: TaskSelector = {
    units: options.units,
    goals: options.goals,
    labels: options.labels,
  }

  const runner = await bootstrapper.makeRunner(selector, options.buildRaptorConfigFile, {
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
  })
  const { exitCode } = await runner()
  // eslint-disable-next-line require-atomic-updates
  process.exitCode = exitCode
}

function reportTests(logger: Logger, arr: TestEndedEvent[], tr: TestReporting) {
  //     "build": "build-raptor build --compact",
  //      "test": "export NODE_OPTIONS=--no-experimental-fetch && build-raptor test --compact --test-reporting=tree"

  let renderPassingTests
  if (tr === 'tree-all') {
    renderPassingTests = true
  } else if (tr === 'tree-just-failing') {
    renderPassingTests = false
  } else {
    shouldNeverHappen(tr)
  }
  // printPassing = false

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
  if (renderPassingTests) {
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
        describe: 'whether to dump the output of passing tasks to the terminal.',
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
        choices: ['tree-all', 'tree-just-failing'],
        describe: 'test reporing policy',
        default: 'tree',
      })
      .option('test-caching', {
        describe: 'whether to skip running tests that have already passed',
        type: 'boolean',
        default: true,
      })
      .option('task-progress-output', {
        describe: 'whether to print number of tasks ended/started',
        type: 'boolean',
        default: false,
      })
      .command(
        'build',
        'build the code',
        yargs => yargs,
        async rawArgv => {
          const argv = camelizeRecord(rawArgv)
          await run({
            units: argv.units,
            goals: argv.goals,
            labels: ['build', ...argv.labels],
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
            taskProgressOutput: argv.taskProgressOutput,
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
            units: argv.units,
            goals: argv.goals,
            labels: ['test', ...argv.labels],
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            testCaching: argv.testCaching,
            testReporting:
              tr === 'tree-all' || tr === 'tree-just-failing' || tr === undefined
                ? tr
                : failMe(`unsupported value: ${tr}`),
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
            taskProgressOutput: argv.taskProgressOutput,
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
            units: argv.units,
            goals: argv.goals,
            labels: ['pack', ...argv.labels],
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
            taskProgressOutput: argv.taskProgressOutput,
          })
        },
      )
      // TODO(imaman): 'pack', 'publish', etc. should not be an array option (and not separate commands)
      .command(
        'publish-assets',
        `runs tests and builds assets (by running 'prepare-assets' run scripts)`,
        yargs => yargs,
        async rawArgv => {
          const argv = camelizeRecord(rawArgv)
          const tr = argv.testReporting
          await run({
            units: argv.units,
            goals: argv.goals,
            labels: ['publish-assets', 'test', ...argv.labels],
            printPassing: argv.printPassing,
            concurrency: argv.concurrency,
            compact: argv.compact,
            criticality: stringToLoudness(argv.loudness),
            testCaching: argv.testCaching,
            testReporting:
              tr === 'tree-all' || tr === 'tree-just-failing' || tr === undefined
                ? tr
                : failMe(`unsupported value: ${tr}`),
            stepByStepProcessor: argv.stepByStepProcessor,
            buildRaptorConfigFile: argv.configFile,
            taskProgressOutput: argv.taskProgressOutput,
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
            units: argv.units,
            goals: argv.goals,
            labels: ['run', ...argv.labels],
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
            taskProgressOutput: argv.taskProgressOutput,
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
