import type { BenchmarkConfig } from '../domain/benchmark-config'
import type { BenchmarkRunner } from '../domain/benchmark-runner'
import { isRunEventType, type RunEvent } from '../domain/run-event'
import { COPY, serverError } from '../ui/copy'

/** Checks the discriminant against the domain's own list, not merely that it is a string. */
const isRunEvent = (value: unknown): value is RunEvent =>
  typeof value === 'object' &&
  value !== null &&
  isRunEventType((value as { type: unknown }).type)

/**
 * Splits an SSE byte stream into `data:` payloads. Frames are separated by a
 * blank line and can arrive split across chunk boundaries, hence the buffer.
 */
async function* readFrames(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let separator = buffer.indexOf('\n\n')
      while (separator !== -1) {
        const raw = buffer.slice(0, separator)
        buffer = buffer.slice(separator + 2)
        const line = raw.split('\n').find((l) => l.startsWith('data: '))
        if (line !== undefined) yield line.slice(6)
        separator = buffer.indexOf('\n\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Client-side adapter: satisfies the same port the mock does, but the work
 * happens on the server. No database SDK ever reaches the browser bundle.
 * @param endpoint - server route that streams RunEvents as SSE
 */
export const createHttpBenchmarkRunner = (endpoint = '/api/benchmark'): BenchmarkRunner => ({
  async *run(config: BenchmarkConfig, signal: AbortSignal): AsyncIterable<RunEvent> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
      signal,
    })

    if (!response.ok) {
      const detail = await response.json().catch(() => null)
      const missing =
        detail !== null && typeof detail === 'object' && 'missing' in detail
          ? String((detail as { missing: unknown }).missing)
          : ''
      yield { type: 'run-failed', message: serverError(response.status, missing) }
      return
    }

    if (response.body === null) {
      yield { type: 'run-failed', message: COPY.transport.noBody }
      return
    }

    let sawTerminal = false

    for await (const payload of readFrames(response.body)) {
      if (signal.aborted) return
      try {
        const parsed: unknown = JSON.parse(payload)
        if (!isRunEvent(parsed)) continue
        if (parsed.type === 'run-completed' || parsed.type === 'run-failed') sawTerminal = true
        yield parsed
      } catch {
        // A truncated frame is not worth killing the run over.
      }
    }

    // Without this the UI would sit on 'running' forever if the stream is cut.
    if (!sawTerminal && !signal.aborted) {
      yield { type: 'run-failed', message: COPY.transport.truncated }
    }
  },
})
