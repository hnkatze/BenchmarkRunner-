/**
 * A measured call must never outlive its deadline.
 *
 * The reason is concrete: when Firestore's daily quota runs out, the Admin SDK
 * answers `RESOURCE_EXHAUSTED` and then **retries internally for up to 600
 * seconds** before rejecting. A warmup of 20 iterations would therefore take
 * over three hours to reach the first measured sample, and the run would look
 * frozen while being technically alive.
 *
 * A call that takes ten minutes is not a latency measurement; it is a hang. So
 * the deadline converts it into a failed sample with a reason, which the run
 * already knows how to report.
 */

/** Well above any legitimate latency — Firestore's p95 is ~155 ms. */
export const SAMPLE_TIMEOUT_MS = 15_000

/**
 * How many samples may fail before a phase is abandoned. It only ever trips
 * while NOTHING has succeeded: one bad sample among good ones is data, but five
 * in a row with zero successes is a broken phase, and grinding through the
 * remaining iterations only spends time and quota to learn the same thing.
 */
export const PHASE_FAILURE_LIMIT = 5

/**
 * Lower than the measured limit, on purpose. Warmup samples are discarded
 * anyway, so nothing is lost by giving up early — and when a whole engine is
 * down (quota gone, credentials revoked) every phase pays this wait before
 * reporting, so the difference between 3 and 5 is minutes across a full run.
 */
export const WARMUP_FAILURE_LIMIT = 3

/**
 * Clearing and seeding a collection legitimately takes longer than one sample —
 * seeding 220 documents one round trip at a time already costs seconds — but it
 * must still be bounded, because setup is exactly where a quota-exhausted run
 * stalls before emitting anything at all.
 */
export const SETUP_TIMEOUT_MS = 60_000

/**
 * For work that must still run after the user cancels: leaving a collection
 * full would poison the next run's measurements.
 */
export const NEVER_ABORTS: AbortSignal = new AbortController().signal

export class DeadlineError extends Error {
  constructor(ms: number) {
    super(`la operación superó el límite de ${ms} ms y se abandonó`)
    this.name = 'DeadlineError'
  }
}

export class AbortedError extends Error {
  constructor() {
    super('la ejecución fue cancelada')
    this.name = 'AbortedError'
  }
}

/**
 * Stops waiting on `work` once the deadline passes or the signal aborts.
 *
 * The underlying call cannot be cancelled — the driver owns it — so the
 * abandoned promise is swallowed to keep it from surfacing as an unhandled
 * rejection later. What it returns after that point is no longer of interest:
 * the sample has already been counted as failed.
 *
 * @param work - the in-flight operation
 * @param timeoutMs - how long to wait before giving up
 * @param signal - aborting it rejects immediately, so Cancel stays responsive
 * @returns the operation's value, or rejects with DeadlineError / AbortedError
 */
export const withDeadline = <T>(
  work: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<T> => {
  if (signal.aborted) {
    void work.catch(() => {})
    return Promise.reject(new AbortedError())
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false

    const finish = (): boolean => {
      if (settled) return false
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      return true
    }

    const onAbort = (): void => {
      if (finish()) reject(new AbortedError())
    }

    const timer = setTimeout(() => {
      if (finish()) reject(new DeadlineError(timeoutMs))
    }, timeoutMs)

    signal.addEventListener('abort', onAbort, { once: true })

    work.then(
      (value) => {
        if (finish()) resolve(value)
      },
      (error: unknown) => {
        if (finish()) reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}
