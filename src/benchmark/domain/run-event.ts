import type { BenchmarkReport, OperationResult } from './benchmark-report'
import type { EngineId } from './engine'
import type { PhaseId } from './phase'

export type RunEvent =
  | { readonly type: 'run-started'; readonly at: number; readonly totalSamples: number }
  | {
      readonly type: 'phase-started'
      readonly engine: EngineId
      readonly operation: PhaseId
      readonly iterations: number
    }
  | {
      readonly type: 'sample'
      readonly engine: EngineId
      readonly operation: PhaseId
      readonly durationMs: number
      readonly index: number
    }
  | {
      /**
       * A sample that threw. It carries no duration — a failed call has no
       * latency to report — but the run did ATTEMPT it, so progress must count
       * it. Without this event a phase where every call fails is
       * indistinguishable from a frozen run: no samples, no error, no movement.
       */
      readonly type: 'sample-failed'
      readonly engine: EngineId
      readonly operation: PhaseId
      readonly index: number
      readonly reason: string
    }
  | {
      /**
       * The phase never produced a result. Carries the reason for the same
       * cause as `sample-failed`: a phase that dies during setup — clearing a
       * collection, seeding it — emits no samples at all, so without this the
       * UI has literally nothing to show for it.
       */
      readonly type: 'phase-failed'
      readonly engine: EngineId
      readonly operation: PhaseId
      readonly reason: string
    }
  | { readonly type: 'phase-completed'; readonly result: OperationResult }
  | { readonly type: 'run-completed'; readonly report: BenchmarkReport }
  | { readonly type: 'run-failed'; readonly message: string }

export const RUN_EVENT_TYPES = [
  'run-started',
  'phase-started',
  'sample',
  'sample-failed',
  'phase-failed',
  'phase-completed',
  'run-completed',
  'run-failed',
] as const satisfies readonly RunEvent['type'][]

/**
 * Fails to compile if a RunEvent variant is added without listing it above.
 * `satisfies` alone only checks the members present, never the ones missing.
 */
type MissingEventType = Exclude<RunEvent['type'], (typeof RUN_EVENT_TYPES)[number]>
const _allEventTypesListed: MissingEventType extends never ? true : MissingEventType = true
void _allEventTypesListed

/** Runtime companion to the RunEvent union, for parsing events off the wire. */
export const isRunEventType = (value: unknown): value is RunEvent['type'] =>
  typeof value === 'string' && (RUN_EVENT_TYPES as readonly string[]).includes(value)

/**
 * One measured sample, kept rather than only counted.
 *
 * The per-phase percentiles answer "how fast"; only the sequence answers "was it
 * steady" — a warm-up ramp, a drift, or one 800 ms spike among 50 ms samples all
 * vanish into a p95 and are obvious in a line.
 */
export type SamplePoint = {
  readonly engine: EngineId
  readonly operation: PhaseId
  readonly index: number
  readonly durationMs: number
}

export type RunState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running'
      /** Samples that produced a latency. */
      readonly completedSamples: number
      /**
       * Samples that threw. Kept apart from the completed ones because they
       * belong to different questions: progress is `completed + failed` over
       * total, while the percentiles may only ever see the completed ones.
       */
      readonly failedSamples: number
      readonly totalSamples: number
      readonly results: readonly OperationResult[]
      /**
       * The phase in flight. It carries its own sample bookkeeping because an
       * abandoned phase has to account for the samples it will now never emit —
       * otherwise the bar stops short of 100% and looks stuck all over again.
       */
      readonly current: {
        readonly engine: EngineId
        readonly operation: PhaseId
        readonly iterations: number
        readonly samples: number
      } | null
      /** Reason of the latest failed sample, so a failing phase says why it fails. */
      readonly lastFailure: string | null
      /**
       * Phases that produced no result at all. Kept apart from `results`
       * because a failed phase has no percentiles to show, and apart from
       * `lastFailure` because it survives the phases that follow it.
       */
      readonly failedPhases: readonly {
        readonly engine: EngineId
        readonly operation: PhaseId
        readonly reason: string
      }[]
      readonly samples: readonly SamplePoint[]
    }
  | {
      readonly status: 'completed'
      readonly report: BenchmarkReport
      /** Carried past the end of the run: the chart outlives the stream. */
      readonly samples: readonly SamplePoint[]
    }
  | { readonly status: 'failed'; readonly message: string }
  | {
      readonly status: 'cancelled'
      readonly results: readonly OperationResult[]
      readonly samples: readonly SamplePoint[]
    }

export const IDLE_STATE: RunState = { status: 'idle' }

/**
 * Folding events into state keeps the UI a pure projection of the run.
 * @param state - previous state
 * @param event - the event just received from a runner
 * @returns the next state; unexpected event/state pairs return `state` unchanged
 */
/** Advances the in-flight phase's own counter. Null when between phases. */
const countSample = (
  current: Extract<RunState, { status: 'running' }>['current'],
): Extract<RunState, { status: 'running' }>['current'] =>
  current === null ? null : { ...current, samples: current.samples + 1 }

export const reduceRunState = (state: RunState, event: RunEvent): RunState => {
  switch (event.type) {
    case 'run-started':
      return {
        status: 'running',
        completedSamples: 0,
        failedSamples: 0,
        totalSamples: event.totalSamples,
        results: [],
        current: null,
        lastFailure: null,
        failedPhases: [],
        samples: [],
      }

    case 'phase-started':
      return state.status === 'running'
        ? {
            ...state,
            current: {
              engine: event.engine,
              operation: event.operation,
              iterations: event.iterations,
              samples: 0,
            },
          }
        : state

    case 'sample':
      return state.status === 'running'
        ? {
            ...state,
            completedSamples: state.completedSamples + 1,
            current: countSample(state.current),
            samples: [
              ...state.samples,
              {
                engine: event.engine,
                operation: event.operation,
                index: event.index,
                durationMs: event.durationMs,
              },
            ],
          }
        : state

    case 'sample-failed':
      return state.status === 'running'
        ? {
            ...state,
            failedSamples: state.failedSamples + 1,
            lastFailure: event.reason,
            current: countSample(state.current),
          }
        : state

    case 'phase-completed':
      return state.status === 'running'
        ? { ...state, results: [...state.results, event.result], current: null }
        : state

    case 'phase-failed': {
      if (state.status !== 'running') return state
      // The samples this phase will now never emit are counted as failed, so
      // the total still adds up and the bar still reaches 100%.
      const skipped =
        state.current === null ? 0 : Math.max(0, state.current.iterations - state.current.samples)
      return {
        ...state,
        current: null,
        failedSamples: state.failedSamples + skipped,
        lastFailure: event.reason,
        failedPhases: [
          ...state.failedPhases,
          { engine: event.engine, operation: event.operation, reason: event.reason },
        ],
      }
    }

    case 'run-completed':
      return {
        status: 'completed',
        report: event.report,
        samples: state.status === 'running' ? state.samples : [],
      }

    case 'run-failed':
      return { status: 'failed', message: event.message }

    default: {
      const unhandled: never = event
      throw new Error(`unhandled run event: ${JSON.stringify(unhandled)}`)
    }
  }
}
