import type { EngineId, PhaseId, SamplePoint } from '../domain'
import { COPY } from './copy'
import { formatMs } from './format'
import { ENGINE_DISPLAY, PHASE_DISPLAY } from './labels'
import {
  FALLBACK_WIDTH,
  MIN_WIDTH,
  axisText,
  emptyState,
  engineLegend,
  gridLine,
  bandTicks,
  svgEl,
  withTooltip,
} from './chart-primitives'

/**
 * Latency sample by sample, one line per engine, for a single phase.
 *
 * This is the chart the percentiles cannot draw. A p95 of 55 ms is the same
 * number whether every sample sat at 55 or whether forty sat at 50 and one hit
 * 800 — and those are different databases to live with. A warm-up ramp, a
 * drift, a lone spike: all of them are invisible in a summary and obvious in a
 * line.
 *
 * The y axis is always linear here, and fitted to the data rather than anchored
 * at zero — see the band comment below for why that is honest for a line and
 * would not be for a bar.
 */

const LEFT_PAD = 56
const RIGHT_PAD = 14
const TOP_PAD = 16
const BOTTOM_PAD = 28
const PLOT_HEIGHT = 220

/** Markers stop helping once the points crowd each other. */
const MARKER_LIMIT = 40

type Series = { readonly engine: EngineId; readonly points: readonly SamplePoint[] }

/** Groups the phase's samples by engine, each ordered by iteration. */
const seriesFor = (
  samples: readonly SamplePoint[],
  operation: PhaseId,
): readonly Series[] => {
  const byEngine = new Map<EngineId, SamplePoint[]>()
  for (const sample of samples) {
    if (sample.operation !== operation) continue
    const bucket = byEngine.get(sample.engine)
    if (bucket === undefined) byEngine.set(sample.engine, [sample])
    else bucket.push(sample)
  }

  return [...byEngine.entries()].map(([engine, points]) => ({
    engine,
    points: [...points].sort((a, b) => a.index - b.index),
  }))
}

/**
 * @param host - container element, fully replaced
 * @param samples - every sample of the run; only the chosen phase is drawn
 * @param operation - which phase to plot
 * @param availableWidth - measured container width
 */
export const renderSamplesChart = (
  host: HTMLElement,
  samples: readonly SamplePoint[],
  operation: PhaseId | null,
  availableWidth = FALLBACK_WIDTH,
): void => {
  host.textContent = ''

  if (operation === null) {
    host.append(emptyState(COPY.chart.samplesEmpty))
    return
  }

  const series = seriesFor(samples, operation).filter((one) => one.points.length > 0)
  if (series.length === 0) {
    host.append(emptyState(COPY.chart.samplesEmpty))
    return
  }

  const width = Math.max(Math.round(availableWidth), MIN_WIDTH)
  const height = TOP_PAD + PLOT_HEIGHT + BOTTOM_PAD
  const plotWidth = width - LEFT_PAD - RIGHT_PAD

  const maxIndex = series.reduce(
    (max, one) => Math.max(max, ...one.points.map((point) => point.index)),
    0,
  )
  const maxMs = series.reduce(
    (max, one) => Math.max(max, ...one.points.map((point) => point.durationMs)),
    0,
  )
  const minMs = series.reduce(
    (min, one) => Math.min(min, ...one.points.map((point) => point.durationMs)),
    Number.POSITIVE_INFINITY,
  )

  // The band is fitted to the data, not anchored at zero.
  //
  // A bar must start at zero because its LENGTH encodes the value. A line does
  // not encode magnitude by length — it encodes change by shape, and that is
  // precisely the question here. Anchored at zero, a steady 52–57 ms phase and
  // one that spiked draw the same flat line in the top fifth of an empty plot.
  // The axis labels state the real range, so nothing is hidden.
  const spread = Math.max(maxMs - minMs, maxMs * 0.05)
  const lo = Math.max(0, minMs - spread * 0.35)
  const hi = maxMs + spread * 0.35

  const x = (index: number): number =>
    LEFT_PAD + (maxIndex === 0 ? 0 : (index / maxIndex) * plotWidth)
  const y = (ms: number): number =>
    TOP_PAD + PLOT_HEIGHT - (hi === lo ? PLOT_HEIGHT / 2 : ((ms - lo) / (hi - lo)) * PLOT_HEIGHT)

  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    height: `${height}`,
    role: 'img',
    'aria-label': COPY.chart.samplesLabel,
    class: 'max-w-full',
  })

  for (const tick of bandTicks(lo, hi)) {
    const ty = y(tick)
    svg.append(gridLine(LEFT_PAD, ty, width - RIGHT_PAD, ty))
    const label = axisText(LEFT_PAD - 8, ty + 3, 'end')
    label.textContent = formatMs(tick)
    svg.append(label)
  }

  // Iteration axis: first and last only. A tick per sample would be noise.
  const first = axisText(LEFT_PAD, height - 8, 'start')
  first.textContent = '#0'
  const last = axisText(width - RIGHT_PAD, height - 8, 'end')
  last.textContent = `#${maxIndex}`
  svg.append(first, last)

  for (const one of series) {
    const display = ENGINE_DISPLAY[one.engine]
    const stroke = `var(${display.colorVar})`

    svg.append(
      svgEl('polyline', {
        points: one.points.map((point) => `${x(point.index)},${y(point.durationMs)}`).join(' '),
        fill: 'none',
        stroke,
        'stroke-width': '2',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
    )

    if (one.points.length > MARKER_LIMIT) continue

    for (const point of one.points) {
      const marker = svgEl('circle', {
        cx: `${x(point.index)}`,
        cy: `${y(point.durationMs)}`,
        r: '4',
        fill: stroke,
        // A 2px ring in the surface colour keeps overlapping markers readable.
        stroke: 'var(--color-surface)',
        'stroke-width': '2',
      })
      svg.append(
        withTooltip(
          marker,
          `${display.label} · muestra #${point.index}: ${formatMs(point.durationMs)}`,
        ),
      )
    }
  }

  // Dense series get their tooltip from an invisible band per iteration, so the
  // hit target is a column of the plot rather than a 2px line.
  if (series.some((one) => one.points.length > MARKER_LIMIT)) {
    const bandWidth = maxIndex === 0 ? plotWidth : plotWidth / (maxIndex + 1)
    for (let index = 0; index <= maxIndex; index += 1) {
      const readings = series
        .map((one) => {
          const point = one.points.find((candidate) => candidate.index === index)
          return point === undefined
            ? null
            : `${ENGINE_DISPLAY[one.engine].label} ${formatMs(point.durationMs)}`
        })
        .filter((text): text is string => text !== null)

      if (readings.length === 0) continue

      const band = svgEl('rect', {
        x: `${x(index) - bandWidth / 2}`,
        y: `${TOP_PAD}`,
        width: `${Math.max(bandWidth, 1)}`,
        height: `${PLOT_HEIGHT}`,
        fill: 'transparent',
      })
      svg.append(withTooltip(band, `Muestra #${index} — ${readings.join(' · ')}`))
    }
  }

  const footer = document.createElement('div')
  footer.className = 'mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3'
  footer.append(engineLegend(series.map((one) => one.engine)))

  const caption = document.createElement('p')
  caption.className = 'text-xs text-muted'
  caption.textContent = COPY.chart.samplesCaption(PHASE_DISPLAY[operation].label)
  footer.append(caption)

  host.append(svg, footer)
}
