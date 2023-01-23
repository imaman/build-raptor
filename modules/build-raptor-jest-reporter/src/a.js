const path = require('path')
const fs = require('fs')

module.exports = class BuildRaptorJestReporter {
  constructor(config) {
    if (!config.outputFile) {
      throw new Error(`outputFile is missing (must be specified in the config)`)
    }

    this.file = path.isAbsolute(config.outputFile) ? config.outputFile : path.join(config.rootDir, config.outputFile)
    this.cases = []
  }

  getLastError() {}
  onRunStart() {}

  onTestCaseResult(test, testCaseResult) {
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
    const output = { cases }
    fs.writeFileSync(this.file, JSON.stringify(output))
  }
}
