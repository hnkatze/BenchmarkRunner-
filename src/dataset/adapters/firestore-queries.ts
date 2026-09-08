import { AggregateField, type Firestore } from 'firebase-admin/firestore'
import { CUSTOMER_SEGMENTS, ORDER_STATUSES } from '../domain/collections.ts'
import { PAIRED_SCALE } from '../domain/generate.ts'
import { QUERIES, type QueryId } from '../domain/queries.ts'

/**
 * The ten queries as Firestore is able to answer them.
 *
 * Five run natively. The other five do not exist in Firestore at all — there is
 * no GROUP BY, no HAVING, no JOIN and no subquery — so what runs here is the
 * missing engine, written by hand in application code. Each one carries a note
 * saying exactly what is being emulated, because a latency number without that
 * caveat would compare MongoDB's aggregation pipeline against a JavaScript loop
 * and call it a database comparison.
 *
 * Read cost matters as much as latency on the Spark plan (50,000 reads/day), so
 * the emulations use aggregation queries wherever possible: those bill one read
 * per 1,000 index entries instead of one per document. Fetching every document
 * to group it client-side would cost 600× more and exhaust the daily quota in a
 * single run.
 */

const HALF_YEAR = Date.UTC(2024, 6, 1)
const YEAR_END = Date.UTC(2025, 0, 1)
const COUNTRIES = ['HN', 'GT', 'SV', 'NI', 'CR', 'PA', 'MX', 'US'] as const

const pickId = (prefix: string, index: number, bound: number, width: number): string =>
  `${prefix}_${String(index % bound).padStart(width, '0')}`

export type FirestoreQuery = (db: Firestore, iteration: number) => Promise<unknown>

