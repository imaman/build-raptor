import { Brand } from 'brand'
export type Fingerprint = Brand<string, 'fingerprint'>

function validate(input: string): asserts input is Fingerprint {
  if (input.length === 0) {
    throw new Error(`Bad Fingerprint: <${input}>`)
  }
}

export function Fingerprint(input: string): Fingerprint {
  validate(input)
  return input
}
