import { cert } from 'firebase-admin/app'
import { allBenchIndexes } from '../../benchmark/domain/bench-indexes.ts'
import { indexesForEngine } from '../domain/indexes.ts'

/**
 * Creates Firestore's composite indexes from the declared tables.
 *
 * **Firestore does index every field automatically — but only one field at a
 * time.** A query that combines fields, or sorts by a field it does not filter
 * on, needs a COMPOSITE index, and composites are never automatic. Seven of
 * the ten study queries need one. That distinction is the whole reason this
 * file exists, and it is easy to miss because both halves of it are true.
 *
 * The Admin *SDK* cannot create a composite; the Admin *REST API* can. So this
 * mints a token from the service account and posts the declarations directly,
 * which means a brand-new project can be made query-ready without a console
 * visit and without the Firebase CLI — whose identity is a human, and the human
 * at the keyboard may have no access to the project at all.
 *
 * Credentials are passed in rather than read here: the same module has to serve
 * an Astro endpoint and a plain Node script, and only one of them can read
 * `import.meta.env`.
 */

export type IndexCredentials = {
  readonly projectId: string
  readonly clientEmail: string
  /** With real newlines already expanded. */
  readonly privateKey: string
}

export type IndexField = { readonly fieldPath: string; readonly order: 'ASCENDING' | 'DESCENDING' }

export type DeclaredIndex = {
  readonly collection: string
  readonly name: string
  readonly fields: readonly IndexField[]
  /** Why it exists, straight from the declaration. */
  readonly serves: string
}

export type IndexState = 'ready' | 'building' | 'missing' | 'created' | 'denied' | 'error'

export type IndexStatus = DeclaredIndex & {
  readonly state: IndexState
  readonly detail?: string
}

export type IndexReport = {
  readonly projectId: string
  readonly indexes: readonly IndexStatus[]
  /** Set when the whole operation could not even start. */
  readonly error?: string
}

const toFields = (keys: Readonly<Record<string, 1 | -1>>): readonly IndexField[] =>
  Object.entries(keys).map(([fieldPath, direction]) => ({
    fieldPath,
    order: direction === 1 ? 'ASCENDING' : 'DESCENDING',
  }))

/**
 * Every composite Firestore needs: the dataset's, plus the CRUD benchmark's own.
 *
 * Single-field specs are dropped — those Firestore really does create by
 * itself. Leaving them in would ask the API to build something it already has.
 */
export const declaredFirestoreIndexes = (): readonly DeclaredIndex[] => [
  ...indexesForEngine('firestore')
    .map(({ collection, spec }) => ({
      collection,
      name: spec.name,
      fields: toFields(spec.keys),
      serves: spec.serves,
    }))
    .filter((index) => index.fields.length > 1),
  ...allBenchIndexes().map((spec) => ({
    collection: spec.collection,
    name: spec.collection,
    fields: toFields(spec.keys),
    serves: spec.serves,
  })),
]

/** Firestore appends __name__ to every composite; it must not join the comparison. */
const signature = (collection: string, fields: readonly { fieldPath: string; order?: string }[]): string =>
  `${collection}|${fields
    .filter((field) => field.fieldPath !== '__name__')
    .map((field) => `${field.fieldPath}:${field.order ?? ''}`)
    .join(',')}`

const apiBase = (projectId: string): string =>
  `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups`

const authorize = async (credentials: IndexCredentials): Promise<string> => {
  const token = await cert({
    projectId: credentials.projectId,
    clientEmail: credentials.clientEmail,
    privateKey: credentials.privateKey,
  }).getAccessToken()
  return token.access_token
}

type LiveIndex = { readonly state: 'ready' | 'building' }

type ApiIndexField = { readonly fieldPath: string; readonly order?: string }

type ApiIndex = {
  readonly name: string
  readonly state?: string
  readonly fields?: readonly ApiIndexField[]
}

