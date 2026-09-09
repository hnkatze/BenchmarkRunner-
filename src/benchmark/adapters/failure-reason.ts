/**
 * Turns whatever a driver rejected with into a short string fit for an event.
 *
 * The text is diagnostic, not copy: it comes from the engine, so it is never
 * translated and never routed through `ui/copy.ts`. It is capped because a
 * Firestore missing-index rejection carries a console URL long enough to bloat
 * every SSE frame — the head of the message is where the cause lives, and the
 * link stays in the server log.
 *
 * @param reason - the rejection value from a settled promise
 * @returns a single-line reason, at most {@link REASON_MAX_LENGTH} characters
 */
export const REASON_MAX_LENGTH = 300

export const failureReason = (reason: unknown): string => {
  const text = reason instanceof Error ? reason.message : String(reason)
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > REASON_MAX_LENGTH ? line.slice(0, REASON_MAX_LENGTH - 1) + '…' : line
}
