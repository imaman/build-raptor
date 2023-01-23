const { create } = require('jest-reporter-impl')

module.exports = class BuildRaptorJestReporter {
  constructor(config) {
    this.impl = create(config)
  }

  getLastError() {}
  onRunStart() {}

  onTestCaseResult(test, testCaseResult) {
    return this.impl.onTestCaseResult(test, testCaseResult)
  }
  onRunComplete() {
    return this.impl.onRunComplete()
  }
}
