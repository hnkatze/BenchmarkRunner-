/**
 * The ten read queries the brief asks for: five simple, five complex with
 * subqueries and HAVING.
 *
 * Declared as data rather than as code in each adapter, because the two engines
 * answer them by completely different means and the only thing keeping the
 * comparison honest is that both are answering the SAME question. The MongoDB
 * pipeline and the Firestore emulation are implementations of these entries;
 * neither is allowed to define what is being asked.
 */

export const QUERIES = {
  // Simple: one collection, one indexed filter, bounded result.
  productsByCategory: 'productsByCategory',
  ordersByCustomer: 'ordersByCustomer',
  ordersByStatusInRange: 'ordersByStatusInRange',
  customersBySegment: 'customersBySegment',
  reviewsByProductRated: 'reviewsByProductRated',
  // Complex: grouping, HAVING, joins, or a subquery.
  revenueByCategoryHaving: 'revenueByCategoryHaving',
  avgTicketByCategoryHaving: 'avgTicketByCategoryHaving',
  ordersJoinPayments: 'ordersJoinPayments',
  customersAboveAverageSpend: 'customersAboveAverageSpend',
  productsRatedAboveAverage: 'productsRatedAboveAverage',
} as const

export type QueryId = (typeof QUERIES)[keyof typeof QUERIES]

export const QUERY_IDS: readonly QueryId[] = [
  QUERIES.productsByCategory,
  QUERIES.ordersByCustomer,
  QUERIES.ordersByStatusInRange,
  QUERIES.customersBySegment,
  QUERIES.reviewsByProductRated,
  QUERIES.revenueByCategoryHaving,
  QUERIES.avgTicketByCategoryHaving,
  QUERIES.ordersJoinPayments,
  QUERIES.customersAboveAverageSpend,
  QUERIES.productsRatedAboveAverage,
]

export const isQueryId = (value: unknown): value is QueryId =>
  typeof value === 'string' && (QUERY_IDS as readonly string[]).includes(value)

export type QueryKind = 'simple' | 'complex'

/**
 * How Firestore has to answer a query it cannot express.
 *
 * This is the finding the whole study rests on, so it is a typed field rather
 * than a comment: a reader can see, per query, exactly what Firestore was made
 * to do — and a reviewer can object to it.
 */
export type FirestoreStrategy =
  /** Runs natively. A `where` plus an `orderBy` over an index. */
  | { readonly kind: 'native' }
  /**
   * One aggregation query per group, then the HAVING applied on the client.
   * Costs one read per 1,000 index entries per group, which is affordable —
   * but it requires the set of groups to be KNOWN and BOUNDED in advance.
   * It does not generalise to a high-cardinality key.
   */
  | { readonly kind: 'aggregation-per-group'; readonly groupField: string }
  /**
   * N+1 round trips: read the parent set, then one lookup per parent. This is
   * what "no joins" actually costs, and it is why the brief's join queries are
   * the most expensive thing Firestore does here.
   */
  | { readonly kind: 'client-side-join'; readonly parent: string; readonly child: string }
  /**
   * Two passes: one aggregation for the threshold, then a filter that uses it.
   * A relational engine expresses this as a subquery in a single statement.
   */
  | { readonly kind: 'two-pass-subquery'; readonly threshold: string }

export type QuerySpec = {
  readonly id: QueryId
  readonly kind: QueryKind
  /** What the query answers, in the language of the domain, not of a driver. */
  readonly question: string
  /** The SQL an operator would have written, for the report's comparison table. */
  readonly sql: string
  /** How MongoDB answers it. */
  readonly mongo: string
  /** How Firestore is made to answer it. */
  readonly firestore: FirestoreStrategy
}

