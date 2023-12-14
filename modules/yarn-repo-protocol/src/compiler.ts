import { Logger } from 'logger'
import path from 'path'
import ts from 'typescript'

export function compile(taskName: string, dir: string, logger: Logger): number {
  const configFileName = ts.findConfigFile(path.join(dir, 'tsconfig.json'), ts.sys.fileExists, 'tsconfig.json')
  if (!configFileName) {
    throw new Error(`config file not found under ${dir}`)
  }
  const configFile = ts.readConfigFile(configFileName, ts.sys.readFile)
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dir)

  const program = ts.createProgram(parsed.fileNames, parsed.options)
  const emitResult = program.emit()

  const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics)
  for (const diagnostic of allDiagnostics) {
    if (!diagnostic.file) {
      logger.print(`${taskName} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
      continue
    }
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    if (!diagnostic.start) {
      logger.print(`${taskName} ${diagnostic.file.fileName}: ${message}`)
      continue
    }
    const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start)
    logger.print(`${taskName} ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`)
  }

  const exitCode = emitResult.emitSkipped ? 1 : 0
  return exitCode
}
