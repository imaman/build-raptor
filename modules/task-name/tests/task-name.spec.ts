import { UnitId } from 'unit-metadata'

import { TaskKind, TaskName } from '../src/task-name'

describe('task-name', () => {
  describe('TaskName', () => {
    test('generates a string from unit-ID, task-kind', () => {
      const taskName = TaskName(UnitId('U'), TaskKind('T'), '')
      expect(taskName).toEqual('U:T')
    })
    describe('undo', () => {
      test('decomposes a TaskName back into unit-ID, task-kind', () => {
        const taskName = TaskName(UnitId('U'), TaskKind('T'), '')
        const decomposed = TaskName().undo(taskName)
        expect(decomposed).toEqual({ unitId: 'U', taskKind: 'T' })
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
