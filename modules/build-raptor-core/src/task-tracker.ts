import { Int, shouldNeverHappen, switchOn } from 'misc'
import { ExitStatus } from 'repo-protocol'
import { TaskName } from 'task-name'

import { ExecutionPlan } from './execution-plan'
import { PerformanceReport } from './performance-report'
import { SlotIndex } from './slot-index'
import { Task } from './task'

export class TaskTracker {
  private numRunning = 0
  private readonly usedConcurrencyLevles: number[] = []
  private numExecuted = 0
  private counter: SlotIndex = SlotIndex(0)

  constructor(private readonly plan: ExecutionPlan) {}

  tasks() {
    return this.plan.tasks()
  }

  getDependencyTasks(tn: TaskName): Task[] {
    return this.plan.taskGraph.neighborsOf(tn).map(tn => this.getTask(tn))
  }

  hasVerdict(taskName: TaskName) {
    return switchOn(this.getTask(taskName).record.verdict, {
      UNKNOWN: () => false,
      OK: () => true,
      FAIL: () => true,
      CRASH: () => true,
    })
  }

  getPerformanceReport(): PerformanceReport {
    return {
      maxUsedConcurrency: Math.max(...this.usedConcurrencyLevles),
      numExecuted: this.numExecuted,
      usedConcurrencyLevles: this.usedConcurrencyLevles,
    }
  }

  changeStatus(taskName: TaskName, status: 'RUNNING' | 'DONE') {
    const t = this.getTask(taskName)
    this.counter = SlotIndex(this.counter, switchOn(status, { RUNNING: () => Int(0), DONE: () => Int(1) }))
    t.changeStatus(status, this.counter)

    if (status === 'RUNNING') {
      this.numRunning += 1
      this.numExecuted += 1
      this.usedConcurrencyLevles.push(this.numRunning)
      return
    }

    if (status === 'DONE') {
      this.numRunning -= 1
      return
    }

    shouldNeverHappen(status)
  }

  registerCachedVerdict(taskName: TaskName, cachedVerdict: 'OK' | 'FLAKY' | 'FAIL') {
    const task = this.getTask(taskName)

    if (cachedVerdict === 'OK' || cachedVerdict === 'FLAKY') {
      task.assignVerdict('OK', 'CACHED')
      return
    }

    if (cachedVerdict == 'FAIL') {
      task.assignVerdict('FAIL', 'CACHED')
      this.propagateFailure(taskName)
      return
    }

    shouldNeverHappen(cachedVerdict)
  }

  registerVerdict(taskName: TaskName, status: ExitStatus, outputFile: string) {
    const task = this.getTask(taskName)
    task.assignVerdict(status, 'EXECUTED')

    switchOn(status, {
      CRASH: () => {},
      FAIL: () => task.setOutputFile(outputFile),
      OK: () => task.setOutputFile(outputFile),
    })

    switchOn(status, {
      CRASH: () => {},
      FAIL: () => this.propagateFailure(taskName),
      OK: () => {},
    })
  }

  getTask(tn: TaskName): Task {
    return this.plan.getTask(tn)
  }

  get successful() {
    return this.tasks().every(t => t.record.verdict === 'OK')
  }

  private propagateFailure(taskName: TaskName) {
    const toFail = this.plan.errorPropagationGraph.traverseFrom(taskName, { direction: 'backwards' })
    for (const t of toFail) {
      if (t === taskName) {
        // TODO(imaman): not tested
        continue
      }
      const r = this.getTask(t)
      r.assignVerdict('FAIL', 'CANNOT_START', taskName)
    }
  }
}
