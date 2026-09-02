import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'
import { readEnv } from './env'

/**
 * Server-only. Importing this from anything the browser bundles would ship the
 * service-account key to every visitor.
 */

export type FirestoreConfigError = { readonly missing: readonly string[] }

let cached: Firestore | null = null

/**
 * @returns the shared Firestore handle, or the list of env vars that are missing
 */
export const getFirestoreClient = (): Firestore | FirestoreConfigError => {
  if (cached !== null) return cached

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

  // .env stores the key with literal \n pairs; the SDK needs real newlines.
  const privateKey = rawKey.split('\\n').join('\n')

  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })

  if (app === undefined) return { missing: ['firebase app failed to initialise'] }

  cached = getFirestore(app)
  return cached
}

export const isConfigError = (
  value: Firestore | FirestoreConfigError,
): value is FirestoreConfigError => 'missing' in value
