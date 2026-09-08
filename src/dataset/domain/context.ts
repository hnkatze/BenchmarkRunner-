import type { CollectionId } from './collections.ts'

/**
 * The conditions a measurement was taken under.
 *
 * The brief asks for network data, for the size of each database before and
 * after the records, and for the cluster parameters. Those three are the same
 * requirement wearing different clothes: a latency number means nothing without
 * the conditions that produced it, and this is where they are recorded.
 *
 * Every field is nullable on purpose. Firestore cannot answer several of these
 * at all, and the honest representation of "the engine does not expose this" is
 * an absent value with a stated reason — not a zero that reads like a
 * measurement.
 */

export type EngineContext = {
  readonly engine: string
  /** How the engine is provisioned, in its own vocabulary. */
  readonly parameters: readonly ContextField[]
  readonly network: NetworkContext | null
  readonly storage: StorageContext | null
  /** Why a section is absent, when it is. */
  readonly unavailable: readonly UnavailableReason[]
}

export type ContextField = {
  readonly label: string
  readonly value: string
}

export type NetworkContext = {
  /** Median of several pings. A single sample says nothing about a network. */
  readonly medianRttMs: number
  readonly minRttMs: number
  readonly maxRttMs: number
  readonly samples: number
  /** Host the samples went to, never the credentials that reached it. */
  readonly host: string
}

export type StorageContext = {
  readonly documents: number
  readonly dataBytes: number
  readonly storageBytes: number
  readonly indexBytes: number
  readonly perCollection: readonly CollectionStorage[]
}

export type CollectionStorage = {
  readonly collection: CollectionId
  readonly documents: number
  readonly storageBytes: number
  readonly indexBytes: number
  readonly indexes: readonly string[]
}

export type UnavailableReason = {
  readonly what: string
  /** Stated in the report as a finding, not swept under a zero. */
  readonly why: string
}

/** Total bytes an engine occupies, data plus indexes. */
export const totalBytes = (storage: StorageContext): number =>
  storage.storageBytes + storage.indexBytes

/**
 * Index weight as a share of stored data.
 *
 * Worth its own helper because it is one of the study's findings: at the paired
 * scale MongoDB's indexes weigh about as much as the documents they point at,
 * and Firestore's are heavier still since it indexes every field on its own.
 */
export const indexShare = (storage: StorageContext): number =>
  storage.storageBytes > 0 ? storage.indexBytes / storage.storageBytes : 0

export type { CollectionId }
