import type { EngineId } from '../domain/engine'
import type { OperationId } from '../domain/operation'

export type LatencyProfile = {
  readonly medianMs: number
  readonly sigma: number
  readonly tailChance: number
  readonly tailMultiplier: number
  readonly errorRate: number
}

/**
 * Firestore is a remote HTTPS/gRPC call to a Google Cloud region, so its floor
 * is a round trip; MongoDB profiles assume a driver-pooled connection nearby.
 */
const PROFILES: Readonly<Record<EngineId, Readonly<Record<OperationId, LatencyProfile>>>> = {
  firestore: {
    insertOne: { medianMs: 42, sigma: 0.34, tailChance: 0.02, tailMultiplier: 5.5, errorRate: 0.001 },
    insertMany: { medianMs: 128, sigma: 0.3, tailChance: 0.03, tailMultiplier: 4, errorRate: 0.002 },
    findById: { medianMs: 26, sigma: 0.28, tailChance: 0.015, tailMultiplier: 6, errorRate: 0 },
    queryFiltered: { medianMs: 58, sigma: 0.4, tailChance: 0.04, tailMultiplier: 5, errorRate: 0.001 },
    updateOne: { medianMs: 46, sigma: 0.33, tailChance: 0.02, tailMultiplier: 5, errorRate: 0.001 },
    deleteOne: { medianMs: 40, sigma: 0.31, tailChance: 0.02, tailMultiplier: 5, errorRate: 0.001 },
    aggregate: { medianMs: 210, sigma: 0.45, tailChance: 0.06, tailMultiplier: 3.5, errorRate: 0.004 },
  },
  mongodb: {
    insertOne: { medianMs: 1.8, sigma: 0.42, tailChance: 0.01, tailMultiplier: 12, errorRate: 0.0005 },
    insertMany: { medianMs: 9.4, sigma: 0.38, tailChance: 0.02, tailMultiplier: 8, errorRate: 0.001 },
    findById: { medianMs: 0.9, sigma: 0.35, tailChance: 0.008, tailMultiplier: 14, errorRate: 0 },
    queryFiltered: { medianMs: 4.6, sigma: 0.5, tailChance: 0.03, tailMultiplier: 9, errorRate: 0.0005 },
    updateOne: { medianMs: 2.4, sigma: 0.44, tailChance: 0.012, tailMultiplier: 11, errorRate: 0.0005 },
    deleteOne: { medianMs: 2.1, sigma: 0.4, tailChance: 0.01, tailMultiplier: 11, errorRate: 0.0005 },
    aggregate: { medianMs: 18.5, sigma: 0.55, tailChance: 0.05, tailMultiplier: 6, errorRate: 0.002 },
  },
}

export const profileFor = (engine: EngineId, operation: OperationId): LatencyProfile =>
  PROFILES[engine][operation]

/**
 * Payload cost is sublinear: serialization dominates below ~64KB, network above.
 * @param documentSizeBytes - configured document size
 * @returns a multiplier applied to the profile median
 */
export const payloadPenalty = (documentSizeBytes: number): number =>
  1 + Math.log2(Math.max(documentSizeBytes, 64) / 1024 + 1) * 0.18
