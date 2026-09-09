// Explicit .ts extension: this module is imported from Vite AND from
// scripts/firestore-indexes.mjs under Node's type stripping, which does not
// resolve extensionless relative specifiers.
import { OPERATIONS, type OperationId } from './operation.ts'

/**
 * The composite indexes the CRUD phases need in Firestore.
 *
 * They live here, next to the operations, rather than inside the Firestore
 * adapter, for one reason: `firebase deploy --only firestore:indexes` treats
 * the deployed file as the WHOLE truth and offers to delete every index it
 * does not mention. A declaration that covered only the dataset collections
 * would quietly take `_bench_queryFiltered` with it on the next deploy, and
 * that phase would go back to failing on every iteration.
 *
 * Firestore indexes single fields on its own, so only composites belong here.
 */
export type BenchIndexSpec = {
  /** Stable collection id, matching the one the adapters run against. */
  readonly collection: string
  /** Field to direction. 1 ascending, -1 descending. */
  readonly keys: Readonly<Record<string, 1 | -1>>
  /** Why it exists — a nameless index is an index nobody dares to delete. */
  readonly serves: string
}

/**
 * Indexed by OperationId, so adding an operation fails to compile until its
 * index needs are stated — even if the answer is "none".
 */
export const BENCH_INDEXES: Readonly<Record<OperationId, readonly BenchIndexSpec[]>> = {
  [OPERATIONS.insertOne]: [],
  [OPERATIONS.insertMany]: [],
  [OPERATIONS.findById]: [],
  [OPERATIONS.queryFiltered]: [
    {
      collection: '_bench_queryFiltered',
      keys: { bucket: 1, seq: 1 },
      serves: 'la fase queryFiltered: where bucket == n, ordenado por seq',
    },
  ],
  [OPERATIONS.updateOne]: [],
  [OPERATIONS.deleteOne]: [],
  [OPERATIONS.aggregate]: [],
}

/** Every benchmark index, flattened. */
export const allBenchIndexes = (): readonly BenchIndexSpec[] =>
  Object.values(BENCH_INDEXES).flat()
