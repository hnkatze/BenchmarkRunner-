import type { BenchmarkConfig } from '../domain/benchmark-config'
import type { BenchmarkReport, OperationResult } from '../domain/benchmark-report'
import type { BenchmarkRunner } from '../domain/benchmark-runner'
import type { RunEvent } from '../domain/run-event'

/**
 * Combines several runners into one, satisfying the same port they do: the UI
 * cannot tell a multi-engine run from a single-engine one.
 *
 * **They run one after another, never concurrently.** Running two engines at the
 * same time would have them compete for the function's CPU and bandwidth, and
 * each would inflate the other's latency — the run would measure contention
 * instead of the engines.
 *
 * @param runners - one per engine, executed in the order given
 * @returns a runner emitting a single run-started and a single merged report
 */
export const createSequentialRunner = (runners: readonly BenchmarkRunner[]): BenchmarkRunner => ({
  async *run(config: BenchmarkConfig, signal: AbortSignal): AsyncIterable<RunEvent> {
    const startedAt = Date.now()
    const results: OperationResult[] = []
    let announced = false

    for (const runner of runners) {
      if (signal.aborted) return

      for await (const event of runner.run(config, signal)) {
        switch (event.type) {
          case 'run-started':
            // Every runner gets the same config, so they all compute the same
            // sample count — including the server-side clamp. Multiplying the
            // first one is exact, and avoids duplicating the clamp here.
            if (!announced) {
              announced = true
              yield {
                type: 'run-started',
                at: startedAt,
                totalSamples: event.totalSamples * runners.length,
              }
            }
            break

          case 'run-completed':
            // Swallowed: a per-engine report would end the run in the UI while
            // other engines are still pending. Their results are merged below.
            results.push(...event.report.results)
            break

          case 'run-failed':
            // A whole engine failing is terminal. A single bad phase is reported
            // as phase-failed and does not reach here.
            yield event
            return

          case 'phase-started':
          case 'sample':
          case 'phase-failed':
          case 'phase-completed':
            yield event
            break

          default: {
            const unhandled: never = event
            throw new Error(`unhandled run event: ${JSON.stringify(unhandled)}`)
          }
        }
      }
    }

    if (signal.aborted) return

    const report: BenchmarkReport = {
      startedAt,
      finishedAt: Date.now(),
      config,
      results,
    }
    yield { type: 'run-completed', report }
  },
})
