import { TaskExecutionVisualizer } from '../src/task-execution-visualizer'

describe('TaskExecutionVisualizer', () => {
  it('shows single task execution', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.ended('taskA', 'OK')).toBe('_')
  })

  it('shows two sequential tasks', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.ended('taskA', 'OK')).toBe('_')
    expect(visualizer.begin('taskB')).toBe('taskB')
    expect(visualizer.ended('taskB', 'OK')).toBe('_')
  })

  it('shows nested task execution', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.begin('taskB')).toBe('     taskB')
    expect(visualizer.ended('taskB', 'OK')).toBe('|    _')
    expect(visualizer.ended('taskA', 'OK')).toBe('_')
  })

  it('handles complex nested execution pattern', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('A')).toBe('A')
    expect(visualizer.begin('B')).toBe('     B')
    expect(visualizer.begin('C')).toBe('          C')
    expect(visualizer.ended('B', 'OK')).toBe('|    _    |')
    expect(visualizer.begin('D')).toBe('     D')
    expect(visualizer.ended('C', 'OK')).toBe('|    |    _')
    expect(visualizer.begin('E')).toBe('          E')
    expect(visualizer.begin('F')).toBe('               F')
    expect(visualizer.ended('A', 'OK')).toBe('_    |    |    |')
    expect(visualizer.ended('D', 'OK')).toBe('     _    |    |')
    expect(visualizer.ended('F', 'OK')).toBe('          |    _')
    expect(visualizer.ended('E', 'OK')).toBe('          _')
  })

  it('handles task completion in different order than start', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.begin('taskB')).toBe('     taskB')
    expect(visualizer.begin('taskC')).toBe('          taskC')
    expect(visualizer.ended('taskB', 'OK')).toBe('|    _    |')
    expect(visualizer.ended('taskC', 'OK')).toBe('|         _')
    expect(visualizer.ended('taskA', 'OK')).toBe('_')
  })

  it('handles different verdict types', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('task')).toBe('task')
    expect(visualizer.ended('task', 'FAIL')).toBe('_')

    expect(visualizer.begin('task2')).toBe('task2')
    expect(visualizer.ended('task2', 'CRASH')).toBe('_')
  })
})
