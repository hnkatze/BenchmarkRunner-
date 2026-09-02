/**
 * Server-only environment access. Single seam: every server variable is read
 * here, so there is exactly one place that knows both lookup sources.
 */

/**
 * `import.meta.env` covers Astro's dev server, `process.env` covers the Vercel
 * runtime. A variable read through only one of them works in exactly one of the
 * two environments, which is the worst kind of bug to find.
 * @param name - variable name, never prefixed with PUBLIC_
 * @returns the value, or undefined when absent or empty
 */
export const readEnv = (name: string): string | undefined => {
  const fromAstro = import.meta.env[name]
  if (typeof fromAstro === 'string' && fromAstro.length > 0) return fromAstro
  const fromNode = process.env[name]
  return typeof fromNode === 'string' && fromNode.length > 0 ? fromNode : undefined
}

/**
 * Server-side ceiling on iterations per phase, independent of what the UI asks
 * for. Guards a free-tier quota against a stray request. Engine-agnostic: every
 * adapter applies it the same way.
 * @returns the configured ceiling, or 500 when unset or invalid
 */
export const maxIterations = (): number => {
  const raw = readEnv('BENCH_MAX_ITERATIONS')
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 500
}
