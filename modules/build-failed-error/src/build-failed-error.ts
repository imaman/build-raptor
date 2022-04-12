export class BuildFailedError extends Error {
  constructor(m: string) {
    super(m)

    // Set the prototype explicitly.
    Object.setPrototypeOf(this, BuildFailedError.prototype)
  }
}
