export class TaskExecutionVisualizer {
  private numStarted = 0
  private numEnded = 0

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

  ended(taskName: string, verdict: string): string {
    ++this.numEnded
    const ret = this.getLine(taskName, verdict)
    return ret
  }
}
