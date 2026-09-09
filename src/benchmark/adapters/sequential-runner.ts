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
 * @param runners - one per engine and phase family, executed in the order given
 * @returns a runner emitting a single run-started and a single merged report
 */
export const createSequentialRunner = (runners: readonly BenchmarkRunner[]): BenchmarkRunner => ({
  // Asked of every runner rather than scaling the first one's answer. The list
  // mixes CRUD runners with query runners, which measure different phases, so
  // multiplying either count by the number of runners gives a total that no run
  // ever reaches — and a progress bar that never arrives at 100%.
  plannedSamples: (config: BenchmarkConfig): number =>
    runners.reduce((total, runner) => total + runner.plannedSamples(config), 0),

  async *run(config: BenchmarkConfig, signal: AbortSignal): AsyncIterable<RunEvent> {
    const startedAt = Date.now()
    const results: OperationResult[] = []
    const totalSamples = runners.reduce(
      (total, runner) => total + runner.plannedSamples(config),
      0,
    )

    // Announced up front, before any runner speaks: the total is already known,
    // and waiting for the first run-started would leave the bar at zero while
    // the first phase seeds its documents.
    yield { type: 'run-started', at: startedAt, totalSamples }

    for (const runner of runners) {
      if (signal.aborted) return

      for await (const event of runner.run(config, signal)) {
        switch (event.type) {
          case 'run-started':
            // Swallowed: the combinator already announced the exact total.
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
          case 'sample-failed':
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
