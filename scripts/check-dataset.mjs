#!/usr/bin/env node
// Verifies the dataset generator BEFORE anything is written to a database.
//
// This matters more than it looks. Firestore's Spark quota gives one seeding
// attempt per day, so a generator bug is not a retry — it is a lost day. And
// two of the brief's requirements rest entirely on this file being correct:
// "los registros deben ser idénticos" and the category grouping that the
// complex queries compare across engines.
//
// Usage: node --experimental-strip-types scripts/check-dataset.mjs

import {
  COLLECTION_IDS,
  PAIRED_SCALE,
  SCALE_DEMO,
  documentsFor,
  productAt,
  totalDocuments,
} from '../src/dataset/domain/index.ts'

let failures = 0

const check = (label, passed, detail = '') => {
  console.log(`${passed ? '  ok  ' : '  FALLA'} ${label}${detail ? ' — ' + detail : ''}`)
  if (!passed) failures += 1
}

const take = (collection, scale, from, count) => [...documentsFor(collection, scale, from, count)]

console.log('\n=== 1. Determinismo: la misma posición da el mismo documento ===')
// Generating [0,60) and [30,60) must agree on the overlap. If it does not, a
// resumed seed writes different data than a clean one and the two engines
// silently stop being identical.
for (const collection of COLLECTION_IDS) {
  const whole = take(collection, PAIRED_SCALE, 0, 60)
  const resumed = take(collection, PAIRED_SCALE, 30, 30)
  const same = JSON.stringify(whole.slice(30)) === JSON.stringify(resumed)
  check(`${collection}: reanudar desde 30 coincide con generar de corrido`, same)
}

console.log('\n=== 2. Integridad referencial ===')
const scale = PAIRED_SCALE
const idNum = (id) => Number(id.slice(id.indexOf('_') + 1))

const items = take('orderItems', scale, 0, 2000)
check(
  'orderItems.orderId siempre apunta a un pedido existente',
  items.every((it) => idNum(it.orderId) < scale.orders),
)
check(
  'orderItems.productId siempre apunta a un producto existente',
  items.every((it) => idNum(it.productId) < scale.products),
)

// The one that would silently corrupt the comparison. Firestore cannot join,
// so the line carries its own categoryId; if that copy disagreed with the
// product's real category, MongoDB's $lookup and Firestore's per-group
// aggregation would answer DIFFERENT questions and the numbers would look
// fine while meaning nothing.
const mismatched = items.filter(
  (it) => productAt(idNum(it.productId), scale).categoryId !== it.categoryId,
)
check(
  'orderItems.categoryId coincide con la categoría real del producto',
  mismatched.length === 0,
  mismatched.length ? `${mismatched.length} desalineados` : 'clave de agrupación consistente',
)

const orders = take('orders', scale, 0, 1000)
check(
  'orders.customerId siempre apunta a un cliente existente',
  orders.every((o) => idNum(o.customerId) < scale.customers),
)

console.log('\n=== 3. Unicidad de ids ===')
for (const collection of COLLECTION_IDS) {
  const sample = take(collection, scale, 0, Math.min(scale[collection], 1500))
  const unique = new Set(sample.map((d) => d.id)).size
  check(`${collection}: ${sample.length} documentos, ${unique} ids únicos`, unique === sample.length)
}

console.log('\n=== 4. Cardinalidad de las claves de agrupación ===')
// Firestore emulates GROUP BY with one aggregation query per group, so the
// number of groups is a cost, not a detail. It has to stay small and known.
const groups = new Set(items.map((it) => it.categoryId))
check(
  `categorías presentes en la tabla de hechos: ${groups.size}`,
  groups.size > 1 && groups.size <= scale.categories,
  `${groups.size} agregaciones por consulta compleja en Firestore`,
)

console.log('\n=== 5. Escalas ===')
const paired = totalDocuments(PAIRED_SCALE)
const demo = totalDocuments(SCALE_DEMO)
check(`pareada: ${paired.toLocaleString('es-HN')} documentos`, paired <= 18_000,
  `cupo diario de Firestore 20.000, margen ${(20_000 - paired).toLocaleString('es-HN')}`)
check(`escala: ${demo.toLocaleString('es-HN')} documentos`, demo >= 1_000_000,
  'cumple el mínimo del brief, solo MongoDB')

console.log('\n=== Muestra ===')
for (const collection of ['categories', 'products', 'orderItems']) {
  console.log(`\n${collection}:`)
  for (const doc of documentsFor(collection, scale, 0, 2)) console.log(' ', JSON.stringify(doc))
}

console.log(failures === 0 ? '\nTodo en orden.\n' : `\n${failures} verificación(es) fallaron.\n`)
process.exit(failures === 0 ? 0 : 1)
