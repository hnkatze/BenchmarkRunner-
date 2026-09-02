import { MongoClient, type Db } from 'mongodb'
import { readEnv } from './env'

/**
 * Server-only. The driver and the connection string must never reach a client
 * bundle — the URI carries the password in plain text.
 */

export type MongoConfigError = { readonly missing: readonly string[] }

export type MongoHandle = { readonly db: Db }

let cached: MongoClient | null = null

/**
 * One client per process, reused across requests: the driver keeps a connection
 * pool, and building a new one per run would put TLS and auth inside the
 * measurement instead of the operation.
 * @returns the database handle, or the list of env vars that are missing
 */
export const getMongoClient = (): MongoHandle | MongoConfigError => {
  const uri = readEnv('MONGODB_URI')
  const dbName = readEnv('MONGODB_DB')

  const missing = [
    uri === undefined ? 'MONGODB_URI' : null,
    dbName === undefined ? 'MONGODB_DB' : null,
  ].filter((name): name is string => name !== null)

  if (uri === undefined || dbName === undefined) return { missing }

  if (cached === null) {
    cached = new MongoClient(uri, {
      // The pool has to cover the widest concurrency the config allows, or
      // lanes would queue on sockets and the run would measure the pool.
      maxPoolSize: 100,
      serverSelectionTimeoutMS: 15_000,
    })
  }

  return { db: cached.db(dbName) }
}

export const isMongoConfigError = (
  value: MongoHandle | MongoConfigError,
): value is MongoConfigError => 'missing' in value
