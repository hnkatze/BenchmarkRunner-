export const OPERATIONS = {
  insertOne: 'insertOne',
  insertMany: 'insertMany',
  findById: 'findById',
  queryFiltered: 'queryFiltered',
  updateOne: 'updateOne',
  deleteOne: 'deleteOne',
  aggregate: 'aggregate',
} as const

export type OperationId = (typeof OPERATIONS)[keyof typeof OPERATIONS]

export const OPERATION_IDS: readonly OperationId[] = [
  OPERATIONS.insertOne,
  OPERATIONS.insertMany,
  OPERATIONS.findById,
  OPERATIONS.queryFiltered,
  OPERATIONS.updateOne,
  OPERATIONS.deleteOne,
  OPERATIONS.aggregate,
]

export const isOperationId = (value: unknown): value is OperationId =>
  typeof value === 'string' && (OPERATION_IDS as readonly string[]).includes(value)
