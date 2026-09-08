/**
 * Glossary tooltips built on the native Popover API.
 *
 * The markup is a plain string like `icon()`, so the same helper serves Astro
 * at build time and the results table at runtime. Two reasons for a popover
 * instead of an absolutely positioned span:
 *
 * - The table lives inside an `overflow-x-auto` scroller, which clips on both
 *   axes. The top layer escapes that clipping; a positioned child would be cut
 *   off at the column edge.
 * - Dismissal, `Esc` and focus handling arrive already correct.
 *
 * Without JavaScript the button still opens the panel, only centred on the
 * viewport instead of anchored. `initInfoTips` is the enhancement, not the
 * mechanism.
 */

import { icon } from './icons'

export type InfoTip = {
  /** Unique in the document — the same term repeats across operation tables. */
  readonly id: string
  readonly term: string
  readonly definition: string
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const escapeText = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/* Triggers sit inside table headers and form legends, which are uppercase and
   letter-spaced. The panel resets both, or the definition reads as a shout. */
const PANEL =
  'm-0 max-w-[20rem] rounded-card border-0 bg-primary p-6 text-left normal-case tracking-normal text-canvas'

const TRIGGER =
  'inline-flex cursor-help rounded-button text-subtle transition-colors hover:text-primary focus-visible:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'

/**
 * Builds the trigger and its panel as one inline group.
 *
 * `aria-describedby` points at the panel even while it is closed: assistive
 * technology announces the definition on focus without anyone opening anything.
 * @param tip - the term, its definition, and a document-unique id
 * @returns markup safe to inject; every dynamic part is escaped here
 */
export const infoTip = (tip: InfoTip): string => {
  const id = escapeAttribute(tip.id)
  const label = escapeAttribute(`Qué significa ${tip.term}`)

  return (
    `<span class="relative inline-flex align-middle" data-info-tip>` +
    `<button type="button" popovertarget="${id}" aria-describedby="${id}" aria-label="${label}" class="${TRIGGER}">` +
    icon('circle-help', 'size-3.5') +
    `</button>` +
    `<span popover id="${id}" class="${PANEL}">` +
    `<span class="block font-mono text-caption-uppercase text-canvas/60">${escapeText(tip.term)}</span>` +
    `<span class="mt-3 block text-body-sm text-canvas">${escapeText(tip.definition)}</span>` +
    `</span></span>`
  )
}

const GAP = 8

/**
 * Pins an open panel to its trigger, flipping above when it would overflow the
 * bottom edge and clamping horizontally so it never leaves the viewport.
 * @param panel - the open popover
 * @param trigger - the button that owns it
 */
const anchor = (panel: HTMLElement, trigger: Element): void => {
  const from = trigger.getBoundingClientRect()
  const box = panel.getBoundingClientRect()

  const left = Math.min(
    Math.max(GAP, from.left + from.width / 2 - box.width / 2),
    Math.max(GAP, window.innerWidth - box.width - GAP),
  )
  const below = from.bottom + GAP
  const top =
    below + box.height + GAP > window.innerHeight
      ? Math.max(GAP, from.top - box.height - GAP)
      : below

  panel.style.left = `${left}px`
  panel.style.top = `${top}px`
}

const panelOf = (group: Element): HTMLElement | null => {
  const panel = group.querySelector('[popover]')
  return panel instanceof HTMLElement ? panel : null
}

/**
 * Wires positioning and hover for every tooltip in the document, present and
 * future. Delegated on purpose: the results table rebuilds its headers on
 * every event, so per-element binding would go stale on the first sample.
 */
export const initInfoTips = (): void => {
  // Without the Popover API the button is inert and the panel stays hidden,
  // while `aria-describedby` still carries the definition. Bailing out matters:
  // `:popover-open` is a syntax error there, and `matches` would throw on every
  // pointer move.
  if (!HTMLElement.prototype.hasOwnProperty('showPopover')) return

  // Neither event bubbles, but both still reach the document while capturing.
  //
  // Two passes on purpose. `beforetoggle` runs while the panel is still
  // `display: none`, so it cannot be measured — but whatever is set there
  // lands on the FIRST paint, which is what stops the panel from flashing in
  // the middle of the viewport where the UA sheet puts it. `toggle` then runs
  // with real dimensions and does the flip and the clamp.
  const place = (event: Event, measured: boolean): void => {
    const panel = event.target
    if (!(panel instanceof HTMLElement) || !panel.matches('[popover]')) return

    const trigger = panel.parentElement?.querySelector('button')
    if (trigger == null) return

    // The UA sheet pins all four sides to 0 with `margin: auto`; setting only
    // left and top would fight right and bottom and squash the panel.
    panel.style.inset = 'auto'
    panel.style.margin = '0'

    if (measured) {
      anchor(panel, trigger)
      return
    }

    const from = trigger.getBoundingClientRect()
    panel.style.left = `${from.left}px`
    panel.style.top = `${from.bottom + GAP}px`
  }

  document.addEventListener(
    'beforetoggle',
    (event) => {
      if ((event as ToggleEvent).newState === 'open') place(event, false)
    },
    true,
  )

  document.addEventListener(
    'toggle',
    (event) => {
      if ((event as ToggleEvent).newState === 'open') place(event, true)
    },
    true,
  )

  // Hover is the enhancement; tap and keyboard already work through the button.
  // Both calls throw when the popover is already in the requested state, hence
  // the `:popover-open` guards.
  document.addEventListener('pointerover', (event) => {
    if (!(event.target instanceof Element)) return
    const group = event.target.closest('[data-info-tip]')
    if (group === null) return
    const panel = panelOf(group)
    if (panel !== null && !panel.matches(':popover-open')) panel.showPopover()
  })

  document.addEventListener('pointerout', (event) => {
    if (!(event.target instanceof Element)) return
    const group = event.target.closest('[data-info-tip]')
    if (group === null) return
    if (event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) return
    const panel = panelOf(group)
    if (panel !== null && panel.matches(':popover-open')) panel.hidePopover()
  })
}
