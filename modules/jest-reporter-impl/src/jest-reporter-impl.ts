import { type Reporter, type Test } from '@jest/reporters'
import { type TestCaseResult } from '@jest/test-result'
import { Config } from '@jest/types'
import * as fs from 'fs'
import path from 'path'
import { ReporterOutput } from 'reporter-output'

export class JestReporterImpl implements Reporter {
  private readonly file
  private readonly cases: { testCaseResult: TestCaseResult; testFile: string }[] = []
  constructor(config: Config.GlobalConfig) {
    if (!config.outputFile) {
      throw new Error(`outputFile is missing (must be specified in the config)`)
    }

    this.file = path.isAbsolute(config.outputFile) ? config.outputFile : path.join(config.rootDir, config.outputFile)
  }

  getLastError() {}
  onRunStart() {}

  onTestCaseResult(test: Test, testCaseResult: TestCaseResult) {
    this.cases.push({ testFile: test.path, testCaseResult })
  }
  onRunComplete() {
    const cases = this.cases.map(at => ({
      testCaseFullName: at.testCaseResult.fullName,
      fileName: at.testFile,
      ancestorTitles: at.testCaseResult.ancestorTitles,
      title: at.testCaseResult.title,
      status: at.testCaseResult.status,
      duration: at.testCaseResult.duration ?? undefined,
    }))
    const output: ReporterOutput = { cases }
    fs.writeFileSync(this.file, JSON.stringify(ReporterOutput.parse(output)))
  }
}
