export { COLLECTIONS, COLLECTION_IDS, isCollectionId } from './collections.ts'
export {
  CUSTOMER_SEGMENTS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  SALES_CHANNELS,
} from './collections.ts'
export type {
  Category,
  CollectionId,
  Customer,
  CustomerSegment,
  DocumentOf,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  PaymentMethod,
  Product,
  Review,
  SalesChannel,
  SeedDocument,
  Supplier,
} from './collections.ts'

export {
  PAIRED_SCALE,
  SCALE_DEMO,
  categoryAt,
  customerAt,
  orderAt,
  orderItemAt,
  paymentAt,
  productAt,
  reviewAt,
  supplierAt,
  totalDocuments,
} from './generate.ts'
export type { DatasetScale } from './generate.ts'

export { documentsFor } from './documents.ts'

export { QUERIES, QUERY_IDS, QUERY_SPECS, isQueryId, isNativeOnFirestore, queriesOfKind } from './queries.ts'
export type { FirestoreStrategy, QueryId, QueryKind, QuerySpec } from './queries.ts'

export { INDEXES, allIndexes } from './indexes.ts'
export type { IndexSpec } from './indexes.ts'

export { seedThroughput } from './seed-port.ts'
export type {
  CollectionSeedResult,
  DatasetSeeder,
  SeedEvent,
  SeedPlan,
  SeedReport,
} from './seed-port.ts'
