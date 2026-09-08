import type { Db } from 'mongodb'
import { PAIRED_SCALE } from '../domain/generate.ts'
import { QUERIES, type QueryId } from '../domain/queries.ts'

/**
 * The ten queries as MongoDB expresses them.
 *
 * Parameters are derived from a sample index rather than randomised, so every
 * iteration of a phase asks a comparably sized question. A random customer with
 * two orders and a random one with forty would put the data's variance into the
 * latency distribution, and the percentile would describe the seed instead of
 * the engine.
 */

const HALF_YEAR = Date.UTC(2024, 6, 1)
const YEAR_END = Date.UTC(2025, 0, 1)

/** Cycles through a fixed set so repeated iterations stay comparable. */
const pickId = (prefix: string, index: number, bound: number, width: number): string =>
  `${prefix}_${String(index % bound).padStart(width, '0')}`

export type MongoQuery = (db: Db, iteration: number) => Promise<unknown>

export const MONGO_QUERIES: Readonly<Record<QueryId, MongoQuery>> = {
  [QUERIES.productsByCategory]: (db, i) =>
    db
      .collection('products')
      .find({ categoryId: pickId('cat', i, PAIRED_SCALE.categories, 4) })
      .sort({ price: -1 })
      .limit(50)
      .toArray(),

  [QUERIES.ordersByCustomer]: (db, i) =>
    db
      .collection('orders')
      .find({ customerId: pickId('cus', i, PAIRED_SCALE.customers, 8) })
      .sort({ placedAt: -1 })
      .limit(50)
      .toArray(),

  [QUERIES.ordersByStatusInRange]: (db, i) =>
    db
      .collection('orders')
      .find({
        status: (['pending', 'paid', 'shipped', 'delivered', 'refunded'] as const)[i % 5],
        placedAt: { $gte: HALF_YEAR, $lt: YEAR_END },
      })
      .sort({ placedAt: -1 })
      .limit(50)
      .toArray(),

  [QUERIES.customersBySegment]: (db, i) =>
    db
      .collection('customers')
      .find({
        segment: (['retail', 'wholesale', 'vip'] as const)[i % 3],
        country: (['HN', 'GT', 'SV', 'NI', 'CR', 'PA', 'MX', 'US'] as const)[i % 8],
      })
      .limit(50)
      .toArray(),

  [QUERIES.reviewsByProductRated]: (db, i) =>
    db
      .collection('reviews')
      .find({ productId: pickId('prd', i, PAIRED_SCALE.products, 7), rating: { $gte: 3 } })
      .sort({ rating: -1 })
      .limit(50)
      .toArray(),

  /* Complex. Every one of these is a single round trip — that is the whole
     point of the comparison, because Firestore needs several for each. */

  [QUERIES.revenueByCategoryHaving]: (db) =>
    db
      .collection('orderItems')
      .aggregate([
        { $group: { _id: '$categoryId', revenue: { $sum: '$lineTotal' } } },
        { $match: { revenue: { $gt: 100_000 } } },
        { $sort: { revenue: -1 } },
      ])
      .toArray(),

  [QUERIES.avgTicketByCategoryHaving]: (db) =>
    db
      .collection('orderItems')
      .aggregate([
        { $group: { _id: '$categoryId', ticket: { $avg: '$lineTotal' }, n: { $sum: 1 } } },
        { $match: { n: { $gt: 100 }, ticket: { $gt: 1_000 } } },
        { $sort: { ticket: -1 } },
      ])
      .toArray(),

  [QUERIES.ordersJoinPayments]: (db) =>
    db
      .collection('orders')
      .aggregate([
        { $match: { status: 'delivered' } },
        { $limit: 50 },
        {
          $lookup: {
            from: 'payments',
            localField: 'id',
            foreignField: 'orderId',
            as: 'payments',
          },
        },
        { $project: { id: 1, total: 1, status: 1, payments: { method: 1, amount: 1 } } },
      ])
      .toArray(),

  // `$facet` computes the threshold and the groups in ONE pass. A relational
  // engine writes this as a subquery; Firestore needs two separate round trips.
  [QUERIES.customersAboveAverageSpend]: (db) =>
    db
      .collection('orders')
      .aggregate([
        {
          $facet: {
            average: [{ $group: { _id: null, avg: { $avg: '$total' } } }],
            perCustomer: [{ $group: { _id: '$customerId', spend: { $sum: '$total' } } }],
          },
        },
        { $set: { threshold: { $ifNull: [{ $first: '$average.avg' }, 0] } } },
        { $project: { above: { $filter: {
          input: '$perCustomer',
          as: 'c',
          cond: { $gt: ['$$c.spend', '$threshold'] },
        } } } },
      ])
      .toArray(),

  [QUERIES.productsRatedAboveAverage]: (db) =>
    db
      .collection('reviews')
      .aggregate([
        {
          $facet: {
            average: [{ $group: { _id: null, avg: { $avg: '$rating' } } }],
            perProduct: [
              { $group: { _id: '$productId', stars: { $avg: '$rating' }, n: { $sum: 1 } } },
              { $match: { n: { $gt: 5 } } },
            ],
          },
        },
        { $set: { threshold: { $ifNull: [{ $first: '$average.avg' }, 0] } } },
        { $project: { above: { $filter: {
          input: '$perProduct',
          as: 'p',
          cond: { $gt: ['$$p.stars', '$threshold'] },
        } } } },
      ])
      .toArray(),
}
