type HintType =
  /**
   * Failure while running a build task (including, for instance, test tasks)
   */
  | 'task'
  /**
   * Failure while running a program (due to `build-raptor run` command)
   */
  | 'program'

export class BuildFailedError extends Error {
  constructor(m: string, readonly hint: HintType = 'task') {
    super(m)

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, BuildFailedError.prototype)
  }
}
