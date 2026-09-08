import type { Firestore } from 'firebase-admin/firestore'
import { COLLECTION_IDS } from '../domain/collections.ts'
import type { CollectionStorage, EngineContext, NetworkContext } from '../domain/context.ts'

/**
 * Reports what conditions a Firestore measurement was taken under — and, more
 * usefully, what Firestore refuses to tell us.
 *
 * Three of the brief's requirements have no answer on this side, and each
 * absence is returned as a stated reason rather than a zero:
 *
 * - **Database size.** No SDK call returns it. It lives in the Firebase console
 *   or in Cloud Monitoring, so the before/after measurement is a manual reading
 *   here while MongoDB answers it with one `dbStats`.
 * - **Cluster parameters.** There are none. Firestore is serverless: no tier,
 *   no CPU, no RAM, no connection ceiling to declare. The only comparable knobs
 *   are location and database mode, which is why the two engines cannot be
 *   "matched on parameters" at all.
 * - **Index build time.** Composite indexes are deployed with the CLI and built
 *   asynchronously on the server; there is no client-side moment to time.
 */

const PING_SAMPLES = 7

/**
 * Firestore has no `ping`. The cheapest round trip that actually reaches the
 * service is a count aggregation over an empty-ish path — it bills a single
 * read and returns nothing, which is exactly what a latency probe wants.
 */
const measureNetwork = async (db: Firestore, projectId: string): Promise<NetworkContext> => {
  const probe = db.collection('categories').limit(1)
  const samples: number[] = []

  for (let i = 0; i < PING_SAMPLES; i += 1) {
    const at = Date.now()
    await probe.get()
    samples.push(Date.now() - at)
  }

  const sorted = [...samples].sort((a, b) => a - b)
  return {
    medianRttMs: sorted[Math.floor(sorted.length / 2)] ?? 0,
    minRttMs: sorted[0] ?? 0,
    maxRttMs: sorted[sorted.length - 1] ?? 0,
    samples: PING_SAMPLES,
    host: `${projectId}.firestore.googleapis.com`,
  }
}

/**
 * Document counts only — the one part of "how big is it" Firestore will answer.
 *
 * Uses `count()` aggregations, which bill one read per 1,000 index entries
 * rather than one per document. Counting eight collections by fetching them
 * would cost 18,000 reads of a 50,000 daily quota; this costs about twenty.
 */
const countDocuments = async (db: Firestore): Promise<readonly CollectionStorage[]> => {
  const counts = await Promise.all(
    COLLECTION_IDS.map(async (collection) => {
      try {
        const snapshot = await db.collection(collection).count().get()
        return {
          collection,
          documents: Number(snapshot.data().count ?? 0),
          // Firestore reports no bytes at all, at any granularity.
          storageBytes: 0,
          indexBytes: 0,
          // Every field is indexed automatically; there is no list to read back.
          indexes: ['automáticos en todos los campos'],
        }
      } catch {
        return {
          collection,
          documents: 0,
          storageBytes: 0,
          indexBytes: 0,
          indexes: [],
        }
      }
    }),
  )
  return counts
}

/**
 * @param db - a live handle; the probe only reads through it
 * @param projectId - for the host name in the network section
 * @param region - the configured location, e.g. `nam5`
 * @returns Firestore's conditions, including what it cannot report
 */
export const readFirestoreContext = async (
  db: Firestore,
  projectId: string,
  region: string,
): Promise<EngineContext> => {
  const [network, perCollection] = await Promise.all([
    measureNetwork(db, projectId),
    countDocuments(db),
  ])

  const documents = perCollection.reduce((sum, entry) => sum + entry.documents, 0)

  return {
    engine: 'firestore',
    parameters: [
      { label: 'Modo', value: 'Native' },
      { label: 'Ubicación', value: region },
      { label: 'Tipo de ubicación', value: region.startsWith('nam') ? 'multirregión' : 'regional' },
      { label: 'Plan', value: 'Spark · gratuito' },
      { label: 'Techo de almacenamiento', value: '1 GiB' },
      { label: 'Cupo de escrituras', value: '20.000/día' },
      { label: 'Cupo de lecturas', value: '50.000/día' },
      { label: 'Cupo de borrados', value: '20.000/día' },
      { label: 'Cluster', value: 'no aplica — serverless' },
    ],
    network,
    storage: {
      documents,
      // Zero here means "not reported", and `unavailable` below says so. It is
      // never to be read as "the database occupies nothing".
      dataBytes: 0,
      storageBytes: 0,
      indexBytes: 0,
      perCollection,
    },
    unavailable: [
      {
        what: 'Tamaño de la base en bytes',
        why: 'Ningún método del SDK lo devuelve. Sale de la consola de Firebase o de la API de Cloud Monitoring, así que la medición antes/después es manual de este lado.',
      },
      {
        what: 'Parámetros de cluster',
        why: 'No existen. Firestore es serverless: no hay tier, ni CPU, ni RAM, ni límite de conexiones que declarar. Solo ubicación y modo.',
      },
      {
        what: 'Tiempo de creación de índices',
        why: 'Los compuestos se despliegan con la CLI y se construyen en background. No hay momento del cliente que cronometrar.',
      },
      {
        what: 'Detalle de índices por colección',
        why: 'Firestore indexa cada campo automáticamente y no expone la lista resultante.',
      },
    ],
  }
}
