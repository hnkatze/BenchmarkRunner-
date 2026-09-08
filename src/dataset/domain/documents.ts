import { COLLECTIONS, type CollectionId, type SeedDocument } from './collections.ts'
import {
  categoryAt,
  customerAt,
  orderAt,
  orderItemAt,
  paymentAt,
  productAt,
  reviewAt,
  supplierAt,
  type DatasetScale,
} from './generate.ts'

/**
 * One factory per collection, keyed on the union so adding a ninth collection
 * fails to compile until it has a generator. Same total-table technique the
 * benchmark side uses for engines and operations.
 */
const FACTORIES: Readonly<
  Record<CollectionId, (index: number, scale: DatasetScale) => SeedDocument>
> = {
  [COLLECTIONS.categories]: (index) => categoryAt(index),
  [COLLECTIONS.suppliers]: (index) => supplierAt(index),
  [COLLECTIONS.products]: (index, scale) => productAt(index, scale),
  [COLLECTIONS.customers]: (index) => customerAt(index),
  [COLLECTIONS.orders]: (index, scale) => orderAt(index, scale),
  [COLLECTIONS.orderItems]: (index, scale) => orderItemAt(index, scale),
  [COLLECTIONS.payments]: (index, scale) => paymentAt(index, scale),
  [COLLECTIONS.reviews]: (index, scale) => reviewAt(index, scale),
}

/**
 * Yields a slice of a collection without materialising the whole thing.
 *
 * A generator, not an array: the scale demonstration writes 600,000 order
 * items, and building that array first would hold roughly 160 MB of objects in
 * memory before a single document reached the wire. Slicing by `from`/`count`
 * is also what makes a seed resumable — the caller asks for exactly the range
 * it has not written yet.
 *
 * @param collection - which collection to generate
 * @param scale - row counts, needed because foreign keys are drawn against them
 * @param from - zero-based index of the first document
 * @param count - how many to yield
 * @returns an iterable of documents, identical on every run
 */
export function* documentsFor(
  collection: CollectionId,
  scale: DatasetScale,
  from: number,
  count: number,
): Generator<SeedDocument> {
  const factory = FACTORIES[collection]
  for (let index = from; index < from + count; index += 1) {
    yield factory(index, scale)
  }
}
