/** Single seam for locale. es-HN keeps the dot as decimal separator, unlike es-ES. */
const LOCALE = 'es-HN'

const MS = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const SUB_MS = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
})

const COMPACT = new Intl.NumberFormat(LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const INTEGER = new Intl.NumberFormat(LOCALE)

/** No grouping: 23×, never 1,023×. */
const RATIO_FINE = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: false,
})

const RATIO_COARSE = new Intl.NumberFormat(LOCALE, {
  maximumFractionDigits: 0,
  useGrouping: false,
})

/**
 * Sub-millisecond values need 3 decimals to mean anything. Both branches go
 * through Intl so a locale change cannot split the separator across a column.
 */
export const formatMs = (value: number): string =>
  value < 1 ? `${SUB_MS.format(value)} ms` : `${MS.format(value)} ms`

export const formatOps = (value: number): string => `${COMPACT.format(value)} op/s`

export const formatCount = (value: number): string => INTEGER.format(value)

/**
 * Ratio phrased as a multiplier against the slower side.
 * @param fastMs - the lower latency
 * @param slowMs - the higher latency
 * @returns a formatted multiplier, or null when either side is zero
 */
export const formatSpeedup = (fastMs: number, slowMs: number): string | null => {
  if (fastMs <= 0 || slowMs <= 0) return null
  const ratio = slowMs / fastMs
  // Past 10x the decimal is false precision, so it is dropped.
  return ratio < 1.05 ? null : `${(ratio < 10 ? RATIO_FINE : RATIO_COARSE).format(ratio)}×`
}
