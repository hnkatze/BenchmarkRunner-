#!/usr/bin/env node
// Seeds a dataset into MongoDB or Firestore, behind one port.
//
// Firestore defaults to a hard write ceiling and cannot be run without one.
// The Spark plan allows 20,000 writes per 24 hours and deletes come out of a
// separate 20,000, so undoing a bad seed and redoing it spans two days. The
// ceiling is not a convenience, it is the only brake that exists.
//
//   node --experimental-strip-types --env-file=.env scripts/seed.mjs [opciones]
//
//   --engine=mongodb|firestore  motor destino
//   --scale=paired|demo   paired = 18.000 pareados · demo = 1.000.000 solo Mongo
//   --batch=1000          documentos por lote (Firestore topa en 500)
//   --concurrency=8       lotes en vuelo
//   --budget=N            techo de escrituras (Firestore: 19.000 por defecto)
//   --fresh               ignora el progreso guardado y empieza de cero
//   --skip-indexes        siembra sin crear índices (para cronometrarlos aparte)
//   --dry-run             calcula y no escribe nada

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { MongoClient } from 'mongodb'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { PAIRED_SCALE, SCALE_DEMO, totalDocuments } from '../src/dataset/domain/generate.ts'
import { COLLECTION_IDS } from '../src/dataset/domain/collections.ts'
import { indexesForEngine } from '../src/dataset/domain/indexes.ts'
import { seedThroughput } from '../src/dataset/domain/seed-port.ts'
import { createMongoSeeder } from '../src/dataset/adapters/mongo-seeder.ts'
import { createFirestoreSeeder } from '../src/dataset/adapters/firestore-seeder.ts'

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
const flag = (name) => process.argv.includes(`--${name}`)

const engine = arg('engine', 'mongodb')
const scaleName = arg('scale', 'paired')
const batchSize = Number(arg('batch', '1000'))
const concurrency = Number(arg('concurrency', '8'))
const dryRun = flag('dry-run')

if (engine !== 'mongodb' && engine !== 'firestore') {
  console.error(`Motor "${engine}" desconocido. Usá mongodb o firestore.`)
  process.exit(1)
}

// Firestore gets a ceiling whether the caller remembers one or not. 19,000
// leaves 1,000 of the daily 20,000 for retries; without that margin a single
// failed batch near the end costs the whole next day.
const explicitBudget = arg('budget', null)
const budget =
  explicitBudget !== null ? Number(explicitBudget) : engine === 'firestore' ? 19_000 : null

const scale = scaleName === 'demo' ? SCALE_DEMO : PAIRED_SCALE

if (engine === 'firestore' && scaleName === 'demo') {
  console.error(
    '\nLa escala demo son 1.000.000 de documentos y Firestore Spark permite 20.000\n' +
      'escrituras por día: serían 50 días. Esa escala es solo para MongoDB.\n',
  )
  process.exit(1)
}

// Progress lives next to the repo, not in it: it records how far a run got, and
// committing it would hand the next person a state that does not match their
// database.
const STATE_FILE = `.seed-state.${engine}.${scaleName}.json`
const loadState = () =>
  !flag('fresh') && existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}
const saveState = (state) => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n')

const writtenSoFar = loadState()
const total = totalDocuments(scale)
const pending = COLLECTION_IDS.reduce(
  (sum, c) => sum + Math.max(0, scale[c] - (writtenSoFar[c] ?? 0)),
  0,
)

console.log(`\nMotor        ${engine}`)
console.log(`Escala       ${scaleName} — ${total.toLocaleString('es-HN')} documentos`)
console.log(`Ya escritos  ${(total - pending).toLocaleString('es-HN')}`)
console.log(`Pendientes   ${pending.toLocaleString('es-HN')}`)
console.log(`Lotes        ${engine === 'firestore' ? Math.min(batchSize, 500) : batchSize} × ${concurrency} en vuelo`)
console.log(`Techo        ${budget === null ? 'sin techo' : budget.toLocaleString('es-HN')}`)
console.log(
  `Índices      ${
    engine === 'firestore'
      ? 'no aplica — ver scripts/firestore-indexes.mjs'
      : flag('skip-indexes')
        ? 'omitidos'
        : indexesForEngine('mongodb').length + ' declarados'
  }`,
)

