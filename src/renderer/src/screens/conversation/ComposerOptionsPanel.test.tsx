import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ComposerOptionsMenu,
  ComposerOptionsPanel,
  COMPOSER_OPTIONS_UNAVAILABLE_NOTE,
  type ComposerOptionsPanelOption
} from './ComposerOptionsPanel'

// #838: no DOM harness — vitest.config.ts sets `environment: 'node'` and there is no jsdom and no
// @testing-library, so nothing here can click, focus or measure. ComposerOptionsPanel is a pure view
// (props in, markup out, no state and no effects), so a server-rendered string proves the whole tested
// contract: one row per option in array order, the current-value modifier on exactly the matching row,
// the ARIA shape, and untrusted labels escaped. The PermissionModalView / ThreadOverflowMenuView posture.
//
// Only AC4 has a detector. AC2 (28px rows, the 12px inset, body-small), AC3 (the 2px vertical padding,
// content-driven width) and AC5 (no z-index) are stylesheet DECLARATIONS and server render has no layout
// engine — per the ruling at ConversationScreen.test.tsx:1128-1132 those are left to the stylesheet and
// the test pins that the class hooks they hang off are ON the elements. Do not add a DOM environment to
// reach them (CLAUDE.md: that is a separate, deliberate decision). No e2e proof is available either — the
// panel has no host in the app until #839.
//
// `onSelect` is wired to each row's onClick and is NOT exercised here: a static render fires no events.
// #840's e2e tier drives it.

const noop = (): void => {}

// #840 added `focusedIndex`, defaulted here so the seven tests above it are untouched — which is the proof
// the new prop is additive. `panelRef` is omitted throughout: a native <div> accepts ref={undefined}, and a
// static render could not exercise a ref anyway (the ThreadOverflowMenuView `triggerRef` convention).
function renderPanel(
  options: readonly ComposerOptionsPanelOption[],
  currentId: string | null,
  ariaLabel = 'Effort level',
  focusedIndex = 0
): string {
  return renderToStaticMarkup(
    <ComposerOptionsPanel
      options={options}
      currentId={currentId}
      onSelect={noop}
      ariaLabel={ariaLabel}
      focusedIndex={focusedIndex}
    />
  )
}

// The current value is the MIDDLE entry, so order and current-marking stay independent properties (the
// PermissionModal.test.tsx PROMPT convention). Ids deliberately differ in case from the labels so a
// label/id mix-up cannot pass by coincidence.
const OPTIONS: readonly ComposerOptionsPanelOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'max', label: 'Max' },
  { id: 'ultracode', label: 'Ultracode' }
]

// Count ROWS specifically — match the class attribute's leading token bounded by a closing quote or the
// space before the --current modifier, so the panel div does not inflate the count and the current row
// (whose leading token is still the only one preceded by `class="`) still counts exactly once.
function rowCount(markup: string): number {
  return markup.match(/class="composer-options__item["\s]/g)?.length ?? 0
}

function countOf(markup: string, needle: string): number {
  return markup.split(needle).length - 1
}

// The text of the row that is in the tab order, or null when no row is. Read off the parsed <button> tag
// rather than a literal attribute run, so these assertions do not couple to JSX prop order — the one
// non-blocking NIT #838's code review left on this file.
function focusableRowLabel(markup: string): string | null {
  return markup.match(/<button[^>]*tabindex="0"[^>]*>([^<]*)</)?.[1] ?? null
}

