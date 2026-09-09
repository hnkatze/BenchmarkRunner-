#!/usr/bin/env node
// Finds the indexes the ten read queries need, on each engine, and says which
// ones are missing.
//
// The two engines have to be asked in completely different ways, and that
// asymmetry is the point:
//
//   Firestore TELLS you. A query with no composite index fails outright with
//   FAILED_PRECONDITION and a console link. It fails on an EMPTY collection
//   too, because the requirement is decided when the query is planned, not
//   when it reads — so the whole set can be discovered without seeding a
//   single document and without spending a byte of the daily write quota.
//
//   MongoDB never tells you. A missing index is not an error: the planner
//   quietly does a collection scan and returns the right answer, slower. So
//   the only way to ask is to run the queries between two readings of
//   $indexStats and see which indexes actually moved.
//
//   node --experimental-strip-types --env-file=.env scripts/check-query-indexes.mjs
//   node --experimental-strip-types --env-file=.env scripts/check-query-indexes.mjs --engine=firestore

import { MongoClient } from 'mongodb'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { FIRESTORE_QUERIES } from '../src/dataset/adapters/firestore-queries.ts'
import { MONGO_QUERIES } from '../src/dataset/adapters/mongo-queries.ts'
import { COLLECTION_IDS } from '../src/dataset/domain/collections.ts'
import { indexesForEngine } from '../src/dataset/domain/indexes.ts'

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
    return [key, value]
  }),
)
const which = args.get('engine') ?? 'both'

/* ── Firestore ───────────────────────────────────────────────────────────── */

/**
 * Turns the `create_composite` blob of a Firestore index error into the index
 * it is asking for. The blob is a base64 protobuf: a resource path, then
 * repeated {name, direction} fields where 1 is ascending and 2 descending.
 *
 * Decoding it rather than just printing the link matters, because the link
 * creates the index in ONE project by hand. The decoded shape can be added to
 * the shared table, which then builds it in every project, on both engines,
 * for good.
 */
