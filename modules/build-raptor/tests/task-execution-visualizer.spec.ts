import { TaskExecutionVisualizer } from '../src/task-execution-visualizer'

describe('TaskExecutionVisualizer', () => {
  let visualizer: TaskExecutionVisualizer

  beforeEach(() => {
    visualizer = new TaskExecutionVisualizer()
  })

  it('shows single task execution', () => {
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.ended('taskA', 'OK')).toBe('_')
  })

  it('shows two sequential tasks', () => {
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.ended('taskA', 'OK')).toBe('_')
    expect(visualizer.begin('taskB')).toBe('taskB')
    expect(visualizer.ended('taskB', 'OK')).toBe('_')
  })

  it('shows nested task execution', () => {
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.begin('taskB')).toBe('|   taskB')
    expect(visualizer.ended('taskB', 'OK')).toBe('|   _')
    expect(visualizer.ended('taskA', 'OK')).toBe('_')
  })

  it('handles complex nested execution pattern', () => {
    // This test recreates the example from the requirements
    // A starts
    expect(visualizer.begin('A')).toBe('A')

    // B starts
    expect(visualizer.begin('B')).toBe('|   B')

    // C starts
    expect(visualizer.begin('C')).toBe('|   |   C')

    // B finishes
    expect(visualizer.ended('B', 'OK')).toBe('|   _B [OK]')

    // D starts
    expect(visualizer.begin('D')).toBe('|   D')

    // C finishes
    expect(visualizer.ended('C', 'OK')).toBe('|   |   _C [OK]')

    // E starts
    expect(visualizer.begin('E')).toBe('|   |   E')

    // F starts
    expect(visualizer.begin('F')).toBe('|   |   |   F')

    // A finishes
    expect(visualizer.ended('A', 'OK')).toBe('_A [OK]')

    // D finishes
    expect(visualizer.ended('D', 'OK')).toBe('    _D [OK]')

    // F finishes
    expect(visualizer.ended('F', 'OK')).toBe('        |   _F [OK]')

    // E finishes
    expect(visualizer.ended('E', 'OK')).toBe('        _E [OK]')
  })

  it('handles task completion in different order than start', () => {
    expect(visualizer.begin('taskA')).toBe('taskA')
    expect(visualizer.begin('taskB')).toBe('|   taskB')
    expect(visualizer.begin('taskC')).toBe('|   |   taskC')
    expect(visualizer.ended('taskB', 'OK')).toBe('|   _taskB [OK]')
    expect(visualizer.ended('taskC', 'OK')).toBe('|       _taskC [OK]')
    expect(visualizer.ended('taskA', 'OK')).toBe('_taskA [OK]')
  })

  it('handles different verdict types', () => {
    expect(visualizer.begin('task')).toBe('task')
    expect(visualizer.ended('task', 'FAIL')).toBe('_task [FAIL]')

    expect(visualizer.begin('task2')).toBe('task2')
    expect(visualizer.ended('task2', 'CRASH')).toBe('_task2 [CRASH]')
  })
})
