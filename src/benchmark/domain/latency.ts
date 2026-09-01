export type LatencySummary = {
  readonly count: number
  readonly minMs: number
  readonly maxMs: number
  readonly meanMs: number
  readonly p50Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
  readonly stdDevMs: number
  readonly opsPerSecond: number
}

export const EMPTY_LATENCY_SUMMARY: LatencySummary = {
  count: 0,
  minMs: 0,
  maxMs: 0,
  meanMs: 0,
  p50Ms: 0,
  p95Ms: 0,
  p99Ms: 0,
  stdDevMs: 0,
  opsPerSecond: 0,
}

/**
 * Linear interpolation between ranks, matching the NIST/Excel PERCENTILE.INC
 * definition, so p95 of a short sample is not pinned to an observed value.
 * @param sorted - ascending durations; an empty input yields 0
 * @param quantile - target quantile in [0, 1]
 * @returns the interpolated value in the same unit as `sorted`
 */
const percentile = (sorted: readonly number[], quantile: number): number => {
  const rank = (sorted.length - 1) * quantile
  const lowIndex = Math.floor(rank)
  const highIndex = Math.ceil(rank)
  const low = sorted[lowIndex]
  const high = sorted[highIndex]
  if (low === undefined || high === undefined) return 0
  if (lowIndex === highIndex) return low
  return low + (high - low) * (rank - lowIndex)
}

/**
 * Throughput is derived from the mean, so it describes a single sequential
 * worker — it is not the aggregate throughput of a concurrent run.
 * @param durationsMs - per-operation latencies, unsorted
 * @returns the full summary, or a zeroed one when there are no samples
 */
export const summarizeLatencies = (durationsMs: readonly number[]): LatencySummary => {
  if (durationsMs.length === 0) return EMPTY_LATENCY_SUMMARY

  const sorted = [...durationsMs].sort((a, b) => a - b)
  const count = sorted.length
  const total = sorted.reduce((sum, value) => sum + value, 0)
  const meanMs = total / count
  const variance = sorted.reduce((sum, value) => sum + (value - meanMs) ** 2, 0) / count

  const minMs = sorted[0]
  const maxMs = sorted[count - 1]
  if (minMs === undefined || maxMs === undefined) return EMPTY_LATENCY_SUMMARY

  return {
    count,
    minMs,
    maxMs,
    meanMs,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    stdDevMs: Math.sqrt(variance),
    opsPerSecond: meanMs > 0 ? 1000 / meanMs : 0,
  }
}
