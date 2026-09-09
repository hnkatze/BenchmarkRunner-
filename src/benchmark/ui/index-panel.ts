import { INDEX_COPY, INDEX_STATE_LABEL, indexSummary } from './copy'

/**
 * The Firestore composite indexes, checked and created from the page.
 *
 * A plain init function rather than a custom element, mirroring `initInfoTips`:
 * there is no state worth a component here, only two buttons and a list.
 *
 * It talks to `/api/indexes` and never to Firestore, so no SDK reaches the
 * browser bundle. Checking needs only read access; creating needs an IAM role
 * the default service account does not carry, and the panel says so plainly
 * instead of failing with a bare 403.
 */

type IndexState = keyof typeof INDEX_STATE_LABEL

type IndexStatus = {
  readonly collection: string
  readonly fields: readonly { readonly fieldPath: string; readonly order: string }[]
  readonly state: IndexState
  readonly serves: string
  readonly detail?: string
}

type IndexReport = {
  readonly projectId: string
  readonly indexes: readonly IndexStatus[]
  readonly error?: string
}

const isIndexState = (value: unknown): value is IndexState =>
  typeof value === 'string' && value in INDEX_STATE_LABEL

/** Untrusted network input: the shape is checked before it reaches the DOM. */
const isReport = (value: unknown): value is IndexReport => {
  if (typeof value !== 'object' || value === null) return false
  const raw = value as { projectId?: unknown; indexes?: unknown }
  if (typeof raw.projectId !== 'string' || !Array.isArray(raw.indexes)) return false
  return raw.indexes.every((index: unknown) => {
    if (typeof index !== 'object' || index === null) return false
    const row = index as { collection?: unknown; state?: unknown; fields?: unknown }
    return typeof row.collection === 'string' && isIndexState(row.state) && Array.isArray(row.fields)
  })
}

const shapeOf = (index: IndexStatus): string =>
  `${index.collection} (${index.fields
    .map((field) => `${field.fieldPath} ${field.order === 'ASCENDING' ? 'ASC' : 'DESC'}`)
    .join(', ')})`

export const initIndexPanel = (root: ParentNode = document): void => {
  const panel = root.querySelector<HTMLElement>('[data-ref="index-panel"]')
  if (panel === null) return

  const status = panel.querySelector<HTMLElement>('[data-ref="index-status"]')
  const list = panel.querySelector<HTMLElement>('[data-ref="index-list"]')
  const check = panel.querySelector<HTMLButtonElement>('[data-ref="index-check"]')
  const create = panel.querySelector<HTMLButtonElement>('[data-ref="index-create"]')

  const setBusy = (busy: boolean, message: string): void => {
    if (check !== null) check.disabled = busy
    if (create !== null) create.disabled = busy
    if (status !== null) status.textContent = message
  }

  const render = (report: IndexReport): void => {
    if (list === null || status === null) return

    list.textContent = ''
    for (const index of report.indexes) {
      const item = document.createElement('li')
      // textContent, never innerHTML: `serves` and `detail` are project data.
      item.textContent = `${INDEX_STATE_LABEL[index.state].padEnd(10)} ${shapeOf(index)}`
      list.append(item)
    }
    list.hidden = report.indexes.length === 0

    const ready = report.indexes.filter((i) => i.state === 'ready').length
    const missing = report.indexes.filter((i) => i.state === 'missing').length
    const denied = report.indexes.filter((i) => i.state === 'denied').length
    const pending = report.indexes.filter(
      (i) => i.state === 'created' || i.state === 'building',
    ).length

    const lines = [indexSummary(ready, report.indexes.length, missing)]
    if (denied > 0) lines.push(INDEX_COPY.denied)
    if (pending > 0) lines.push(INDEX_COPY.building)
    status.textContent = lines.join(' ')
  }

  const call = async (method: 'GET' | 'POST', pending: string): Promise<void> => {
    setBusy(true, pending)
    try {
      const response = await fetch('/api/indexes', { method })
      const payload: unknown = await response.json()

      if (response.status === 503) {
        setBusy(false, INDEX_COPY.notConfigured)
        return
      }
      if (!isReport(payload)) {
        setBusy(false, INDEX_COPY.unreachable)
        return
      }

      setBusy(false, '')
      render(payload)
      if (payload.error !== undefined && status !== null) {
        status.textContent = INDEX_COPY.unreachable
      }
    } catch {
      setBusy(false, INDEX_COPY.unreachable)
    }
  }

  check?.addEventListener('click', () => void call('GET', INDEX_COPY.checking))
  create?.addEventListener('click', () => void call('POST', INDEX_COPY.creating))
}
