import type { Firestore } from 'firebase-admin/firestore'
import type { BenchmarkConfig } from '../domain/benchmark-config'
import type { BenchmarkReport, OperationResult } from '../domain/benchmark-report'
import type { BenchmarkRunner } from '../domain/benchmark-runner'
import { summarizeLatencies } from '../domain/latency'
import type { OperationId } from '../domain/operation'
import type { RunEvent } from '../domain/run-event'
import {
  NEVER_ABORTS,
  PHASE_FAILURE_LIMIT,
  SAMPLE_TIMEOUT_MS,
  SETUP_TIMEOUT_MS,
  WARMUP_FAILURE_LIMIT,
  withDeadline,
} from './deadline'
import { failureReason } from './failure-reason'

const BATCH_SIZE = 100
const QUERY_LIMIT = 50

type BenchDoc = {
  readonly seq: number
  readonly bucket: number
  readonly createdAt: number
  readonly payload: string
}

/**
 * Firestore counts a document's own field names and values toward its size, so
 * the padding is approximate — close enough to compare engines, not a guarantee.
 */
const makeDoc = (seq: number, sizeBytes: number): BenchDoc => ({
  seq,
  bucket: seq % 10,
  createdAt: Date.now(),
  payload: 'x'.repeat(Math.max(sizeBytes - 64, 0)),
})

const nowMs = (): number => Number(process.hrtime.bigint() / 1_000n) / 1000

export type FirestoreRunnerOptions = {
  readonly db: Firestore
  /** Hard ceiling applied server-side, whatever the client asks for. */
  readonly maxIterations: number
}

/**
 * Real Firestore adapter. Every phase seeds its own documents in a throwaway
 * collection and deletes them afterwards, so a run leaves no residue behind.
 */
