import type { BenchmarkConfig } from './benchmark-config'
import type { EngineId } from './engine'
import type { LatencySummary } from './latency'
import type { OperationId } from './operation'

export type OperationResult = {
  readonly engine: EngineId
  readonly operation: OperationId
  readonly summary: LatencySummary
  readonly errorCount: number
  /** Wall-clock of the whole phase. Required to report throughput under concurrency. */
  readonly wallClockMs: number
}

/**
 * Aggregate throughput. `summary.opsPerSecond` is the inverse of the mean and
 * therefore describes one sequential worker — it DROPS as concurrency rises.
 * @param result - a completed phase
 * @returns operations per second actually achieved, zero if the phase took no time
 */
export const throughputOpsPerSecond = (result: OperationResult): number =>
  result.wallClockMs > 0 ? (result.summary.count / result.wallClockMs) * 1000 : 0

export type BenchmarkReport = {
  readonly startedAt: number
  readonly finishedAt: number
  readonly config: BenchmarkConfig
  readonly results: readonly OperationResult[]
}

export type OperationComparison = {
  readonly operation: OperationId
  readonly byEngine: ReadonlyMap<EngineId, OperationResult>
  readonly winner: EngineId | null
}

/**
 * The winner is decided on p95, not the mean: tail latency is what a user feels.
 * A tie, a missing engine, or a single-engine run yields no winner.
 * @param results - every result of one report, across engines and operations
 * @returns one comparison per operation, in first-seen order
 */
export const compareByOperation = (
  results: readonly OperationResult[],
): readonly OperationComparison[] => {
  const grouped = new Map<OperationId, Map<EngineId, OperationResult>>()

  for (const result of results) {
    const bucket = grouped.get(result.operation) ?? new Map<EngineId, OperationResult>()
    bucket.set(result.engine, result)
    grouped.set(result.operation, bucket)
  }

  return [...grouped].map(([operation, byEngine]) => {
    const ranked = [...byEngine.values()]
      .filter((result) => result.summary.count > 0)
      .sort((a, b) => a.summary.p95Ms - b.summary.p95Ms)

    const best = ranked[0]
    const runnerUp = ranked[1]
    const isDecisive =
      best !== undefined && runnerUp !== undefined && best.summary.p95Ms < runnerUp.summary.p95Ms

    return { operation, byEngine, winner: isDecisive ? best.engine : null }
  })
}
