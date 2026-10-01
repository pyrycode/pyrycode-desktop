import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { UsageLimitReading } from '../../store/usageLimitStore'
import { TopOverlay, USAGE_PILL_DISMISS_LABEL } from './TopOverlay'
import { USAGE_LIMIT_EXHAUSTED_COPY, USAGE_LIMIT_WARNING_COPY } from './usageLimitNotice'
import { COMPOSER_REPAIR_BUTTON_COPY } from './composerSend'

// #1604 — the Top overlay's pure view. The markup is a pure function of the reading, the instant, the
// dismissed triple and the repair flag, so every arm is a static render here; the clicks live in e2e.
const NOW = Math.floor(new Date(2026, 8, 9, 13, 55, 0, 0).getTime() / 1000)

const reading = (over: Partial<UsageLimitReading> = {}): UsageLimitReading => ({
  status: 'allowed_warning',
  limitType: 'overage',
  resetsAt: 0,
  ...over
})

const render = (props: {
  reading?: UsageLimitReading | null
  dismissed?: UsageLimitReading | null
  repair?: boolean
  resolution?: 'remote' | 'timeout' | null
}): string => renderToStaticMarkup(
  <TopOverlay
    reading={props.reading ?? null}
    nowSeconds={NOW}
    dismissed={props.dismissed ?? null}
    repair={props.repair ?? false}
    onDismissUsage={() => {}}
    resolution={props.resolution ?? null}
    onDismissResolution={() => {}}
    onRepair={() => {}}
  />
)

const X_BUTTON = `<button type="button" class="top-overlay-pill__dismiss" aria-label="${USAGE_PILL_DISMISS_LABEL}">`
const REPAIR_PILL =
  `<button type="button" class="top-overlay-pill top-overlay-pill--error">${COMPOSER_REPAIR_BUTTON_COPY}</button>`

describe('TopOverlay (#1604)', () => {
  // The empty overlay in the strict exact-empty form: no element at all, so it takes no space.
  it('renders nothing at all with no reading and no repair', () => {
    expect(render({})).toBe('')
  })

  it('renders nothing at all when the only reading is the dismissed one', () => {
    expect(render({ reading: reading(), dismissed: reading() })).toBe('')
  })

  it('draws `allowed_warning` as a Default pill with an X carrying a client-owned name', () => {
    const markup = render({ reading: reading() })
    expect(markup.startsWith(
      '<div class="conversation__top-overlay">' +
        '<div class="top-overlay-pill top-overlay-pill--default">' +
          `<span class="top-overlay-pill__text">${USAGE_LIMIT_WARNING_COPY}</span>` +
          X_BUTTON
    )).toBe(true)
    expect(markup.endsWith('</button></div></div>')).toBe(true)
    expect(markup).not.toContain('top-overlay-pill--error')
    expect(markup).toContain('aria-hidden="true"')
  })

  it('draws `rejected` as an Error pill with no X', () => {
    expect(render({ reading: reading({ status: 'rejected' }) })).toBe(
      '<div class="conversation__top-overlay">' +
        '<div class="top-overlay-pill top-overlay-pill--error">' +
          `<span class="top-overlay-pill__text">${USAGE_LIMIT_EXHAUSTED_COPY}</span>` +
        '</div>' +
      '</div>'
    )
  })

  // An unrecognised status is an Error pill that still reads as a warning, and neither untrusted field
  // reaches the markup — text, class or attribute.
  it('draws an unrecognised status as an Error pill and lets no daemon string reach the DOM', () => {
    const markup = render({ reading: reading({ status: 'DAEMON_STATUS_SENTINEL', limitType: 'DAEMON_LIMIT_SENTINEL' }) })
    expect(markup).toContain('top-overlay-pill--error')
    expect(markup).toContain(USAGE_LIMIT_WARNING_COPY)
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('SENTINEL')
  })

  it('draws Re-pair alone as an Error pill button with its visible text as the name', () => {
    expect(render({ repair: true })).toBe(`<div class="conversation__top-overlay">${REPAIR_PILL}</div>`)
  })

  it('stacks the usage pill above the Re-pair pill in one overlay', () => {
    const markup = render({ reading: reading({ status: 'rejected' }), repair: true })
    expect(markup.match(/conversation__top-overlay/g)).toHaveLength(1)
    expect(markup.indexOf(USAGE_LIMIT_EXHAUSTED_COPY)).toBeLessThan(markup.indexOf(COMPOSER_REPAIR_BUTTON_COPY))
    expect(markup.endsWith(`${REPAIR_PILL}</div>`)).toBe(true)
  })

  it('keeps Re-pair when the usage reading is dismissed', () => {
    expect(render({ reading: reading(), dismissed: reading(), repair: true }))
      .toBe(`<div class="conversation__top-overlay">${REPAIR_PILL}</div>`)
  })

  it.each([
    ['status', { status: 'rejected' }],
    ['limit type', { limitType: 'seven_day' }],
    ['reset time', { resetsAt: NOW + 3600 }]
  ] as const)('shows the pill again once the %s changes', (_field, change) => {
    expect(render({ reading: reading(change), dismissed: reading() })).toContain('top-overlay-pill__text')
  })
})


describe('permission resolution pill', () => {
  it.each([
    ['remote', 'Resolved on another device'],
    ['timeout', 'Request timed out']
  ] as const)('renders %s with exact client copy, Default treatment and X', (resolution, copy) => {
    const markup = render({ resolution })
    expect(markup).toContain(`<div class="top-overlay-pill top-overlay-pill--default"><span class="top-overlay-pill__text">${copy}</span>`)
    expect(markup).toContain('aria-label="Dismiss permission resolution notice"')
    expect(markup).toContain('<svg width="8" height="8"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('top-overlay-pill--error')
    expect(markup).not.toContain('remote')
    expect(markup).not.toContain('timeout')
  })

  it('stacks usage, resolution and Re-pair in one overlay', () => {
    const markup = render({ reading: reading(), resolution: 'remote', repair: true })
    expect(markup.match(/conversation__top-overlay/g)).toHaveLength(1)
    expect(markup.indexOf(USAGE_LIMIT_WARNING_COPY)).toBeLessThan(markup.indexOf('Resolved on another device'))
    expect(markup.indexOf('Resolved on another device')).toBeLessThan(markup.indexOf(COMPOSER_REPAIR_BUTTON_COPY))
    expect(markup.match(/top-overlay-pill--default/g)).toHaveLength(2)
  })
})
