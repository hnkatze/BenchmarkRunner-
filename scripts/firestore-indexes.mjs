#!/usr/bin/env node
// Emits `firestore.indexes.json` from the SAME index table MongoDB uses, and
// can create those indexes directly.
//
// The Firestore *SDK* cannot create a composite index — but the Firestore
// *Admin REST API* can, and the service account already in `.env` is allowed
// to call it. That matters here: the Firebase CLI authenticates as a human,
// and the human logged into this machine has no access to the project the
// benchmark actually points at. `--deploy` closes that gap without a console
// visit, so a fresh project stops being a manual, forgettable step.
//
// Generating the declaration from the shared table is the only way the two
// engines stay on equal footing — a hand-written copy would drift the first
// time an index changed, and the benchmark would silently compare an indexed
// engine against an unindexed one.
//
//   node --experimental-strip-types scripts/firestore-indexes.mjs [--write]
//   node --experimental-strip-types --env-file=.env scripts/firestore-indexes.mjs --deploy

import { writeFileSync } from 'node:fs'
import { allBenchIndexes } from '../src/benchmark/domain/bench-indexes.ts'
import { INDEXES } from '../src/dataset/domain/indexes.ts'

const indexes = []
const single = []

const toFields = (keys) =>
  Object.entries(keys).map(([fieldPath, direction]) => ({
    fieldPath,
    order: direction === 1 ? 'ASCENDING' : 'DESCENDING',
  }))

for (const [collection, specs] of Object.entries(INDEXES)) {
  for (const spec of specs) {
    const fields = toFields(spec.keys)

    // Firestore indexes every field on its own already, so a single-field spec
    // needs no declaration. Only the composites do.
    if (fields.length < 2) {
      single.push(`${collection}.${Object.keys(spec.keys).join(',')}`)
      continue
    }

    indexes.push({ collectionGroup: collection, queryScope: 'COLLECTION', fields })
  }
}

// The CRUD benchmark's own composite index. It is NOT optional decoration: a
// `firebase deploy` declares the complete set and offers to delete every index
// missing from the file, so leaving this one out would erase the index that
// makes the queryFiltered phase work, one deploy after it was created by hand.
for (const spec of allBenchIndexes()) {
  indexes.push({
    collectionGroup: spec.collection,
    queryScope: 'COLLECTION',
    fields: toFields(spec.keys),
  })
}

const document = { indexes, fieldOverrides: [] }
const json = JSON.stringify(document, null, 2) + '\n'

console.log(`\nCompuestos a declarar : ${indexes.length}`)
console.log(`Automáticos en Firestore: ${single.length}${single.length ? ' — ' + single.join(', ') : ''}`)

/* ── Deploy ──────────────────────────────────────────────────────────────── */

/** Firestore appends __name__ to every composite index it builds. */
const signature = (fields) =>
  fields
    .filter((field) => field.fieldPath !== '__name__')
    .map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig ?? ''}`)
    .join(',')

const deploy = async () => {
  const projectId = process.env.FIRESTORE_PROJECT_ID
  const clientEmail = process.env.FIRESTORE_CLIENT_EMAIL
  const rawKey = process.env.FIRESTORE_PRIVATE_KEY

  if (!projectId || !clientEmail || !rawKey) {
    console.error('\nFaltan credenciales. Corré con --env-file=.env\n')
    process.exit(1)
  }

  // Same expansion the server does: .env stores literal \n pairs.
  const privateKey = rawKey.split('\\n').join('\n')

  const { cert } = await import('firebase-admin/app')
  const token = await cert({ projectId, clientEmail, privateKey }).getAccessToken()

  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups`
  const headers = {
    authorization: `Bearer ${token.access_token}`,
    'content-type': 'application/json',
  }

  const listed = await fetch(`${base}/-/indexes`, { headers })
  if (!listed.ok) {
    console.error(`\nNo se pudo listar índices: ${listed.status} ${await listed.text()}\n`)
    process.exit(1)
  }

  // The collection group is the second-to-last segment of the index name.
  const existing = new Set(
    ((await listed.json()).indexes ?? []).map((index) => {
      const group = index.name.split('/collectionGroups/')[1].split('/indexes/')[0]
      return `${group}|${signature(index.fields ?? [])}`
    }),
  )

  console.log(`\nProyecto: ${projectId}`)
  console.log(`Ya existen: ${existing.size}\n`)

  let created = 0
  let skipped = 0

  for (const index of indexes) {
    const key = `${index.collectionGroup}|${signature(index.fields)}`
    const label = `${index.collectionGroup} (${index.fields.map((f) => f.fieldPath).join(', ')})`

    if (existing.has(key)) {
      console.log(`  = ${label}`)
      skipped += 1
      continue
    }

    const response = await fetch(`${base}/${index.collectionGroup}/indexes`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ queryScope: index.queryScope, fields: index.fields }),
    })

    if (response.ok) {
      console.log(`  + ${label}`)
      created += 1
      continue
    }

    // 409 means another run already asked for it; that is not a failure.
    if (response.status === 409) {
      console.log(`  = ${label}`)
      skipped += 1
      continue
    }

    console.error(`  ! ${label} — ${response.status} ${await response.text()}`)
    process.exitCode = 1
  }

  console.log(`\nCreados: ${created} · Ya estaban: ${skipped}`)
  // Building is asynchronous and can take minutes on a populated collection.
  // A query against an index still building fails exactly like a missing one.
  console.log('Se construyen en segundo plano. Hasta que terminen, las consultas fallan igual.\n')
}

if (process.argv.includes('--deploy')) {
  await deploy()
} else if (process.argv.includes('--write')) {
  writeFileSync('firestore.indexes.json', json)
  console.log('\nEscrito firestore.indexes.json')
  console.log('Crear los índices: agregá --deploy (usa el service account del .env)\n')
} else {
  console.log('\n' + json)
  console.log('Volvé a correr con --write para guardarlo, o --deploy para crearlos.\n')
}
