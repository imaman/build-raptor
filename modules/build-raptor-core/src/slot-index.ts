import { Brand } from 'brand'
import { Int } from 'misc'

export type SlotIndex = Brand<number, 'SlotIndex'>
/**
 * Constructs a SlotIndex value which equals to the sum of all numbers in the input.
 */
export const SlotIndex = (n: number, ...ns: number[]) => {
  let sum = Int(n)
  for (const curr of ns) {
    sum = Int().sum(sum, curr)
  }
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return (sum as unknown) as SlotIndex
}