const isApiField = (value: unknown): value is ApiIndexField =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { fieldPath?: unknown }).fieldPath === 'string'

/** Guarded rather than cast: this is network input like any other. */
const isApiIndex = (value: unknown): value is ApiIndex =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { name?: unknown }).name === 'string'

const listedIndexes = (body: unknown): readonly ApiIndex[] => {
  if (typeof body !== 'object' || body === null) return []
  const raw: unknown = (body as { indexes?: unknown }).indexes
  return Array.isArray(raw) ? raw.filter(isApiIndex) : []
}

const fetchLive = async (
  credentials: IndexCredentials,
  accessToken: string,
): Promise<Map<string, LiveIndex>> => {
  const response = await fetch(`${apiBase(credentials.projectId)}/-/indexes`, {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)

  const live = new Map<string, LiveIndex>()

  for (const index of listedIndexes(await response.json())) {
    const collection = index.name.split('/collectionGroups/')[1]?.split('/indexes/')[0]
    if (collection === undefined) continue
    const fields = (index.fields ?? []).filter(isApiField)
    live.set(signature(collection, fields), {
      state: index.state === 'READY' ? 'ready' : 'building',
    })
  }
  return live
}

/**
 * Reports each declared composite as ready, building or missing. Read-only.
 * @param credentials - service account with at least read access to indexes
 */
export const listFirestoreIndexes = async (
  credentials: IndexCredentials,
): Promise<IndexReport> => {
  const declared = declaredFirestoreIndexes()
  try {
    const live = await fetchLive(credentials, await authorize(credentials))
    return {
      projectId: credentials.projectId,
      indexes: declared.map((index) => ({
        ...index,
        state: live.get(signature(index.collection, index.fields))?.state ?? 'missing',
      })),
    }
  } catch (error) {
    return {
      projectId: credentials.projectId,
      indexes: declared.map((index) => ({ ...index, state: 'error' as const })),
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Creates every declared composite that is not already there.
 *
 * Idempotent by design: it lists first and treats an ALREADY_EXISTS as a
 * success, so pressing the button twice is harmless. Building is asynchronous
 * on Firestore's side — a query against an index still building fails exactly
 * like one against an index that was never created, so `created` means asked
 * for, not usable yet.
 *
 * @param credentials - service account needing `datastore.indexes.create`
 * @returns the state of every declared index after the attempt
 */
export const ensureFirestoreIndexes = async (
  credentials: IndexCredentials,
): Promise<IndexReport> => {
  const declared = declaredFirestoreIndexes()

  let accessToken: string
  let live: Map<string, LiveIndex>
  try {
    accessToken = await authorize(credentials)
    live = await fetchLive(credentials, accessToken)
  } catch (error) {
    return {
      projectId: credentials.projectId,
      indexes: declared.map((index) => ({ ...index, state: 'error' as const })),
      error: error instanceof Error ? error.message : String(error),
    }
  }

  const headers = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
  }
  const statuses: IndexStatus[] = []

  for (const index of declared) {
    const already = live.get(signature(index.collection, index.fields))
    if (already !== undefined) {
      statuses.push({ ...index, state: already.state })
      continue
    }

    const response = await fetch(`${apiBase(credentials.projectId)}/${index.collection}/indexes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ queryScope: 'COLLECTION', fields: index.fields }),
    })

    if (response.ok) {
      statuses.push({ ...index, state: 'created' })
      continue
    }
    // 409 means a concurrent request already asked for it. Not a failure.
    if (response.status === 409) {
      statuses.push({ ...index, state: 'building' })
      continue
    }
    statuses.push({
      ...index,
      // 403 is its own state because the fix is an IAM role, not a retry.
      state: response.status === 403 ? 'denied' : 'error',
      detail: `${response.status} ${(await response.text()).slice(0, 200)}`,
    })
  }

  return { projectId: credentials.projectId, indexes: statuses }
}
