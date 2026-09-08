import type { Db } from 'mongodb'
import { COLLECTION_IDS } from '../domain/collections.ts'
import type {
  CollectionStorage,
  EngineContext,
  NetworkContext,
  StorageContext,
} from '../domain/context.ts'

/**
 * Reports what conditions a MongoDB measurement was taken under.
 *
 * Read-only throughout. It pings, it reads metadata, and it never writes — a
 * context probe that changed the database would invalidate the very numbers it
 * is describing.
 */

const PING_SAMPLES = 7

/** Never the URI: it carries the password in plain text. */
const hostOf = (uri: string): string =>
  uri.replace(/^mongodb(\+srv)?:\/\/[^@]*@/, '').split('/')[0] ?? 'desconocido'

const measureNetwork = async (db: Db, uri: string): Promise<NetworkContext> => {
  const admin = db.admin()
  const samples: number[] = []

  // One ping is a single sample and says nothing. The median of several is the
  // floor every latency number in this study sits on top of.
  for (let i = 0; i < PING_SAMPLES; i += 1) {
    const at = Date.now()
    await admin.command({ ping: 1 })
    samples.push(Date.now() - at)
  }

  const sorted = [...samples].sort((a, b) => a - b)
  return {
    medianRttMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    minRttMs: sorted[0] ?? 0,
    maxRttMs: sorted[sorted.length - 1] ?? 0,
    samples: PING_SAMPLES,
    host: hostOf(uri),
  }
}

const measureStorage = async (db: Db): Promise<StorageContext> => {
  const perCollection: CollectionStorage[] = []

  for (const collection of COLLECTION_IDS) {
    try {
      const stats = await db.command({ collStats: collection })
      const indexes = await db.collection(collection).indexes()
      perCollection.push({
        collection,
        documents: Number(stats.count ?? 0),
        storageBytes: Number(stats.storageSize ?? 0),
        indexBytes: Number(stats.totalIndexSize ?? 0),
        indexes: indexes.map((index) => index.name ?? '(sin nombre)'),
      })
    } catch {
      // A collection that does not exist yet is not an error: it is the "before"
      // half of the before/after the brief asks for.
      perCollection.push({
        collection,
        documents: 0,
        storageBytes: 0,
        indexBytes: 0,
        indexes: [],
      })
    }
  }

  const stats = await db.command({ dbStats: 1 })
  return {
    documents: Number(stats.objects ?? 0),
    dataBytes: Number(stats.dataSize ?? 0),
    storageBytes: Number(stats.storageSize ?? 0),
    indexBytes: Number(stats.indexSize ?? 0),
    perCollection,
  }
}

/**
 * @param db - a live handle; the probe only reads through it
 * @param uri - used for the host name alone, never logged or returned whole
 * @returns everything the report needs to state MongoDB's conditions
 */
export const readMongoContext = async (db: Db, uri: string): Promise<EngineContext> => {
  const [network, storage, build] = await Promise.all([
    measureNetwork(db, uri),
    measureStorage(db),
    db.admin().command({ buildInfo: 1 }),
  ])

  return {
    engine: 'mongodb',
    parameters: [
      { label: 'Versión', value: String(build.version ?? 'desconocida') },
      { label: 'Motor de almacenamiento', value: 'WiredTiger' },
      { label: 'Tier', value: 'M0 · compartido' },
      { label: 'Techo de almacenamiento', value: '512 MB' },
      { label: 'Conexiones', value: '500 máximo' },
      { label: 'Topología', value: 'Replica set de 3 nodos' },
      { label: 'Cupo de escrituras', value: 'sin cupo diario' },
    ],
    network,
    storage,
    unavailable: [],
  }
}
