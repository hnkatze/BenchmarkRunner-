import type { Db } from 'mongodb'
import { COLLECTION_IDS, type CollectionId } from '../domain/collections.ts'
import { documentsFor } from '../domain/documents.ts'
import { INDEXES } from '../domain/indexes.ts'
import type {
  CollectionSeedResult,
  DatasetSeeder,
  SeedEvent,
  SeedPlan,
  SeedReport,
} from '../domain/seed-port.ts'

/**
 * Seeds MongoDB.
 *
 * Two properties are non-negotiable and both come from the same place — the
 * seed has to survive being interrupted:
 *
 * - **Idempotent.** Every write is a `replaceOne` upsert keyed on the
 *   deterministic `_id`, never an insert. Re-running a range overwrites it
 *   instead of duplicating, so a half-finished seed can simply be re-run.
 * - **Concurrent.** Sequential 1,000-document batches measured 366 docs/s
 *   against Atlas from Honduras: the round trip, not the server, is the cost.
 *   Batches in flight turn 46 minutes into single digits.
 */

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/** Runs `tasks` with at most `limit` in flight, preserving no order. */
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

export const createMongoSeeder = (db: Db): DatasetSeeder => ({
  async *seed(plan: SeedPlan, signal: AbortSignal): AsyncIterable<SeedEvent> {
    const startedAt = Date.now()
    const results: CollectionSeedResult[] = []
    const indexes: { collection: CollectionId; name: string; wallClockMs: number }[] = []
    let totalWritten = 0
    let budgetExhausted = false

    for (const collection of COLLECTION_IDS) {
      if (signal.aborted) break

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

      const handle = db.collection(collection)
      const phaseStarted = nowMs()
      let written = 0

      // The whole range is planned up front, then drained by a fixed pool.
      // Building the documents lazily per batch keeps 600,000 order items from
      // ever existing as one array in memory.
      const batches: (() => Promise<void>)[] = []
      for (let offset = 0; offset < remaining; offset += plan.batchSize) {
        const start = from + offset
        const size = Math.min(plan.batchSize, remaining - offset)
        batches.push(async () => {
          if (signal.aborted) return
          const operations = [...documentsFor(collection, plan.scale, start, size)].map((doc) => ({
            replaceOne: {
              filter: { _id: doc.id },
              // `_id` is the document's own id, so re-writing the same index
              // replaces rather than appends. This is what makes a re-run safe.
              replacement: { ...doc, _id: doc.id },
              upsert: true,
            },
          }))
          await handle.bulkWrite(operations as never, { ordered: false })
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
        break
      }
    }

    // Indexes come after the data, and are timed on their own. Creating them
    // first would make every write maintain them, which inflates the seeding
    // number and deflates the indexing one — the brief asks for both.
    if (!plan.skipIndexes && !signal.aborted) {
      for (const collection of COLLECTION_IDS) {
        for (const spec of INDEXES[collection]) {
          const at = nowMs()
          await db.collection(collection).createIndex(spec.keys, { name: spec.name })
          const entry = { collection, name: spec.name, wallClockMs: nowMs() - at }
          indexes.push(entry)
          yield { type: 'index-created', ...entry }
        }
      }
    }

    const report: SeedReport = {
      engine: 'mongodb',
      startedAt,
      finishedAt: Date.now(),
      collections: results,
      indexes,
      totalWritten,
      budgetExhausted,
    }
    yield { type: 'seed-completed', report }
  },
})
