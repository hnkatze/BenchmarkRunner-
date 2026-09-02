import {
  compareByOperation,
  throughputOpsPerSecond,
  type EngineId,
  type OperationResult,
} from '../domain'
import { COPY, fasterBadge, tableCaption } from './copy'
import { formatCount, formatMs, formatOps, formatSpeedup } from './format'
import { icon } from '../../ui/icons'
import { ENGINE_DISPLAY, OPERATION_DISPLAY } from './labels'

const NUMERIC_CELL = 'px-2.5 py-2 text-right tnum font-mono text-xs text-primary'
const HEADER_CELL = 'px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-muted'

const cell = (className: string, text: string): HTMLTableCellElement => {
  const element = document.createElement('td')
  element.className = className
  element.textContent = text
  return element
}

const engineCell = (engine: EngineId): HTMLTableCellElement => {
  const display = ENGINE_DISPLAY[engine]
  const element = document.createElement('td')
  element.className = 'px-3 py-2 text-left text-body-sm font-medium text-primary'

  // The mark is tinted with the engine's own colour, so it replaces the dot
  // rather than sitting beside it: one glyph, both signals.
  const mark = document.createElement('span')
  mark.className = 'mr-2 inline-flex align-middle'
  mark.style.color = `var(${display.colorVar})`
  mark.innerHTML = icon(display.icon, 'size-4')

  element.append(mark, document.createTextNode(display.label))
  return element
}

const winnerBadge = (text: string): HTMLElement => {
  const badge = document.createElement('span')
  badge.className =
    'ml-2 rounded-button bg-pixel-glare px-3 py-1 text-[11px] font-semibold text-abyssal-ink'
  badge.textContent = text
  return badge
}

/**
 * The palette holds no red, so a non-zero error count is inverted ink instead
 * of coloured text: a black pill in a beige table is the loudest signal here.
 * @param count - errors recorded during the phase
 * @returns the cell, plain and muted at zero
 */
const errorCell = (count: number): HTMLTableCellElement => {
  const element = document.createElement('td')

  if (count === 0) {
    element.className = `${NUMERIC_CELL} text-muted`
    element.textContent = formatCount(count)
    return element
  }

  element.className = 'px-2.5 py-2 text-right'
  const pill = document.createElement('span')
  pill.className =
    'inline-flex items-center gap-1.5 rounded-button bg-abyssal-ink px-3 py-1 font-mono text-xs tnum text-pure-white'
  pill.innerHTML = icon('triangle-alert', 'size-3.5')
  pill.append(document.createTextNode(formatCount(count)))
  element.append(pill)
  return element
}

const emptyState = (): HTMLElement => {
  const wrapper = document.createElement('div')
  wrapper.className = 'grid justify-items-center gap-4 px-10 py-16 text-center'

  const glyph = document.createElement('span')
  glyph.className = 'inline-flex text-subtle'
  glyph.innerHTML = icon('table-2', 'size-12')

  const message = document.createElement('p')
  message.className = 'text-body-sm text-muted'
  message.textContent = COPY.table.empty

  wrapper.append(glyph, message)
  return wrapper
}

/**
 * Rebuilds the whole table on every event. At a few dozen rows this is cheaper
 * than diffing, and it keeps the DOM a pure function of the results array.
 * @param host - container element, fully replaced
 * @param results - results collected so far, possibly partial
 */
export const renderResults = (host: HTMLElement, results: readonly OperationResult[]): void => {
  host.textContent = ''

  if (results.length === 0) {
    host.append(emptyState())
    return
  }

  for (const comparison of compareByOperation(results)) {
    const display = OPERATION_DISPLAY[comparison.operation]

    const section = document.createElement('section')
    section.className = 'border-b border-subtle last:border-b-0'

    const heading = document.createElement('h3')
    heading.className = 'flex flex-wrap items-baseline gap-x-2 px-10 pt-8 text-body font-semibold text-primary'
    heading.append(document.createTextNode(display.label))

    const hint = document.createElement('span')
    hint.className = 'text-xs font-normal text-muted'
    hint.textContent = display.description
    heading.append(hint)

    const rows = [...comparison.byEngine.values()]
    const sorted = [...rows].sort((a, b) => a.summary.p95Ms - b.summary.p95Ms)
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]

    if (comparison.winner !== null && best !== undefined && worst !== undefined) {
      const speedup = formatSpeedup(best.summary.p95Ms, worst.summary.p95Ms)
      if (speedup !== null) {
        heading.append(winnerBadge(fasterBadge(ENGINE_DISPLAY[comparison.winner].label, speedup)))
      }
    }

    const scroller = document.createElement('div')
    scroller.className = 'overflow-x-auto px-6 pb-8'

    const table = document.createElement('table')
    table.className = 'w-full min-w-[52rem] border-collapse'

    const caption = document.createElement('caption')
    caption.className = 'sr-only'
    caption.textContent = tableCaption(display.label)
    table.append(caption)

    const head = document.createElement('thead')
    const headRow = document.createElement('tr')
    const headings: readonly (readonly [string, string])[] = [
      [COPY.table.engine, 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted'],
      ['p50', HEADER_CELL],
      ['p95', HEADER_CELL],
      ['p99', HEADER_CELL],
      [COPY.table.mean, HEADER_CELL],
      [COPY.table.max, HEADER_CELL],
      [COPY.table.throughput, HEADER_CELL],
      [COPY.table.errors, HEADER_CELL],
    ]

    for (const [text, className] of headings) {
      const th = document.createElement('th')
      th.scope = 'col'
      th.className = className
      th.textContent = text
      headRow.append(th)
    }
    head.append(headRow)
    table.append(head)

    const body = document.createElement('tbody')
    for (const result of rows) {
      const row = document.createElement('tr')
      row.className = 'border-t border-subtle/60'
      row.append(
        engineCell(result.engine),
        cell(NUMERIC_CELL, formatMs(result.summary.p50Ms)),
        cell(`${NUMERIC_CELL} font-semibold`, formatMs(result.summary.p95Ms)),
        cell(NUMERIC_CELL, formatMs(result.summary.p99Ms)),
        cell(NUMERIC_CELL, formatMs(result.summary.meanMs)),
        cell(NUMERIC_CELL, formatMs(result.summary.maxMs)),
        cell(NUMERIC_CELL, formatOps(throughputOpsPerSecond(result))),
        errorCell(result.errorCount),
      )
      body.append(row)
    }
    table.append(body)

    scroller.append(table)
    section.append(heading, scroller)
    host.append(section)
  }
}
