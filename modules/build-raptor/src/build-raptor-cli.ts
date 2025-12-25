import { DefaultAssetPublisher, EngineBootstrapper, findRepoDir, TaskSelector } from 'build-raptor-core'
import fs from 'fs'
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

import { TaskExecutionVisualizer } from './task-execution-visualizer.js'

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
  printTiming?: boolean
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

async function makeBootstrapper(options: Options) {
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
  const taskTimings = options.printTiming ? new Map<string, number>() : undefined

  // TODO(imaman): use a writable stream?
  const allTestsFile = path.join(buildRaptorDir, 'all-tests')

  // Wipe out the file
  fs.writeFileSync(allTestsFile, '')

  let atLeastOneTest = false

  bootstrapper.transmitter.addProcessor(s => {
    if (
      s.step === 'ASSET_PUBLISHED' ||
      s.step === 'BUILD_RUN_STARTED' ||
      s.step === 'PUBLIC_FILES' ||
      s.step === 'TASK_STORE_GET' ||
      s.step === 'TASK_STORE_PUT'
    ) {
      return
    }

    if (s.step === 'TEST_ENDED') {
      atLeastOneTest = true
      return
    }

    if (s.step === 'PLAN_PREPARED') {
      visualizer?.addTasks(s.taskNames)
      return
    }

    if (s.step === 'TASK_ENDED') {
      if (visualizer) {
        const line = visualizer.ended(s.taskName, s.verdict, s.executionType, s.durationMillis)
        if (line) {
          logger.print(line)
        }
      }
      if (taskTimings && s.durationMillis !== undefined) {
        taskTimings.set(s.taskName, s.durationMillis)
      }
      return
    }

    if (s.step === 'BUILD_RUN_ENDED') {
      // If there are no tests, don't print the message asbout the location of the all-test-logs file.
      // If there is no summary message, do not print it.
      // If one of them is printed, add a prefix of three blank lines
      const line = visualizer?.summary(Date.now() - t0) ?? ''
      const whereIsTheLogMessage = atLeastOneTest ? `All test logs were written to ${allTestsFile}\n\n` : ``
      if (whereIsTheLogMessage || line) {
        // The logger does .trim() on the message so we use "." instead of a "pure" blank line
        logger.print(`.\n.\n.\n${whereIsTheLogMessage}${line}`)
      }

      // Print timing report if --print-timing was specified
      if (taskTimings && taskTimings.size > 0) {
        const sortedTimings = Array.from(taskTimings.entries()).sort((a, b) => a[1] - b[1])

        logger.print('\n\nTask Timing Report (sorted by duration):')
        logger.print('==========================================')
        for (const [taskName, durationMs] of sortedTimings) {
          const seconds = (durationMs / 1000).toFixed(1)
          logger.print(`${taskName}: ${seconds}s`)
        }
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

    reportTests(logger, testOutput.get(arg.taskName) ?? [], options.testReporting ?? 'tree-all', allTestsFile)

    const dumpTaskOutputToTerminal =
      options.printPassing ||
      switchOn(arg.status, {
        CRASH: () => false,
        OK: () => false,
        FAIL: () => true,
      })
    if (dumpTaskOutputToTerminal) {
      await dumpFile(arg.outputFile, process.stdout)
      logger.print(`\n\n`)
    }
    fs.appendFileSync(allTestsFile, fs.readFileSync(arg.outputFile) + '\n')
    logger.info(`output of ${arg.taskName} dumped`)
  })

  bootstrapper.subscribable.on('executionSkipped', tn => {
    logger.print(`Task ${tn} succeeded earlier. Skipping.\n`, 'low')
  })
  return { bootstrapper, buildRaptorDir, commitHash, userDir, logger }
}

export async function run(options: Options) {
  const { bootstrapper, buildRaptorDir, commitHash, userDir } = await makeBootstrapper(options)
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

function reportTests(logger: Logger, arr: TestEndedEvent[], tr: TestReporting, allTasksFile: string) {
  let renderPassingTests
  if (tr === 'tree-all') {
    renderPassingTests = true
  } else if (tr === 'tree-just-failing') {
    renderPassingTests = false
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
      const message = `${spaces}${v} ${at.testPath.at(-1)}${duration}`
      // TODO(imaman): create a dedicate logger that write to the allTasksFile
      logger.print(message, 'high')
      fs.appendFileSync(allTasksFile, message + '\n')

      prev = k
    }
  }

  const list = Object.entries(groupBy(arr, at => at.fileName)).map(([fileName, tests]) => ({ fileName, tests }))
  const sorted = sortBy(list, at => at.fileName)
  const passing = sorted.filter(at => isPassing(at.tests))
  for (const at of passing) {
    const message = `✅ PASSED ${at.fileName}`
    fs.appendFileSync(allTasksFile, message + '\n')
    if (renderPassingTests) {
      logger.print(message, 'high')
    }
  }
  for (const at of sorted.filter(at => !isPassing(at.tests))) {
    fs.appendFileSync(allTasksFile, at.fileName + '\n')
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
      // TODO(imaman): seems like --compact, --loudness can be replaced by --task-progress-output
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
        describe: `repo-relative path to a build-raptor config file. If not specified, looks for '${EngineBootstrapper.CONFIG_FILES.join(
          ', ',
        )}' (mutually exclusive).`,
        type: 'string',
        demandOption: false,
      })
      .option('test-reporting', {
        choices: ['tree-all', 'tree-just-failing'],
        describe: 'test reporing policy',
        default: 'tree-just-failing',
      })
      .option('test-caching', {
        describe: 'whether to skip running tests that have already passed',
        type: 'boolean',
        default: true,
      })
      .option('task-progress-output', {
        describe: 'whether to print a line indicating verdict/execution-type for each task',
        type: 'boolean',
        default: true,
      })
      .option('print-timing', {
        describe: 'print task timing report at the end (sorted by duration)',
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
            printTiming: argv.printTiming,
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
            printTiming: argv.printTiming,
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
            printTiming: argv.printTiming,
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
            printTiming: argv.printTiming,
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
            printTiming: argv.printTiming,
          })
        },
      )
      .command(
        'init-config',
        'generate a build-raptor config file with all available options commented out',
        yargs => yargs,
        async () => {
          const { logger, userDir, bootstrapper } = await makeBootstrapper({
            units: [],
            goals: [],
            labels: [],
            printPassing: false,
            criticality: 'low',
            concurrency: 0,
          })
          const configContent = bootstrapper.getConfigFileExample()
          const outputPath = path.join(userDir, EngineBootstrapper.CONFIG_FILES[0])

          if (fs.existsSync(outputPath)) {
            logger.print(`Error: ${outputPath} already exists. Remove it first if you want to regenerate.`)
            process.exitCode = 1
            return
          }

          fs.writeFileSync(outputPath, configContent + '\n')
          logger.print(`Created ${outputPath}`)
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
