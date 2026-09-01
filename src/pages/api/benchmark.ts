import type { APIRoute } from 'astro'
import {
  createFirestoreRunner,
  type FirestoreRunnerOptions,
} from '../../benchmark/adapters/firestore-runner'
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
import { getFirestoreClient, isConfigError, maxIterations } from '../../server/firestore-client'

export const prerender = false

/**
 * Adding an EngineId fails to compile until it is listed here, and null keeps an
 * unwired engine rejected instead of silently running against another adapter.
 */
const ENGINE_RUNNERS: Readonly<
  Record<EngineId, ((deps: FirestoreRunnerOptions) => BenchmarkRunner) | null>
> = {
  firestore: createFirestoreRunner,
  mongodb: null,
}

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
  const client = getFirestoreClient()
  if (isConfigError(client)) {
    return json({ error: 'firestore-not-configured', missing: client.missing }, 503)
  }

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

  if (parsed.engines.length > 1) {
    return json({ error: 'multi-engine-not-implemented', engines: parsed.engines }, 400)
  }

  const engine = parsed.engines[0]
  const factory = engine === undefined ? null : ENGINE_RUNNERS[engine]
  if (factory === null || factory === undefined) {
    return json({ error: 'engine-not-wired', supported: SUPPORTED_ENGINES }, 400)
  }

  const config = parsed
  const runner = factory({ db: client, maxIterations: maxIterations() })
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
