import { describe, it, expect } from 'vitest'
import {
  COMPOSER_OPTIONS_LABEL_INSET_PX,
  composerOptionsShiftPx
} from './composerOptionsPlacement'

// The arithmetic is isolated in composerOptionsPlacement.ts precisely so it can be tested here: vitest
// runs in the `node` environment (vitest.config.ts) with no DOM, no jsdom and no layout engine, so the
// measuring half of this feature — the anchor's rect, the panel's offsetWidth, window.innerWidth, the
// useLayoutEffect that writes the result back — cannot be exercised at all. composerOptionsShiftPx takes
// three plain numbers, so it is a total function this environment can cover completely.
//
// AC1 (opens upward) and AC2 (the 12px-left alignment) get NO test here and none anywhere: they are
// stylesheet declarations, and per the ruling at ConversationScreen.test.tsx:1128-1132 server render has
// no layout engine to detect them. #838's standing prohibition also holds — conversation.css is not read
// as text from a test — and no e2e proof exists either, because no footer button opens the panel until
// #680. AC3 is the one criterion with a detector, and this file is it.
//
// The window is 800 throughout: the app's minimum width (CLAUDE.md), and the width at which the clamp is
// reachable, so every scenario below is a case that can actually occur rather than a constructed one.

describe('COMPOSER_OPTIONS_LABEL_INSET_PX', () => {
  it('is 12, mirroring .composer-options__item’s left padding (AC2)', () => {
    // The pair: `.composer-options__item { padding: 0 var(--space-3) }` (conversation.css:3163) insets a
    // row's label 12px from the panel's left edge, and the panel's `left` negates exactly that so the
    // label lands on its button's label. The two are ONE quantity seen from two sides — a change to
    // either must move both, or the labels drift. There is no cross-file detector for that coupling
    // (the stylesheet is not read from a test), so this pin plus the paired comments carry it, exactly
    // as AT_BOTTOM_TOLERANCE_PX is carried.
    expect(COMPOSER_OPTIONS_LABEL_INSET_PX).toBe(12)
  })
})

describe('composerOptionsShiftPx', () => {
  it('does not move a panel that fits with room to spare (AC3)', () => {
    // A mid-footer button with a moderately wide panel: resting left 488, right edge 688, well inside 800.
    expect(
      composerOptionsShiftPx({ anchorLeft: 500, panelWidth: 200, windowWidth: 800 })
    ).toBe(0)
  })

  it('does not move a panel whose resting right edge lands exactly on the window edge (AC3)', () => {
    // The boundary that decides `>` versus `>=` in the overflow comparison. With the drawn 81px panel the
    // clamp engages once the button's left edge passes 800 - 81 + 12 = 731; AT 731 the panel's right edge
    // is 800 exactly and it must not be nudged by a pixel.
    expect(
      composerOptionsShiftPx({ anchorLeft: 731, panelWidth: 81, windowWidth: 800 })
    ).toBe(0)
  })

  it('shifts an overflowing panel by exactly its overflow, landing its right edge on the window edge (AC3)', () => {
    // #683's model menu is much wider than the drawn 81px, so it overflows from a button well inside the
    // footer's 468-752 span. The invariant, not the formula: after the shift the panel's right edge sits
    // ON the window's right edge.
    const metrics = { anchorLeft: 700, panelWidth: 140, windowWidth: 800 }
    const shift = composerOptionsShiftPx(metrics)

    expect(shift).toBe(28)

    const shiftedRightEdge =
      metrics.anchorLeft - COMPOSER_OPTIONS_LABEL_INSET_PX - shift + metrics.panelWidth
    expect(shiftedRightEdge).toBe(metrics.windowWidth)
  })

  it('clamps to the window edge, not to the chat pane — the 20px gutter overhang is deliberate (AC3)', () => {
    // The geometry decision's detector. At 800px the chat pane's right edge is 780 (800 - 20 shell
    // padding, pairedShell.css:24) while the window's is 800, so a clamped panel sits over that 20px
    // gutter. That is intended: the gutter is .paired-shell's own empty backdrop, the panel is an
    // overlay, and AC3 names the window. Clamping to the pane instead would return 48 here.
    const shift = composerOptionsShiftPx({ anchorLeft: 700, panelWidth: 140, windowWidth: 800 })

    expect(shift).toBe(28)
    expect(700 - COMPOSER_OPTIONS_LABEL_INSET_PX - shift + 140).toBeGreaterThan(780)
  })

  it('never shifts from the leftmost reachable anchor — the left edge is out of reach (AC3)', () => {
    // The sidebar is flex: 0 0 400px and never shrinks (pairedShell.css:43), so the leftmost footer
    // button's left edge is 20 + 400 + 20 + 12 + 16 = 468 at EVERY window width, and the panel's
    // leftmost resting edge is 456. Documents why there is no left clamp: no Math.min, no second branch,
    // because no input can reach one.
    expect(
      composerOptionsShiftPx({ anchorLeft: 468, panelWidth: 81, windowWidth: 800 })
    ).toBe(0)
  })

  it('passes fractional metrics through unrounded (AC3)', () => {
    // getBoundingClientRect() returns fractions and CSS lengths accept them, so rounding here would be a
    // silent half-pixel drift with nothing asking for it. The values are halves and quarters, exact in
    // binary floating point, so this tests the absence of rounding rather than FP error: resting left
    // 728.5, right edge 809.75, overflow 9.75.
    expect(
      composerOptionsShiftPx({ anchorLeft: 740.5, panelWidth: 81.25, windowWidth: 800 })
    ).toBe(9.75)
  })

  it('returns zero for a zero-width panel rather than throwing (AC3)', () => {
    // A panel with no options cannot overflow from a reachable anchor. Answered by the single expression
    // — the overflow goes negative — rather than by a guard.
    expect(composerOptionsShiftPx({ anchorLeft: 752, panelWidth: 0, windowWidth: 800 })).toBe(0)
  })
})
