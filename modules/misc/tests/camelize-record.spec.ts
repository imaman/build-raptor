import { CamelizeRecord, camelizeRecord } from '../src/camelize-record'

type Example = Record<'first-name' | 'last-name' | 'home-town', string | number | boolean>

describe('camelize-record', () => {
  test('converts the input record to a similar record where all attribute names were camelCased', () => {
    const example: Example = {
      'first-name': 'fn',
      'home-town': 'ht',
      'last-name': 'ln',
    }

    const output = camelizeRecord(example)
    const explicitlyTypedOutput: CamelizeRecord<Example> = output
    expect(explicitlyTypedOutput).toEqual({
      firstName: 'fn',
      homeTown: 'ht',
      lastName: 'ln',
    })
  })
})

// Assert that CamelizedRecord produces a type with camel case attribute names. Note that this does not check the sad
// path (which would be: does not contain attributes which are non-camel-cased) as this would break compilaion.
const _ignore: CamelizeRecord<Example> = {
  firstName: 'foo',
  lastName: 'boo',
  homeTown: 'zoo',
}
