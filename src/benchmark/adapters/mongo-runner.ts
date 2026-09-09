import type { Db, ObjectId } from 'mongodb'
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
 * Mirrors the Firestore adapter's padding so both engines carry the same
 * payload. BSON overhead differs from Firestore's own accounting, so the size
 * is approximate on both sides — comparable, not exact.
 */
const makeDoc = (seq: number, sizeBytes: number): BenchDoc => ({
  seq,
  bucket: seq % 10,
  createdAt: Date.now(),
  payload: 'x'.repeat(Math.max(sizeBytes - 64, 0)),
})

const nowMs = (): number => Number(process.hrtime.bigint() / 1_000n) / 1000

export type MongoRunnerOptions = {
  readonly db: Db
  /** Hard ceiling applied server-side, whatever the client asks for. */
  readonly maxIterations: number
}

/**
 * Real MongoDB adapter. Every phase seeds its own documents in a throwaway
 * collection and drops it afterwards, so a run leaves no residue behind.
 */
export const createMongoRunner = (options: MongoRunnerOptions): BenchmarkRunner => {
  const { db, maxIterations } = options

  /**
   * Firestore indexes every field automatically; MongoDB indexes only `_id`.
   * Without this the filtered query would run a collection scan and the
   * comparison would measure a missing index instead of the engine.
   */
  const seed = async (
    collection: string,
    count: number,
    sizeBytes: number,
  ): Promise<ObjectId[]> => {
    const ref = db.collection<BenchDoc>(collection)
    await ref.createIndex({ bucket: 1, seq: 1 })

    const ids: ObjectId[] = []
    for (let start = 0; start < count; start += BATCH_SIZE) {
      const batch = Array.from({ length: Math.min(BATCH_SIZE, count - start) }, (_, offset) =>
        makeDoc(start + offset, sizeBytes),
      )
      const result = await ref.insertMany(batch)
      for (let i = 0; i < batch.length; i += 1) {
        const id = result.insertedIds[i]
        if (id !== undefined) ids.push(id)
      }
    }
    return ids
  }

  /** Returns the latency of one operation, or throws to be counted as an error. */
  const runOnce = async (
    operation: OperationId,
    collection: string,
    ids: readonly ObjectId[],
    index: number,
    config: BenchmarkConfig,
  ): Promise<number> => {
    const ref = db.collection<BenchDoc>(collection)
    const started = nowMs()

    switch (operation) {
      case 'insertOne':
        await ref.insertOne(makeDoc(index, config.documentSizeBytes))
        break

      case 'insertMany':
        await ref.insertMany(
          Array.from({ length: BATCH_SIZE }, (_, i) =>
            makeDoc(index * BATCH_SIZE + i, config.documentSizeBytes),
          ),
        )
        break

      case 'findById': {
        const id = ids[index % ids.length]
        if (id === undefined) throw new Error('no seeded document to read')
        await ref.findOne({ _id: id })
        break
      }

      case 'queryFiltered':
        await ref
          .find({ bucket: index % 10 })
          .sort({ seq: 1 })
          .limit(QUERY_LIMIT)
          .toArray()
        break

      case 'updateOne': {
        const id = ids[index % ids.length]
        if (id === undefined) throw new Error('no seeded document to update')
        await ref.updateOne({ _id: id }, { $set: { createdAt: Date.now() } })
        break
      }

      case 'deleteOne': {
        const id = ids[index]
        if (id === undefined) throw new Error('ran out of seeded documents to delete')
        await ref.deleteOne({ _id: id })
        break
      }

      case 'aggregate':
        // countDocuments, not a $group: the Firestore side runs count(), and a
        // grouping stage would compare a richer query against a plain count.
        await ref.countDocuments({})
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
   * sharing them would make the measured phase delete nothing at all.
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

        // Stable collection id, matching the Firestore adapter. Mongo could use a
        // fresh name — it builds its own index while seeding — but both engines
        // must run against the same shape or the comparison drifts.
        const collection = `_bench_${operation}`
        yield { type: 'phase-started', engine: 'mongodb', operation, iterations }

        try {
          // A run cut short leaves documents behind and the next seed would
          // measure against a polluted collection.
          // Bounded: setup is where a quota-exhausted run stalls, and it stalls
          // BEFORE any sample exists, so nothing would be reported meanwhile.
          await withDeadline(db.collection(collection).deleteMany({}), SETUP_TIMEOUT_MS, signal)

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
                  engine: 'mongodb',
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
                  engine: 'mongodb',
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
            engine: 'mongodb',
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
            engine: 'mongodb',
            operation,
            reason: failureReason(error),
          }
        } finally {
          // deleteMany, not drop: dropping would take the index with it, and the
          // collection is reused across runs. Emptying keeps both stable.
          // NEVER_ABORTS on purpose: cancelling the run must not leave the
          // collection full, or the next run measures against dirty data.
          await withDeadline(
            db.collection(collection).deleteMany({}),
            SETUP_TIMEOUT_MS,
            NEVER_ABORTS,
          ).catch((error: unknown) => {
            console.error(`[bench] cleanup failed for ${collection}:`, error)
          })
        }
      }

      const report: BenchmarkReport = { startedAt, finishedAt: Date.now(), config, results }
      yield { type: 'run-completed', report }
    },
  }
}
