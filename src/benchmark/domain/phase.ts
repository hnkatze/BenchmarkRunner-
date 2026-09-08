import { QUERY_IDS, isQueryId, type QueryId } from '../../dataset/domain/queries.ts'
import { OPERATION_IDS, isOperationId, type OperationId } from './operation'

/**
 * What a single measured phase is about.
 *
 * The CRUD micro-operations and the ten read queries are different questions,
 * but from the measurement's point of view they are the same thing: run this
 * N times and hand back the latencies. Widening the phase identifier instead
 * of building a second pipeline is what lets the reducer, the results table,
 * the chart and the percentile maths serve both without a line of change.
 */
export type PhaseId = OperationId | QueryId

export const PHASE_IDS: readonly PhaseId[] = [...OPERATION_IDS, ...QUERY_IDS]

export const isPhaseId = (value: unknown): value is PhaseId =>
  isOperationId(value) || isQueryId(value)

/** Narrows a phase back to the CRUD side, which is where the two runners split. */
export const isOperationPhase = (phase: PhaseId): phase is OperationId => isOperationId(phase)
