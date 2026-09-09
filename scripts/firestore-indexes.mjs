#!/usr/bin/env node
// Emits `firestore.indexes.json` and creates the composite indexes it declares.
//
// **Firestore indexes every field automatically — one field at a time.**
// A COMPOSITE index, which is what a query needs as soon as it combines fields
// or sorts by a field it does not filter on, is never automatic. Seven of the
// ten study queries need one, so a fresh project answers most of them with
// FAILED_PRECONDITION until these exist. Both halves of that sentence are
// true, which is exactly why the distinction gets missed.
//
// The Admin *SDK* cannot create a composite; the Admin *REST API* can, so
// `--deploy` makes a new project query-ready without a console visit and
// without the Firebase CLI — whose identity is a human, and the human at this
// keyboard may have no access to the project the benchmark points at.
//
// The file, this script and the app's own button all read the same declaration
// in `src/dataset/adapters/firestore-index-admin.ts`, so they cannot drift.
//
//   node --experimental-strip-types scripts/firestore-indexes.mjs [--write]
//   node --experimental-strip-types --env-file=.env scripts/firestore-indexes.mjs --list
//   node --experimental-strip-types --env-file=.env scripts/firestore-indexes.mjs --deploy

import { writeFileSync } from 'node:fs'
import {
  declaredFirestoreIndexes,
  ensureFirestoreIndexes,
  listFirestoreIndexes,
} from '../src/dataset/adapters/firestore-index-admin.ts'
import { INDEXES } from '../src/dataset/domain/indexes.ts'

const declared = declaredFirestoreIndexes()

// Reported, never declared: these are the ones Firestore really does build by
// itself, and asking the API for one would be asking for what it already has.
const automatic = Object.entries(INDEXES).flatMap(([collection, specs]) =>
  specs
    .filter((spec) => Object.keys(spec.keys).length < 2)
    .map((spec) => `${collection}.${Object.keys(spec.keys).join(',')}`),
)

const document = {
  indexes: declared.map((index) => ({
    collectionGroup: index.collection,
    queryScope: 'COLLECTION',
    fields: index.fields,
  })),
  fieldOverrides: [],
}
const json = JSON.stringify(document, null, 2) + '\n'

console.log(`\nCompuestos a declarar   : ${declared.length}`)
console.log(
  `Automáticos en Firestore: ${automatic.length}${automatic.length ? ' — ' + automatic.join(', ') : ''}`,
)

const credentials = () => {
  const projectId = process.env.FIRESTORE_PROJECT_ID
  const clientEmail = process.env.FIRESTORE_CLIENT_EMAIL
  const rawKey = process.env.FIRESTORE_PRIVATE_KEY

  if (!projectId || !clientEmail || !rawKey) {
    console.error('\nFaltan credenciales. Corré con --env-file=.env\n')
    process.exit(1)
  }
  // Same expansion the server does: .env stores literal \n pairs.
  return { projectId, clientEmail, privateKey: rawKey.split('\\n').join('\n') }
}

const MARK = {
  ready: '  ok      ',
  building: '  armando ',
  missing: '  FALTA   ',
  created: '  + creado',
  denied: '  DENEGADO',
  error: '  ERROR   ',
}

const render = (report) => {
  console.log(`\nProyecto: ${report.projectId}\n`)

  if (report.error !== undefined) {
    console.error(`No se pudo consultar la API: ${report.error}\n`)
    process.exitCode = 1
    return
  }

  for (const index of report.indexes) {
    const shape = index.fields
      .map((f) => `${f.fieldPath} ${f.order === 'ASCENDING' ? 'ASC' : 'DESC'}`)
      .join(', ')
    console.log(`${MARK[index.state]}  ${index.collection} (${shape})`)
    if (index.detail !== undefined) console.log(`              ${index.detail}`)
  }

  const denied = report.indexes.filter((i) => i.state === 'denied').length
  if (denied > 0) {
    console.error(`\n${denied} denegados: al service account le falta permiso de creación.`)
    console.error("Dale 'roles/datastore.indexAdmin' en IAM y volvé a correr.\n")
    process.exitCode = 1
    return
  }

  const missing = report.indexes.filter((i) => i.state === 'missing').length
  const pending = report.indexes.filter(
    (i) => i.state === 'created' || i.state === 'building',
  ).length

  if (missing > 0) {
    console.log(`\n${missing} faltan. Volvé a correr con --deploy para crearlos.`)
  }
  if (pending > 0) {
    console.log(`\n${pending} se están construyendo en segundo plano.`)
    console.log('Hasta que terminen, una consulta falla igual que sin índice.')
  }
  if (missing === 0 && pending === 0) {
    console.log('\nTodos listos.')
  }
  console.log('')
}

if (process.argv.includes('--deploy')) {
  render(await ensureFirestoreIndexes(credentials()))
} else if (process.argv.includes('--list')) {
  render(await listFirestoreIndexes(credentials()))
} else if (process.argv.includes('--write')) {
  writeFileSync('firestore.indexes.json', json)
  console.log('\nEscrito firestore.indexes.json')
  console.log('Crearlos: agregá --deploy (usa el service account del .env)\n')
} else {
  console.log('\n' + json)
  console.log('--write para guardarlo · --list para ver el estado · --deploy para crearlos.\n')
}
