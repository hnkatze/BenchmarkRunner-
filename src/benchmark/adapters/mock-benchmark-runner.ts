import type { BenchmarkConfig } from '../domain/benchmark-config'
import type { BenchmarkReport, OperationResult } from '../domain/benchmark-report'
import type { BenchmarkRunner } from '../domain/benchmark-runner'
import type { EngineId } from '../domain/engine'
import { summarizeLatencies } from '../domain/latency'
import type { OperationId } from '../domain/operation'
import type { RunEvent } from '../domain/run-event'
import { payloadPenalty, profileFor } from './latency-profile'

/**
 * Mulberry32: seeded so a run is reproducible and two engines can be compared
 * without the noise of a fresh Math.random stream on every render.
 */
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const standardNormal = (random: () => number): number => {
  const u = Math.max(random(), Number.EPSILON)
  const v = random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

type SampleOutcome = { readonly durationMs: number; readonly failed: boolean }

const drawSample = (
  engine: EngineId,
  operation: OperationId,
  config: BenchmarkConfig,
  random: () => number,
): SampleOutcome => {
  const profile = profileFor(engine, operation)
  const base = profile.medianMs * payloadPenalty(config.documentSizeBytes)
  const logNormal = base * Math.exp(standardNormal(random) * profile.sigma)
  const contention = 1 + (config.concurrency - 1) * 0.04
  const isTail = random() < profile.tailChance
  const durationMs = logNormal * contention * (isTail ? profile.tailMultiplier : 1)

  return { durationMs, failed: random() < profile.errorRate }
}

export type MockRunnerOptions = {
  readonly seed?: number
  /** Wall-clock pacing per sample. Keep it tiny: this is a UI feed, not a real load test. */
  readonly pacingMs?: number
}

/**
 * Stand-in adapter that streams plausible events so the UI can be built and
 * demoed before any credentials exist. Swap it for a real adapter at the root.
 * @param options - seed for reproducibility and pacing for the visible feed
 * @returns a `BenchmarkRunner` that never touches the network
 */
export const createMockBenchmarkRunner = (options: MockRunnerOptions = {}): BenchmarkRunner => {
  const seed = options.seed ?? 0x5eed
  const pacingMs = options.pacingMs ?? 4

  return {
    async *run(config: BenchmarkConfig, signal: AbortSignal): AsyncIterable<RunEvent> {
      const random = createRandom(seed)
      const startedAt = Date.now()
      const totalSamples = config.engines.length * config.operations.length * config.iterations

      yield { type: 'run-started', at: startedAt, totalSamples }

      const results: OperationResult[] = []

      for (const operation of config.operations) {
        for (const engine of config.engines) {
          if (signal.aborted) return

          yield { type: 'phase-started', engine, operation, iterations: config.iterations }

          for (let i = 0; i < config.warmupIterations; i += 1) {
            drawSample(engine, operation, config, random)
          }

          const durations: number[] = []
          let errorCount = 0
          const phaseStarted = Date.now()

          for (let index = 0; index < config.iterations; index += 1) {
            if (signal.aborted) return

            const outcome = drawSample(engine, operation, config, random)
            if (outcome.failed) {
              errorCount += 1
            } else {
              durations.push(outcome.durationMs)
            }

            yield { type: 'sample', engine, operation, durationMs: outcome.durationMs, index }
            if (pacingMs > 0) await sleep(pacingMs)
          }

          const result: OperationResult = {
            engine,
            operation,
            summary: summarizeLatencies(durations),
            errorCount,
            wallClockMs: Date.now() - phaseStarted,
          }
          results.push(result)
          yield { type: 'phase-completed', result }
        }
      }

      const report: BenchmarkReport = {
        startedAt,
        finishedAt: Date.now(),
        config,
        results,
      }
      yield { type: 'run-completed', report }
    },
  }
}
