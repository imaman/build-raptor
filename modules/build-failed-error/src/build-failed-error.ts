export class BuildFailedError extends Error {
  constructor(m: string, readonly hint: 'task' | 'program' = 'task') {
    super(m)

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, BuildFailedError.prototype)
  }
}
