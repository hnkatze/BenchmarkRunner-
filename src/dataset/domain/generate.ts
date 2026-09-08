/**
 * Deterministic dataset generator.
 *
 * The brief requires the records in both engines to be IDENTICAL. `Math.random`
 * cannot deliver that: two seeding runs would produce two different datasets
 * and every later comparison would be measuring the data, not the engine.
 *
 * So the generator is a pure function of an index. Document number 4,211 is
 * always the same document, on either engine, on any machine, today or in six
 * months. Re-seeding one side after a failure stays safe, and a partial seed
 * can be resumed from where it stopped without drifting.
 */

import {
  CUSTOMER_SEGMENTS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  SALES_CHANNELS,
  type Category,
  type Customer,
  type Order,
  type OrderItem,
  type Payment,
  type Product,
  type Review,
  type Supplier,
} from './collections.ts'

/**
 * Row counts per collection, sized by Firestore's Spark quota of 20,000 writes
 * per day and not by taste: the total leaves 2,000 writes of headroom for
 * retries, because a failed re-seed cannot be repeated until tomorrow.
 *
 * The fact table carries 61% of the rows because that is where the
 * `GROUP BY … HAVING` questions live.
 */
export const PAIRED_SCALE = {
  categories: 10,
  suppliers: 40,
  products: 150,
  customers: 900,
  orders: 3_500,
  orderItems: 11_000,
  payments: 700,
  reviews: 1_700,
} as const

/**
 * The scale demonstration, MongoDB only. Firestore cannot be matched here:
 * 1,000,000 ÷ 20,000 writes per day is 50 days. Measured on the M0 cluster,
 * this occupies roughly 101 MB of its 512 MB ceiling.
 */
export const SCALE_DEMO = {
  categories: 40,
  suppliers: 500,
  products: 5_000,
  customers: 50_000,
  orders: 200_000,
  orderItems: 600_000,
  payments: 44_460,
  reviews: 100_000,
} as const

export type DatasetScale = typeof PAIRED_SCALE

/** Total documents a scale will write. */
export const totalDocuments = (scale: DatasetScale): number =>
  Object.values(scale).reduce((sum, count) => sum + count, 0)

/* ── The generator's only source of variation ───────────────────────────────
   A 32-bit integer hash, not a seeded PRNG object: a PRNG carries state, so
   generating document 500 would depend on having generated 499 first, and
   resuming a partial seed would produce different data than a clean run.
   This is stateless — index in, value out — which is what makes resumption
   safe. Constants are Thomas Wang's well-known integer mix. */
const mix = (value: number): number => {
  let n = value | 0
  n = (n ^ 61) ^ (n >>> 16)
  n = n + (n << 3)
  n = n ^ (n >>> 4)
  n = Math.imul(n, 0x27d4eb2d)
  n = n ^ (n >>> 15)
  return n >>> 0
}

/** A stable pseudo-random integer in [0, bound) for a given index and salt. */
const pick = (index: number, salt: number, bound: number): number =>
  mix(index * 2654435761 + salt) % bound

/** A stable value in [0, 1) for a given index and salt. */
const unit = (index: number, salt: number): number => mix(index * 2654435761 + salt) / 4294967296

const pad = (value: number, width: number): string => String(value).padStart(width, '0')

/* Fixed vocabularies. Kept small and literal so the data is readable in both
   consoles — a reviewer has to be able to see that the two sides match. */
const CITIES = [
  'Tegucigalpa', 'San Pedro Sula', 'La Ceiba', 'Choluteca', 'Comayagua',
  'El Progreso', 'Danlí', 'Puerto Cortés',
] as const

const COUNTRIES = ['HN', 'GT', 'SV', 'NI', 'CR', 'PA', 'MX', 'US'] as const

const CATEGORY_NAMES = [
  'Electrónica', 'Hogar', 'Ropa', 'Deportes', 'Libros',
  'Juguetes', 'Alimentos', 'Belleza', 'Ferretería', 'Oficina',
  'Mascotas', 'Jardín', 'Automotriz', 'Salud', 'Música',
  'Fotografía', 'Bebés', 'Calzado', 'Joyería', 'Papelería',
] as const

/** 2024 in epoch milliseconds — a fixed window keeps date filters comparable. */
const WINDOW_START = Date.UTC(2024, 0, 1)
const WINDOW_MS = Date.UTC(2025, 0, 1) - WINDOW_START

