import { Brand } from 'brand'

export type BuildRunId = Brand<string, 'BuildRunId'>

function validate(input: string): asserts input is BuildRunId {
  if (input.length === 0) {
    throw new Error(`Bad BuildRunId: <${input}>`)
  }
}

export function BuildRunId(input: string): BuildRunId {
  validate(input)
  return input
}
