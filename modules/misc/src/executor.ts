import PQueue from 'p-queue'

import { TypedPublisher } from './typed-publisher.js'

/**
 * Allows tasks (promises) to be executed with controlled concurrency, providing error-handling ("fail fast"), and notifications
 * that allow consumers to track progress. Uses PQueue as the underlying priority queue.
 *
 * The execution of a task is essentially calling the callback function passed to the copnstructor (`workToDo`), passing
 * to it a `T` value (`T` is a generic type, representing information about a single task).
 *
 * Fail-fast error handling: once a task is rejected, it is guaranteed that no further tasks will be execute. Tasks that
 * started running before the rejection will continue to run. Subsequent calls to `schedule()` are allowed but those
 * scheduled tasks will not be executed.
 *
 * Progress notifications: consumers can use `subscribe()` to register a handler that will be called whenever some
 * progress in made (including progress due to task failures, or tasks that are no-op due to a previous failure).
 */
export class Executor<T> {
  private firstError: unknown | undefined

  private publisher = new TypedPublisher<{ progressMade: { lastSettled: T; error?: unknown } }>()

  constructor(private readonly queue: PQueue, private readonly workToDo: (t: T) => Promise<void>) {}

  /**
   * Schedules a task to be executed. A task will be executed only if no earlier-executed task has failed.
   * @param task information about the task to execute
   */
  schedule(task: T) {
    this.queue.add(async () => this.process(task))
  }

  /**
   * Registers handler to be called when any task settles (either succeeds or fails or is no-op due to an earlier
   * failure). Once handler is registered, it is guranateed to be called exactly once for every subsequently scheduled
   * task. A handler is not called for previously executed tasks. Handlers are call
   *
   * @param handler the callback function to register
   */
  subscribe(handler: (arg: { lastSettled: T; error?: unknown }) => void) {
    return this.publisher.on('progressMade', handler)
  }

  private async process(task: T) {
    if (!this.firstError) {
      try {
        await this.workToDo(task)
      } catch (e) {
        if (!this.firstError) {
          this.firstError = e
        }
      }
    }

    // The event that is published intentionally includes an exception, even if it was emitted from the execution of
    // some other vertex. This makes event handling easier on the subscriber side.
    await this.publisher.publish('progressMade', { lastSettled: task, error: this.firstError })
  }
}
