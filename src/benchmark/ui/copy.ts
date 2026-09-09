import type { BenchmarkConfig, ConfigViolation } from '../domain'

/** Keyed on BenchmarkConfig so a new field fails to compile until it is named here. */
const FIELD_LABELS: Readonly<Record<keyof BenchmarkConfig, string>> = {
  engines: 'Motores',
  operations: 'Operaciones',
  queries: 'Consultas',
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
    captionLinear: 'Latencia p95, escala lineal desde cero. Más corto es mejor.',
    throughputCaption:
      'Operaciones por segundo, del reloj de pared de la fase. Más largo es mejor.',
    samplesEmpty: 'Elegí una fase con muestras para ver su latencia una por una.',
    samplesLabel: 'Latencia por muestra y motor a lo largo de las iteraciones',
    samplesCaption: (phase: string): string =>
      `Latencia muestra a muestra en ${phase}, escala lineal. Un p95 no distingue una fase pareja de una con un pico.`,
  },
  /* Las tres preguntas que los datos contestan, y que NO comparten eje: latencia
     y rendimiento se mueven en direcciones opuestas al subir la concurrencia. */
  charts: {
    p95: 'Latencia p95',
    samples: 'Muestra a muestra',
    throughput: 'Rendimiento',
    phaseLabel: 'Fase',
  },
  steps: {
    configure: 'Configurar',
    analyze: 'Resultados',
    edit: 'Cambiar parámetros',
    back: 'Volver a los resultados',
  },
} as const

export const runningStatus = (
  where: string,
  attempted: number,
  total: number,
  failed: number,
): string =>
  failed === 0
    ? `Ejecutando ${where} — ${attempted} de ${total} muestras.`
    : `Ejecutando ${where} — ${attempted} de ${total} muestras, ${failed} con error.`

/**
 * Shown while the run is still going. A phase whose every sample fails would
 * otherwise reach the results table as a row of dashes with no explanation.
 * The reason comes from the engine, so it stays in its own language.
 */
export const sampleFailureNotice = (failed: number, reason: string): string =>
  `${failed} ${failed === 1 ? 'muestra ha fallado' : 'muestras han fallado'}. Última causa: ${reason}`

/**
 * A phase abandoned before producing a result. It never reaches the results
 * table — there are no percentiles to show — so this notice is the only place
 * the user ever learns it existed.
 */
export const phaseFailureNotice = (where: string, reason: string): string =>
  `Fase abandonada — ${where}: ${reason}`

/* ── Índices de Firestore ───────────────────────────────────────────────────
   Los índices viven en el PROYECTO, no en el repositorio: apuntar la app a un
   proyecto nuevo —que es un `.env` de distancia— los deja en cero, y siete de
   las diez consultas fallan hasta reconstruirlos. */

export const INDEX_COPY = {
  title: 'Índices de Firestore',
  explainer:
    'Firestore indexa cada campo por su cuenta, pero solo de a uno. Los compuestos —los que hacen falta al combinar campos u ordenar por uno que no se filtra— no son automáticos, y sin ellos siete de las diez consultas fallan.',
  idle: 'Sin consultar.',
  checking: 'Consultando…',
  creating: 'Creando los que faltan…',
  check: 'Revisar',
  create: 'Crear los que faltan',
  unreachable: 'No se pudo consultar la API de Firestore.',
  notConfigured: 'Faltan credenciales de Firestore en el servidor.',
  denied:
    'Sin permiso para crear índices. El rol por defecto del service account no lo incluye: hay que darle roles/datastore.indexAdmin en IAM.',
  building: 'Se construyen en segundo plano. Hasta que terminen, una consulta falla igual que sin índice.',
} as const

export const INDEX_STATE_LABEL = {
  ready: 'listo',
  building: 'armando',
  missing: 'falta',
  created: 'creado',
  denied: 'sin permiso',
  error: 'error',
} as const

