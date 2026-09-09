import type { BenchmarkConfig } from './benchmark-config'
import type { RunEvent } from './run-event'

/**
 * The port every storage engine adapter implements. Nothing behind this type
 * may leak a vendor SDK into the UI — that is the whole point of the boundary.
 */
export type BenchmarkRunner = {
  /**
   * How many samples this runner will attempt for the given config, knowable
   * BEFORE it runs. It exists so a combinator can announce an exact total
   * instead of guessing from the first runner to speak: a run mixing CRUD
   * operations with dataset queries has runners that measure different phase
   * counts, and scaling one of them by the number of runners is simply wrong.
   *
   * Property syntax for the same reason `run` uses it.
   * @param config - the configuration about to be run
   * @returns the sample count, already reflecting any server-side clamp
   */
  readonly plannedSamples: (config: BenchmarkConfig) => number

  /**
   * Property syntax, not a method: `strictFunctionTypes` skips method shorthand,
   * so only this form checks an adapter's parameters contravariantly.
   * @param config - a configuration already validated by `validateConfig`
   * @param signal - aborting it must end the stream, not throw past the caller
   * @returns events in run order; the last one is `run-completed` or `run-failed`
   */
  readonly run: (config: BenchmarkConfig, signal: AbortSignal) => AsyncIterable<RunEvent>
}
