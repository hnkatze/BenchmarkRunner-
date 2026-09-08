import type { CollectionId } from './collections.ts'
import type { DatasetScale } from './generate.ts'

/**
 * The port every seeder implements.
 *
 * Same shape as `BenchmarkRunner`: a plan and a signal in, an async iterable of
 * events out. The CLI only knows this type, so switching engines — or adding a
 * third one — never reaches the caller.
 *
 * Property syntax, not a method: `strictFunctionTypes` does not apply to
 * shorthand methods, and an adapter with narrower parameters would compile.
 */
export type DatasetSeeder = {
  readonly seed: (plan: SeedPlan, signal: AbortSignal) => AsyncIterable<SeedEvent>
}

export type SeedPlan = {
  readonly scale: DatasetScale
  /**
   * Where to resume each collection from. A seed that was cut in half must not
   * start over: on Firestore the rewrite would spend quota it does not have,
   * and the daily allowance gives one attempt, not two.
   */
  readonly writtenSoFar: Readonly<Partial<Record<CollectionId, number>>>
  /**
   * Hard ceiling on documents written in this run, or `null` for none.
   * Firestore's Spark plan allows 20,000 writes per day; going over does not
   * fail loudly, it just stops working until tomorrow.
   */
  readonly writeBudget: number | null
  /** Batch size. Firestore caps a WriteBatch at 500; MongoDB has no such cap. */
  readonly batchSize: number
  /** Batches in flight. Sequential batches measured 366 docs/s against Atlas. */
  readonly concurrency: number
  /** Skip index creation — useful to time seeding and indexing separately. */
  readonly skipIndexes: boolean
}

/**
 * Progress, one event per meaningful step.
 *
 * `index-created` is its own event because the brief asks how long creating
 * tables and indexes takes, and that number is worthless if it is buried
 * inside the seeding total.
 */
export type SeedEvent =
  | { readonly type: 'collection-started'; readonly collection: CollectionId; readonly target: number; readonly from: number }
  | { readonly type: 'batch-written'; readonly collection: CollectionId; readonly written: number; readonly target: number }
  | { readonly type: 'collection-completed'; readonly result: CollectionSeedResult }
  | { readonly type: 'index-created'; readonly collection: CollectionId; readonly name: string; readonly wallClockMs: number }
  | { readonly type: 'budget-exhausted'; readonly collection: CollectionId; readonly written: number; readonly budget: number }
  | { readonly type: 'seed-failed'; readonly collection: CollectionId; readonly reason: string }
  | { readonly type: 'seed-completed'; readonly report: SeedReport }

export type CollectionSeedResult = {
  readonly collection: CollectionId
  readonly written: number
  readonly skipped: number
  readonly wallClockMs: number
}

export type SeedReport = {
  readonly engine: string
  readonly startedAt: number
  readonly finishedAt: number
  readonly collections: readonly CollectionSeedResult[]
  readonly indexes: readonly { readonly collection: CollectionId; readonly name: string; readonly wallClockMs: number }[]
  readonly totalWritten: number
  readonly budgetExhausted: boolean
}

/** Documents written per second over a phase's real elapsed time. */
export const seedThroughput = (result: CollectionSeedResult): number =>
  result.wallClockMs > 0 ? (result.written / result.wallClockMs) * 1000 : 0
