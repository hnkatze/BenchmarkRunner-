import type { EngineId } from '../domain'
import { COPY } from './copy'
import { ENGINE_DISPLAY } from './labels'

/**
 * The pieces every chart here is built from.
 *
 * They exist so the three charts share one set of marks. A second chart drawn
 * with its own gridline weight and its own swatch shape stops reading as the
 * same instrument, and the reader starts comparing the drawings instead of the
 * numbers.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg'

/** Used before the container has been measured, and as a hard floor when narrow. */
export const FALLBACK_WIDTH = 680
export const MIN_WIDTH = 420

export const svgEl = <TName extends keyof SVGElementTagNameMap>(
  name: TName,
  attributes: Readonly<Record<string, string>>,
): SVGElementTagNameMap[TName] => {
  const element = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value)
  }
  return element
}

/**
 * Wraps a mark so its `<title>` belongs to the mark and not to the whole chart.
 *
 * Appending a `<title>` straight to the `<svg>` names the entire drawing, so
 * every mark shares the last one written and hovering tells you nothing. The
 * tooltip has to hang off the element being pointed at.
 *
 * @param mark - the shape the pointer will land on
 * @param text - what to say about that one mark
 * @returns a group carrying both
 */
export const withTooltip = (mark: SVGElement, text: string): SVGGElement => {
  const group = svgEl('g', {})
  const title = svgEl('title', {})
  title.textContent = text
  group.append(title, mark)
  return group
}

/**
 * The engine legend. Not decoration: with the form on another step, this is the
 * only thing on screen that says which colour is which engine, and identity
 * must never rest on colour alone.
 *
 * @param engines - the engines actually drawn, in draw order
 */
export const engineLegend = (engines: readonly EngineId[]): HTMLElement => {
  const legend = document.createElement('ul')
  legend.className = 'flex flex-wrap items-center gap-x-6 gap-y-2'

  for (const engine of engines) {
    const display = ENGINE_DISPLAY[engine]
    const item = document.createElement('li')
    item.className = 'flex items-center gap-2 text-caption text-secondary'

    const swatch = document.createElement('span')
    swatch.className = 'inline-block size-2.5 shrink-0 rounded-pill'
    // The only place a series colour appears outside the plot. The label beside
    // it wears a text token, never the series colour.
    swatch.style.backgroundColor = `var(${display.colorVar})`

    const label = document.createElement('span')
    label.textContent = display.label

    item.append(swatch, label)
    legend.append(item)
  }

  return legend
}

export const emptyState = (message: string = COPY.chart.empty): HTMLElement => {
  const paragraph = document.createElement('p')
  paragraph.className = 'py-10 text-center text-sm text-muted'
  paragraph.textContent = message
  return paragraph
}

/**
 * Four round steps up to the maximum, so the eye can interpolate between them.
 * Shared, because two charts with different tick logic stop being comparable.
 * @param max - the largest value plotted
 * @param count - roughly how many steps to aim for
 */
export const bandTicks = (lo: number, hi: number, count = 4): readonly number[] => {
  const span = hi - lo
  if (span <= 0) return []

  const stepped = (divisor: number): readonly number[] => {
    const raw = span / divisor
    const magnitude = 10 ** Math.floor(Math.log10(raw))
    const step = [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= raw) ?? magnitude * 10
    const ticks: number[] = []
    for (let tick = Math.ceil(lo / step) * step; tick <= hi; tick += step) ticks.push(tick)
    return ticks
  }

  // A band that does not start at zero can land on a step that leaves one
  // gridline inside it, or none — and a single rule gives the reader nothing to
  // interpolate between. Halve the step until at least three ticks fall inside.
  let best = stepped(count)
  for (const divisor of [count * 2, count * 4, count * 8]) {
    if (best.length >= 3) break
    best = stepped(divisor)
  }
  return best
}

/** Ticks from zero up to the maximum, for a scale anchored at zero. */
export const niceTicks = (max: number, count = 4): readonly number[] => {
  if (max <= 0) return []
  const raw = max / count
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((n) => n * magnitude).find((n) => n >= raw) ?? magnitude * 10
  const ticks: number[] = []
  for (let tick = step; tick <= max * 1.02; tick += step) ticks.push(tick)
  return ticks
}

/**
 * Gridlines and axis text are recessive on purpose: the data is the figure.
 *
 * Solid, never dashed. A dashed rule reads as a projection or a threshold —
 * something the data is being measured AGAINST — and here it is only a grid.
 * Recessiveness comes from the hairline colour, not from breaking the line up.
 */
export const gridLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): SVGLineElement =>
  svgEl('line', {
    x1: `${x1}`,
    y1: `${y1}`,
    x2: `${x2}`,
    y2: `${y2}`,
    stroke: 'var(--color-hairline)',
    'stroke-width': '1',
  })

/**
 * Shortens a label that would otherwise be clipped by its gutter.
 *
 * Clipping the first characters of a row label is worse than shortening it: the
 * reader cannot tell that anything is missing. The full text stays in the mark's
 * tooltip and in the results table.
 *
 * @param text - the full label
 * @param max - how many characters fit in the gutter
 */
export const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

export const axisText = (
  x: number,
  y: number,
  anchor: 'start' | 'middle' | 'end',
): SVGTextElement =>
  svgEl('text', {
    x: `${x}`,
    y: `${y}`,
    'text-anchor': anchor,
    fill: 'var(--color-muted)',
    'font-size': '10',
    'font-family': 'var(--font-mono)',
  })
