/**
 * Cursor button recipes. Both shapes are 8px rectangles (`rounded-button`) and
 * 40px tall — Cursor is a tight-radius system, and a pill here would read as a
 * different brand. See DESIGN.md.
 *
 * The filled action is INK, not the orange, even though Cursor's own
 * `button primary` is orange. The orange is Firestore's identity in the chart,
 * the table and the legend; an action wearing it would make the chart lie.
 * Cursor documents an ink-filled `button download`, so this is the system's
 * own component, not an invention.
 */

const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

const SOLID_BASE =
  `rounded-button bg-accent font-medium text-accent-contrast transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`

/* Cursor's `button secondary`: a white card surface with a hairline, not a
   transparent outline that inverts. */
const GHOST_BASE =
  `rounded-button border border-hairline-strong bg-surface font-medium text-primary transition-colors hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`

/** The reference specifies 10/18 at 40px tall, and 12/20 for the ink fill. */
const PADDING = {
  sm: 'px-4 py-2 text-button',
  md: 'px-5 py-2.5 text-button',
} as const

export type ButtonSize = keyof typeof PADDING

/**
 * Primary call to action. Ink fill on canvas text.
 * @param size - padding scale; the rest of the recipe is identical
 * @returns the full class string, safe for the Tailwind scanner to see statically
 */
export const solidButton = (size: ButtonSize = 'md'): string =>
  `${SOLID_BASE} ${PADDING[size]}`

/**
 * Secondary action: a card surface behind a hairline.
 * @param size - padding scale; the rest of the recipe is identical
 * @returns the full class string, safe for the Tailwind scanner to see statically
 */
export const ghostButton = (size: ButtonSize = 'md'): string =>
  `${GHOST_BASE} ${PADDING[size]}`

/* A segmented control, not a row of buttons: the options are mutually exclusive
   views of the same data, and a shared inset track says so before the labels do.
   Both states are complete literal strings — Tailwind's scanner reads source
   text, so a class assembled by interpolation at runtime is never generated. */
const SEGMENT_BASE =
  `rounded-button px-4 py-1.5 text-button font-medium transition-colors ${FOCUS_RING}`

/**
 * One option of a segmented control.
 * @param active - whether this option is the one currently shown
 * @returns the full class string
 */
export const segmentButton = (active: boolean): string =>
  active
    ? `${SEGMENT_BASE} bg-surface text-primary shadow-none`
    : `${SEGMENT_BASE} bg-transparent text-muted hover:text-primary`

/** The track the segments sit in. */
export const segmentTrack = 'inline-flex gap-1 rounded-button bg-inset p-1'
