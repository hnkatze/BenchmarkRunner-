import {
  compareByOperation,
  throughputOpsPerSecond,
  type EngineId,
  type OperationResult,
} from '../domain'
import { COPY, fasterBadge, tableCaption } from './copy'
import { formatCount, formatMs, formatOps, formatSpeedup } from './format'
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
  element.className = 'px-3 py-2 text-left text-sm font-medium text-primary'

  const dot = document.createElement('span')
  dot.className = 'mr-2 inline-block size-2.5 rounded-full align-middle'
  dot.style.backgroundColor = `var(${display.colorVar})`
  dot.setAttribute('aria-hidden', 'true')

  element.append(dot, document.createTextNode(display.label))
  return element
}

const winnerBadge = (text: string): HTMLElement => {
  const badge = document.createElement('span')
  badge.className =
    'ml-2 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-[11px] font-semibold text-ok'
  badge.textContent = text
  return badge
}

const emptyState = (): HTMLElement => {
  const message = document.createElement('p')
  message.className = 'px-4 py-10 text-center text-sm text-muted'
  message.textContent = COPY.table.empty
  return message
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
    heading.className = 'flex flex-wrap items-baseline gap-x-2 px-4 pt-4 text-sm font-semibold text-primary'
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
    scroller.className = 'overflow-x-auto px-2 pb-4'

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
        cell(
          `${NUMERIC_CELL} ${result.errorCount > 0 ? 'text-error' : 'text-muted'}`,
          formatCount(result.errorCount),
        ),
      )
      body.append(row)
    }
    table.append(body)

    scroller.append(table)
    section.append(heading, scroller)
    host.append(section)
  }
}
