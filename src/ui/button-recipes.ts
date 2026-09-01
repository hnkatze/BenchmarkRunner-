const GHOST_BASE =
  'rounded-lg border border-strong text-sm font-medium text-secondary transition-colors hover:bg-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const GHOST_PADDING = {
  sm: 'px-3 py-2',
  md: 'px-4 py-2.5',
} as const

export type GhostButtonSize = keyof typeof GHOST_PADDING

/**
 * Secondary action recipe shared by the theme toggle and the run cancel button.
 * @param size - padding scale; the rest of the recipe is identical
 * @returns the full class string, safe for the Tailwind scanner to see statically
 */
export const ghostButton = (size: GhostButtonSize = 'md'): string =>
  `${GHOST_BASE} ${GHOST_PADDING[size]}`
