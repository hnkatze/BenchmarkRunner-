import type { EngineId } from '../domain/engine'
import type { OperationId } from '../domain/operation'

export type EngineDisplay = {
  readonly label: string
  readonly tagline: string
  readonly colorVar: string
}

export const ENGINE_DISPLAY: Readonly<Record<EngineId, EngineDisplay>> = {
  firestore: {
    label: 'Firestore',
    tagline: 'Base documental serverless, ida y vuelta HTTPS regional',
    colorVar: '--engine-firestore',
  },
  mongodb: {
    label: 'MongoDB',
    tagline: 'Autogestionado o Atlas, conexión con pool del driver',
    colorVar: '--engine-mongodb',
  },
}

export type OperationDisplay = {
  readonly label: string
  readonly description: string
}

export const OPERATION_DISPLAY: Readonly<Record<OperationId, OperationDisplay>> = {
  insertOne: { label: 'Insertar uno', description: 'Escritura de un documento' },
  insertMany: { label: 'Insertar varios', description: 'Lote de 100 documentos' },
  findById: { label: 'Buscar por id', description: 'Búsqueda por clave primaria' },
  queryFiltered: { label: 'Consulta filtrada', description: 'Filtro de rango indexado, límite 50' },
  updateOne: { label: 'Actualizar uno', description: 'Actualización parcial de campos' },
  deleteOne: { label: 'Eliminar uno', description: 'Borrado de un documento' },
  aggregate: { label: 'Agregación', description: 'Agrupar y contar sobre la colección' },
}
