import { RepoRoot } from 'core-types'
import { switchOn } from 'misc'
import { TestRunSummary } from 'repo-protocol'
import { ReporterOutput } from 'reporter-output'

export function generateTestRunSummary(repoRoot: RepoRoot, reporterOutput: ReporterOutput): TestRunSummary {
  return {
    testRuns: reporterOutput.cases
      .map(at => {
        if (at.status === 'disabled' || at.status === 'pending' || at.status === 'skipped' || at.status === 'todo') {
          return undefined
        }
        return {
          testFile: repoRoot.unresolve(at.fileName).val,
          testCasePath: [...at.ancestorTitles, at.title],
          verdict: switchOn(at.status, {
            failed: () => 'failed' as const,
            passed: () => 'passed' as const,
          }),
          durationInMillis: at.duration ?? 0,
          message: at.message,
        }
      })
      .flatMap(at => (at ? [at] : [])),
  }
}
