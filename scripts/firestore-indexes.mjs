#!/usr/bin/env node
// Emits `firestore.indexes.json` from the SAME index table MongoDB uses.
//
// Firestore's Admin SDK cannot create a composite index: they are declared in
// this file and deployed with `firebase deploy --only firestore:indexes`, then
// built asynchronously on the server. Generating the declaration from the
// shared table is the only way the two engines stay on equal footing — a
// hand-written copy would drift the first time an index changed, and the
// benchmark would silently compare an indexed engine against an unindexed one.
//
//   node --experimental-strip-types scripts/firestore-indexes.mjs [--write]

import { writeFileSync } from 'node:fs'
import { INDEXES } from '../src/dataset/domain/indexes.ts'

const indexes = []
const single = []

for (const [collection, specs] of Object.entries(INDEXES)) {
  for (const spec of specs) {
    const fields = Object.entries(spec.keys).map(([fieldPath, direction]) => ({
      fieldPath,
      order: direction === 1 ? 'ASCENDING' : 'DESCENDING',
    }))

    // Firestore indexes every field on its own already, so a single-field spec
    // needs no declaration. Only the composites do.
    if (fields.length < 2) {
      single.push(`${collection}.${Object.keys(spec.keys).join(',')}`)
      continue
    }

    indexes.push({ collectionGroup: collection, queryScope: 'COLLECTION', fields })
  }
}

const document = { indexes, fieldOverrides: [] }
const json = JSON.stringify(document, null, 2) + '\n'

console.log(`\nCompuestos a declarar : ${indexes.length}`)
console.log(`Automáticos en Firestore: ${single.length}${single.length ? ' — ' + single.join(', ') : ''}`)

if (process.argv.includes('--write')) {
  writeFileSync('firestore.indexes.json', json)
  console.log('\nEscrito firestore.indexes.json')
  console.log('Desplegar con: firebase deploy --only firestore:indexes\n')
} else {
  console.log('\n' + json)
  console.log('Volvé a correr con --write para guardarlo.\n')
}
