import { UnitId } from '../src'

describe('unit-metadata', () => {
  describe('UnitId', () => {
    test('cosntructs a new UnitId value', () => {
      const v: UnitId = UnitId('a')
      expect(v).toEqual('a')
    })
    test('allows the input to contain a single colon', () => {
      expect(UnitId('a:b')).toEqual('a:b')
    })
    test('yells if the input is empty', () => {
      expect(() => UnitId('')).toThrowError('Bad UnitId: <>')
    })
    test('yells if the input contains more than one colon', () => {
      expect(() => UnitId('a::b')).toThrowError('Bad UnitId: <a::b>')
    })
    test('yells if the input contains more than one colon scattered', () => {
      expect(() => UnitId('ab:c:d')).toThrowError('Bad UnitId: <ab:c:d>')
    })
    test('yells if the input ends or starts with a colon', () => {
      expect(() => UnitId('ab:')).toThrowError('Bad UnitId: <ab:>')
      expect(() => UnitId(':ab')).toThrowError('Bad UnitId: <:ab>')
    })
    test('yells if the input is just a colon', () => {
      expect(() => UnitId(':')).toThrowError('Bad UnitId: <:>')
    })
  })
})
