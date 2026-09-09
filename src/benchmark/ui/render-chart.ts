import {
  compareByOperation,
  throughputOpsPerSecond,
  type EngineId,
  type OperationResult,
} from '../domain'
import { COPY, GLOSSARY, chartLabel } from './copy'
import { infoTip } from '../../ui/info-tip'
import { formatMs, formatOps } from './format'
import { ENGINE_DISPLAY, PHASE_DISPLAY } from './labels'
import {
  FALLBACK_WIDTH,
  MIN_WIDTH,
  axisText,
  emptyState,
  engineLegend,
  gridLine,
  niceTicks,
  svgEl,
  truncate,
  withTooltip,
} from './chart-primitives'

const ROW_HEIGHT = 46
const BAR_HEIGHT = 13
const BAR_GAP = 5
const LABEL_WIDTH = 168
/** What fits in the gutter at 12px in the sans, with the 12px inset. */
const LABEL_CHARS = 22
/** Room for the value label after each bar. The mono runs wide, so this is generous. */
const RIGHT_PAD = 118
const TOP_PAD = 26

/**
 * Which measure the bars encode.
 *
 * They are separate charts and never share an axis. Latency and throughput
 * answer different questions and move in opposite directions as concurrency
 * rises — measured: concurrency 1→8 took throughput from 18,6 to 135,6 op/s
 * while p50 moved 1,2 %. Putting both on one plot with two scales would invite
 * exactly the comparison the numbers forbid.
 */
export type BarMeasure = 'p95' | 'throughput'

/** The span the bars have to encode. Both ends matter for choosing a scale. */
type Domain = { readonly min: number; readonly max: number }

type MeasureSpec = {
  readonly of: (result: OperationResult) => number
  readonly format: (value: number) => string
  readonly scale: (value: number, domain: Domain) => number
  readonly ticks: (domain: Domain) => readonly number[]
  readonly label: string
  /** Says which scale was actually used — the caption must not claim the wrong one. */
  readonly caption: (domain: Domain) => string
}

/**
 * A log axis earns its place only when the data really spans decades.
 *
 * The reason it exists here is the case where one engine costs ~2 ms and the
 * other ~200: on a linear axis the fast one is an invisible sliver. But every
 * number actually measured sits between 44 and 155 ms, because the network floor
 * dominates — and inside a single decade a log axis pins every bar to within a
 * few percent of the same length, which is the opposite of discriminating.
 * So the span decides, run by run.
 */
const spansDecades = ({ min, max }: Domain): boolean => min > 0 && max / min > 10

/**
 * Log scale, because a linear axis collapses a sub-millisecond bar to nothing
 * once a 200 ms bar shares the same axis.
 */
const logScale = (value: number, maxValue: number): number => {
  if (value <= 0 || maxValue <= 0) return 0
  const floor = Math.log10(0.1)
  const ceiling = Math.log10(Math.max(maxValue, 1))
  const position = (Math.log10(Math.max(value, 0.1)) - floor) / (ceiling - floor || 1)
  return Math.min(Math.max(position, 0.012), 1)
}

const linearScale = (value: number, maxValue: number): number =>
  maxValue <= 0 ? 0 : Math.min(Math.max(value / maxValue, 0.012), 1)

const MEASURES: Readonly<Record<BarMeasure, MeasureSpec>> = {
  p95: {
    of: (result) => result.summary.p95Ms,
    format: formatMs,
    scale: (value, domain) =>
      spansDecades(domain) ? logScale(value, domain.max) : linearScale(value, domain.max),
    ticks: (domain) =>
      spansDecades(domain)
        ? [0.1, 1, 10, 100, 1000].filter((tick) => tick <= domain.max * 1.4)
        : niceTicks(domain.max),
    label: 'p95',
    caption: (domain) => (spansDecades(domain) ? COPY.chart.caption : COPY.chart.captionLinear),
  },
  throughput: {
    of: throughputOpsPerSecond,
    format: formatOps,
    // Linear always: throughput has a real zero, and doubling it means twice
    // the work — a length the reader is entitled to compare directly.
    scale: (value, domain) => linearScale(value, domain.max),
    ticks: (domain) => niceTicks(domain.max),
    label: 'rendimiento',
    caption: () => COPY.chart.throughputCaption,
  },
}