const decodeRequiredIndex = (message) => {
  const blob = /create_composite=([A-Za-z0-9_-]+)/.exec(message)?.[1]
  if (blob === undefined) return null

  const raw = Buffer.from(blob.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const collection = /collectionGroups\/([A-Za-z0-9_]+)\//.exec(raw.toString('latin1'))?.[1]
  const fields = []

  for (let i = 0; i < raw.length - 3; i += 1) {
    if (raw[i] !== 0x1a || raw[i + 2] !== 0x0a) continue
    const blockLength = raw[i + 1]
    const nameLength = raw[i + 3]
    if (nameLength + 4 !== blockLength) continue
    if (raw[i + 4 + nameLength] !== 0x10) continue
    fields.push({
      name: raw.subarray(i + 4, i + 4 + nameLength).toString('latin1'),
      order: raw[i + 5 + nameLength] === 1 ? 'ASC' : 'DESC',
    })
  }

  // Firestore appends __name__ itself; declaring it would be noise.
  return { collection, fields: fields.filter((f) => f.name !== '__name__') }
}

const checkFirestore = async () => {
  const rawKey = process.env.FIRESTORE_PRIVATE_KEY
  const projectId = process.env.FIRESTORE_PROJECT_ID
  if (!rawKey || !projectId || !process.env.FIRESTORE_CLIENT_EMAIL) {
    console.log('\nFirestore: faltan credenciales, se omite.\n')
    return
  }

  const app =
    getApps()[0] ??
    initializeApp({
      credential: cert({
        projectId,
        clientEmail: process.env.FIRESTORE_CLIENT_EMAIL,
        privateKey: rawKey.split('\\n').join('\n'),
      }),
    })
  const db = getFirestore(app)

  console.log(`\n══ Firestore · ${projectId} ══\n`)
  console.log('Se ejecuta cada consulta una vez. El índice se exige al planificar,')
  console.log('así que esto funciona con la base vacía y sin gastar cupo de escritura.\n')

  const missing = []

  for (const id of Object.keys(FIRESTORE_QUERIES)) {
    try {
      await FIRESTORE_QUERIES[id](db, 0)
      console.log(`  ok        ${id}`)
    } catch (error) {
      const message = String(error?.message ?? error)
      if (error?.code !== 9 || !message.includes('requires an index')) {
        console.log(`  ERROR     ${id} — ${message.slice(0, 110)}`)
        continue
      }

      const index = decodeRequiredIndex(message)
      const shape =
        index === null
          ? '(no se pudo decodificar)'
          : `${index.collection} (${index.fields.map((f) => `${f.name} ${f.order}`).join(', ')})`

      if (message.includes('currently building')) {
        console.log(`  armando   ${id} — ${shape}`)
        continue
      }

      console.log(`  FALTA     ${id} — ${shape}`)
      missing.push({ id, shape, link: /https?:\/\/\S+/.exec(message)?.[0] })
    }
  }

  if (missing.length === 0) {
    console.log('\nNingún índice compuesto falta.\n')
    return
  }

  console.log(`\n${missing.length} índices faltan. Dos formas de crearlos:\n`)
  console.log('  1. Declarados, que es la buena — si alguna forma de arriba no está en')
  console.log('     src/dataset/domain/indexes.ts, agregala ahí y luego:')
  console.log('       node --experimental-strip-types --env-file=.env \\')
  console.log('         scripts/firestore-indexes.mjs --deploy\n')
  console.log('  2. A mano, un proyecto y un índice por vez, con estos enlaces:\n')
  for (const item of missing) {
    if (item.link !== undefined) console.log(`     ${item.id}\n       ${item.link}\n`)
  }
}

/* ── MongoDB ─────────────────────────────────────────────────────────────── */

/** Index usage counters, keyed by `collection|index`. */
const readIndexStats = async (db) => {
  const counters = new Map()
  for (const collection of COLLECTION_IDS) {
    try {
      const rows = await db.collection(collection).aggregate([{ $indexStats: {} }]).toArray()
      for (const row of rows) {
        counters.set(`${collection}|${row.name}`, Number(row.accesses?.ops ?? 0))
      }
    } catch {
      // A collection that does not exist yet has no stats, and that is fine.
    }
  }
  return counters
}

const checkMongo = async () => {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.MONGODB_DB
  if (!uri || !dbName) {
    console.log('\nMongoDB: faltan credenciales, se omite.\n')
    return
  }

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db(dbName)

  console.log(`\n══ MongoDB · ${dbName} ══\n`)

  // 1. Declared versus real. MongoDB will happily run without them.
  const declared = indexesForEngine('mongodb')
  const existing = new Map()
  for (const collection of COLLECTION_IDS) {
    try {
      for (const index of await db.collection(collection).listIndexes().toArray()) {
        existing.set(`${collection}|${index.name}`, JSON.stringify(index.key))
      }
    } catch {
      // Collection absent: every declared index for it counts as missing.
    }
  }

  // Compared by KEYS, not by name. A name that survives a changed direction
  // reports a false "present", and MongoDB then refuses to rebuild it —
  // createIndex will not reuse a name whose key spec moved.
  const absent = []
  const drifted = []
  for (const { collection, spec } of declared) {
    const live = existing.get(`${collection}|${spec.name}`)
    if (live === undefined) absent.push({ collection, spec })
    else if (live !== JSON.stringify(spec.keys)) drifted.push({ collection, spec, live })
  }

  const ok = declared.length - absent.length - drifted.length
  console.log(`Declarados para MongoDB: ${declared.length} · coinciden: ${ok}`)
  for (const { collection, spec } of absent) {
    console.log(`  FALTA     ${collection}.${spec.name} — ${JSON.stringify(spec.keys)}`)
  }
  for (const { collection, spec, live } of drifted) {
    console.log(`  DIFIERE   ${collection}.${spec.name}`)
    console.log(`            en la base: ${live}`)
    console.log(`            declarado : ${JSON.stringify(spec.keys)}`)
  }
  if (absent.length + drifted.length > 0) {
    console.log('\n  scripts/seed.mjs los construye al sembrar, y reconstruye los que difieren.\n')
  }

  // 2. What the queries actually touched. A missing index is not an error
  //    here — it is a collection scan, and only the counters reveal it.
  console.log('\nEjecutando las diez consultas para ver qué índices se usan…\n')
  const before = await readIndexStats(db)
  for (const id of Object.keys(MONGO_QUERIES)) {
    try {
      await MONGO_QUERIES[id](db, 0)
    } catch (error) {
      console.log(`  ERROR     ${id} — ${String(error?.message ?? error).slice(0, 110)}`)
    }
  }
  const after = await readIndexStats(db)

  const used = []
  for (const [key, ops] of after) {
    const delta = ops - (before.get(key) ?? 0)
    if (delta > 0) used.push({ key, delta })
  }

  if (used.length === 0) {
    console.log('  Ningún índice se movió: las diez consultas se resolvieron escaneando.')
  } else {
    for (const { key, delta } of used.sort((a, b) => b.delta - a.delta)) {
      console.log(`  usado ${String(delta).padStart(3)}x  ${key.replace('|', '.')}`)
    }
  }

  console.log('\n  Un índice que no se mueve no está necesariamente de más: puede servir')
  console.log('  a una consulta que este script no ejecuta. Pero uno que nadie usa y')
  console.log('  nadie explica es peso muerto que igual se paga en cada escritura.\n')

  await client.close()
}

/* ── ─────────────────────────────────────────────────────────────────────── */

if (which === 'firestore' || which === 'both') await checkFirestore()
if (which === 'mongodb' || which === 'both') await checkMongo()
process.exit(0)
