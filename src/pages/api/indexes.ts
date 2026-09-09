import type { APIRoute } from 'astro'
import {
  ensureFirestoreIndexes,
  listFirestoreIndexes,
  type IndexCredentials,
} from '../../dataset/adapters/firestore-index-admin.ts'
import { readEnv } from '../../server/env'

export const prerender = false

/**
 * Firestore's composite indexes: what is there, and a way to create what is not.
 *
 * It exists because indexes live in the PROJECT, not in the repository. Point
 * the app at a new Firebase project — which is one `.env` away — and every
 * composite is gone, so seven of the ten study queries fail until they are
 * built again. Discovering that in the middle of a run is the expensive way to
 * find out.
 *
 * GET reports the state and needs only read access.
 * POST creates whatever is missing and needs `datastore.indexes.create`, which
 * the default Firebase Admin service account does NOT carry.
 *
 * The POST is unauthenticated, like every other route here, and that is a
 * deliberate, bounded choice: it accepts no input and can only ask for the
 * exact set declared in the repository, idempotently. It cannot create an
 * arbitrary index, delete one, or touch data. Anyone who can reach it can
 * trigger the same build the owner would have triggered.
 */

const credentials = (): IndexCredentials | { readonly missing: readonly string[] } => {
  const projectId = readEnv('FIRESTORE_PROJECT_ID')
  const clientEmail = readEnv('FIRESTORE_CLIENT_EMAIL')
  const rawKey = readEnv('FIRESTORE_PRIVATE_KEY')

  const missing = [
    projectId === undefined ? 'FIRESTORE_PROJECT_ID' : null,
    clientEmail === undefined ? 'FIRESTORE_CLIENT_EMAIL' : null,
    rawKey === undefined ? 'FIRESTORE_PRIVATE_KEY' : null,
  ].filter((name): name is string => name !== null)

  if (projectId === undefined || clientEmail === undefined || rawKey === undefined) {
    return { missing }
  }

  // .env stores the key with literal \n pairs; the signer needs real newlines.
  return { projectId, clientEmail, privateKey: rawKey.split('\\n').join('\n') }
}

const isMissing = (
  value: IndexCredentials | { readonly missing: readonly string[] },
): value is { readonly missing: readonly string[] } => 'missing' in value

const json = (payload: unknown, status: number): Response =>
  new Response(JSON.stringify(payload), {
    status,
    // Never cached: a cached report would describe the indexes of some other
    // moment, which is the one thing this endpoint must not do.
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })

export const GET: APIRoute = async () => {
  const resolved = credentials()
  if (isMissing(resolved)) {
    return json({ error: 'engine-not-configured', missing: resolved.missing }, 503)
  }
  return json(await listFirestoreIndexes(resolved), 200)
}

export const POST: APIRoute = async () => {
  const resolved = credentials()
  if (isMissing(resolved)) {
    return json({ error: 'engine-not-configured', missing: resolved.missing }, 503)
  }

  const report = await ensureFirestoreIndexes(resolved)
  // 403 from the API is reported as 200 with per-index state on purpose: the
  // caller asked a question and got a complete answer. The failure belongs to
  // the indexes, not to the request.
  return json(report, 200)
}
