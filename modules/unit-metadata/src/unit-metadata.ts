import { Brand } from 'brand'
import { PathInRepo } from 'core-types'
export type UnitId = Brand<string, 'UnitId'>

function validate(input: string): asserts input is UnitId {
  if (
    input.length === 0 ||
    input.includes('::') ||
    input.endsWith(':') ||
    input.startsWith(':') ||
    input.split(':').length > 2
  ) {
    throw new Error(`Bad UnitId: <${input}>`)
  }
}

export const UnitId: (input: string) => UnitId = (input: string) => {
  validate(input)
  return input
}

export class UnitMetadata {
  readonly pathInRepo
  /**
   *
   * @param pathInRepo path (relative to the repo's root dir) to a directory which is the root directory of the unit.
   * @param id
   */
  // TODO(imama): make it PathInRepo
  constructor(pathInRepo: string, readonly id: UnitId) {
    this.pathInRepo = PathInRepo(pathInRepo)
  }
}
