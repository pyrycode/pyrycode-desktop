import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerOptionsPanel, type ComposerOptionsPanelOption } from './ComposerOptionsPanel'

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

function renderPanel(
  options: readonly ComposerOptionsPanelOption[],
  currentId: string | null,
  ariaLabel = 'Effort level'
): string {
  return renderToStaticMarkup(
    <ComposerOptionsPanel
      options={options}
      currentId={currentId}
      onSelect={noop}
      ariaLabel={ariaLabel}
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
})
