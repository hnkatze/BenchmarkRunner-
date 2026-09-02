import type { EngineId } from '../domain/engine'
import type { OperationId } from '../domain/operation'
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

export type OperationDisplay = {
  readonly label: string
  readonly description: string
  /** Depicts the verb, never the engine — the engine has its own mark. */
  readonly icon: IconName
}

export const OPERATION_DISPLAY: Readonly<Record<OperationId, OperationDisplay>> = {
  insertOne: {
    label: 'Insertar uno',
    description: 'Escritura de un documento',
    icon: 'database-plus',
  },
  insertMany: {
    label: 'Insertar varios',
    description: 'Lote de 100 documentos',
    icon: 'layers-plus',
  },
  findById: {
    label: 'Buscar por id',
    description: 'Búsqueda por clave primaria',
    icon: 'key-round',
  },
  queryFiltered: {
    label: 'Consulta filtrada',
    description: 'Filtro de rango indexado, límite 50',
    icon: 'list-filter',
  },
  updateOne: {
    label: 'Actualizar uno',
    description: 'Actualización parcial de campos',
    icon: 'pencil-line',
  },
  deleteOne: {
    label: 'Eliminar uno',
    description: 'Borrado de un documento',
    icon: 'trash-2',
  },
  aggregate: {
    label: 'Agregación',
    description: 'Agrupar y contar sobre la colección',
    icon: 'sigma',
  },
}
