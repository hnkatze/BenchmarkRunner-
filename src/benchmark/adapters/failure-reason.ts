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

/** Firestore answers a missing composite index with a console link to create it. */
const LINK = /https?:\/\/\S+/

export const failureReason = (reason: unknown): string => {
  const text = reason instanceof Error ? reason.message : String(reason)
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= REASON_MAX_LENGTH) return line

  // The link is the actionable half of a Firestore index error and it sits at
  // the END of the message — a plain truncation threw away the only part the
  // reader can do anything with. Keep the head AND the whole link.
  const head = line.slice(0, REASON_MAX_LENGTH - 1) + '…'
  const link = LINK.exec(line)?.[0]
  return link === undefined || head.includes(link) ? head : `${head} ${link}`
}