if (engine === 'firestore' && pending > (budget ?? 0)) {
  console.log(
    `\n  AVISO: quedan ${pending.toLocaleString('es-HN')} pendientes y el techo es ` +
      `${(budget ?? 0).toLocaleString('es-HN')}. La siembra va a cortar y hay que retomarla mañana.`,
  )
}

if (dryRun) {
  console.log('\n--dry-run: no se escribió nada.\n')
  process.exit(0)
}

let closeConnection = async () => {}
let seeder

if (engine === 'mongodb') {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('\nMONGODB_URI ausente. Corré con --env-file=.env\n')
    process.exit(1)
  }
  const client = new MongoClient(uri, { maxPoolSize: 100, serverSelectionTimeoutMS: 20_000 })
  await client.connect()
  seeder = createMongoSeeder(client.db(process.env.MONGODB_DB))
  closeConnection = () => client.close()
} else {
  const projectId = process.env.FIRESTORE_PROJECT_ID
  const clientEmail = process.env.FIRESTORE_CLIENT_EMAIL
  const rawKey = process.env.FIRESTORE_PRIVATE_KEY
  if (!projectId || !clientEmail || !rawKey) {
    console.error('\nFaltan credenciales de Firestore. Corré con --env-file=.env\n')
    process.exit(1)
  }
  // .env stores the key with literal backslash-n pairs; the SDK needs real ones.
  const privateKey = rawKey.split(String.fromCharCode(92) + 'n').join('\n')
  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  seeder = createFirestoreSeeder(getFirestore(app))
}

const controller = new AbortController()
// Ctrl+C must not lose the progress: the whole point of the state file is that
// an interrupted seed resumes instead of restarting.
process.on('SIGINT', () => {
  console.log('\nCancelando… se guarda el progreso.')
  controller.abort()
})

const started = Date.now()
console.log('\nSembrando…\n')

try {
  for await (const event of seeder.seed(
    {
      scale,
      writtenSoFar,
      writeBudget: budget,
      batchSize,
      concurrency,
      skipIndexes: flag('skip-indexes'),
    },
    controller.signal,
  )) {
    switch (event.type) {
      case 'collection-started':
        process.stdout.write(`  ${event.collection.padEnd(12)} ${event.from}/${event.target} … `)
        break
      case 'collection-completed': {
        const r = event.result
        if (r.written === 0 && r.skipped > 0) {
          console.log(`ya completa (${r.skipped.toLocaleString('es-HN')})`)
        } else {
          console.log(
            `${r.written.toLocaleString('es-HN')} escritos en ${(r.wallClockMs / 1000).toFixed(1)}s ` +
              `— ${Math.round(seedThroughput(r)).toLocaleString('es-HN')} docs/s`,
          )
        }
        writtenSoFar[r.collection] = (writtenSoFar[r.collection] ?? 0) + r.written
        saveState(writtenSoFar)
        break
      }
      case 'index-created':
        console.log(
          `  índice ${(event.collection + '.' + event.name).padEnd(34)} ${event.wallClockMs.toFixed(0)} ms`,
        )
        break
      case 'budget-exhausted':
        console.log(
          `\n  TECHO ALCANZADO en ${event.collection}: ${event.written.toLocaleString('es-HN')} de ${event.budget.toLocaleString('es-HN')}`,
        )
        console.log('  Retomá mañana con el mismo comando: el progreso ya está guardado.')
        break
      case 'seed-failed':
        console.error(`\n  FALLA en ${event.collection}: ${event.reason}`)
        break
      case 'seed-completed': {
        const r = event.report
        const seconds = (r.finishedAt - r.startedAt) / 1000
        const indexMs = r.indexes.reduce((s, i) => s + i.wallClockMs, 0)
        console.log('\n  ── resumen ──')
        console.log(`  documentos escritos   ${r.totalWritten.toLocaleString('es-HN')}`)
        console.log(`  tiempo total          ${seconds.toFixed(1)} s`)
        console.log(
          `  índices creados       ${r.indexes.length === 0 ? 'no aplica en este motor' : `${r.indexes.length} en ${indexMs.toFixed(0)} ms`}`,
        )
        console.log(`  techo alcanzado       ${r.budgetExhausted ? 'sí' : 'no'}`)
        break
      }
      default:
        break
    }
  }
} finally {
  await closeConnection()
}

console.log(`\nListo en ${((Date.now() - started) / 1000).toFixed(1)} s. Progreso en ${STATE_FILE}\n`)
