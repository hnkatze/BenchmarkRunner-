import { indexShare, totalBytes, type EngineContext } from '../domain/context.ts'
import { ENGINE_DISPLAY } from '../../benchmark/ui/labels'
import { isEngineId } from '../../benchmark/domain'
import { icon } from '../../ui/icons'

/**
 * A latency number without its conditions is not a measurement, it is an
 * anecdote — gaps included, shown as stated reasons rather than omitted.
 */

/* Interpolated from whole literals only: the scanner reads source text, so a
   class name may never be split across the boundary. */
const CARD_SURFACE = 'rounded-card border border-hairline bg-canvas p-6'
const CARD = `grid content-start gap-4 ${CARD_SURFACE}`
const CARD_SECTION = 'grid gap-1.5'
const LABEL = 'text-caption-uppercase font-semibold text-muted'
const CARD_TITLE = 'flex items-center gap-2 text-body-md font-semibold text-primary'
const NUM = 'font-mono text-body-sm tnum text-primary'

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '—'
  const mb = bytes / 1024 / 1024
  return mb < 1 ? `${(bytes / 1024).toFixed(0)} KB` : `${mb.toFixed(2)} MB`
}

const formatCount = (value: number): string => value.toLocaleString('es-HN')

const row = (label: string, value: string, mono = true): HTMLElement => {
  const line = document.createElement('div')
  line.className = 'flex items-baseline justify-between gap-4'

  const key = document.createElement('span')
  key.className = 'text-body-sm text-secondary'
  key.textContent = label

  const val = document.createElement('span')
  val.className = mono ? NUM : 'text-body-sm text-primary'
  val.textContent = value

  line.append(key, val)
  return line
}

const section = (title: string): HTMLElement => {
  const heading = document.createElement('p')
  heading.className = LABEL
  heading.textContent = title
  return heading
}

/** The coloured mark plus the engine's name, for whatever heading level asks. */
const engineMark = (context: EngineContext): readonly Node[] => {
  if (!isEngineId(context.engine)) return [document.createTextNode(context.engine)]

  const display = ENGINE_DISPLAY[context.engine]
  const mark = document.createElement('span')
  mark.className = 'inline-flex'
  mark.style.color = `var(${display.colorVar})`
  mark.innerHTML = icon(display.icon, 'size-5')
  return [mark, document.createTextNode(display.label)]
}

const engineCard = (context: EngineContext): HTMLElement => {
  const card = document.createElement('article')
  card.className = CARD

  const head = document.createElement('h3')
  head.className = CARD_TITLE
  head.append(...engineMark(context))
  card.append(head)

  if (context.network !== null) {
    const net = context.network
    const block = document.createElement('div')
    block.className = CARD_SECTION
    block.append(
      section('Red'),
      row('Ida y vuelta, mediana', `${net.medianRttMs} ms`),
      row('Mínimo · máximo', `${net.minRttMs} · ${net.maxRttMs} ms`),
      row('Muestras', String(net.samples)),
    )
    const host = document.createElement('p')
    host.className = 'break-all font-mono text-caption text-muted'
    host.textContent = net.host
    block.append(host)
    card.append(block)
  }

  if (context.storage !== null) {
    const store = context.storage
    const block = document.createElement('div')
    block.className = CARD_SECTION
    block.append(section('Tamaño'), row('Documentos', formatCount(store.documents)))

    if (totalBytes(store) > 0) {
      block.append(
        row('Datos', formatBytes(store.dataBytes)),
        row('En disco', formatBytes(store.storageBytes)),
        row('Índices', formatBytes(store.indexBytes)),
        // Called out because it is a finding: at this scale the indexes weigh
        // about as much as the documents they point at.
        row('Índices sobre datos', `${(indexShare(store) * 100).toFixed(0)} %`),
      )
    }
    card.append(block)
  }

  const params = document.createElement('div')
  params.className = CARD_SECTION
  params.append(section('Parámetros'))
  for (const field of context.parameters) params.append(row(field.label, field.value, false))
  card.append(params)

  return card
}

/**
 * Nested, an absence reads as a footnote to one engine; side by side the gaps
 * read as what they are — the shape of the comparison itself.
 * @param contexts - every engine reported by the endpoint
 * @returns the card, or `null` when no engine declared a gap
 */
const unavailableCard = (contexts: readonly EngineContext[]): HTMLElement | null => {
  const withGaps = contexts.filter((context) => context.unavailable.length > 0)
  if (withGaps.length === 0) return null

  const card = document.createElement('article')
  card.className = `grid gap-5 ${CARD_SURFACE}`

  const head = document.createElement('h3')
  head.className = CARD_TITLE
  head.textContent = 'Lo que los motores no informan'
  card.append(head)

  for (const context of withGaps) {
    const group = document.createElement('div')
    group.className = 'grid gap-3'

    const name = document.createElement('h4')
    name.className = 'flex items-center gap-2 text-body-sm font-semibold text-secondary'
    name.append(...engineMark(context))
    group.append(name)

    const items = document.createElement('div')
    /* Two columns and no wider: each `why` runs 150-200 characters, and a fourth
       column would cut them to ~40 per line, under the comfortable range. */
    items.className = 'grid gap-x-8 gap-y-4 md:grid-cols-2'
    for (const entry of context.unavailable) {
      const item = document.createElement('div')

      const what = document.createElement('p')
      what.className = 'text-body-sm font-medium text-primary'
      what.textContent = entry.what

      const why = document.createElement('p')
      why.className = 'mt-1 text-caption leading-relaxed text-muted'
      why.textContent = entry.why

      item.append(what, why)
      items.append(item)
    }

    group.append(items)
    card.append(group)
  }

  return card
}

/**
 * Fetches the context and paints it, replacing whatever the host held.
 * @param host - container element, fully replaced on every call
 */
export const renderContext = async (host: HTMLElement): Promise<void> => {
  host.textContent = ''

  const loading = document.createElement('p')
  loading.className = 'text-body-sm text-muted'
  loading.textContent = 'Midiendo la red y consultando el tamaño de las bases…'
  host.append(loading)

  try {
    const response = await fetch('/api/context')
    if (!response.ok) throw new Error(`el servidor respondió ${response.status}`)

    const payload = (await response.json()) as {
      contexts: EngineContext[]
      failures: { engine: string; reason: string }[]
    }

    host.textContent = ''
    const stack = document.createElement('div')
    stack.className = 'grid gap-6'

    const grid = document.createElement('div')
    grid.className = 'grid gap-5 lg:grid-cols-2'
    for (const context of payload.contexts) grid.append(engineCard(context))
    stack.append(grid)

    const gaps = unavailableCard(payload.contexts)
    if (gaps !== null) stack.append(gaps)

    host.append(stack)

    for (const failure of payload.failures) {
      const note = document.createElement('p')
      note.className = 'mt-4 text-body-sm text-muted'
      note.textContent = `${failure.engine}: ${failure.reason}`
      host.append(note)
    }
  } catch (error) {
    host.textContent = ''
    const failed = document.createElement('p')
    failed.className = 'text-body-sm text-muted'
    failed.textContent = `No se pudo leer el contexto: ${
      error instanceof Error ? error.message : String(error)
    }`
    host.append(failed)
  }
}