const timestampAt = (index: number, salt: number): number =>
  WINDOW_START + Math.floor(unit(index, salt) * WINDOW_MS)

const money = (value: number): number => Math.round(value * 100) / 100

export const categoryAt = (index: number): Category => {
  const name = CATEGORY_NAMES[index % CATEGORY_NAMES.length] ?? 'Otros'
  return {
    id: `cat_${pad(index, 4)}`,
    name,
    slug: name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
  }
}

export const supplierAt = (index: number): Supplier => ({
  id: `sup_${pad(index, 6)}`,
  name: `Proveedor ${pad(index, 6)}`,
  country: COUNTRIES[pick(index, 11, COUNTRIES.length)] ?? 'HN',
  rating: money(1 + unit(index, 12) * 4),
})

export const productAt = (index: number, scale: DatasetScale): Product => ({
  id: `prd_${pad(index, 7)}`,
  categoryId: `cat_${pad(pick(index, 21, scale.categories), 4)}`,
  supplierId: `sup_${pad(pick(index, 22, scale.suppliers), 6)}`,
  name: `Producto ${pad(index, 7)}`,
  price: money(5 + unit(index, 23) * 995),
  stock: pick(index, 24, 500),
  active: pick(index, 25, 10) > 0,
})

export const customerAt = (index: number): Customer => ({
  id: `cus_${pad(index, 8)}`,
  name: `Cliente ${pad(index, 8)}`,
  email: `cliente${pad(index, 8)}@ejemplo.hn`,
  city: CITIES[pick(index, 31, CITIES.length)] ?? 'Tegucigalpa',
  country: COUNTRIES[pick(index, 32, COUNTRIES.length)] ?? 'HN',
  signedUpAt: timestampAt(index, 33),
  segment: CUSTOMER_SEGMENTS[pick(index, 34, CUSTOMER_SEGMENTS.length)] ?? 'retail',
})

export const orderAt = (index: number, scale: DatasetScale): Order => ({
  id: `ord_${pad(index, 9)}`,
  customerId: `cus_${pad(pick(index, 41, scale.customers), 8)}`,
  status: ORDER_STATUSES[pick(index, 42, ORDER_STATUSES.length)] ?? 'pending',
  total: money(20 + unit(index, 43) * 4980),
  currency: 'HNL',
  placedAt: timestampAt(index, 44),
  channel: SALES_CHANNELS[pick(index, 45, SALES_CHANNELS.length)] ?? 'web',
})

/**
 * The fact table. `categoryId` is denormalised onto the line on purpose: it is
 * the grouping key, and Firestore cannot join to reach it. Without it the
 * category questions would be unanswerable there at any price, which would
 * make the comparison vacuous instead of instructive.
 */
export const orderItemAt = (index: number, scale: DatasetScale): OrderItem => {
  const productIndex = pick(index, 51, scale.products)
  const quantity = 1 + pick(index, 52, 9)
  const unitPrice = money(5 + unit(index, 53) * 995)
  const discount = money(unit(index, 54) * 0.25)
  return {
    id: `itm_${pad(index, 9)}`,
    orderId: `ord_${pad(pick(index, 55, scale.orders), 9)}`,
    productId: `prd_${pad(productIndex, 7)}`,
    categoryId: `cat_${pad(pick(productIndex, 21, scale.categories), 4)}`,
    quantity,
    unitPrice,
    discount,
    lineTotal: money(quantity * unitPrice * (1 - discount)),
  }
}

export const paymentAt = (index: number, scale: DatasetScale): Payment => ({
  id: `pay_${pad(index, 8)}`,
  orderId: `ord_${pad(pick(index, 61, scale.orders), 9)}`,
  method: PAYMENT_METHODS[pick(index, 62, PAYMENT_METHODS.length)] ?? 'card',
  amount: money(20 + unit(index, 63) * 4980),
  paidAt: timestampAt(index, 64),
  settled: pick(index, 65, 10) > 1,
})

export const reviewAt = (index: number, scale: DatasetScale): Review => ({
  id: `rev_${pad(index, 8)}`,
  productId: `prd_${pad(pick(index, 71, scale.products), 7)}`,
  customerId: `cus_${pad(pick(index, 72, scale.customers), 8)}`,
  rating: 1 + pick(index, 73, 5),
  helpful: pick(index, 74, 200),
  postedAt: timestampAt(index, 75),
})
