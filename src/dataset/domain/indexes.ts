import { COLLECTIONS, type CollectionId } from './collections.ts'

/**
 * The indexes the ten queries need, declared once for both engines.
 *
 * Declaring them here rather than inside each adapter is the point: MongoDB
 * indexes only `_id` by default while Firestore indexes every single field on
 * its own, so if each side chose its own indexes the benchmark would be
 * measuring an indexing decision instead of an engine. Any query that filters
 * or sorts has to find equal conditions on both sides.
 */

export type IndexSpec = {
  readonly name: string
  /** Field to direction. 1 ascending, -1 descending. */
  readonly keys: Readonly<Record<string, 1 | -1>>
  /** Why it exists — a nameless index is an index nobody dares to delete. */
  readonly serves: string
  /**
   * Materialised in Firestore and deliberately NOT in MongoDB. An asymmetry,
   * not an oversight, and one of the study's results.
   *
   * MongoDB serves a descending sort by walking an ascending index backwards,
   * so a single index covers both directions. Firestore cannot, and demands a
   * separate composite per direction — and a filtered `sum()`/`average()`
   * needs the aggregated field ASCENDING even when the query never sorts by
   * it. The same ten questions therefore cost Firestore more indexes than
   * MongoDB. Building the redundant copies in MongoDB would inflate its index
   * size for plans that can never use them, and the storage comparison would
   * stop being honest.
   */
  readonly firestoreOnly?: true
}

export const INDEXES: Readonly<Record<CollectionId, readonly IndexSpec[]>> = {
  [COLLECTIONS.categories]: [],
  [COLLECTIONS.suppliers]: [
    { name: 'country_rating', keys: { country: 1, rating: -1 }, serves: 'proveedores mejor calificados por país' },
  ],
  [COLLECTIONS.products]: [
    { name: 'category_price', keys: { categoryId: 1, price: -1 }, serves: 'productos más caros por categoría' },
    { name: 'supplier', keys: { supplierId: 1 }, serves: 'unión con proveedores' },
  ],
  [COLLECTIONS.customers]: [
    { name: 'segment_country', keys: { segment: 1, country: 1 }, serves: 'agrupación por segmento' },
    { name: 'signedUpAt', keys: { signedUpAt: -1 }, serves: 'altas por rango de fecha' },
  ],
  [COLLECTIONS.orders]: [
    { name: 'customer_placedAt', keys: { customerId: 1, placedAt: -1 }, serves: 'historial de un cliente' },
    { name: 'status_placedAt', keys: { status: 1, placedAt: -1 }, serves: 'pedidos por estado y fecha' },
    { name: 'channel_total', keys: { channel: 1, total: -1 }, serves: 'ticket por canal' },
    // Firestore's filtered sum(total) demands its own ascending composite.
    // MongoDB answers the same question with a $facet over the whole
    // collection and never looks at this shape.
    {
      name: 'customer_total',
      keys: { customerId: 1, total: 1 },
      serves: 'la suma por cliente de la subconsulta emulada',
      firestoreOnly: true,
    },
  ],
  [COLLECTIONS.orderItems]: [
    { name: 'order', keys: { orderId: 1 }, serves: 'líneas de un pedido, unión con pedidos' },
    // ASCENDING, not descending: a filtered sum()/average() in Firestore needs
    // the aggregated field ascending, and no query sorts by lineTotal. A
    // descending declaration compiles, deploys, and then fails at query time.
    { name: 'category_lineTotal', keys: { categoryId: 1, lineTotal: 1 }, serves: 'la agrupación por categoría — el HAVING vive acá' },
    { name: 'product', keys: { productId: 1 }, serves: 'unión con productos' },
  ],
  [COLLECTIONS.payments]: [
    { name: 'order', keys: { orderId: 1 }, serves: 'unión con pedidos' },
    { name: 'method_settled', keys: { method: 1, settled: 1 }, serves: 'cobros por método' },
  ],
  [COLLECTIONS.reviews]: [
    { name: 'product_rating', keys: { productId: 1, rating: -1 }, serves: 'reseñas mejor calificadas de un producto' },
    {
      name: 'product_rating_asc',
      keys: { productId: 1, rating: 1 },
      serves: 'el promedio de calificación por producto',
      firestoreOnly: true,
    },
    { name: 'customer', keys: { customerId: 1 }, serves: 'reseñas de un cliente' },
  ],
}

/** Every index across every collection, flattened. */
export const allIndexes = (): readonly { collection: CollectionId; spec: IndexSpec }[] =>
  Object.entries(INDEXES).flatMap(([collection, specs]) =>
    specs.map((spec) => ({ collection: collection as CollectionId, spec })),
  )

/**
 * The indexes one engine actually materialises. The counts differ on purpose —
 * see `firestoreOnly` — so anything that creates, deploys or reports indexes
 * must go through here rather than through {@link allIndexes}.
 *
 * @param engine - which side is being built
 * @returns its indexes, flattened
 */
export const indexesForEngine = (
  engine: 'firestore' | 'mongodb',
): readonly { collection: CollectionId; spec: IndexSpec }[] =>
  allIndexes().filter(({ spec }) => engine === 'firestore' || spec.firestoreOnly !== true)

/* ── The asymmetry this file cannot hide ────────────────────────────────────
   MongoDB creates every one of these from the driver, and the time it takes is
   measurable — which is what the brief asks for.

   Firestore cannot. Single-field indexes are automatic and free of charge in
   effort, but COMPOSITE indexes are declared in `firestore.indexes.json` and
   deployed with the CLI; the Admin SDK has no API to create one. They also
   build asynchronously, so there is no client-side moment to time.

   So "how long does creating the indexes take" has an answer on one side and
   not on the other. `firestore-indexes.ts` emits the equivalent declaration
   from this same table, so at least the two sides stay in step. */
