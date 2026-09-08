import type { Firestore } from 'firebase-admin/firestore'
import { COLLECTION_IDS } from '../domain/collections.ts'
import { documentsFor } from '../domain/documents.ts'
import type {
  CollectionSeedResult,
  DatasetSeeder,
  SeedEvent,
  SeedPlan,
  SeedReport,
} from '../domain/seed-port.ts'

/**
 * Seeds Firestore.
 *
 * The same port as the MongoDB seeder, and deliberately more cautious, because
 * the two engines fail differently when a seed goes wrong:
 *
 * - MongoDB costs a re-run. Firestore costs **a day**: the Spark plan allows
 *   20,000 writes per 24 hours, and deletes come out of their own 20,000. So
 *   undoing a bad seed and redoing it spans two days, not two minutes.
 * - Going over quota does not raise a distinct error you can catch and reason
 *   about — writes simply start failing until the window rolls over.
 *
 * Hence `writeBudget` is enforced BEFORE each batch rather than after, and the
 * seeder stops on the boundary instead of discovering it.
 */

/** Firestore hard-caps a batch at 500 operations. Not a tuning knob. */
const FIRESTORE_BATCH_LIMIT = 500

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

const pooled = async (
  tasks: readonly (() => Promise<void>)[],
  limit: number,
  signal: AbortSignal,
): Promise<void> => {
  let next = 0
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length && !signal.aborted) {
      const task = tasks[next]
      next += 1
      if (task !== undefined) await task()
    }
  })
  await Promise.all(workers)
}

export const createFirestoreSeeder = (db: Firestore): DatasetSeeder => ({
  async *seed(plan: SeedPlan, signal: AbortSignal): AsyncIterable<SeedEvent> {
    const startedAt = Date.now()
    const results: CollectionSeedResult[] = []
    let totalWritten = 0
    let budgetExhausted = false

    const batchSize = Math.min(plan.batchSize, FIRESTORE_BATCH_LIMIT)

    for (const collection of COLLECTION_IDS) {
      if (signal.aborted || budgetExhausted) break

      const target = plan.scale[collection]
      const from = plan.writtenSoFar[collection] ?? 0
      if (from >= target) {
        results.push({ collection, written: 0, skipped: target, wallClockMs: 0 })
        continue
      }

      let remaining = target - from
      if (plan.writeBudget !== null) {
        const left = plan.writeBudget - totalWritten
        if (left <= 0) {
          budgetExhausted = true
          yield { type: 'budget-exhausted', collection, written: totalWritten, budget: plan.writeBudget }
          break
        }
        if (remaining > left) {
          remaining = left
          budgetExhausted = true
        }
      }

      yield { type: 'collection-started', collection, target, from }

      const ref = db.collection(collection)
      const phaseStarted = nowMs()
      let written = 0

      const batches: (() => Promise<void>)[] = []
      for (let offset = 0; offset < remaining; offset += batchSize) {
        const start = from + offset
        const size = Math.min(batchSize, remaining - offset)
        batches.push(async () => {
          if (signal.aborted) return
          const batch = db.batch()
          for (const doc of documentsFor(collection, plan.scale, start, size)) {
            // `set` on an explicit id, never `add`: the id is the document's own
            // deterministic key, so re-writing a range overwrites it. `add`
            // would mint a new id and quietly double the collection — and on
            // Spark there is no quota left to clean that up.
            batch.set(ref.doc(doc.id), doc)
          }
          await batch.commit()
          written += size
        })
      }

      try {
        await pooled(batches, plan.concurrency, signal)
      } catch (error) {
        yield {
          type: 'seed-failed',
          collection,
          reason: error instanceof Error ? error.message : String(error),
        }
        break
      }

      const result: CollectionSeedResult = {
        collection,
        written,
        skipped: from,
        wallClockMs: nowMs() - phaseStarted,
      }
      results.push(result)
      totalWritten += written
      yield { type: 'collection-completed', result }

      if (budgetExhausted) {
        yield { type: 'budget-exhausted', collection, written: totalWritten, budget: plan.writeBudget ?? 0 }
      }
    }

    /* No index phase, and that absence is a finding rather than an omission.
       Firestore indexes every single field automatically, and COMPOSITE indexes
       cannot be created from the Admin SDK at all — they are declared in
       `firestore.indexes.json` and deployed with the Firebase CLI, then built
       asynchronously on the server. There is no client-side moment to time, so
       the brief's "how long does index creation take" has a number on MongoDB
       and none here. `scripts/firestore-indexes.mjs` emits the declaration from
       the same INDEXES table so the two sides still match. */

    const report: SeedReport = {
      engine: 'firestore',
      startedAt,
      finishedAt: Date.now(),
      collections: results,
      indexes: [],
      totalWritten,
      budgetExhausted,
    }
    yield { type: 'seed-completed', report }
  },
})
