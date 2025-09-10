import { TaskExecutionVisualizer } from '../src/task-execution-visualizer'

describe('TaskExecutionVisualizer', () => {
  let visualizer: TaskExecutionVisualizer

  beforeEach(() => {
    visualizer = new TaskExecutionVisualizer()
  })

  describe('gradient display', () => {
    it('should display the correct gradient for different durations', () => {
      // Set up tasks
      visualizer.addTasks(Array(23).fill('test'))

      // Test various durations
      const testCases = [
        { ms: 100, expected: '▁' }, // < 1s
        { ms: 700, expected: '▁' }, // < 1s
        { ms: 1200, expected: '▁▂' }, // < 5s
        { ms: 5100, expected: '▁▂▃' }, // < 10s
        { ms: 10100, expected: '▁▂▃▄' }, // < 30s
        { ms: 30100, expected: '▁▂▃▄▅' }, // < 60s
        { ms: 60200, expected: '▁▂▃▄▅▆' }, // < 120s
        { ms: 120500, expected: '▁▂▃▄▅▆▇' }, // < 240s
        { ms: 240100, expected: '▁▂▃▄▅▆▇█' }, // >= 240s
      ]

      testCases.forEach((testCase, index) => {
        const result = visualizer.ended(`task-${index}`, 'OK', 'CACHED', testCase.ms)

        // Check that the expected gradient is present in the result
        expect(result).toContain(testCase.expected.padEnd(8, ' '))
      })
    })

    it('should format timing with right alignment', () => {
      visualizer.addTasks(Array(23).fill('test'))

      const testCases = [
        { ms: 100, expectedTiming: '  0.1s' },
        { ms: 5100, expectedTiming: '  5.1s' },
        { ms: 10100, expectedTiming: ' 10.1s' },
        { ms: 120500, expectedTiming: '120.5s' },
        { ms: 240100, expectedTiming: '240.1s' },
        { ms: 599800, expectedTiming: '599.8s' },
        { ms: 600200, expectedTiming: ' 10.0m' },
        { ms: 726000, expectedTiming: ' 12.1m' },
      ]

      testCases.forEach((testCase, index) => {
        const result = visualizer.ended(`task-${index}`, 'OK', 'CACHED', testCase.ms)

        // Check that timing is present and formatted correctly
        expect(result).toContain(testCase.expectedTiming)
      })
    })

    it('should produce output matching the expected format', () => {
      visualizer.addTasks(Array(23).fill('test'))

      const result = visualizer.ended('@moojo/cloud-toolkit:build:bundle', 'OK', 'CACHED', 240100)

      // Expected format: .[23/23] ▁▂▃▄▅▆▇█ 240.1s ✅ 🗃️  @moojo/cloud-toolkit:build:bundle
      expect(result).toBe('.[1/23] ▁▂▃▄▅▆▇█ 240.1s ✅ 🗃️  @moojo/cloud-toolkit:build:bundle')
    })
  })
})
