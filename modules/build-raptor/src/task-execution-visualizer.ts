import { switchOn } from 'misc'

export class TaskExecutionVisualizer {
  private numStarted = 0
  private numEnded = 0
  private numBlocked = 0
  private numFailed = 0
  private numSucceeded = 0
  private numExectuted = 0
  private numCached = 0
  private all = 0

  addTasks(names: string[]) {
    this.all += names.length
  }

  private getLine(taskName: string, text?: string): string {
    if (text === undefined) {
      return `[${this.numEnded}/${this.numStarted}] 🚀  ${taskName}`
    }

    return `[${this.numEnded}/${this.numStarted}] 🏁  ${taskName}`
  }

  begin(taskName: string): string {
    ++this.numStarted
    return this.getLine(taskName)
  }

  private getGradient(durationMillis: number): string {
    const seconds = durationMillis / 1000

    const steps = [
      [0, '▁'],
      [1, '▂'],
      [10, '▃'],
      [30, '▄'],
      [90, '▅'],
      [270, '▆'],
      [810, '▇'],
    ] as const

    const gradient = steps
      .filter(at => seconds >= at[0])
      .map(at => at[1])
      .join('')

    // Pad to 8 characters with spaces for alignment
    return gradient.padEnd(8, ' ')
  }

  ended(
    taskName: string,
    verdict: 'OK' | 'FAIL' | 'UNKNOWN' | 'CRASH',
    executionType: 'EXECUTED' | 'CACHED' | 'UNKNOWN' | 'CANNOT_START',
    durationMillis?: number,
  ): string | undefined {
    if (executionType === 'CANNOT_START' || executionType === 'UNKNOWN') {
      // It looks like UNKNOWN cannot really happen once the task is started, so we ignore it.
      // CANNOT_START can happen but it clutters the output: after a (single) task that failed to build, there can be
      // long chain of dependent tasks that will be CANNOT_START. printing these tasks will distract the user.
      ++this.numBlocked
      return undefined
    }

    ++this.numEnded
    const cacheIndicator = switchOn(executionType, {
      CACHED: () => {
        ++this.numCached
        return '🗃️ '
      },
      EXECUTED: () => {
        ++this.numExectuted
        return '✨'
      },
    })

    const verdictIndicator = switchOn(verdict, {
      CRASH: () => {
        ++this.numFailed
        return '❌'
      },
      FAIL: () => {
        ++this.numFailed
        return '❌'
      },
      OK: () => {
        ++this.numSucceeded
        return '✅'
      },
      UNKNOWN: () => '',
    })

    const full = `[${this.all}/${this.all}]`.length
    const progress = `[${this.numEnded}/${this.all}]`

    // Calculate gradient and format timing
    const gradient = durationMillis !== undefined ? this.getGradient(durationMillis) : '        '
    const timing = durationMillis !== undefined ? this.formatDuration(durationMillis).padStart(6) : '      '

    return `${progress.padStart(full, '.')} ${gradient} ${timing} ${verdictIndicator} ${cacheIndicator} ${taskName}`
  }

  private formatDuration(durationMillis: number) {
    const seconds = durationMillis / 1000
    if (seconds < 600) {
      return `${seconds.toFixed(1)}s`
    } else {
      const minutes = seconds / 60
      return `${minutes.toFixed(1)}m`
    }
  }

  summary(durationInMillis: number) {
    const tried = this.numExectuted + this.numCached
    const width = this.all.toString().length

    return [
      `Build Summary (${(durationInMillis / 1000).toFixed(1)}s):`,
      `✅ Succeeded:       ${this.numSucceeded.toString().padStart(width)}/${this.all}`,
      this.numFailed > 0 ? `❌ Failed:          ${this.numFailed.toString().padStart(width)}/${this.all}` : undefined,
      this.numBlocked > 0 ? `⛔ Could not start: ${this.numBlocked.toString().padStart(width)}/${this.all}` : undefined,
      ``,
      `✨ Executed:        ${this.numExectuted.toString().padStart(width)}/${tried}`,
      `🗃️  Cache hit:       ${this.numCached.toString().padStart(width)}/${tried} (${(
        (100 * this.numCached) /
        tried
      ).toFixed(1)}%)`,
    ]
      .filter(at => at !== undefined)
      .join('\n')
  }
}
