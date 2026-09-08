/**
 * The eight collections both engines are seeded with, and the shape of every
 * document in them.
 *
 * One definition serves MongoDB and Firestore. The brief requires the records
 * to be IDENTICAL on both sides, and the only way to guarantee that is to have
 * a single source of truth that neither adapter is allowed to reinterpret.
 *
 * The model is a commerce domain on purpose: it produces natural
 * `GROUP BY … HAVING` questions without inventing any, and it carries five
 * real relations, which is what makes MongoDB's `$lookup` contrast against
 * Firestore's complete absence of joins.
 */

export const COLLECTIONS = {
  categories: 'categories',
  suppliers: 'suppliers',
  products: 'products',
  customers: 'customers',
  orders: 'orders',
  orderItems: 'orderItems',
  payments: 'payments',
  reviews: 'reviews',
} as const

export type CollectionId = (typeof COLLECTIONS)[keyof typeof COLLECTIONS]

export const COLLECTION_IDS: readonly CollectionId[] = [
  COLLECTIONS.categories,
  COLLECTIONS.suppliers,
  COLLECTIONS.products,
  COLLECTIONS.customers,
  COLLECTIONS.orders,
  COLLECTIONS.orderItems,
  COLLECTIONS.payments,
  COLLECTIONS.reviews,
]

export const isCollectionId = (value: unknown): value is CollectionId =>
  typeof value === 'string' && (COLLECTION_IDS as readonly string[]).includes(value)

/* ── Document shapes ────────────────────────────────────────────────────────
   Every document carries its own id as a field, not only as the primary key.
   MongoDB puts it in `_id` and Firestore in the document name, and neither
   round-trips it into the body — without the explicit field the two sides
   would stop being identical the moment you read them back. */

export type Category = {
  readonly id: string
  readonly name: string
  readonly slug: string
}

export type Supplier = {
  readonly id: string
  readonly name: string
  readonly country: string
  readonly rating: number
}

export type Product = {
  readonly id: string
  readonly categoryId: string
  readonly supplierId: string
  readonly name: string
  readonly price: number
  readonly stock: number
  readonly active: boolean
}

export type Customer = {
  readonly id: string
  readonly name: string
  readonly email: string
  readonly city: string
  readonly country: string
  /** Milliseconds since the epoch — a number, not a Date. See below. */
  readonly signedUpAt: number
  readonly segment: CustomerSegment
}

export type Order = {
  readonly id: string
  readonly customerId: string
  readonly status: OrderStatus
  readonly total: number
  readonly currency: string
  readonly placedAt: number
  readonly channel: SalesChannel
}

export type OrderItem = {
  readonly id: string
  readonly orderId: string
  readonly productId: string
  readonly categoryId: string
  readonly quantity: number
  readonly unitPrice: number
  readonly discount: number
  readonly lineTotal: number
}

export type Payment = {
  readonly id: string
  readonly orderId: string
  readonly method: PaymentMethod
  readonly amount: number
  readonly paidAt: number
  readonly settled: boolean
}

export type Review = {
  readonly id: string
  readonly productId: string
  readonly customerId: string
  readonly rating: number
  readonly helpful: number
  readonly postedAt: number
}

/* ── Enumerations ───────────────────────────────────────────────────────────
   Small, closed sets on purpose: they are the grouping keys, and Firestore can
   only emulate `GROUP BY` by issuing one aggregation query per group. A field
   with unbounded cardinality would make that emulation impossible, which is
   itself the finding — but the queries need at least one case that works. */

export const CUSTOMER_SEGMENTS = ['retail', 'wholesale', 'vip'] as const
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number]

export const ORDER_STATUSES = ['pending', 'paid', 'shipped', 'delivered', 'refunded'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const SALES_CHANNELS = ['web', 'mobile', 'store'] as const
export type SalesChannel = (typeof SALES_CHANNELS)[number]

export const PAYMENT_METHODS = ['card', 'transfer', 'cash', 'wallet'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

/** Maps each collection to the document type it holds. */
export type DocumentOf = {
  readonly categories: Category
  readonly suppliers: Supplier
  readonly products: Product
  readonly customers: Customer
  readonly orders: Order
  readonly orderItems: OrderItem
  readonly payments: Payment
  readonly reviews: Review
}

/**
 * Any seeded document. The union, not `unknown`: an adapter that receives one
 * of these still cannot invent a field the schema does not declare.
 */
export type SeedDocument = DocumentOf[CollectionId]

/* ── Timestamps are numbers, deliberately ───────────────────────────────────
   MongoDB stores a JS `Date` as BSON UTC datetime; Firestore stores it as its
   own `Timestamp`, which carries nanoseconds and reads back as a different
   object. Comparing them would compare two serialisations, not two engines,
   and the "identical records" requirement would quietly fail on read-back.
   Epoch milliseconds are the one representation both store byte-identically,
   and range filters and sorts work the same on either side. */
