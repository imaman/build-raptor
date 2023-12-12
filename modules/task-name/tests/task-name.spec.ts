import { UnitId } from 'unit-metadata'

import { TaskKind, TaskName } from '../src/task-name'

describe('task-name', () => {
  describe('TaskName', () => {
    test('generates a string from unit-ID, task-kind', () => {
      const taskName = TaskName(UnitId('U'), TaskKind('T'), '')
      expect(taskName).toEqual('U:T')
    })
    test('can take an optional sub-kind value', () => {
      const taskName = TaskName(UnitId('U'), TaskKind('T'), 'abc')
      expect(taskName).toEqual('U:T:abc')
    })
    describe('undo', () => {
      test('decomposes a TaskName back into unit-ID, task-kind', () => {
        const taskName = TaskName(UnitId('U'), TaskKind('T'), '')
        const decomposed = TaskName().undo(taskName)
        expect(decomposed).toEqual({ unitId: 'U', taskKind: 'T' })
      })
      test('can decompose a TaskName back into unit-ID, task-kind, sub-kind', () => {
        const taskName = TaskName(UnitId('U'), TaskKind('T'), 'abc')
        const decomposed = TaskName().undo(taskName)
        expect(decomposed).toEqual({ unitId: 'U', taskKind: 'T', subKind: 'abc' })
      })
    })
  })
  describe('TaskKind', () => {
    test('cosntructs a new TaskKind value', () => {
      const v: TaskKind = TaskKind('a')
      expect(v).toEqual('a')
    })
    test('yells if the input is empty', () => {
      expect(() => TaskKind('')).toThrowError('Bad TaskKind: <>')
    })
    test('yells if the input contains a colon', () => {
      expect(() => TaskKind('a:b')).toThrowError('Bad TaskKind: <a:b>')
    })
  })
})
