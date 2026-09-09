import {
  DEFAULT_CONFIG,
  IDLE_STATE,
  isPhaseId,
  isEngineId,
  isOperationId,
  reduceRunState,
  validateConfig,
  type BenchmarkConfig,
  type BenchmarkRunner,
  type EngineId,
  type OperationId,
  type OperationResult,
  type PhaseId,
  type RunState,
  type SamplePoint,
} from '../domain'
import { isQueryId, type QueryId } from '../../dataset/domain/queries.ts'
import { icon } from '../../ui/icons'
import {
  COPY,
  failedStatus,
  finishedStatus,
  phaseFailureNotice,
  runningStatus,
  runSummary,
  sampleFailureNotice,
  violationMessage,
} from './copy'
import { renderChart, type BarMeasure } from './render-chart'
import { renderResults } from './render-results'
import { renderSamplesChart } from './render-samples-chart'
import { PHASE_DISPLAY } from './labels'
import { segmentButton } from '../../ui/button-recipes'

/** The two halves of the session: choose the run, then read it. */
type Step = 'setup' | 'analysis'

/** Three questions, three plots. They never share an axis. */
type ChartView = BarMeasure | 'samples'

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
  #violations: readonly string[] = []
  /** Which step is on screen. The parameters stop costing width once there is data. */
  #step: Step = 'setup'
  #chartView: ChartView = 'p95'
  #phase: PhaseId | null = null
  /** Rebuild the phase options only when the set changes, not on every sample. */
  #phaseOptions = ''
  /** What actually ran, for the summary line. Reading the form would drift. */
  #lastConfig: BenchmarkConfig | null = null
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
  #stepAnalysis: HTMLElement | null = null
  #summaryHost: HTMLElement | null = null
  #chartHeading: HTMLElement | null = null
  #phasePicker: HTMLElement | null = null
  #phaseSelect: HTMLSelectElement | null = null

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
    this.#stepAnalysis = this.querySelector<HTMLElement>('[data-ref="step-analysis"]')
    this.#summaryHost = this.querySelector<HTMLElement>('[data-ref="summary"]')
    this.#chartHeading = this.querySelector<HTMLElement>('[data-ref="chart-heading-label"]')
    this.#phasePicker = this.querySelector<HTMLElement>('[data-ref="phase-picker"]')
    this.#phaseSelect = this.querySelector<HTMLSelectElement>('[data-ref="phase-select"]')

    for (const tab of this.querySelectorAll<HTMLButtonElement>('[data-ref="step-tab"]')) {
      tab.addEventListener('click', () => {
        this.#step = tab.dataset.step === 'analysis' ? 'analysis' : 'setup'
        this.#render()
      })
    }

    for (const tab of this.querySelectorAll<HTMLButtonElement>('[data-ref="chart-tab"]')) {
      tab.addEventListener('click', () => {
        const view = tab.dataset.chart
        if (view === 'p95' || view === 'samples' || view === 'throughput') {
          this.#chartView = view
          this.#render()
        }
      })
    }

    this.#phaseSelect?.addEventListener('change', () => {
      const chosen = this.#phaseSelect?.value
      this.#phase = chosen !== undefined && isPhaseId(chosen) ? chosen : null
      this.#render()
    })

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

  /**
   * Reads the form exactly as it stands, with no fallback for an empty
   * selection: `validateConfig` owns that verdict, and silently substituting a
   * default would run phases nobody ticked.
   */
  #readConfig(): BenchmarkConfig {
    const form = this.#form
    if (form === null) return DEFAULT_CONFIG

    return {
      engines: readChecked<EngineId>(form, 'engine', isEngineId),
      operations: readChecked<OperationId>(form, 'operation', isOperationId),
      queries: readChecked<QueryId>(form, 'query', isQueryId),
      iterations: readNumber(form, 'iterations', DEFAULT_CONFIG.iterations),
      warmupIterations: readNumber(form, 'warmupIterations', DEFAULT_CONFIG.warmupIterations),
      documentSizeBytes: readNumber(form, 'documentSizeBytes', DEFAULT_CONFIG.documentSizeBytes),
      concurrency: readNumber(form, 'concurrency', DEFAULT_CONFIG.concurrency),
    }
  }

  #onSubmit = (event: SubmitEvent): void => {
    event.preventDefault()
    if (this.#state.status === 'running') return

    if (this.#form === null) return

    const config = this.#readConfig()
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
    this.#lastConfig = config
    // Straight to the results: the parameters have said everything they had to.
    this.#step = 'analysis'
    void this.#run(this.#runner, config)
  }

  #onCancel = (): void => {
    this.#controller?.abort()
    // Cancelling keeps what was already measured, samples included: the charts
    // are the reason someone cancels a run that is clearly going wrong.
    const results = this.#state.status === 'running' ? this.#state.results : []
    const samples = this.#currentSamples()
    this.#state = { status: 'cancelled', results, samples }
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
    this.#violations = messages
    this.#render()
  }

  /**
   * Config violations plus, while a run is going, why its samples are failing.
   * Both belong in the same place: they are the two reasons a run produces no
   * numbers, and the user should not have to know which kind they hit.
   */
  #notices(): readonly string[] {
    const state = this.#state
    if (state.status !== 'running') return this.#violations

    const notices = [...this.#violations]
    for (const phase of state.failedPhases) {
      notices.push(phaseFailureNotice(phase.engine + ' · ' + phase.operation, phase.reason))
    }
    if (state.failedSamples > 0 && state.lastFailure !== null) {
      notices.push(sampleFailureNotice(state.failedSamples, state.lastFailure))
    }
    return notices
  }

  #renderNotices(): void {
    const host = this.#errorHost
    if (host === null) return

    const messages = this.#notices()
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

  #currentSamples(): readonly SamplePoint[] {
    switch (this.#state.status) {
      case 'running':
      case 'cancelled':
      case 'completed':
        return this.#state.samples
      default:
        return []
    }
  }

  /** Which configuration produced what is on screen. */
  #summaryText(): string {
    const config = this.#lastConfig ?? this.#readConfig()
    return runSummary(
      config.engines.length,
      config.operations.length + config.queries.length,
      config.iterations,
    )
  }

  /**
   * Keeps the phase picker in step with the phases that actually have samples,
   * rebuilding the options only when that set changes — a sample event arrives
   * hundreds of times per run, and replacing the options on each one would fight
   * the user for the select.
   */
  #syncPhases(samples: readonly SamplePoint[]): void {
    const phases: PhaseId[] = []
    for (const sample of samples) {
      if (!phases.includes(sample.operation)) phases.push(sample.operation)
    }

    if (this.#phase === null || !phases.includes(this.#phase)) {
      this.#phase = phases[0] ?? null
    }

    const select = this.#phaseSelect
    if (select === null) return

    const key = phases.join('|')
    if (key !== this.#phaseOptions) {
      this.#phaseOptions = key
      select.textContent = ''
      for (const phase of phases) {
        const option = document.createElement('option')
        option.value = phase
        option.textContent = PHASE_DISPLAY[phase].label
        select.append(option)
      }
    }

    if (this.#phase !== null) select.value = this.#phase
  }

  #statusText(): string {
    switch (this.#state.status) {
      case 'idle':
        return COPY.status.idle
      case 'running': {
        const { current, completedSamples, failedSamples, totalSamples } = this.#state
        const where =
          current === null
            ? COPY.status.preparing
            : current.engine + ' · ' + current.operation
        // Attempted, not completed: a phase whose every call fails still moves.
        return runningStatus(where, completedSamples + failedSamples, totalSamples, failedSamples)
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
    // Failed samples count toward progress. They were attempted, they cost the
    // same wall clock, and leaving them out is what made a run against an
    // unseeded collection look frozen instead of broken.
    const attempted =
      state.status === 'running' ? state.completedSamples + state.failedSamples : 0
    const total = state.status === 'running' ? state.totalSamples : 0
    const ratio =
      total > 0 ? Math.min(1, attempted / total) : state.status === 'completed' ? 1 : 0

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

    this.#renderNotices()
    this.#renderSteps()

    const results = this.#currentResults()
    if (this.#resultsHost !== null) renderResults(this.#resultsHost, results)

    const samples = this.#currentSamples()
    this.#syncPhases(samples)

    if (this.#phasePicker !== null) this.#phasePicker.hidden = this.#chartView !== 'samples'
    if (this.#chartHeading !== null) {
      this.#chartHeading.textContent = COPY.charts[this.#chartView]
    }

    if (this.#chartHost !== null) {
      this.#lastChartWidth = this.#chartWidth()
      if (this.#chartView === 'samples') {
        renderSamplesChart(this.#chartHost, samples, this.#phase, this.#lastChartWidth)
      } else {
        renderChart(this.#chartHost, results, this.#lastChartWidth, this.#chartView)
      }
    }
  }

  /** Which step is visible, which tabs read as selected, and the summary line. */
  #renderSteps(): void {
    if (this.#form !== null) this.#form.hidden = this.#step !== 'setup'
    if (this.#stepAnalysis !== null) this.#stepAnalysis.hidden = this.#step !== 'analysis'

    for (const tab of this.querySelectorAll<HTMLButtonElement>('[data-ref="step-tab"]')) {
      const active = tab.dataset.step === this.#step
      tab.className = segmentButton(active)
      tab.setAttribute('aria-selected', String(active))
    }

    for (const tab of this.querySelectorAll<HTMLButtonElement>('[data-ref="chart-tab"]')) {
      const active = tab.dataset.chart === this.#chartView
      tab.className = segmentButton(active)
      tab.setAttribute('aria-selected', String(active))
    }

    if (this.#summaryHost !== null) this.#summaryHost.textContent = this.#summaryText()
  }
}

if (customElements.get('benchmark-console') === undefined) {
  customElements.define('benchmark-console', BenchmarkConsole)
}
