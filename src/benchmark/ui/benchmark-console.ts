import {
  DEFAULT_CONFIG,
  ENGINE_IDS,
  IDLE_STATE,
  OPERATION_IDS,
  isEngineId,
  isOperationId,
  reduceRunState,
  validateConfig,
  type BenchmarkConfig,
  type BenchmarkRunner,
  type EngineId,
  type OperationId,
  type OperationResult,
  type RunState,
} from '../domain'
import { icon } from '../../ui/icons'
import { COPY, failedStatus, finishedStatus, runningStatus, violationMessage } from './copy'
import { renderChart } from './render-chart'
import { renderResults } from './render-results'

const readNumber = (form: HTMLFormElement, name: string, fallback: number): number => {
  const field = form.elements.namedItem(name)
  if (!(field instanceof HTMLInputElement)) return fallback
  const parsed = Number.parseInt(field.value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

const readChecked = <TValue extends string>(
  form: HTMLFormElement,
  name: string,
  guard: (value: unknown) => value is TValue,
): readonly TValue[] => {
  const boxes = form.querySelectorAll<HTMLInputElement>('input[name="' + name + '"]:checked')
  return [...boxes].map((box) => box.value).filter(guard)
}

export class BenchmarkConsole extends HTMLElement {
  #state: RunState = IDLE_STATE
  #controller: AbortController | null = null
  #runner: BenchmarkRunner | null = null

  #form: HTMLFormElement | null = null
  #runButton: HTMLButtonElement | null = null
  #runLabel: HTMLElement | null = null
  #runIcon: HTMLElement | null = null
  #cancelButton: HTMLButtonElement | null = null
  #progressBar: HTMLElement | null = null
  #progressTrack: HTMLElement | null = null
  #progressLabel: HTMLElement | null = null
  #statusRegion: HTMLElement | null = null
  #resultsHost: HTMLElement | null = null
  #chartHost: HTMLElement | null = null
  #errorHost: HTMLElement | null = null
  #resizeObserver: ResizeObserver | null = null
  #lastChartWidth = 0

  connectedCallback(): void {
    this.#form = this.querySelector<HTMLFormElement>('[data-ref="form"]')
    this.#runButton = this.querySelector<HTMLButtonElement>('[data-ref="run"]')
    this.#runLabel = this.querySelector<HTMLElement>('[data-ref="run-label"]')
    this.#runIcon = this.querySelector<HTMLElement>('[data-ref="run-icon"]')
    this.#cancelButton = this.querySelector<HTMLButtonElement>('[data-ref="cancel"]')
    this.#progressBar = this.querySelector<HTMLElement>('[data-ref="progress-bar"]')
    this.#progressTrack = this.querySelector<HTMLElement>('[data-ref="progress-track"]')
    this.#progressLabel = this.querySelector<HTMLElement>('[data-ref="progress-label"]')
    this.#statusRegion = this.querySelector<HTMLElement>('[data-ref="status"]')
    this.#resultsHost = this.querySelector<HTMLElement>('[data-ref="results"]')
    this.#chartHost = this.querySelector<HTMLElement>('[data-ref="chart"]')
    this.#errorHost = this.querySelector<HTMLElement>('[data-ref="errors"]')

    this.#form?.addEventListener('submit', this.#onSubmit)
    this.#cancelButton?.addEventListener('click', this.#onCancel)

    this.#observeChartWidth()
    this.#render()
  }

  disconnectedCallback(): void {
    this.#controller?.abort()
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#form?.removeEventListener('submit', this.#onSubmit)
    this.#cancelButton?.removeEventListener('click', this.#onCancel)
  }

  /**
   * Redraws the chart at the real container width. Guarded on a width change
   * because the redraw writes into the very element being observed.
   */
  #observeChartWidth(): void {
    const host = this.#chartHost
    if (host === null || typeof ResizeObserver === 'undefined') return

    this.#resizeObserver = new ResizeObserver(() => {
      if (this.#chartWidth() === this.#lastChartWidth) return
      this.#render()
    })
    this.#resizeObserver.observe(host)
  }

  #chartWidth(): number {
    const host = this.#chartHost
    return host === null ? 0 : host.clientWidth
  }

  /**
   * Injected by the composition root. The island stays unaware of which engine
   * adapter it drives, so swapping one never reaches this file.
   */
  setRunner(runner: BenchmarkRunner): void {
    this.#runner = runner
  }

  #readConfig(): BenchmarkConfig {
    const form = this.#form
    if (form === null) return DEFAULT_CONFIG

    const engines = readChecked<EngineId>(form, 'engine', isEngineId)
    const operations = readChecked<OperationId>(form, 'operation', isOperationId)

    return {
      engines: engines.length > 0 ? engines : ENGINE_IDS,
      operations: operations.length > 0 ? operations : OPERATION_IDS.slice(0, 1),
      iterations: readNumber(form, 'iterations', DEFAULT_CONFIG.iterations),
      warmupIterations: readNumber(form, 'warmupIterations', DEFAULT_CONFIG.warmupIterations),
      documentSizeBytes: readNumber(form, 'documentSizeBytes', DEFAULT_CONFIG.documentSizeBytes),
      concurrency: readNumber(form, 'concurrency', DEFAULT_CONFIG.concurrency),
    }
  }

  #onSubmit = (event: SubmitEvent): void => {
    event.preventDefault()
    if (this.#state.status === 'running') return

    const form = this.#form
    if (form === null) return

    const config: BenchmarkConfig = {
      ...this.#readConfig(),
      engines: readChecked<EngineId>(form, 'engine', isEngineId),
      operations: readChecked<OperationId>(form, 'operation', isOperationId),
    }

    const violations = validateConfig(config)
    if (violations.length > 0) {
      this.#showViolations(violations.map(violationMessage))
      return
    }

    if (this.#runner === null) {
      this.#showViolations([COPY.status.noRunner])
      return
    }

    this.#showViolations([])
    void this.#run(this.#runner, config)
  }

  #onCancel = (): void => {
    this.#controller?.abort()
    const results = this.#state.status === 'running' ? this.#state.results : []
    this.#state = { status: 'cancelled', results }
    this.#render()
  }

  async #run(runner: BenchmarkRunner, config: BenchmarkConfig): Promise<void> {
    const controller = new AbortController()
    this.#controller = controller

    try {
      for await (const event of runner.run(config, controller.signal)) {
        if (controller.signal.aborted) break
        this.#state = reduceRunState(this.#state, event)
        this.#render()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : COPY.status.unknownFailure
      this.#state = { status: 'failed', message }
      this.#render()
    } finally {
      this.#controller = null
    }
  }

  #showViolations(messages: readonly string[]): void {
    const host = this.#errorHost
    if (host === null) return

    host.textContent = ''
    host.hidden = messages.length === 0
    for (const message of messages) {
      const item = document.createElement('li')
      item.textContent = message
      host.append(item)
    }
  }

  #currentResults(): readonly OperationResult[] {
    switch (this.#state.status) {
      case 'running':
      case 'cancelled':
        return this.#state.results
      case 'completed':
        return this.#state.report.results
      default:
        return []
    }
  }

  #statusText(): string {
    switch (this.#state.status) {
      case 'idle':
        return COPY.status.idle
      case 'running': {
        const { current, completedSamples, totalSamples } = this.#state
        const where =
          current === null
            ? COPY.status.preparing
            : current.engine + ' · ' + current.operation
        return runningStatus(where, completedSamples, totalSamples)
      }
      case 'completed': {
        const elapsed = this.#state.report.finishedAt - this.#state.report.startedAt
        return finishedStatus((elapsed / 1000).toFixed(1))
      }
      case 'cancelled':
        return COPY.status.cancelled
      case 'failed':
        return failedStatus(this.#state.message)
      default: {
        const unhandled: never = this.#state
        throw new Error('unhandled run state: ' + JSON.stringify(unhandled))
      }
    }
  }

  #render(): void {
    const state = this.#state
    const isRunning = state.status === 'running'
    const completed = state.status === 'running' ? state.completedSamples : 0
    const total = state.status === 'running' ? state.totalSamples : 0
    const ratio = total > 0 ? completed / total : state.status === 'completed' ? 1 : 0

    if (this.#runButton !== null) this.#runButton.disabled = isRunning

    // Write into the label, never the button: `textContent` on the button would
    // wipe the icon markup rendered beside it.
    if (this.#runLabel !== null) {
      this.#runLabel.textContent = isRunning ? COPY.buttons.running : COPY.buttons.run
    }
    if (this.#runIcon !== null) {
      this.#runIcon.innerHTML = isRunning
        ? icon('loader-circle', 'size-4 animate-spin')
        : icon('play', 'size-4')
    }
    if (this.#cancelButton !== null) this.#cancelButton.hidden = !isRunning

    if (this.#progressBar !== null) {
      this.#progressBar.style.width = (ratio * 100).toFixed(1) + '%'
    }
    if (this.#progressTrack !== null) {
      this.#progressTrack.setAttribute('aria-valuenow', Math.round(ratio * 100).toString())
    }
    if (this.#progressLabel !== null) {
      this.#progressLabel.textContent = Math.round(ratio * 100) + '%'
    }
    if (this.#statusRegion !== null) this.#statusRegion.textContent = this.#statusText()

    const results = this.#currentResults()
    if (this.#resultsHost !== null) renderResults(this.#resultsHost, results)
    if (this.#chartHost !== null) {
      this.#lastChartWidth = this.#chartWidth()
      renderChart(this.#chartHost, results, this.#lastChartWidth)
    }
  }
}

if (customElements.get('benchmark-console') === undefined) {
  customElements.define('benchmark-console', BenchmarkConsole)
}
