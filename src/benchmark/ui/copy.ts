import type { BenchmarkConfig, ConfigViolation } from '../domain'

/** Keyed on BenchmarkConfig so a new field fails to compile until it is named here. */
const FIELD_LABELS: Readonly<Record<keyof BenchmarkConfig, string>> = {
  engines: 'Motores',
  operations: 'Operaciones',
  iterations: 'Iteraciones',
  warmupIterations: 'Calentamiento',
  documentSizeBytes: 'Tamaño del documento',
  concurrency: 'Concurrencia',
}

/**
 * Turns a domain violation code into user-facing Spanish. The domain stays
 * language-free; every wording decision lives here.
 * @param violation - a code emitted by `validateConfig`
 * @returns the sentence shown in the form's error list
 */
export const violationMessage = (violation: ConfigViolation): string => {
  const field = FIELD_LABELS[violation.field]

  switch (violation.code) {
    case 'empty-selection':
      return `${field}: selecciona al menos una opción.`
    case 'out-of-range':
      return `${field}: debe ser un número entero entre ${violation.min} y ${violation.max}.`
    default: {
      const unhandled: never = violation
      throw new Error('violación no contemplada: ' + JSON.stringify(unhandled))
    }
  }
}

export const COPY = {
  status: {
    idle: 'En espera. Configura una ejecución e iníciala.',
    preparing: 'preparando la siguiente fase',
    cancelled: 'Ejecución cancelada. Abajo quedan los resultados parciales.',
    noRunner: 'No hay ningún ejecutor conectado. Inyecta uno con setRunner().',
    unknownFailure: 'Fallo desconocido del ejecutor',
  },
  buttons: {
    run: 'Ejecutar benchmark',
    running: 'Ejecutando…',
  },
  table: {
    empty: 'Todavía no hay resultados. Inicia una ejecución para llenar esta tabla.',
    engine: 'Motor',
    mean: 'Media',
    max: 'Máx.',
    throughput: 'Rendimiento',
    errors: 'Errores',
  },
  transport: {
    noBody: 'La respuesta del servidor no trae cuerpo.',
    truncated: 'La conexión se cortó antes de terminar la ejecución.',
  },
  chart: {
    empty: 'La comparación p95 aparece aquí cuando termine la primera fase.',
    caption: 'Latencia p95, escala logarítmica. Más corto es mejor.',
  },
} as const

export const runningStatus = (where: string, done: number, total: number): string =>
  `Ejecutando ${where} — ${done} de ${total} muestras.`

export const finishedStatus = (seconds: string): string =>
  `Ejecución completada en ${seconds} s.`

export const failedStatus = (message: string): string => `La ejecución falló: ${message}`

export const fasterBadge = (engine: string, ratio: string): string =>
  `${engine} ${ratio} más rápido en p95`

export const tableCaption = (operation: string): string =>
  `Distribución de latencia por motor para ${operation}`

export const serverError = (status: number, detail: string): string =>
  detail.length > 0
    ? `El servidor respondió ${status} (${detail}).`
    : `El servidor respondió ${status}.`

export const chartLabel = (operations: number): string =>
  `Latencia p95 por operación y motor, escala logarítmica, ${operations} operaciones`