/** Keyed on the union so a new query fails to compile until it is specified. */
export const QUERY_SPECS: Readonly<Record<QueryId, QuerySpec>> = {
  [QUERIES.productsByCategory]: {
    id: QUERIES.productsByCategory,
    kind: 'simple',
    question: 'Los 50 productos más caros de una categoría',
    sql: 'SELECT * FROM products WHERE categoryId = ? ORDER BY price DESC LIMIT 50',
    mongo: 'find({ categoryId }).sort({ price: -1 }).limit(50)',
    firestore: { kind: 'native' },
  },
  [QUERIES.ordersByCustomer]: {
    id: QUERIES.ordersByCustomer,
    kind: 'simple',
    question: 'El historial de pedidos de un cliente, del más reciente al más viejo',
    sql: 'SELECT * FROM orders WHERE customerId = ? ORDER BY placedAt DESC LIMIT 50',
    mongo: 'find({ customerId }).sort({ placedAt: -1 }).limit(50)',
    firestore: { kind: 'native' },
  },
  [QUERIES.ordersByStatusInRange]: {
    id: QUERIES.ordersByStatusInRange,
    kind: 'simple',
    question: 'Pedidos en un estado dentro de una ventana de fechas',
    sql: 'SELECT * FROM orders WHERE status = ? AND placedAt BETWEEN ? AND ? ORDER BY placedAt DESC LIMIT 50',
    mongo: 'find({ status, placedAt: { $gte, $lt } }).sort({ placedAt: -1 }).limit(50)',
    firestore: { kind: 'native' },
  },
  [QUERIES.customersBySegment]: {
    id: QUERIES.customersBySegment,
    kind: 'simple',
    question: 'Clientes de un segmento en un país',
    sql: 'SELECT * FROM customers WHERE segment = ? AND country = ? LIMIT 50',
    mongo: 'find({ segment, country }).limit(50)',
    firestore: { kind: 'native' },
  },
  [QUERIES.reviewsByProductRated]: {
    id: QUERIES.reviewsByProductRated,
    kind: 'simple',
    question: 'Reseñas de un producto con calificación por encima de un umbral',
    sql: 'SELECT * FROM reviews WHERE productId = ? AND rating >= ? ORDER BY rating DESC LIMIT 50',
    mongo: 'find({ productId, rating: { $gte } }).sort({ rating: -1 }).limit(50)',
    firestore: { kind: 'native' },
  },

  [QUERIES.revenueByCategoryHaving]: {
    id: QUERIES.revenueByCategoryHaving,
    kind: 'complex',
    question: 'Categorías cuya facturación total supera un umbral',
    sql: 'SELECT categoryId, SUM(lineTotal) AS revenue FROM orderItems GROUP BY categoryId HAVING SUM(lineTotal) > ? ORDER BY revenue DESC',
    mongo: '$group por categoryId con $sum, luego $match sobre el acumulado',
    firestore: { kind: 'aggregation-per-group', groupField: 'categoryId' },
  },
  [QUERIES.avgTicketByCategoryHaving]: {
    id: QUERIES.avgTicketByCategoryHaving,
    kind: 'complex',
    question: 'Categorías con ticket promedio alto teniendo más de N líneas',
    sql: 'SELECT categoryId, AVG(lineTotal) AS ticket, COUNT(*) AS n FROM orderItems GROUP BY categoryId HAVING COUNT(*) > ? AND AVG(lineTotal) > ? ORDER BY ticket DESC',
    mongo: '$group con $avg y $sum:1, luego $match sobre las dos condiciones',
    firestore: { kind: 'aggregation-per-group', groupField: 'categoryId' },
  },
  [QUERIES.ordersJoinPayments]: {
    id: QUERIES.ordersJoinPayments,
    kind: 'complex',
    question: 'Pedidos entregados y el cobro que les corresponde',
    sql: 'SELECT o.*, p.method, p.amount FROM orders o JOIN payments p ON p.orderId = o.id WHERE o.status = ? LIMIT 50',
    mongo: '$match, luego $lookup contra payments, en una sola ida al servidor',
    firestore: { kind: 'client-side-join', parent: 'orders', child: 'payments' },
  },
  [QUERIES.customersAboveAverageSpend]: {
    id: QUERIES.customersAboveAverageSpend,
    kind: 'complex',
    question: 'Clientes que gastaron más que el promedio general',
    sql: 'SELECT customerId, SUM(total) AS spend FROM orders GROUP BY customerId HAVING SUM(total) > (SELECT AVG(total) FROM orders)',
    mongo: '$facet calcula el promedio y los totales en una pasada, luego se comparan',
    firestore: { kind: 'two-pass-subquery', threshold: 'AVG(orders.total)' },
  },
  [QUERIES.productsRatedAboveAverage]: {
    id: QUERIES.productsRatedAboveAverage,
    kind: 'complex',
    question: 'Productos cuya calificación media supera la media global, con más de N reseñas',
    sql: 'SELECT p.id, AVG(r.rating) AS stars, COUNT(*) AS n FROM products p JOIN reviews r ON r.productId = p.id GROUP BY p.id HAVING COUNT(*) > ? AND AVG(r.rating) > (SELECT AVG(rating) FROM reviews)',
    mongo: '$lookup products→reviews, $group, y $facet para la media global',
    firestore: { kind: 'two-pass-subquery', threshold: 'AVG(reviews.rating)' },
  },
}

export const queriesOfKind = (kind: QueryKind): readonly QueryId[] =>
  QUERY_IDS.filter((id) => QUERY_SPECS[id].kind === kind)

/**
 * True when Firestore answers a query without emulation.
 *
 * The report needs this count front and centre: five of ten run natively, and
 * the other five only exist because we wrote the missing engine by hand.
 */
export const isNativeOnFirestore = (id: QueryId): boolean =>
  QUERY_SPECS[id].firestore.kind === 'native'
