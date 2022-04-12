export interface PerformanceReport {
  maxUsedConcurrency: number
  usedConcurrencyLevles: readonly number[]
  numExecuted: number
}
