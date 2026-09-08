import type { APIRoute } from 'astro'
import { ENGINE_IDS, type EngineId } from '../../benchmark/domain'
import type { EngineContext } from '../../dataset/domain/context.ts'
import { readFirestoreContext } from '../../dataset/adapters/firestore-context.ts'
import { readMongoContext } from '../../dataset/adapters/mongo-context.ts'
import { readEnv } from '../../server/env'
import { getFirestoreClient, isConfigError } from '../../server/firestore-client'
import { getMongoClient, isMongoConfigError } from '../../server/mongo-client'

/**
 * Reports the conditions each engine is measured under: network round trip,
 * stored size, and the provisioning parameters.
 *
 * Read-only and never cached. A cached context would describe a database from
 * some earlier moment while the numbers beside it came from this one, which is
 * exactly the sort of quiet mismatch the whole project exists to avoid.
 */
export const prerender = false

type EngineResult =
  | { readonly ok: true; readonly context: EngineContext }
  | { readonly ok: false; readonly engine: EngineId; readonly missing: readonly string[] }

const readers: Readonly<Record<EngineId, () => Promise<EngineResult>>> = {
  mongodb: async () => {
    const handle = getMongoClient()
    if (isMongoConfigError(handle)) return { ok: false, engine: 'mongodb', missing: handle.missing }
    const uri = readEnv('MONGODB_URI') ?? ''
    return { ok: true, context: await readMongoContext(handle.db, uri) }
  },
  firestore: async () => {
    const db = getFirestoreClient()
    if (isConfigError(db)) return { ok: false, engine: 'firestore', missing: db.missing }
    return {
      ok: true,
      context: await readFirestoreContext(
        db,
        readEnv('FIRESTORE_PROJECT_ID') ?? 'desconocido',
        readEnv('FIRESTORE_REGION') ?? 'sin declarar',
      ),
    }
  },
}

export const GET: APIRoute = async () => {
  const settled = await Promise.allSettled(ENGINE_IDS.map((engine) => readers[engine]()))

  const contexts: EngineContext[] = []
  const failures: { engine: EngineId; reason: string }[] = []

  for (let i = 0; i < settled.length; i += 1) {
    const engine = ENGINE_IDS[i]
    const outcome = settled[i]
    if (engine === undefined || outcome === undefined) continue

    if (outcome.status === 'rejected') {
      // One engine being unreachable must not hide the other's context: the
      // report is more useful with half the conditions than with none.
      failures.push({
        engine,
        reason: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      })
      continue
    }

    if (outcome.value.ok) contexts.push(outcome.value.context)
    else failures.push({ engine, reason: `faltan variables: ${outcome.value.missing.join(', ')}` })
  }

  return new Response(JSON.stringify({ measuredAt: Date.now(), contexts, failures }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
