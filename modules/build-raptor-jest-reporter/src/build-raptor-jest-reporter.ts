import {type ReporterContext, type TestContext, type AggregatedResult, type ReporterOnStartOptions, type Test, type TestResult, type Reporter} from '@jest/reporters'
import { type TestCaseResult } from '@jest/test-result'
import { Config } from '@jest/types'
import * as fs from 'fs'

export class BuildRaptorJestReporter  implements Reporter {
  private readonly file
  private readonly acc: {testCaseResult: TestCaseResult, testFile: string}[] = []
  constructor(config: Config.GlobalConfig) {
    if (!config.outputFile) {
      throw new Error(`outputFile is missing (must be specified in the config)`)
    }
    this.file = config.outputFile
    fs.writeFileSync(this.file, '')
    console.log(`L.15`)
  }

  onRunStart(
    results: AggregatedResult,
    options: ReporterOnStartOptions,
  ) {
    // console.log(JSON.stringify({results, options}, null, 2))
    fs.appendFileSync(this.file, `[`) // +
  }
  onTestFileStart(test: Test) {
    // console.log(`L.13`) // +
  }
  onTestFileResult(
    test: Test,
    testResult: TestResult,
    aggregatedResult: AggregatedResult,
  ) {
    // console.log(`L.21`) // +
  }
  onTestCaseResult(
    test: Test,
    testCaseResult: TestCaseResult,
  ) {
    this.acc.push({testFile: test.path, testCaseResult})
  }
  onRunComplete(
    testContexts: Set<TestContext>,
    results: AggregatedResult,
  ) {
    console.log(`writing to ${this.file}`)
    fs.writeFileSync(this.file, JSON.stringify(this.acc))
    // console.log(JSON.stringify({results, testContexts}, null, 2))
  }

  //////////////////////////////////////////////
  onTestResult(
    test: Test,
    testResult: TestResult,
    aggregatedResult: AggregatedResult,
  ) {
    console.log(`L.11`)
  }
  onTestStart(test: Test) {
    console.log(`L.34`)
  }
  getLastError() {}
}

// export class BuildRaptorJestReporter implements Reporter {
//   constructor(_globalConfig: undefined, _reporterOptions: undefined, _reporterContext: undefined) {
//   }
//   onRunStart(results: AggregatedResult, options: ReporterOnStartOptions) {
//     console.log(`L.10 A_A_B_B`)
//     // => void | Promise<void>;
//   }  
//   onTestFileStart(test: Test) {
//     console.log(`L.15 A_A_B_B`)
//     // => Promise<void> | void;
//   }
//   onTestFileResult(test: Test, testResult: TestResult, aggregatedResult: AggregatedResult) {
//     console.log(`L.19 A_A_B_B`)
//     console.log(JSON.stringify(testResult, null, 2))
//   }

//   onRunComplete(contexts: Set<Context>, results: AggregatedResult) {
//     console.log(`L.24 A_A_B_B`)
//     // => void | Promise<void>
//   }
  
//   getLastError() {}


//   onTestResult(test: Test, testResult: TestResult, aggregatedResult: AggregatedResult) {
//     console.log(`L.22 A_A_B_B`)
//     console.log(JSON.stringify(testResult, null, 2))
//   }
//   onTestCaseResult(test: Test, testCaseResult: TestCaseResult) {
//     console.log(`L.31 A_A_B_B`)
//     console.log(JSON.stringify(testCaseResult, null, 2))
//   }
//   onTestStart(test: Test) {
//     console.log(`L.35 A_A_B_B`)
//     // => Promise<void> | void;
//   }
// }
