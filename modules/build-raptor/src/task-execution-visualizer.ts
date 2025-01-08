export class TaskExecutionVisualizer {
  private readonly runningTasks = new Map<string, number>() // taskName -> indentation level
  private nextIndentation = 0
  private readonly INDENTATION_STEP = 4

  private getTaskPrefix(indentLevel: number, activeIndents: number[]): string {
    const parts: string[] = []
    for (let i = 0; i <= indentLevel; i++) {
      const char = activeIndents.includes(i) ? '|' : ' '
      parts.push(char.padEnd(i === indentLevel ? 0 : this.INDENTATION_STEP))
    }
    return parts.join('')
  }

  begin(taskName: string): string {
    const indentation = this.nextIndentation++
    this.runningTasks.set(taskName, indentation)

    const activeIndents = Array.from(this.runningTasks.values()).sort()
    const prefix = this.getTaskPrefix(indentation, activeIndents)
    return `${prefix}${taskName}`
  }

  ended(taskName: string, verdict: string): string {
    const indentation = this.runningTasks.get(taskName) ?? 0
    this.runningTasks.delete(taskName)
    this.nextIndentation = Math.min(...Array.from(this.runningTasks.values(), x => x + 1), indentation + 1)

    const activeIndents = Array.from(this.runningTasks.values()).sort()
    const prefix = this.getTaskPrefix(indentation, activeIndents).replace(/\|$/, '_')
    return `${prefix}${taskName} [${verdict}]`
  }
}
