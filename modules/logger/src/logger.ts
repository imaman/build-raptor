import * as fs from 'fs'
import { format } from 'logform'
import * as path from 'path'
import jsonStringify from 'safe-stable-stringify'
import * as winston from 'winston'

const criticalityLegend: Record<Criticality, number> = {
  high: 0,
  moderate: 100,
  low: 200,
}

export type Criticality = 'high' | 'moderate' | 'low'

export interface Logger {
  print(message: string, criticality?: Criticality): void
  info(message: string, ...rest: unknown[]): void
  debug(message: string, ...rest: unknown[]): void
  error(message: string, err: unknown, ...rest: unknown[]): void
}

class NopLogger implements Logger {
  print(_message: string) {
    // noop
  }

  info(_message: string, ..._rest: unknown[]) {
    // noop
  }

  debug(_message: string, ..._rest: unknown[]) {
    // noop
  }

  error(_message: string, _err: unknown, ..._rest: unknown[]) {
    // noop
  }
}

export function createNopLogger() {
  return new NopLogger()
}

export function createDefaultLogger(
  logFile: string,
  pickiness: Criticality,
  logLevel?: Level,
  uiStream?: NodeJS.WritableStream,
): FileLogger {
  const stat = fs.statSync(logFile, { throwIfNoEntry: false })
  if (stat && stat.size > 0) {
    fs.rmSync(logFile, { force: true })
  }
  return new FileLogger(logFile, pickiness, logLevel, uiStream)
}

class FileLogger implements Logger {
  private readonly logger: winston.Logger
  private readonly pickiness

  constructor(
    logFile: string,
    pickinessLevel: Criticality,
    logLevel: Level = 'info',
    uiStream: NodeJS.WritableStream = process.stdout,
  ) {
    if (!path.isAbsolute(logFile)) {
      throw new Error(`logDir must be absolute: ${logFile}`)
    }
    this.logger = newLogger(logFile, logLevel, uiStream)
    this.pickiness = criticalityLegend[pickinessLevel]
  }

  print(message: string, messageCriticality: Criticality = 'moderate') {
    const messageLevel = criticalityLegend[messageCriticality]
    const doPrint = messageLevel <= this.pickiness
    if (doPrint) {
      this.logger.info(message, { ui: true })
    }
  }

  info(message: string, ...rest: unknown[]) {
    this.logger.info(message, ...rest)
  }

  debug(message: string, ...rest: unknown[]) {
    this.logger.debug(message, ...rest)
  }

  error(message: string, err: unknown, ...rest: unknown[]) {
    this.logger.error(message, err, ...rest, { ui: true })
  }
}

const joinTokens = (...tokens: (string | undefined)[]) =>
  tokens
    .map(t => t?.trim())
    .filter(Boolean)
    .join(' ')

const finalFormat = format.printf(info => {
  let stringifiedRest = jsonStringify(
    Object.assign({}, info, {
      level: undefined,
      message: undefined,
      timestamp: undefined,
      stack: undefined,
      ui: undefined,
    }),
  )
  if (stringifiedRest === '{}') {
    stringifiedRest = ''
  }

  return joinTokens(info.timestamp, `[${info.level}]`, info.message, stringifiedRest, info.stack)
})

const filterUi = format(info => {
  if (!info.ui) {
    return false
  }

  return info
})

const formatUi = format.printf(info => {
  return joinTokens(info.message, info.stack)
})

type Level = 'error' | 'info' | 'debug'
const levels: Record<Level, number> = {
  error: 0,
  info: 1,
  debug: 2,
}

function newLogger(logFile: string, level: Level, uiStream: NodeJS.WritableStream): winston.Logger {
  return winston.createLogger({
    level: 'debug',
    levels,
    defaultMeta: undefined,
    transports: [
      // Writes all log entries with level `info` and below to logFile.
      new winston.transports.File({
        filename: logFile,
        level,
        format: format.combine(format.timestamp(), format.errors({ stack: true }), finalFormat),
      }),
      // Writes all logs entries marked as "UI" to the the UI stream (typically, stdout).
      new winston.transports.Stream({
        stream: uiStream,
        level: 'info',
        format: format.combine(format.errors({ stack: true }), filterUi(), formatUi),
      }),
    ],
  })
}
