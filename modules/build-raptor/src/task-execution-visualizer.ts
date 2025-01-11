import { switchOn } from 'misc'

export class TaskExecutionVisualizer {
  private numStarted = 0
  private numEnded = 0
  private numBlocked = 0
  private numFailed = 0
  private numCached = 0
  private all = 0
  private runningTasks: string[] = []

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
    this.runningTasks.push(taskName)
    return this.getLine(taskName)
  }

  ended(
    taskName: string,
    verdict: 'OK' | 'FAIL' | 'UNKNOWN' | 'CRASH',
    executionType: 'EXECUTED' | 'CACHED' | 'UNKNOWN' | 'CANNOT_START',
  ): string | undefined {
    if (executionType === 'CANNOT_START' || executionType === 'UNKNOWN') {
      ++this.numBlocked
      return undefined
    }

    ++this.numEnded
    const index = this.runningTasks.indexOf(taskName)
    if (index >= 0) {
      this.runningTasks.splice(index, 1)
    }
    const secondLine = ''
    // if (this.runningTasks.length) {
    //   secondLine = `Currently running: ${this.runningTasks[0]}`
    //   if (this.runningTasks.length >= 2) {
    //     secondLine += ` (and ${this.runningTasks.length - 1} more)`
    //   }
    // }

    const cacheIndicator = switchOn(executionType, {
      CACHED: () => {
        ++this.numCached
        return '🗃️ '
      },
      EXECUTED: () => '󠀠✨',
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
      OK: () => '✅',
      UNKNOWN: () => '',
    })

    const full = `[${this.all}/${this.all}]`.length
    const progress = `[${this.numEnded}/${this.all}]`
    return `${progress.padStart(full, '.')} ${verdictIndicator} ${cacheIndicator} ${taskName}${
      secondLine ? '\n' + ' '.repeat(4 + full) + secondLine : ''
    }`
  }

  summary(_durationInMillis: number) {
    return [
      `✅ Succeeded: ${this.numEnded}/${this.all}`,
      `❌ Failed: ${this.numFailed}/${this.all}`,
      `⛔ Could not start: ${this.numBlocked}/${this.all}`,
      `🗃️ Cache hit: ${this.numCached}/${this.all}`,
    ].join('\n')
  }
}
