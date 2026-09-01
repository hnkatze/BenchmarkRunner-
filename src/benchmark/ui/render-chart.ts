import { compareByOperation, type OperationResult } from '../domain'
import { COPY, chartLabel } from './copy'
import { formatMs } from './format'
import { ENGINE_DISPLAY, OPERATION_DISPLAY } from './labels'

const SVG_NS = 'http://www.w3.org/2000/svg'

const ROW_HEIGHT = 46
const BAR_HEIGHT = 13
const BAR_GAP = 5
const LABEL_WIDTH = 132
/** Room for the value label after each bar. Martian Mono runs wide, so this is generous. */
const RIGHT_PAD = 118
const TOP_PAD = 26

/** Used before the container has been measured, and as a hard floor on narrow screens. */
const FALLBACK_WIDTH = 680
const MIN_WIDTH = 420

const svgEl = <TName extends keyof SVGElementTagNameMap>(
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
 * Log scale, because a linear axis collapses a sub-millisecond bar to nothing
 * once a 200 ms bar shares the same axis.
 * @param value - latency in milliseconds
 * @param maxValue - largest latency across the chart
 * @returns normalized width in [0, 1]
 */
const logScale = (value: number, maxValue: number): number => {
  if (value <= 0 || maxValue <= 0) return 0
  const floor = Math.log10(0.1)
  const ceiling = Math.log10(Math.max(maxValue, 1))
  const position = (Math.log10(Math.max(value, 0.1)) - floor) / (ceiling - floor || 1)
  return Math.min(Math.max(position, 0.012), 1)
}

const emptyState = (): HTMLElement => {
  const message = document.createElement('p')
  message.className = 'py-10 text-center text-sm text-muted'
  message.textContent = COPY.chart.empty
  return message
}

/**
 * Draws one grouped bar row per operation, one bar per engine, scaled on p95.
 * @param host - container element, fully replaced
 * @param results - results collected so far, possibly partial
 * @param availableWidth - measured container width; the viewBox matches it so the
 *   drawing fills the space instead of being letterboxed by preserveAspectRatio
 */
export const renderChart = (
  host: HTMLElement,
  results: readonly OperationResult[],
  availableWidth = FALLBACK_WIDTH,
): void => {
  host.textContent = ''

  const comparisons = compareByOperation(results).filter((comparison) =>
    [...comparison.byEngine.values()].some((result) => result.summary.count > 0),
  )

  if (comparisons.length === 0) {
    host.append(emptyState())
    return
  }

  const maxValue = results.reduce((max, result) => Math.max(max, result.summary.p95Ms), 0)
  const width = Math.max(Math.round(availableWidth), MIN_WIDTH)
  const height = TOP_PAD + comparisons.length * ROW_HEIGHT + 12
  const plotWidth = width - LABEL_WIDTH - RIGHT_PAD

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: `${height}`,
    role: 'img',
    'aria-label': chartLabel(comparisons.length),
    class: 'max-w-full',
  })

  for (const tick of [0.1, 1, 10, 100, 1000]) {
    if (tick > maxValue * 1.4) continue
    const x = LABEL_WIDTH + logScale(tick, maxValue) * plotWidth

    svg.append(
      svgEl('line', {
        x1: `${x}`,
        y1: `${TOP_PAD - 12}`,
        x2: `${x}`,
        y2: `${height - 10}`,
        stroke: 'var(--border-subtle)',
        'stroke-width': '1',
        'stroke-dasharray': '2 4',
      }),
    )

    const tickLabel = svgEl('text', {
      x: `${x}`,
      y: `${TOP_PAD - 16}`,
      'text-anchor': 'middle',
      fill: 'var(--text-muted)',
      'font-size': '10',
      'font-family': 'var(--font-mono)',
    })
    tickLabel.textContent = tick < 1 ? `${tick}ms` : `${tick}ms`
    svg.append(tickLabel)
  }

  comparisons.forEach((comparison, rowIndex) => {
    const rowTop = TOP_PAD + rowIndex * ROW_HEIGHT
    const engines = [...comparison.byEngine.values()].filter((result) => result.summary.count > 0)

    const label = svgEl('text', {
      x: `${LABEL_WIDTH - 12}`,
      y: `${rowTop + (engines.length * (BAR_HEIGHT + BAR_GAP)) / 2 + 2}`,
      'text-anchor': 'end',
      fill: 'var(--text-secondary)',
      'font-size': '12',
      'font-family': 'var(--font-sans)',
    })
    label.textContent = OPERATION_DISPLAY[comparison.operation].label
    svg.append(label)

    engines.forEach((result, barIndex) => {
      const display = ENGINE_DISPLAY[result.engine]
      const y = rowTop + barIndex * (BAR_HEIGHT + BAR_GAP)
      const barWidth = logScale(result.summary.p95Ms, maxValue) * plotWidth

      svg.append(
        svgEl('rect', {
          x: `${LABEL_WIDTH}`,
          y: `${y}`,
          width: `${barWidth}`,
          height: `${BAR_HEIGHT}`,
          rx: '3',
          fill: `var(${display.colorVar})`,
        }),
      )

      const value = svgEl('text', {
        x: `${LABEL_WIDTH + barWidth + 8}`,
        y: `${y + BAR_HEIGHT - 2}`,
        fill: 'var(--text-secondary)',
        'font-size': '11',
        'font-family': 'var(--font-mono)',
      })
      value.textContent = formatMs(result.summary.p95Ms)
      svg.append(value)

      const title = svgEl('title', {})
      title.textContent = `${display.label} — ${OPERATION_DISPLAY[comparison.operation].label}: p95 ${formatMs(result.summary.p95Ms)}`
      svg.append(title)
    })
  })

  const caption = document.createElement('p')
  caption.className = 'mt-3 text-xs text-muted'
  caption.textContent = COPY.chart.caption

  host.append(svg, caption)
}
