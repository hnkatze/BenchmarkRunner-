import type { BenchmarkConfig } from './benchmark-config'
import type { RunEvent } from './run-event'

/**
 * The port every storage engine adapter implements. Nothing behind this type
 * may leak a vendor SDK into the UI — that is the whole point of the boundary.
 */
export type BenchmarkRunner = {
  /**
   * Property syntax, not a method: `strictFunctionTypes` skips method shorthand,
   * so only this form checks an adapter's parameters contravariantly.
   * @param config - a configuration already validated by `validateConfig`
   * @param signal - aborting it must end the stream, not throw past the caller
   * @returns events in run order; the last one is `run-completed` or `run-failed`
   */
  readonly run: (config: BenchmarkConfig, signal: AbortSignal) => AsyncIterable<RunEvent>
}
