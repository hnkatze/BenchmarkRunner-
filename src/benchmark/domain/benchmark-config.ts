import type { EngineId } from './engine'
import type { OperationId } from './operation'

export type BenchmarkConfig = {
  readonly engines: readonly EngineId[]
  readonly operations: readonly OperationId[]
  readonly iterations: number
  readonly warmupIterations: number
  readonly documentSizeBytes: number
  readonly concurrency: number
}

/**
 * Codes, not sentences: the domain states what is wrong, the UI decides the
 * wording and the language.
 */
export type ConfigViolation =
  | { readonly field: keyof BenchmarkConfig; readonly code: 'empty-selection' }
  | {
      readonly field: keyof BenchmarkConfig
      readonly code: 'out-of-range'
      readonly min: number
      readonly max: number
    }

export const CONFIG_LIMITS = {
  iterations: { min: 1, max: 10_000 },
  warmupIterations: { min: 0, max: 1_000 },
  documentSizeBytes: { min: 64, max: 1_048_576 },
  concurrency: { min: 1, max: 64 },
} as const

/**
 * Validation lives in the domain so every adapter rejects the same inputs.
 * @param config - candidate configuration, already parsed into numbers
 * @returns every violation found; an empty array means the config is runnable
 */
export const validateConfig = (config: BenchmarkConfig): readonly ConfigViolation[] => {
  const violations: ConfigViolation[] = []

  if (config.engines.length === 0) {
    violations.push({ field: 'engines', code: 'empty-selection' })
  }
  if (config.operations.length === 0) {
    violations.push({ field: 'operations', code: 'empty-selection' })
  }

  const numeric = [
    ['iterations', config.iterations, CONFIG_LIMITS.iterations],
    ['warmupIterations', config.warmupIterations, CONFIG_LIMITS.warmupIterations],
    ['documentSizeBytes', config.documentSizeBytes, CONFIG_LIMITS.documentSizeBytes],
    ['concurrency', config.concurrency, CONFIG_LIMITS.concurrency],
  ] as const

  for (const [field, value, limit] of numeric) {
    if (!Number.isInteger(value) || value < limit.min || value > limit.max) {
      violations.push({ field, code: 'out-of-range', min: limit.min, max: limit.max })
    }
  }

  return violations
}

export const DEFAULT_CONFIG: BenchmarkConfig = {
  engines: ['firestore', 'mongodb'],
  operations: ['insertOne', 'findById', 'queryFiltered', 'updateOne', 'deleteOne'],
  iterations: 200,
  warmupIterations: 20,
  documentSizeBytes: 1024,
  concurrency: 1,
}
