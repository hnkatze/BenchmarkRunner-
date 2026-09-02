/**
 * Caldera button recipes. Both shapes are pills (`rounded-button`, 800px):
 * the radius is what makes a button read as a button in this system, so it is
 * never traded for a smaller one. See DESIGN.md.
 */

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-abyssal-ink'

const SOLID_BASE =
  `rounded-button bg-accent font-medium text-accent-contrast transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`

const GHOST_BASE =
  `rounded-button border border-strong bg-transparent font-medium text-primary transition-colors hover:bg-abyssal-ink hover:text-pure-white ${FOCUS_RING}`

/** Pill padding. Caldera specifies 12/24 for the filled CTA. */
const PADDING = {
  sm: 'px-4 py-2 text-body-sm',
  md: 'px-6 py-3 text-body-sm',
} as const

export type ButtonSize = keyof typeof PADDING

/**
 * Primary call to action. Abyssal Ink fill, not Digital Orange — the orange
 * is reserved for Firestore's identity in the chart and legend.
 * @param size - padding scale; the rest of the recipe is identical
 * @returns the full class string, safe for the Tailwind scanner to see statically
 */
export const solidButton = (size: ButtonSize = 'md'): string =>
  `${SOLID_BASE} ${PADDING[size]}`

/**
 * Secondary action: ink outline that inverts on hover.
 * @param size - padding scale; the rest of the recipe is identical
 * @returns the full class string, safe for the Tailwind scanner to see statically
 */
export const ghostButton = (size: ButtonSize = 'md'): string =>
  `${GHOST_BASE} ${PADDING[size]}`
