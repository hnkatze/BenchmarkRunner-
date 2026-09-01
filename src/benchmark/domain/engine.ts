export const ENGINES = {
  firestore: 'firestore',
  mongodb: 'mongodb',
} as const

export type EngineId = (typeof ENGINES)[keyof typeof ENGINES]

export const ENGINE_IDS: readonly EngineId[] = [ENGINES.firestore, ENGINES.mongodb]

export const isEngineId = (value: unknown): value is EngineId =>
  typeof value === 'string' && (ENGINE_IDS as readonly string[]).includes(value)