/**
 * One grouped bar row per phase, one bar per engine.
 *
 * @param host - container element, fully replaced
 * @param results - results collected so far, possibly partial
 * @param availableWidth - measured container width; the viewBox matches it so the
 *   drawing fills the space instead of being letterboxed by preserveAspectRatio
 * @param measure - which question the bars answer
 */
export const renderChart = (
  host: HTMLElement,
  results: readonly OperationResult[],
  availableWidth = FALLBACK_WIDTH,
  measure: BarMeasure = 'p95',
): void => {
  host.textContent = ''

  const spec = MEASURES[measure]
  const comparisons = compareByOperation(results).filter((comparison) =>
    [...comparison.byEngine.values()].some((result) => result.summary.count > 0),
  )

  if (comparisons.length === 0) {
    host.append(emptyState())
    return
  }

  const values = comparisons.flatMap((comparison) =>
    [...comparison.byEngine.values()]
      .filter((result) => result.summary.count > 0)
      .map((result) => spec.of(result)),
  )
  const domain: Domain = {
    min: values.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY),
    max: values.reduce((max, value) => Math.max(max, value), 0),
  }
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

  for (const tick of spec.ticks(domain)) {
    const x = LABEL_WIDTH + spec.scale(tick, domain) * plotWidth
    svg.append(gridLine(x, TOP_PAD - 12, x, height - 10))

    const tickLabel = axisText(x, TOP_PAD - 16, 'middle')
    tickLabel.textContent = spec.format(tick)
    svg.append(tickLabel)
  }

  const drawn = new Set<EngineId>()

  comparisons.forEach((comparison, rowIndex) => {
    const rowTop = TOP_PAD + rowIndex * ROW_HEIGHT
    const engines = [...comparison.byEngine.values()].filter((result) => result.summary.count > 0)

    const full = PHASE_DISPLAY[comparison.operation].label
    const label = svgEl('text', {
      x: `${LABEL_WIDTH - 12}`,
      y: `${rowTop + (engines.length * (BAR_HEIGHT + BAR_GAP)) / 2 + 2}`,
      'text-anchor': 'end',
      fill: 'var(--color-secondary)',
      'font-size': '12',
      'font-family': 'var(--font-sans)',
    })
    // Shortened rather than clipped: an end-anchored label that overruns its
    // gutter loses its FIRST characters, and nothing on screen says so.
    label.textContent = truncate(full, LABEL_CHARS)
    svg.append(withTooltip(label, full))

    engines.forEach((result, barIndex) => {
      const display = ENGINE_DISPLAY[result.engine]
      drawn.add(result.engine)

      const value = spec.of(result)
      const y = rowTop + barIndex * (BAR_HEIGHT + BAR_GAP)
      const barWidth = spec.scale(value, domain) * plotWidth

      const bar = svgEl('rect', {
        x: `${LABEL_WIDTH}`,
        y: `${y}`,
        width: `${barWidth}`,
        height: `${BAR_HEIGHT}`,
        rx: '3',
        fill: `var(${display.colorVar})`,
      })

      // On the group, not on the svg: a title on the root names the whole
      // drawing, so every bar would share the last one written.
      svg.append(
        withTooltip(
          bar,
          `${display.label} — ${PHASE_DISPLAY[comparison.operation].label}: ${spec.label} ${spec.format(value)}`,
        ),
      )

      const valueLabel = svgEl('text', {
        x: `${LABEL_WIDTH + barWidth + 8}`,
        y: `${y + BAR_HEIGHT - 2}`,
        fill: 'var(--color-secondary)',
        'font-size': '11',
        'font-family': 'var(--font-mono)',
      })
      valueLabel.textContent = spec.format(value)
      svg.append(valueLabel)
    })
  })

  const footer = document.createElement('div')
  footer.className = 'mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3'
  footer.append(engineLegend([...drawn]))

  const caption = document.createElement('p')
  caption.className = 'flex items-center gap-1.5 text-xs text-muted'
  // Appended, never assigned: textContent on this node would wipe the tooltip.
  caption.append(document.createTextNode(spec.caption(domain)))

  if (measure === 'p95' && spansDecades(domain)) {
    const scaleTip = document.createElement('span')
    scaleTip.className = 'inline-flex'
    scaleTip.innerHTML = infoTip({
      id: 'tip-chart-logScale',
      term: GLOSSARY.logScale.term,
      definition: GLOSSARY.logScale.definition,
    })
    caption.append(scaleTip)
  }

  footer.append(caption)
  host.append(svg, footer)
}
