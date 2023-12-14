import fs from 'fs'
import { Logger } from 'logger'
import path from 'path'
import ts from 'typescript'

export class Compiler {
  constructor(private readonly logger: Logger) {}

  compile(taskName: string, dir: string, outputFile: string): number {
    const configFileName = ts.findConfigFile(path.join(dir, 'tsconfig.json'), ts.sys.fileExists, 'tsconfig.json')
    if (!configFileName) {
      throw new Error(`config file not found under ${dir}`)
    }
    const configFile = ts.readConfigFile(configFileName, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dir)

    const program = ts.createProgram(parsed.fileNames, parsed.options)
    const emitResult = program.emit()

    const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics)
    const mapped = allDiagnostics.map(diagnostic => {
      if (!diagnostic.file) {
        return `${taskName} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`
      }
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
      if (!diagnostic.start) {
        return `${taskName} ${diagnostic.file.fileName}: ${message}`
      }
      const { line, character } = ts.getLineAndCharacterOfPosition(diagnostic.file, diagnostic.start)
      return `${taskName} ${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`
    })

    fs.writeFileSync(outputFile, mapped.join('\n'))
    const exitCode = emitResult.emitSkipped ? 1 : 0
    return exitCode
  }
}