export const FIRESTORE_QUERIES: Readonly<Record<QueryId, FirestoreQuery>> = {
  /* ── Native: a where plus an orderBy over an index ─────────────────────── */

  [QUERIES.productsByCategory]: async (db, i) =>
    (
      await db
        .collection('products')
        .where('categoryId', '==', pickId('cat', i, PAIRED_SCALE.categories, 4))
        .orderBy('price', 'desc')
        .limit(50)
        .get()
    ).size,

  [QUERIES.ordersByCustomer]: async (db, i) =>
    (
      await db
        .collection('orders')
        .where('customerId', '==', pickId('cus', i, PAIRED_SCALE.customers, 8))
        .orderBy('placedAt', 'desc')
        .limit(50)
        .get()
    ).size,

  [QUERIES.ordersByStatusInRange]: async (db, i) =>
    (
      await db
        .collection('orders')
        .where('status', '==', ORDER_STATUSES[i % ORDER_STATUSES.length])
        .where('placedAt', '>=', HALF_YEAR)
        .where('placedAt', '<', YEAR_END)
        .orderBy('placedAt', 'desc')
        .limit(50)
        .get()
    ).size,

  [QUERIES.customersBySegment]: async (db, i) =>
    (
      await db
        .collection('customers')
        .where('segment', '==', CUSTOMER_SEGMENTS[i % CUSTOMER_SEGMENTS.length])
        .where('country', '==', COUNTRIES[i % COUNTRIES.length])
        .limit(50)
        .get()
    ).size,

  [QUERIES.reviewsByProductRated]: async (db, i) =>
    (
      await db
        .collection('reviews')
        .where('productId', '==', pickId('prd', i, PAIRED_SCALE.products, 7))
        .where('rating', '>=', 3)
        .orderBy('rating', 'desc')
        .limit(50)
        .get()
    ).size,

  /* ── Emulated: Firestore has no GROUP BY ──────────────────────────────────
     One aggregation query per group, then the HAVING applied here. This only
     works because the categories are known and there are ten of them; the same
     shape against `customerId` would be 900 round trips, and against an
     unbounded key it would be impossible. That limit IS the finding. */

  [QUERIES.revenueByCategoryHaving]: async (db) => {
    const categories = Array.from({ length: PAIRED_SCALE.categories }, (_, n) =>
      pickId('cat', n, PAIRED_SCALE.categories, 4),
    )
    const totals = await Promise.all(
      categories.map(async (categoryId) => {
        const snap = await db
          .collection('orderItems')
          .where('categoryId', '==', categoryId)
          .aggregate({ revenue: AggregateField.sum('lineTotal') })
          .get()
        return { categoryId, revenue: Number(snap.data().revenue ?? 0) }
      }),
    )
    // The HAVING. There is no server-side equivalent to push this into.
    return totals.filter((t) => t.revenue > 100_000).sort((a, b) => b.revenue - a.revenue)
  },

  [QUERIES.avgTicketByCategoryHaving]: async (db) => {
    const categories = Array.from({ length: PAIRED_SCALE.categories }, (_, n) =>
      pickId('cat', n, PAIRED_SCALE.categories, 4),
    )
    const rows = await Promise.all(
      categories.map(async (categoryId) => {
        const snap = await db
          .collection('orderItems')
          .where('categoryId', '==', categoryId)
          .aggregate({ ticket: AggregateField.average('lineTotal'), n: AggregateField.count() })
          .get()
        const data = snap.data()
        return { categoryId, ticket: Number(data.ticket ?? 0), n: Number(data.n ?? 0) }
      }),
    )
    return rows.filter((r) => r.n > 100 && r.ticket > 1_000).sort((a, b) => b.ticket - a.ticket)
  },

  /* ── Emulated: Firestore has no JOIN ──────────────────────────────────────
     N+1 round trips: one query for the parents, then one per parent. This is
     the literal cost of the missing join, and it is why this query is the most
     expensive thing Firestore does in the whole study. */

  [QUERIES.ordersJoinPayments]: async (db) => {
    const parents = await db
      .collection('orders')
      .where('status', '==', 'delivered')
      .limit(50)
      .get()

    const joined = await Promise.all(
      parents.docs.map(async (doc) => {
        const children = await db
          .collection('payments')
          .where('orderId', '==', doc.get('id'))
          .get()
        return { order: doc.get('id'), payments: children.size }
      }),
    )
    return joined
  },

  /* ── Emulated: Firestore has no subquery ──────────────────────────────────
     Two passes. The threshold has to come back to the client before the second
     query can be built, so the round trips are strictly sequential — a
     relational engine resolves both inside one statement. */

  [QUERIES.customersAboveAverageSpend]: async (db) => {
    const overall = await db
      .collection('orders')
      .aggregate({ avg: AggregateField.average('total') })
      .get()
    const threshold = Number(overall.data().avg ?? 0)

    // And here Firestore runs out of moves: there is no GROUP BY customerId to
    // compare against the threshold, and 900 aggregation queries would be the
    // honest emulation. Bounded to a sample so the phase stays measurable, and
    // the report says so.
    const sample = Array.from({ length: 25 }, (_, n) => pickId('cus', n, PAIRED_SCALE.customers, 8))
    const spends = await Promise.all(
      sample.map(async (customerId) => {
        const snap = await db
          .collection('orders')
          .where('customerId', '==', customerId)
          .aggregate({ spend: AggregateField.sum('total') })
          .get()
        return { customerId, spend: Number(snap.data().spend ?? 0) }
      }),
    )
    return spends.filter((s) => s.spend > threshold)
  },

  [QUERIES.productsRatedAboveAverage]: async (db) => {
    const overall = await db
      .collection('reviews')
      .aggregate({ avg: AggregateField.average('rating') })
      .get()
    const threshold = Number(overall.data().avg ?? 0)

    const sample = Array.from({ length: 25 }, (_, n) => pickId('prd', n, PAIRED_SCALE.products, 7))
    const rated = await Promise.all(
      sample.map(async (productId) => {
        const snap = await db
          .collection('reviews')
          .where('productId', '==', productId)
          .aggregate({ stars: AggregateField.average('rating'), n: AggregateField.count() })
          .get()
        const data = snap.data()
        return { productId, stars: Number(data.stars ?? 0), n: Number(data.n ?? 0) }
      }),
    )
    return rated.filter((r) => r.n > 5 && r.stars > threshold)
  },
}
