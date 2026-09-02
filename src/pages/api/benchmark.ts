import type { APIRoute } from 'astro'
import { createFirestoreRunner } from '../../benchmark/adapters/firestore-runner'
import { createMongoRunner } from '../../benchmark/adapters/mongo-runner'
import { createSequentialRunner } from '../../benchmark/adapters/sequential-runner'
import {
  CONFIG_LIMITS,
  DEFAULT_CONFIG,
  isEngineId,
  isOperationId,
  validateConfig,
  type BenchmarkConfig,
  type EngineId,
  type BenchmarkRunner,
  type OperationId,
} from '../../benchmark/domain'
import { maxIterations } from '../../server/env'
import { getFirestoreClient, isConfigError } from '../../server/firestore-client'
import { getMongoClient, isMongoConfigError } from '../../server/mongo-client'

export const prerender = false

/** Which env vars an engine is missing. Reported instead of a generic failure. */
type EngineConfigError = { readonly missing: readonly string[] }

/**
 * Builds an engine's runner, or reports what its configuration lacks. Each
 * engine resolves its OWN client, so asking for one never fails on the other's
 * credentials.
 */
type EngineFactory = (limit: number) => BenchmarkRunner | EngineConfigError

/**
 * Adding an EngineId fails to compile until it is listed here, and null keeps an
 * unwired engine rejected instead of silently running against another adapter.
 */
const ENGINE_RUNNERS: Readonly<Record<EngineId, EngineFactory | null>> = {
  firestore: (limit) => {
    const db = getFirestoreClient()
    return isConfigError(db) ? db : createFirestoreRunner({ db, maxIterations: limit })
  },
  mongodb: (limit) => {
    const handle = getMongoClient()
    return isMongoConfigError(handle)
      ? handle
      : createMongoRunner({ db: handle.db, maxIterations: limit })
  },
}

const isEngineConfigError = (
  value: BenchmarkRunner | EngineConfigError,
): value is EngineConfigError => 'missing' in value

const SUPPORTED_ENGINES: readonly EngineId[] = (
  Object.keys(ENGINE_RUNNERS) as EngineId[]
).filter((engine) => ENGINE_RUNNERS[engine] !== null)

const encoder = new TextEncoder()

/** One SSE frame. The blank line is the record separator — without it nothing flushes. */
const frame = (payload: unknown): Uint8Array =>
  encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)

const isEngineList = (value: unknown): value is EngineId[] =>
  Array.isArray(value) && value.every(isEngineId)

const isOperationList = (value: unknown): value is OperationId[] =>
  Array.isArray(value) && value.every(isOperationId)

/** Absent means 'use the default'. Present-but-wrong is a client bug: reject it. */
const integer = (value: unknown, fallback: number): number | null => {
  if (value === undefined) return fallback
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/**
 * Parses untrusted network input into a config. Guards run on every element:
 * `validateConfig` only checks ranges, and a bare string would pass its length test.
 */
const parseConfig = (body: unknown): BenchmarkConfig | null => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const raw = body as Record<string, unknown>

  if (!isEngineList(raw.engines) || !isOperationList(raw.operations)) return null

  const iterations = integer(raw.iterations, DEFAULT_CONFIG.iterations)
  const warmupIterations = integer(raw.warmupIterations, DEFAULT_CONFIG.warmupIterations)
  const documentSizeBytes = integer(raw.documentSizeBytes, DEFAULT_CONFIG.documentSizeBytes)
  const concurrency = integer(raw.concurrency, DEFAULT_CONFIG.concurrency)

  if (
    iterations === null ||
    warmupIterations === null ||
    documentSizeBytes === null ||
    concurrency === null
  ) {
    return null
  }

  const candidate: BenchmarkConfig = {
    engines: raw.engines,
    operations: raw.operations,
    iterations,
    warmupIterations,
    documentSizeBytes,
    concurrency,
  }

  return validateConfig(candidate).length === 0 ? candidate : null
}

const json = (payload: unknown, status: number): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  })

export const POST: APIRoute = async ({ request }) => {
  let parsed: BenchmarkConfig | null = null
  try {
    parsed = parseConfig(await request.json())
  } catch {
    parsed = null
  }

  if (parsed === null) {
    return json({ error: 'invalid-config', limits: CONFIG_LIMITS }, 400)
  }

  const unsupported = parsed.engines.filter((engine) => !SUPPORTED_ENGINES.includes(engine))
  if (unsupported.length > 0) {
    return json({ error: 'engine-not-wired', unsupported, supported: SUPPORTED_ENGINES }, 400)
  }

  // Credentials are resolved only once the engines are known: a MongoDB run must
  // not fail because Firestore is unconfigured, or the other way round. Every
  // engine is built BEFORE anything runs, so a misconfigured second engine is a
  // clean 503 instead of a half-finished run.
  const limit = maxIterations()
  const runners: BenchmarkRunner[] = []

  for (const engine of parsed.engines) {
    const factory = ENGINE_RUNNERS[engine]
    if (factory === null) {
      return json({ error: 'engine-not-wired', engine, supported: SUPPORTED_ENGINES }, 400)
    }

    const built = factory(limit)
    if (isEngineConfigError(built)) {
      return json({ error: 'engine-not-configured', engine, missing: built.missing }, 503)
    }
    runners.push(built)
  }

  const config = parsed
  // Always through the combinator, one engine or several: a single code path.
  // It runs them one after another — concurrent engines would measure contention.
  const runner = createSequentialRunner(runners)
  const controller = new AbortController()
  request.signal.addEventListener('abort', () => controller.abort())

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      try {
        for await (const event of runner.run(config, controller.signal)) {
          if (controller.signal.aborted) break
          streamController.enqueue(frame(event))
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'runner failed'
        streamController.enqueue(frame({ type: 'run-failed', message }))
      } finally {
        // close() throws if the consumer already cancelled; that is not an error here.
        try {
          streamController.close()
        } catch {
          /* stream already closed by cancel() */
        }
      }
    },
    cancel() {
      controller.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  })
}
