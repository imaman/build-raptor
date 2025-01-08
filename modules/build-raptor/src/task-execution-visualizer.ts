export class TaskExecutionVisualizer {
  private readonly runningTasks = new Map<string, number>() // taskName -> indentation level
  private readonly INDENTATION_STEP = '    '

  private getLine(taskName: string, text?: string): string {
    const maxIndent = this.activeIndents().at(-1)
    if (maxIndent === undefined) {
      return ''
    }

    const taskByIndent = new Map<number, string>()
    for (const [task, indent] of this.runningTasks) {
      taskByIndent.set(indent, task)
    }

    const parts: string[] = []
    for (let i = 0; i <= maxIndent; ++i) {
      const task = taskByIndent.get(i)
      if (task === taskName) {
        parts.push(text ?? taskName)
        continue
      }

      if (task === undefined || text === undefined) {
        parts.push(' ')
        continue
      }

      parts.push('|')
    }
    return parts.join(this.INDENTATION_STEP).trimEnd()
  }

  private activeIndents(): number[] {
    return Array.from(this.runningTasks.values()).sort()
  }

  private findFreeIndentation(): number {
    let ret = 0

    const set = new Set(this.activeIndents())
    while (true) {
      if (!set.has(ret)) {
        return ret
      }
      ++ret
    }
  }

  begin(taskName: string): string {
    const indentation = this.findFreeIndentation()
    this.runningTasks.set(taskName, indentation)

    return this.getLine(taskName)
  }

  ended(taskName: string, _verdict: string): string {
    const ret = this.getLine(taskName, '_')
    this.runningTasks.delete(taskName)
    return ret
  }
}
