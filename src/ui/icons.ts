/**
 * Inline SVG icons. No runtime dependency and no icon font: the bodies are
 * plain strings, so the same helper serves Astro at build time and the client
 * island at runtime.
 *
 * Sources — Lucide (ISC) for the outline glyphs, Simple Icons (CC0) for the
 * two engine marks. Caldera asks for flat, sharp, single-colour glyphs, so
 * every icon paints with `currentColor` and inherits from its container.
 */

type IconKind = 'stroke' | 'fill'

type IconDef = {
  /** SVG geometry on a 24×24 viewBox, stripped of its paint attributes. */
  readonly body: string
  /** Lucide draws with a stroke; Simple Icons are solid glyphs. */
  readonly kind: IconKind
}

const define = <T extends Record<string, IconDef>>(icons: T): T => icons

export const ICONS = define({
  /* Operations — verbs, not databases: the engine is already named elsewhere. */
  'database-plus': {
    kind: 'stroke',
    body: '<path d="M19 16v6m2-9.464V5m1 14h-6M3 12a9 3 0 0 0 12.182 2.806"/><path d="M3 5v14a9 3 0 0 0 10.318 2.968"/><ellipse cx="12" cy="5" rx="9" ry="3"/>',
  },
  'layers-plus': {
    kind: 'stroke',
    body: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 .83.18a2 2 0 0 0 .83-.18l8.58-3.9a1 1 0 0 0 0-1.831zM16 17h6m-3-3v6M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 .825.178M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l2.116-.962"/>',
  },
  'key-round': {
    kind: 'stroke',
    body: '<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
  },
  'list-filter': {
    kind: 'stroke',
    body: '<path d="M2 5h20M6 12h12m-9 7h6"/>',
  },
  'pencil-line': {
    kind: 'stroke',
    body: '<path d="M13 21h8M15 5l4 4m2.174-2.188a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
  },
  'trash-2': {
    kind: 'stroke',
    body: '<path d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  },
  sigma: {
    kind: 'stroke',
    body: '<path d="M18 7V5a1 1 0 0 0-1-1H6.5a.5.5 0 0 0-.4.8l4.5 6a2 2 0 0 1 0 2.4l-4.5 6a.5.5 0 0 0 .4.8H17a1 1 0 0 0 1-1v-2"/>',
  },

  /* Interface */
  check: {
    kind: 'stroke',
    body: '<path d="M20 6L9 17l-5-5"/>',
  },
  play: {
    kind: 'stroke',
    body: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  },
  'chart-bar': {
    kind: 'stroke',
    body: '<path d="M3 3v16a2 2 0 0 0 2 2h16M7 16h8m-8-5h12M7 6h3"/>',
  },
  'table-2': {
    kind: 'stroke',
    body: '<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
  },
  'circle-alert': {
    kind: 'stroke',
    body: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>',
  },
  'circle-check': {
    kind: 'stroke',
    body: '<circle cx="12" cy="12" r="10"/><path d="m9 12l2 2l4-4"/>',
  },
  'triangle-alert': {
    kind: 'stroke',
    body: '<path d="m21.73 18l-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01"/>',
  },
  'loader-circle': {
    kind: 'stroke',
    body: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  },

  /* Engine marks. Solid glyphs, tinted with the engine's own colour. */
  firebase: {
    kind: 'fill',
    body: '<path d="M19.455 8.369c-.538-.748-1.778-2.285-3.681-4.569a447 447 0 0 0-1.884-2.245l-.488-.576l-.207-.245l-.113-.133l-.022-.032l-.01-.005L12.57 0l-.609.488a13.34 13.34 0 0 0-3.681 4.64a11.4 11.4 0 0 0-1.043 3.176a12 12 0 0 0-.121.738a11 11 0 0 0-.632-.033l-.059-.003a7.5 7.5 0 0 0-2.28.274l-.317.089l-.163.286a9.6 9.6 0 0 0-1.252 4.416a9.53 9.53 0 0 0 1.583 5.625a9.57 9.57 0 0 0 4.42 3.611l.236.095l.071.025l.003-.001a9.6 9.6 0 0 0 2.941.568q.171.006.342.006a9.5 9.5 0 0 0 3.69-.742l.008.004l.313-.145a9.63 9.63 0 0 0 3.927-3.335a9.6 9.6 0 0 0 1.641-5.042c.075-2.161-.643-4.304-2.133-6.371m-7.083 6.695c.328 1.244.264 2.44-.191 3.558c-1.135-1.12-1.967-2.352-2.475-3.665c-.543-1.404-.87-2.74-.974-3.975c.48.157.922.366 1.315.622c1.132.737 1.914 1.902 2.325 3.461zm.207 6.022c.482.368.99.712 1.513 1.028a7.9 7.9 0 0 1-2.369.273a8 8 0 0 1-.373-.022a9 9 0 0 0 1.228-1.279zm1.347-6.431c-.516-1.957-1.527-3.437-3.002-4.398a7.4 7.4 0 0 0-2.194-.95a9 9 0 0 1 .089-.713a11.6 11.6 0 0 1 .91-2.765l.004-.008c.177-.358.376-.719.61-1.105l.092-.152l-.003-.001a11.7 11.7 0 0 1 1.942-2.311l.288.341c.672.796 1.304 1.548 1.878 2.237c1.291 1.549 2.966 3.583 3.612 4.48c1.277 1.771 1.893 3.579 1.83 5.375a7.97 7.97 0 0 1-3.995 6.641a15.5 15.5 0 0 1-2.539-1.599c.79-1.575.952-3.28.479-5.072zm-2.575 5.397a7.9 7.9 0 0 1-2.09 1.856a6 6 0 0 1-.243-.093l-.065-.026a7.97 7.97 0 0 1-3.635-3.01a7.94 7.94 0 0 1-1.298-4.653a7.9 7.9 0 0 1 .882-3.379q.476-.105.96-.131l.084-.002q.245-.005.478 0q.341.017.677.07c.073 1.513.445 3.145 1.105 4.852c.637 1.644 1.694 3.162 3.144 4.515z"/>',
  },
  mongodb: {
    kind: 'fill',
    body: '<path d="M17.193 9.555c-1.264-5.58-4.252-7.414-4.573-8.115c-.28-.394-.53-.954-.735-1.44c-.036.495-.055.685-.523 1.184c-.723.566-4.438 3.682-4.74 10.02c-.282 5.912 4.27 9.435 4.888 9.884l.07.05A74 74 0 0 1 11.91 24h.481a29 29 0 0 1 .51-3.07c.417-.296.604-.463.85-.693a11.34 11.34 0 0 0 3.639-8.464c.01-.814-.103-1.662-.197-2.218m-5.336 8.195s0-8.291.275-8.29c.213 0 .49 10.695.49 10.695c-.381-.045-.765-1.76-.765-2.405"/>',
  },
})

export type IconName = keyof typeof ICONS

const STROKE_PAINT =
  'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

/**
 * Builds an icon as an SVG string, decorative by default.
 *
 * The class string must be written as a literal at the call site — building it
 * by interpolation hides it from the Tailwind scanner and the icon renders at
 * its intrinsic size.
 * @param name - key of the icon in ICONS
 * @param className - utility classes, at minimum a size
 * @param label - accessible name; omit for decoration that text already conveys
 * @returns SVG markup, safe to inject: every part of it is authored here
 */
export const icon = (name: IconName, className: string, label?: string): string => {
  const definition = ICONS[name]
  const paint = definition.kind === 'stroke' ? STROKE_PAINT : 'fill="currentColor"'
  const semantics =
    label === undefined
      ? 'aria-hidden="true"'
      : `role="img" aria-label="${label.replace(/"/g, '&quot;')}"`

  return `<svg class="${className}" viewBox="0 0 24 24" focusable="false" ${semantics} ${paint}>${definition.body}</svg>`
}
