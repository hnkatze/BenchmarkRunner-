import {
  summarizeLatencies,
  type BenchmarkConfig,
  type BenchmarkRunner,
  type EngineId,
  type OperationResult,
  type RunEvent,
} from '../domain'
import type { QueryId } from '../../dataset/domain/queries.ts'
import {
  PHASE_FAILURE_LIMIT,
  SAMPLE_TIMEOUT_MS,
  WARMUP_FAILURE_LIMIT,
  withDeadline,
} from './deadline'
import { failureReason } from './failure-reason'

/**
 * Measures the ten read queries against the seeded dataset.
 *
 * It satisfies the same `BenchmarkRunner` port as the CRUD runners, so the
 * reducer, the results table, the chart and the percentile maths serve it
 * without a line of change. A query is, to the measurement, exactly what an
 * operation is: run this N times and hand back the latencies.
 *
 * The engine-specific part is a single map of functions, injected. This file
 * never learns which database it is timing.
 */

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

export type QueryExecutors = Readonly<Record<QueryId, (iteration: number) => Promise<unknown>>>

/**
 * @param engine - which engine these executors belong to, for the events
 * @param executors - one function per query, already bound to a live client
 * @returns a runner that measures only the queries named in the config
 */
export const createQueryRunner = (engine: EngineId, executors: QueryExecutors): BenchmarkRunner => ({
  // Queries are not clamped by BENCH_MAX_ITERATIONS: that ceiling guards the
  // CRUD phases, which write. A query only reads.
  plannedSamples: (config: BenchmarkConfig): number =>
    config.queries.length * config.iterations,

  async *run(config: BenchmarkConfig, signal: AbortSignal): AsyncIterable<RunEvent> {
    const results: OperationResult[] = []
    const startedAt = Date.now()

    yield {
      type: 'run-started',
      at: startedAt,
      totalSamples: config.queries.length * config.iterations,
    }

    for (const query of config.queries) {
      if (signal.aborted) break

      const execute = executors[query]
      yield { type: 'phase-started', engine, operation: query, iterations: config.iterations }

      // Warmup runs at negative-facing indices past the measured range so a
      // cached plan or a warm connection is paid for once, outside the numbers.
      // It doubles as the canary: a query against an unseeded collection or a
      // composite index that does not exist fails here first.
      try {
        let warmupFailures = 0
        for (let i = 0; i < config.warmupIterations && !signal.aborted; i += 1) {
          try {
            await withDeadline(execute(config.iterations + i), SAMPLE_TIMEOUT_MS, signal)
            warmupFailures = 0
          } catch (error: unknown) {
            warmupFailures += 1
            console.error(`[bench] warmup ${engine}/${query}#${i} failed:`, error)
            if (warmupFailures >= WARMUP_FAILURE_LIMIT) {
              throw new Error(
                `${warmupFailures} calentamientos seguidos fallaron — ${failureReason(error)}`,
              )
            }
          }
        }

      const durations: number[] = []
      let errorCount = 0
      let lastReason = ''
      const phaseStarted = nowMs()

      const lanes = Math.max(1, Math.min(config.concurrency, config.iterations))

      for (let start = 0; start < config.iterations && !signal.aborted; start += lanes) {
        const indexes = Array.from(
          { length: Math.min(lanes, config.iterations - start) },
          (_, offset) => start + offset,
        )

        const settled = await Promise.allSettled(
          indexes.map(async (index) => {
            const at = nowMs()
            await withDeadline(execute(index), SAMPLE_TIMEOUT_MS, signal)
            return nowMs() - at
          }),
        )

        for (let lane = 0; lane < settled.length; lane += 1) {
          const outcome = settled[lane]
          const index = indexes[lane]
          if (outcome === undefined || index === undefined) continue

          if (outcome.status === 'fulfilled') {
            durations.push(outcome.value)
            yield {
              type: 'sample',
              engine,
              operation: query,
              durationMs: outcome.value,
              index,
            }
          } else {
            // A failed query never reaches `durations`, so the percentiles
            // describe only what actually completed. It is still ANNOUNCED, or
            // a phase failing on every iteration — an unseeded collection, a
            // missing composite index — would look exactly like a stalled run.
            errorCount += 1
            lastReason = failureReason(outcome.reason)
            yield {
              type: 'sample-failed',
              engine,
              operation: query,
              index,
              reason: lastReason,
            }
          }
        }

        // Nothing has worked yet and the failures keep coming: the phase is
        // broken, not slow. Running the remaining iterations would spend time —
        // and, on Firestore, read quota — to learn the same thing.
        if (durations.length === 0 && errorCount >= PHASE_FAILURE_LIMIT) {
          throw new Error(`${errorCount} muestras fallaron sin ninguna exitosa — ${lastReason}`)
        }
      }

      const result: OperationResult = {
        engine,
        operation: query,
        summary: summarizeLatencies(durations),
        errorCount,
        wallClockMs: nowMs() - phaseStarted,
      }
      results.push(result)
      yield { type: 'phase-completed', result }
      } catch (error: unknown) {
        // Queries own no collection, so there is nothing to clean up — but a
        // phase that dies before its first sample still has to say so.
        yield { type: 'phase-failed', engine, operation: query, reason: failureReason(error) }
      }
    }

    yield {
      type: 'run-completed',
      report: { startedAt, finishedAt: Date.now(), config, results },
    }
  },
})