describe('ComposerOptionsPanel', () => {
  it('renders one row per option, in array order (AC4 ordering)', () => {
    const markup = renderPanel(OPTIONS, null)
    expect(rowCount(markup)).toBe(OPTIONS.length)
    // Every label reaches the markup, and their positions are strictly increasing in the order the
    // `options` array gave them — the panel does not sort.
    const positions = OPTIONS.map((option) => markup.indexOf(`>${option.label}<`))
    expect(positions.every((at) => at >= 0)).toBe(true)
    expect(positions).toStrictEqual([...positions].sort((a, b) => a - b))
    expect(new Set(positions).size).toBe(OPTIONS.length)
  })

  it('marks exactly the current option, and marks it with the base class kept (AC4, positive)', () => {
    const markup = renderPanel(OPTIONS, 'max')
    // The WHOLE class attribute, never the modifier alone: `composer-options__item--current` CONTAINS
    // `composer-options__item` as a substring, so a bare toContain would pass on markup that dropped the
    // base class and kept only the modifier — the vacuity conversation.css:779-781 was written against.
    expect(
      countOf(markup, 'class="composer-options__item composer-options__item--current"')
    ).toBe(1)
    // ...on the row whose text is the current option's label, not merely somewhere in the panel.
    expect(markup).toContain(
      'class="composer-options__item composer-options__item--current" aria-current="true">Max<'
    )
    // The other two rows carry the base class and nothing else.
    expect(countOf(markup, 'class="composer-options__item">')).toBe(2)
    expect(countOf(markup, '--current')).toBe(1)
    expect(countOf(markup, 'aria-current="true"')).toBe(1)
  })

  it('marks no row when there is no current value — a command list, not a choice (AC4, negative)', () => {
    const markup = renderPanel(OPTIONS, null)
    expect(markup).not.toContain('--current')
    expect(markup).not.toContain('aria-current')
    // The rows are all still there, all wearing the plain base class.
    expect(countOf(markup, 'class="composer-options__item">')).toBe(OPTIONS.length)
  })

  it('marks no row when the current value matches no option (AC4, stale value)', () => {
    // Identical to `null` through the SAME branch — no guard, no throw. Pinned so a later ticket cannot
    // quietly turn a stale model id or a renamed effort level into a crash.
    const markup = renderPanel(OPTIONS, 'gone')
    expect(markup).toBe(renderPanel(OPTIONS, null))
    expect(markup).not.toContain('--current')
    expect(markup).not.toContain('aria-current')
  })

  it('matches the current value on the option id, never on its label', () => {
    // #683's model menu shows `Opus 5` for `claude-opus-5` and #682's permission menu shows
    // `Accept edits` for `acceptEdits` — matching on the display string would force both to invent a
    // lookup, so the id/label split is a tested property rather than a convention.
    const models: readonly ComposerOptionsPanelOption[] = [
      { id: 'claude-opus-5', label: 'Opus 5' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' }
    ]
    expect(renderPanel(models, 'claude-opus-5')).toContain(
      'class="composer-options__item composer-options__item--current" aria-current="true">Opus 5<'
    )
    // The LABEL is not an accepted key for the same row.
    expect(renderPanel(models, 'Opus 5')).not.toContain('--current')
  })

  it('carries the menu ARIA shape, named by the control that opened it', () => {
    const markup = renderPanel(OPTIONS, 'max', 'Effort level')
    expect(markup).toContain('<div class="composer-options" role="menu" aria-label="Effort level">')
    // Every row is a real <button type="button"> — Enter/Space activation comes free, and #840 layers
    // roving focus on top of it rather than re-implementing key handling.
    expect(countOf(markup, '<button type="button" role="menuitem"')).toBe(OPTIONS.length)
  })

  it('renders a hostile label as inert escaped text, never as markup', () => {
    // #694 feeds this panel WORKSPACE-AUTHORED command names, so this is load-bearing, per CLAUDE.md's
    // daemon-text ruling: rendered and escaped is fine, a raw-markup sink is not.
    const hostile = '<img src=x onerror="alert(1)">'
    const markup = renderPanel([{ id: 'hostile', label: hostile }], null)
    expect(markup).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(markup).not.toContain('<img')
    // Matching on the QUOTE is what makes this a detector: escaped output carries a literal
    // ` onerror=&quot;` run, so a bare /\son[a-z]+=/ would fail on CORRECT output — it is the unescaped
    // `="` that only an HTML sink could produce. A bare not.toContain('src=') would pass vacuously.
    expect(markup).not.toMatch(/\son[a-z]+="/i)
    expect(markup).not.toContain('alert(1)"')
  })

  it('renders the bare surface for an empty option list, without throwing', () => {
    // No empty-state branch by design: consumers gate on options.length, and #694 owns the "no matches"
    // question. Zero options is a 4px-tall surface, not a crash and not an invented placeholder row.
    const markup = renderPanel([], null)
    expect(markup).toBe('<div class="composer-options" role="menu" aria-label="Effort level"></div>')
    expect(markup).not.toContain('<button')
  })

  // #840: a ROVING TABINDEX. Exactly one row is in the tab order and the rest are reachable only
  // programmatically, which is what lets the container move real DOM focus between them — and real focus is
  // what both the shipped `:focus-visible` outline and AC5's "returns focus to the trigger" are written in
  // terms of. aria-activedescendant was rejected for exactly that: it leaves focus on the panel.
  it('puts exactly the focused row in the tab order (AC2)', () => {
    const markup = renderPanel(OPTIONS, null, 'Effort level', 1)
    expect(countOf(markup, 'tabindex="0"')).toBe(1)
    expect(countOf(markup, 'tabindex="-1"')).toBe(OPTIONS.length - 1)
    // …and it is the row the index addresses, not merely some row.
    expect(focusableRowLabel(markup)).toBe('Max')
  })

  it('opens the tab order on the first row when focus starts there', () => {
    const markup = renderPanel(OPTIONS, null, 'Effort level', 0)
    expect(countOf(markup, 'tabindex="0"')).toBe(1)
    expect(focusableRowLabel(markup)).toBe('Low')
  })

  it('keeps the current value and the focused row as independent axes', () => {
    // The assertion that stops a later ticket collapsing focus onto the current value. The current row is
    // what the menu READS; the focused row is where the arrows ARE. They coincide only on the frame the
    // panel opens, and after one ArrowDown they must not.
    const markup = renderPanel(OPTIONS, 'max', 'Effort level', 2)
    expect(focusableRowLabel(markup)).toBe('Ultracode')
    expect(countOf(markup, 'aria-current="true"')).toBe(1)
    expect(markup).toContain('composer-options__item--current" aria-current="true">Max<')
  })

  it('marks no row focusable when the focused index addresses no option', () => {
    // Mirrors the stale-currentId test above: no special case, no throw and no invented fallback row. The
    // container cannot produce this — resolveComposerOptionsKey normalises every index it emits — so the
    // view simply does not pretend to have an answer.
    const markup = renderPanel(OPTIONS, null, 'Effort level', 7)
    expect(countOf(markup, 'tabindex="0"')).toBe(0)
    expect(countOf(markup, 'tabindex="-1"')).toBe(OPTIONS.length)
    expect(rowCount(markup)).toBe(OPTIONS.length)
  })
})

// #840: the interaction container. Its open state is internal useState, so a static render sees only the
// CLOSED shape — which is exactly AC1's ARIA half, and it is reachable because effects do not run under
// renderToStaticMarkup. The opened markup is proved directly through ComposerOptionsPanel's own tests
// above; the useState transitions, the document listeners, the preventDefault calls and the focus moves are
// untested reviewed glue, per the ruling at ConversationScreen.test.tsx:2523-2528 for #276's container. The
// in-app interaction proof rides #680, the first consumer with a real trigger in a real footer.
describe('ComposerOptionsMenu — the interaction container, collapsed (#840)', () => {
  function renderMenu(): string {
    return renderToStaticMarkup(
      <ComposerOptionsMenu
        options={OPTIONS}
        currentId="max"
        onSelect={noop}
        ariaLabel="Effort level"
        triggerContent="Max"
        triggerClassName="composer__effort-trigger"
      />
    )
  }

  it('renders the anchor and a trigger advertising a closed menu popup (AC1)', () => {
    const markup = renderMenu()
    // The #839 wrapper, with NO style prop. Since #847 the clamp lives in this container, so this reads:
    // --composer-options-shift is written IMPERATIVELY in a layout effect, which no static render runs, so
    // the resting markup is unchanged. It is the deterministic detector for that decision — the declarative
    // form would append style="--composer-options-shift:0px" and fail this whole opening tag.
    expect(markup).toContain('<div class="composer-options-anchor">')
    expect(markup).toContain('aria-haspopup="menu"')
    // React stringifies the aria boolean under server render → "false", directly assertable.
    expect(markup).toContain('aria-expanded="false"')
  })

  it('wears the consumer label and appearance, and names itself with neither', () => {
    const markup = renderMenu()
    expect(markup).toContain('class="composer__effort-trigger"')
    expect(markup).toContain('>Max</button>')
    // NO aria-label on the trigger. `triggerContent` is visible text, so an aria-label would override it
    // and break WCAG 2.5.3's label-in-name — the trigger's accessible name has to BE what it reads.
    expect(markup).not.toContain('aria-label=')
  })

  it('renders no panel while closed', () => {
    const markup = renderMenu()
    expect(markup).not.toContain('role="menu"')
    expect(markup).not.toContain('composer-options__item')
    expect(countOf(markup, '<button')).toBe(1)
  })

  it('supports a named icon trigger with bottom-end placement', () => {
    const markup = renderToStaticMarkup(
      <ComposerOptionsMenu
        options={OPTIONS}
        currentId={null}
        onSelect={noop}
        ariaLabel="More actions"
        triggerAriaLabel="More actions"
        triggerContent={<span aria-hidden="true">⋮</span>}
        triggerClassName="conversation__overflow-trigger"
        placement="bottom-end"
      />
    )
    expect(markup).toContain('class="composer-options-anchor composer-options-anchor--bottom-end"')
    expect(markup).toContain('aria-label="More actions"')
    expect(markup).toContain('aria-expanded="false"')
  })
})

// #681 — the optional `unavailable` marking. The affordance's own end-to-end proof (a published list
// greying an Actions entry) is ComposerActionsMenu.test.tsx's; what this block owns is the SHARED
// surface's contract: the marking composes with `currentId`, and a consumer that passes nothing renders
// byte-for-byte what it rendered before the field existed.
describe('ComposerOptionsPanel unavailable rows (#681)', () => {
  it('renders identically when no option carries the field — the four other consumers (AC5)', () => {
    // The explicit `=== true` read, from the outside: `false` and absent are the same rendering, so a
    // later `if (option.unavailable)` truthiness slip would still pass here — but an implementation that
    // emitted aria-disabled="false" or appended an empty modifier would not.
    const spelled = OPTIONS.map((option) => ({ ...option, unavailable: false }))
    expect(renderPanel(spelled, 'max')).toBe(renderPanel(OPTIONS, 'max'))
    expect(renderPanel(OPTIONS, 'max')).not.toContain('aria-disabled')
    expect(renderPanel(OPTIONS, 'max')).not.toContain('--unavailable')
    expect(renderPanel(OPTIONS, 'max')).not.toContain('composer-options__unavailable-note')
  })

  it('marks exactly the unavailable rows, base class kept (AC1, AC4)', () => {
    const markup = renderPanel(
      [OPTIONS[0], { ...OPTIONS[1], unavailable: true }, OPTIONS[2]],
      null
    )
    expect(rowCount(markup)).toBe(OPTIONS.length)
    expect(
      countOf(markup, 'class="composer-options__item composer-options__item--unavailable"')
    ).toBe(1)
    expect(countOf(markup, 'aria-disabled="true"')).toBe(1)
    expect(countOf(markup, COMPOSER_OPTIONS_UNAVAILABLE_NOTE)).toBe(1)
    // The two available rows are still exactly what they were.
    expect(countOf(markup, 'class="composer-options__item">')).toBe(2)
  })

  // aria-disabled, never the HTML `disabled` attribute: the container moves real DOM focus onto the
  // focused row, and a disabled <button> is not focusable — arrow navigation would appear stuck. The row
  // also keeps role="menuitem" and its place in the roving tabindex.
  it('keeps an unavailable row focusable and in the menu (the ARIA disabled-item pattern)', () => {
    const markup = renderPanel([{ ...OPTIONS[0], unavailable: true }, OPTIONS[1]], null)
    expect(markup).not.toContain(' disabled')
    expect(countOf(markup, 'role="menuitem"')).toBe(2)
    expect(focusableRowLabel(markup)).toBe(OPTIONS[0].label)
  })

  // Both modifiers on one row, in a fixed order, with the base class first — a menu that offers a CHOICE
  // (#682/#683) can in principle mark its own current value unavailable, and the class run must stay a
  // single predictable string rather than depending on which flag was read first.
  it('composes with the current-row marking, base first', () => {
    const markup = renderPanel([OPTIONS[0], { ...OPTIONS[1], unavailable: true }], 'max')
    expect(markup).toContain(
      'class="composer-options__item composer-options__item--current composer-options__item--unavailable" aria-current="true" aria-disabled="true">Max<'
    )
  })
})
