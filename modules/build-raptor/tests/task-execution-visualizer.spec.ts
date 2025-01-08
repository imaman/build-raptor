import { TaskExecutionVisualizer } from '../src/task-execution-visualizer'

describe('TaskExecutionVisualizer', () => {
  test('shows single task execution', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.ended('taskA', 'V')).toBe('V')
  })

  test('shows two sequential tasks', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.ended('taskA', '✅')).toBe('✅')
    expect(visualizer.begin('taskB')).toBe('taskB')
    expect(visualizer.ended('taskB', '✅')).toBe('✅')
  })

  test('shows nested task execution', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.begin('taskB')).toBe('     taskB')
    expect(visualizer.ended('taskB', '✅')).toBe('|    ✅')
    expect(visualizer.ended('taskA', '✅')).toBe('✅')
  })

  test('handles complex nested execution pattern', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('A')).toBe('A')
    expect(visualizer.begin('B')).toBe('     B')
    expect(visualizer.begin('C')).toBe('          C')
    expect(visualizer.ended('B', '✅')).toBe('|    ✅    |')
    expect(visualizer.begin('D')).toBe('     D')
    expect(visualizer.ended('C', '✅')).toBe('|    |    ✅')
    expect(visualizer.begin('E')).toBe('          E')
    expect(visualizer.begin('F')).toBe('               F')
    expect(visualizer.ended('A', '✅')).toBe('✅    |    |    |')
    expect(visualizer.ended('D', '✅')).toBe('     ✅    |    |')
    expect(visualizer.ended('F', '✅')).toBe('          |    ✅')
    expect(visualizer.ended('E', '✅')).toBe('          ✅')
  })

  test('handles task completion in different order than start', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.begin('taskB')).toBe('     taskB')
    expect(visualizer.begin('taskC')).toBe('          taskC')
    expect(visualizer.ended('taskB', 'V')).toBe('|    V    |')
    expect(visualizer.ended('taskC', 'V')).toBe('|         V')
    expect(visualizer.ended('taskA', 'V')).toBe('V')
  })

  test('handles different verdict types', () => {
    const visualizer = new TaskExecutionVisualizer()
    expect(visualizer.begin('task')).toBe('task')
    expect(visualizer.ended('task', 'X')).toBe('X')

    expect(visualizer.begin('task2')).toBe('task2')
    expect(visualizer.ended('task2', '#')).toBe('#')
  })
})