export const createFirestoreRunner = (options: FirestoreRunnerOptions): BenchmarkRunner => {
  const { db, maxIterations } = options

  const deleteAll = async (collection: string): Promise<void> => {
    const ref = db.collection(collection)
    for (;;) {
      const snapshot = await ref.limit(BATCH_SIZE).get()
      if (snapshot.empty) return
      const batch = db.batch()
      for (const doc of snapshot.docs) batch.delete(doc.ref)
      await batch.commit()
    }
  }

  const seed = async (collection: string, count: number, sizeBytes: number): Promise<string[]> => {
    const ids: string[] = []
    for (let start = 0; start < count; start += BATCH_SIZE) {
      const batch = db.batch()
      for (let i = start; i < Math.min(start + BATCH_SIZE, count); i += 1) {
        const ref = db.collection(collection).doc()
        batch.set(ref, makeDoc(i, sizeBytes))
        ids.push(ref.id)
      }
      await batch.commit()
    }
    return ids
  }

  /** Returns the latency of one operation, or throws to be counted as an error. */
  const runOnce = async (
    operation: OperationId,
    collection: string,
    ids: readonly string[],
    index: number,
    config: BenchmarkConfig,
  ): Promise<number> => {
    const ref = db.collection(collection)
    const started = nowMs()

    switch (operation) {
      case 'insertOne':
        await ref.doc().set(makeDoc(index, config.documentSizeBytes))
        break

      case 'insertMany': {
        const batch = db.batch()
        for (let i = 0; i < BATCH_SIZE; i += 1) {
          batch.set(ref.doc(), makeDoc(index * BATCH_SIZE + i, config.documentSizeBytes))
        }
        await batch.commit()
        break
      }

      case 'findById': {
        const id = ids[index % ids.length]
        if (id === undefined) throw new Error('no seeded document to read')
        await ref.doc(id).get()
        break
      }

      case 'queryFiltered':
        await ref
          .where('bucket', '==', index % 10)
          .orderBy('seq')
          .limit(QUERY_LIMIT)
          .get()
        break

      case 'updateOne': {
        const id = ids[index % ids.length]
        if (id === undefined) throw new Error('no seeded document to update')
        await ref.doc(id).update({ createdAt: Date.now() })
        break
      }

      case 'deleteOne': {
        const id = ids[index]
        if (id === undefined) throw new Error('ran out of seeded documents to delete')
        await ref.doc(id).delete()
        break
      }

      case 'aggregate':
        await ref.count().get()
        break

      default: {
        const unhandled: never = operation
        throw new Error(`unhandled operation: ${String(unhandled)}`)
      }
    }

    return nowMs() - started
  }

  /**
   * deleteOne burns one document per call, so warmup needs its own documents:
   * sharing them would make the measured phase re-delete tombstones for free.
   */
  const seedCountFor = (operation: OperationId, iterations: number, warmup: number): number => {
    if (operation === 'deleteOne') return iterations + warmup
    if (operation === 'insertOne' || operation === 'insertMany') return 0
    return Math.min(iterations, BATCH_SIZE)
  }

  const plannedSamples = (config: BenchmarkConfig): number =>
    config.operations.length * Math.min(config.iterations, maxIterations)

  return {
    // The clamp is applied here too, not just inside run: an announced total
    // built from the UI's unclamped request could never be reached.
    plannedSamples,

    async *run(config: BenchmarkConfig, signal: AbortSignal): AsyncIterable<RunEvent> {
      const iterations = Math.min(config.iterations, maxIterations)
      const startedAt = Date.now()

      yield { type: 'run-started', at: startedAt, totalSamples: plannedSamples(config) }

      const results: OperationResult[] = []

      for (const operation of config.operations) {
        if (signal.aborted) return

        // Stable collection id, NOT one per run. A composite index in Firestore is
        // defined per collection, so a timestamped name would need a new index for
        // every run — which is why queryFiltered used to fail. The index survives
        // an empty collection, so emptying is enough to leave no data behind.
        const collection = `_bench_${operation}`
        yield { type: 'phase-started', engine: 'firestore', operation, iterations }

        try {
          // A run cut short (maxDuration, a crash) leaves documents behind and the
          // next seed would measure against a polluted collection.
          // Bounded: setup is where a quota-exhausted run stalls, and it stalls
          // BEFORE any sample exists, so nothing would be reported meanwhile.
          await withDeadline(deleteAll(collection), SETUP_TIMEOUT_MS, signal)

          const poolSize = seedCountFor(operation, iterations, config.warmupIterations)
          const ids =
            poolSize > 0
              ? await withDeadline(
                  seed(collection, poolSize, config.documentSizeBytes),
                  SETUP_TIMEOUT_MS,
                  signal,
                )
              : []

          // Warmup indexes past the measured range so deleteOne never overlaps.
          // It doubles as the canary: if the first calls all fail, the phase is
          // broken and the measured loop would only spend time proving it.
          let warmupFailures = 0
          for (let i = 0; i < config.warmupIterations && !signal.aborted; i += 1) {
            try {
              await withDeadline(
                runOnce(operation, collection, ids, iterations + i, config),
                SAMPLE_TIMEOUT_MS,
                signal,
              )
              warmupFailures = 0
            } catch (error: unknown) {
              warmupFailures += 1
              console.error(`[bench] warmup ${operation}#${i} failed:`, error)
              if (warmupFailures >= WARMUP_FAILURE_LIMIT) {
                throw new Error(
                  `${warmupFailures} calentamientos seguidos fallaron — ${failureReason(error)}`,
                )
              }
            }
          }

          const durations: number[] = []
          let errorCount = 0
          let lastReason = ''
          const phaseStarted = nowMs()

          // Lanes run in parallel; each latency is still measured per operation, so
          // the summary stays per-request rather than becoming aggregate throughput.
          const lanes = Math.max(1, Math.min(config.concurrency, iterations))

          for (let start = 0; start < iterations && !signal.aborted; start += lanes) {
            const indexes = Array.from(
              { length: Math.min(lanes, iterations - start) },
              (_, offset) => start + offset,
            )

            const settled = await Promise.allSettled(
              indexes.map((index) =>
                withDeadline(
                  runOnce(operation, collection, ids, index, config),
                  SAMPLE_TIMEOUT_MS,
                  signal,
                ),
              ),
            )

            for (let lane = 0; lane < settled.length; lane += 1) {
              const outcome = settled[lane]
              const index = indexes[lane]
              if (outcome === undefined || index === undefined) continue

              if (outcome.status === 'fulfilled') {
                durations.push(outcome.value)
                yield {
                  type: 'sample',
                  engine: 'firestore',
                  operation,
                  durationMs: outcome.value,
                  index,
                }
              } else {
                // Announced, not merely counted: a phase failing on every
                // iteration — a missing composite index, an unseeded
                // collection — is otherwise indistinguishable from a stall.
                errorCount += 1
                lastReason = failureReason(outcome.reason)
                yield {
                  type: 'sample-failed',
                  engine: 'firestore',
                  operation,
                  index,
                  reason: lastReason,
                }
              }
            }

            // Nothing has worked yet and the failures keep coming: the phase is
            // broken, not slow. Running the remaining iterations would spend
            // time — and, on Firestore, quota — to learn the same thing.
            if (durations.length === 0 && errorCount >= PHASE_FAILURE_LIMIT) {
              throw new Error(
                `${errorCount} muestras fallaron sin ninguna exitosa — ${lastReason}`,
              )
            }
          }

          const result: OperationResult = {
            engine: 'firestore',
            operation,
            summary: summarizeLatencies(durations),
            errorCount,
            wallClockMs: nowMs() - phaseStarted,
          }
          results.push(result)
          yield { type: 'phase-completed', result }
        } catch (error: unknown) {
          // With a reason: a phase that dies during setup emits no samples at
          // all, so this event is the only thing the UI ever hears about it.
          yield {
            type: 'phase-failed',
            engine: 'firestore',
            operation,
            reason: failureReason(error),
          }
        } finally {
          // NEVER_ABORTS on purpose: cancelling the run must not leave the
          // collection full, or the next run measures against dirty data.
          await withDeadline(deleteAll(collection), SETUP_TIMEOUT_MS, NEVER_ABORTS).catch(
            (error: unknown) => {
              console.error(`[bench] cleanup failed for ${collection}:`, error)
            },
          )
        }
      }

      const report: BenchmarkReport = { startedAt, finishedAt: Date.now(), config, results }
      yield { type: 'run-completed', report }
    },
  }
}
