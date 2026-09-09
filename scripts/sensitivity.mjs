#!/usr/bin/env node
// Sensitivity sweeps: how each measurement moves when ONE parameter moves.
//
// A single latency table answers "how fast is it". It does not answer "how much
// do I trust this number", and that is what a sensitivity test is for: vary one
// input at a time, hold the rest, and see whether the reading is stable or the
// parameter dominates it.
//
// It drives the SAME endpoint the browser drives, so the numbers come from the
// production code path — not from a private copy of the measurement logic that
// could drift from it.
//
//   npm run dev            (in another terminal)
//   node scripts/sensitivity.mjs [--engine=mongodb] [--out=SENSIBILIDAD.json]

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, value = 'true'] = arg.replace(/^--/, '').split('=')
    return [key, value]
  }),
)

const ENGINE = args.get('engine') ?? 'mongodb'
const ENDPOINT = args.get('endpoint') ?? 'http://localhost:4321/api/benchmark'
const OUT = args.get('out') ?? 'sensibilidad.json'

const BASE = {
  engines: [ENGINE],
  operations: ['insertOne', 'findById'],
  queries: [],
  iterations: 30,
  warmupIterations: 5,
  documentSizeBytes: 1024,
  concurrency: 1,
}

/** Reads one SSE run to completion and returns its report. */
const runOnce = async (config) => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(config),
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let report = null
  let failed = null

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let separator = buffer.indexOf('\n\n')
    while (separator !== -1) {
      const raw = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const line = raw.split('\n').find((l) => l.startsWith('data: '))
      if (line !== undefined) {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'run-completed') report = event.report
        if (event.type === 'run-failed') failed = event.message
      }
      separator = buffer.indexOf('\n\n')
    }
  }

  if (failed !== null) throw new Error(failed)
  if (report === null) throw new Error('el stream terminó sin run-completed')
  return report
}

/** Throughput from the phase's wall clock, never from the inverse of the mean. */
const throughput = (result) =>
  result.wallClockMs > 0 ? (result.summary.count / result.wallClockMs) * 1000 : 0

const row = (label, report) =>
  report.results.map((result) => ({
    variante: label,
    operacion: result.operation,
    p50: Number(result.summary.p50Ms.toFixed(2)),
    p95: Number(result.summary.p95Ms.toFixed(2)),
    media: Number(result.summary.meanMs.toFixed(2)),
    max: Number(result.summary.maxMs.toFixed(2)),
    desviacion: Number(result.summary.stdDevMs.toFixed(2)),
    muestras: result.summary.count,
    errores: result.errorCount,
    // From the phase wall clock. summary.opsPerSecond is the inverse of the
    // mean, which DROPS as concurrency rises — the opposite of what a
    // concurrency sweep is asking.
    opsPorSegundo: Number(throughput(result).toFixed(2)),
    opsPorSegundoInverso: Number(result.summary.opsPerSecond.toFixed(2)),
  }))

const sweep = async (name, parameter, values, overrides = {}) => {
  console.log(`\n## ${name}`)
  const rows = []

  for (const value of values) {
    const config = { ...BASE, ...overrides, [parameter]: value }
    process.stdout.write(`  ${parameter}=${value} … `)
    try {
      const report = await runOnce(config)
      const collected = row(`${parameter}=${value}`, report)
      rows.push(...collected)
      console.log(
        collected
          .map((r) => `${r.operacion} p95 ${r.p95} ms · ${r.opsPorSegundo} op/s`)
          .join(' | '),
      )
    } catch (error) {
      console.log(`FALLA: ${error.message}`)
      rows.push({ variante: `${parameter}=${value}`, error: error.message })
    }
  }

  return { nombre: name, parametro: parameter, valores: values, filas: rows }
}

const main = async () => {
  console.log(`Motor: ${ENGINE}`)
  console.log(`Base : ${BASE.iterations} iteraciones, ${BASE.documentSizeBytes} B, concurrencia ${BASE.concurrency}`)

  const sweeps = []

  // Does parallelism buy throughput, and what does it cost in tail latency?
  sweeps.push(await sweep('Concurrencia', 'concurrency', [1, 2, 4, 8, 16]))

  // Does payload size dominate the reading, or is the round trip the cost?
  sweeps.push(await sweep('Tamaño del documento', 'documentSizeBytes', [256, 1024, 4096, 16384]))

  // How many samples before p95 stops moving? Below that, the tail is noise.
  sweeps.push(await sweep('Iteraciones', 'iterations', [10, 30, 100, 200]))

  const document = {
    motor: ENGINE,
    generado: new Date().toISOString(),
    base: BASE,
    barridos: sweeps,
  }

  const { writeFileSync } = await import('node:fs')
  writeFileSync(OUT, JSON.stringify(document, null, 2) + '\n')
  console.log(`\nEscrito ${OUT}\n`)
}

await main()
