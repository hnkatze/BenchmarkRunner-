import type { BenchmarkReport, OperationResult } from './benchmark-report'
import type { EngineId } from './engine'
import type { OperationId } from './operation'

export type RunEvent =
  | { readonly type: 'run-started'; readonly at: number; readonly totalSamples: number }
  | {
      readonly type: 'phase-started'
      readonly engine: EngineId
      readonly operation: OperationId
      readonly iterations: number
    }
  | {
      readonly type: 'sample'
      readonly engine: EngineId
      readonly operation: OperationId
      readonly durationMs: number
      readonly index: number
    }
  | { readonly type: 'phase-failed'; readonly engine: EngineId; readonly operation: OperationId }
  | { readonly type: 'phase-completed'; readonly result: OperationResult }
  | { readonly type: 'run-completed'; readonly report: BenchmarkReport }
  | { readonly type: 'run-failed'; readonly message: string }

export const RUN_EVENT_TYPES = [
  'run-started',
  'phase-started',
  'sample',
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

export type RunState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running'
      readonly completedSamples: number
      readonly totalSamples: number
      readonly results: readonly OperationResult[]
      readonly current: { readonly engine: EngineId; readonly operation: OperationId } | null
    }
  | { readonly status: 'completed'; readonly report: BenchmarkReport }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'cancelled'; readonly results: readonly OperationResult[] }

export const IDLE_STATE: RunState = { status: 'idle' }

/**
 * Folding events into state keeps the UI a pure projection of the run.
 * @param state - previous state
 * @param event - the event just received from a runner
 * @returns the next state; unexpected event/state pairs return `state` unchanged
 */
export const reduceRunState = (state: RunState, event: RunEvent): RunState => {
  switch (event.type) {
    case 'run-started':
      return {
        status: 'running',
        completedSamples: 0,
        totalSamples: event.totalSamples,
        results: [],
        current: null,
      }

    case 'phase-started':
      return state.status === 'running'
        ? { ...state, current: { engine: event.engine, operation: event.operation } }
        : state

    case 'sample':
      return state.status === 'running'
        ? { ...state, completedSamples: state.completedSamples + 1 }
        : state

    case 'phase-completed':
      return state.status === 'running'
        ? { ...state, results: [...state.results, event.result], current: null }
        : state

    case 'phase-failed':
      return state.status === 'running' ? { ...state, current: null } : state

    case 'run-completed':
      return { status: 'completed', report: event.report }

    case 'run-failed':
      return { status: 'failed', message: event.message }

    default: {
      const unhandled: never = event
      throw new Error(`unhandled run event: ${JSON.stringify(unhandled)}`)
    }
  }
}
