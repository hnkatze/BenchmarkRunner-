import { QUERIES, QUERY_SPECS, type QueryId } from '../../dataset/domain/queries.ts'
import type { EngineId } from '../domain/engine'
import type { PhaseId } from '../domain/phase'
import type { IconName } from '../../ui/icons'

export type EngineDisplay = {
  readonly label: string
  readonly tagline: string
  readonly colorVar: string
  /** Brand mark, tinted with `colorVar` so identity and colour arrive together. */
  readonly icon: IconName
}

export const ENGINE_DISPLAY: Readonly<Record<EngineId, EngineDisplay>> = {
  firestore: {
    label: 'Firestore',
    tagline: 'Base documental serverless, ida y vuelta HTTPS regional',
    colorVar: '--color-firestore',
    icon: 'firebase',
  },
  mongodb: {
    label: 'MongoDB',
    tagline: 'Autogestionado o Atlas, conexión con pool del driver',
    colorVar: '--color-mongodb',
    icon: 'mongodb',
  },
}

export type PhaseDisplay = {
  readonly label: string
  readonly description: string
  /** Depicts the verb or the subject, never the engine — that has its own mark. */
  readonly icon: IconName
}

/**
 * Keyed on `PhaseId`, so adding either a CRUD operation or a query fails to
 * compile until it is named here. The two families share one table because the
 * results view treats them identically: both are just phases with latencies.
 */
export const PHASE_DISPLAY: Readonly<Record<PhaseId, PhaseDisplay>> = {
  insertOne: { label: 'Insertar uno', description: 'Escritura de un documento', icon: 'database-plus' },
  insertMany: { label: 'Insertar varios', description: 'Lote de 100 documentos', icon: 'layers-plus' },
  findById: { label: 'Buscar por id', description: 'Búsqueda por clave primaria', icon: 'key-round' },
  queryFiltered: { label: 'Consulta filtrada', description: 'Filtro de rango indexado, límite 50', icon: 'list-filter' },
  updateOne: { label: 'Actualizar uno', description: 'Actualización parcial de campos', icon: 'pencil-line' },
  deleteOne: { label: 'Eliminar uno', description: 'Borrado de un documento', icon: 'trash-2' },
  aggregate: { label: 'Agregación', description: 'Agrupar y contar sobre la colección', icon: 'sigma' },

  [QUERIES.productsByCategory]: {
    label: 'Productos por categoría',
    description: QUERY_SPECS.productsByCategory.question,
    icon: 'list-filter',
  },
  [QUERIES.ordersByCustomer]: {
    label: 'Pedidos de un cliente',
    description: QUERY_SPECS.ordersByCustomer.question,
    icon: 'user-round',
  },
  [QUERIES.ordersByStatusInRange]: {
    label: 'Pedidos por estado y fecha',
    description: QUERY_SPECS.ordersByStatusInRange.question,
    icon: 'calendar-range',
  },
  [QUERIES.customersBySegment]: {
    label: 'Clientes por segmento',
    description: QUERY_SPECS.customersBySegment.question,
    icon: 'users-round',
  },
  [QUERIES.reviewsByProductRated]: {
    label: 'Reseñas de un producto',
    description: QUERY_SPECS.reviewsByProductRated.question,
    icon: 'star',
  },
  [QUERIES.revenueByCategoryHaving]: {
    label: 'Facturación por categoría',
    description: QUERY_SPECS.revenueByCategoryHaving.question,
    icon: 'sigma',
  },
  [QUERIES.avgTicketByCategoryHaving]: {
    label: 'Ticket promedio por categoría',
    description: QUERY_SPECS.avgTicketByCategoryHaving.question,
    icon: 'chart-bar',
  },
  [QUERIES.ordersJoinPayments]: {
    label: 'Pedidos unidos a cobros',
    description: QUERY_SPECS.ordersJoinPayments.question,
    icon: 'git-merge',
  },
  [QUERIES.customersAboveAverageSpend]: {
    label: 'Clientes sobre el promedio',
    description: QUERY_SPECS.customersAboveAverageSpend.question,
    icon: 'trending-up',
  },
  [QUERIES.productsRatedAboveAverage]: {
    label: 'Productos mejor calificados',
    description: QUERY_SPECS.productsRatedAboveAverage.question,
    icon: 'award',
  },
}

/**
 * How Firestore answers a query, in one short phrase.
 *
 * The UI states this next to every complex query on purpose: a reader has to
 * see that five of the ten only run because the missing engine was written by
 * hand, and a number without that caveat would be a lie of omission.
 */
export const firestoreStrategyLabel = (query: QueryId): string => {
  const strategy = QUERY_SPECS[query].firestore
  switch (strategy.kind) {
    case 'native':
      return 'Nativa en ambos motores'
    case 'aggregation-per-group':
      return `Firestore: una agregación por cada ${strategy.groupField}`
    case 'client-side-join':
      return `Firestore: unión en el cliente, ${strategy.parent} → ${strategy.child}`
    case 'two-pass-subquery':
      return `Firestore: dos pasadas, primero ${strategy.threshold}`
    default: {
      const unhandled: never = strategy
      throw new Error('estrategia no contemplada: ' + JSON.stringify(unhandled))
    }
  }
}