/** The configuration that produced what is on screen, in one line. */
export const runSummary = (engines: number, phases: number, iterations: number): string =>
  `${engines} ${engines === 1 ? 'motor' : 'motores'} · ${phases} ${phases === 1 ? 'fase' : 'fases'} · ${iterations} iteraciones`

export const indexSummary = (ready: number, total: number, missing: number): string =>
  missing === 0
    ? `${ready} de ${total} índices listos.`
    : `${ready} de ${total} listos · faltan ${missing}.`

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

/* ── Glossary ───────────────────────────────────────────────────────────────
   One wording per term, reused by the table tooltips, the form tooltips and
   the project write-up. A metric explained twice drifts into two meanings. */

export type GlossaryTermId =
  | 'latency'
  | 'p50'
  | 'p95'
  | 'p99'
  | 'mean'
  | 'max'
  | 'throughput'
  | 'errors'
  | 'iterations'
  | 'warmup'
  | 'documentSize'
  | 'concurrency'
  | 'logScale'

export type GlossaryEntry = {
  /** Heading of the tooltip; may read fuller than the column label. */
  readonly term: string
  /** One or two sentences. Longer than that stops being a tooltip. */
  readonly definition: string
}

/** Keyed on the union so a new term fails to compile until it is defined. */
export const GLOSSARY: Readonly<Record<GlossaryTermId, GlossaryEntry>> = {
  latency: {
    term: 'Latencia',
    definition:
      'Tiempo entre pedir la operación y recibir su confirmación, medido en el servidor. Incluye el viaje de red hasta la base, no solo el trabajo del motor.',
  },
  p50: {
    term: 'p50 · mediana',
    definition:
      'La mitad de las muestras tardó menos que este valor. Describe la ejecución típica, no la peor.',
  },
  p95: {
    term: 'p95',
    definition:
      'El 95 % de las muestras tardó menos que este valor. Es la cola que el usuario percibe como lentitud, y por eso el ganador de cada operación se decide aquí y no por la media.',
  },
  p99: {
    term: 'p99',
    definition:
      'El 1 % más lento. Con pocas muestras es muy inestable: un solo pico lo mueve entero.',
  },
  mean: {
    term: 'Media',
    definition:
      'Promedio de todas las muestras. Una sola muestra extrema la arrastra hacia arriba, así que puede esconder una cola mala tanto como inventarla.',
  },
  max: {
    term: 'Máximo',
    definition:
      'La muestra más lenta de la fase. Dice hasta dónde llegó el peor caso; como es un único dato, no sirve para comparar motores.',
  },
  throughput: {
    term: 'Rendimiento',
    definition:
      'Operaciones completadas por segundo sobre el tiempo real de la fase. No es la inversa de la media: al subir la concurrencia cada operación tarda más y el rendimiento sube igual.',
  },
  errors: {
    term: 'Errores',
    definition:
      'Operaciones que fallaron. No entran en los percentiles, así que las columnas de latencia describen únicamente lo que sí llegó a completarse.',
  },
  iterations: {
    term: 'Iteraciones',
    definition:
      'Muestras medidas por cada motor y cada operación. Cuantas más, más confiable es la cola: con diez muestras el p95 es poco más que una anécdota.',
  },
  warmup: {
    term: 'Calentamiento',
    definition:
      'Operaciones que se ejecutan y se descartan antes de empezar a medir, para que abrir la conexión y llenar cachés no se cuele en los números.',
  },
  documentSize: {
    term: 'Tamaño del documento',
    definition:
      'Bytes aproximados del documento de prueba. Cuanto más crece, más pesan la red y la serialización frente al motor.',
  },
  concurrency: {
    term: 'Concurrencia',
    definition:
      'Operaciones en vuelo al mismo tiempo. Con 1 se mide latencia pura; al subir, cada operación tarda más pero el trabajo total por segundo crece.',
  },
  logScale: {
    term: 'Escala logarítmica',
    definition:
      'Cada marca del eje multiplica por diez. En escala lineal, un motor de 2 ms al lado de uno de 200 ms sería una raya invisible.',
  },
}
