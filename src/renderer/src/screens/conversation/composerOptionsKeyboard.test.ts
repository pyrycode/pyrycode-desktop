import { describe, it, expect } from 'vitest'
import {
  initialFocusedOptionIndex,
  resolveComposerOptionsKey,
  type ComposerOptionsKeyOutcome
} from './composerOptionsKeyboard'
import type { ComposerOptionsPanelOption } from './ComposerOptionsPanel'

// #840: the executable half of the ticket. Nothing in this repo can click — vitest.config.ts sets
// `environment: 'node'`, there is no jsdom and no @testing-library — so the keyboard contract was written
// as plain data precisely so a vitest spec can execute it. Every keyboard acceptance criterion is proved
// HERE; the container that feeds this function is untested reviewed glue (see ComposerOptionsPanel.tsx).

// The current value is the MIDDLE entry, so "which option is current" and "which option is first" stay
// independent properties (the ComposerOptionsPanel.test.tsx / PermissionModal.test.tsx convention).
const OPTIONS: readonly ComposerOptionsPanelOption[] = [
  { id: 'low', label: 'Low' },
  { id: 'max', label: 'Max' },
  { id: 'ultracode', label: 'Ultracode' }
]

function on(key: string, focusedIndex: number, optionCount = 3): ComposerOptionsKeyOutcome {
  return resolveComposerOptionsKey({ optionCount, focusedIndex, key })
}

describe('initialFocusedOptionIndex — where focus starts when the panel opens (AC2)', () => {
  it('opens on the current option for a value menu', () => {
    // A value menu (#682 permission mode, #683 model and effort) opens on what it currently reads, which
    // is where the arrows should be relative to. The middle entry, so a "return 0" stub cannot pass.
    expect(initialFocusedOptionIndex(OPTIONS, 'max')).toBe(1)
    expect(initialFocusedOptionIndex(OPTIONS, 'ultracode')).toBe(2)
  })

  it('opens on the first option for a command list', () => {
    // #680 Actions and #694's slash-command list pass currentId: null — a list of actions rather than a
    // choice, so nothing is highlighted and the first entry is where the arrows start.
    expect(initialFocusedOptionIndex(OPTIONS, null)).toBe(0)
  })

  it('opens on the first option when the current value matches nothing', () => {
    // A stale model id or a renamed effort level lands on the first row through the SAME branch as null —
    // no special case and no throw, exactly as ComposerOptionsPanel handles a stale id in its markup.
    expect(initialFocusedOptionIndex(OPTIONS, 'gone')).toBe(initialFocusedOptionIndex(OPTIONS, null))
    expect(initialFocusedOptionIndex(OPTIONS, 'gone')).toBe(0)
  })

  it('matches on the option id, never on its label', () => {
    // #683's model menu shows `Opus 5` for `claude-opus-5`; matching the display string would force it to
    // invent a lookup. The panel's own markup already pins this split — the focus start must share it.
    const models: readonly ComposerOptionsPanelOption[] = [
      { id: 'claude-opus-5', label: 'Opus 5' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' }
    ]
    expect(initialFocusedOptionIndex(models, 'claude-sonnet-5')).toBe(1)
    expect(initialFocusedOptionIndex(models, 'Sonnet 5')).toBe(0)
  })

  it('answers 0 for an empty option list, without throwing', () => {
    expect(initialFocusedOptionIndex([], null)).toBe(0)
    expect(initialFocusedOptionIndex([], 'max')).toBe(0)
  })
})

describe('resolveComposerOptionsKey — arrow keys move focus, and they wrap (AC2)', () => {
  it('ArrowDown moves to the next option', () => {
    expect(on('ArrowDown', 0)).toStrictEqual({ type: 'focus', index: 1 })
    expect(on('ArrowDown', 1)).toStrictEqual({ type: 'focus', index: 2 })
  })

  it('ArrowDown from the last option wraps to the first', () => {
    expect(on('ArrowDown', 2)).toStrictEqual({ type: 'focus', index: 0 })
  })

  it('ArrowUp moves to the previous option', () => {
    expect(on('ArrowUp', 1)).toStrictEqual({ type: 'focus', index: 0 })
    expect(on('ArrowUp', 2)).toStrictEqual({ type: 'focus', index: 1 })
  })

  it('ArrowUp from the first option wraps to the last', () => {
    // The negative-modulo detector: `-1 % 3` is `-1` in JavaScript, so an implementation that subtracts
    // before adding the count back returns -1 here and addresses no row at all.
    expect(on('ArrowUp', 0)).toStrictEqual({ type: 'focus', index: 2 })
  })

  it('treats a lone option as its own neighbour in both directions', () => {
    expect(on('ArrowDown', 0, 1)).toStrictEqual({ type: 'focus', index: 0 })
    expect(on('ArrowUp', 0, 1)).toStrictEqual({ type: 'focus', index: 0 })
  })

  it('always lands inside the option list, from any focused index (totality)', () => {
    // The property that makes the container's `options[outcome.index]` safe, and worth more than the
    // individual arrow cases above: #694 filters the option list WHILE the panel is open, so a
    // focusedIndex left over from a longer list is a shape a named consumer will actually produce.
    for (let optionCount = 1; optionCount <= 5; optionCount++) {
      for (let focusedIndex = -1; focusedIndex <= optionCount; focusedIndex++) {
        for (const key of ['ArrowDown', 'ArrowUp']) {
          const outcome = on(key, focusedIndex, optionCount)
          expect(outcome.type).toBe('focus')
          if (outcome.type !== 'focus') continue
          expect(Number.isInteger(outcome.index)).toBe(true)
          expect(outcome.index).toBeGreaterThanOrEqual(0)
          expect(outcome.index).toBeLessThan(optionCount)
          // Not merely in range: `Object.is(-0, 0)` is false, so a negative zero out of the modulo would
          // pass every bound above and still fail a strict comparison at a later call site.
          expect(Object.is(outcome.index, -0)).toBe(false)
        }
      }
    }
  })
})

describe('resolveComposerOptionsKey — Enter picks, Escape dismisses (AC3, AC4)', () => {
  it('Enter picks the focused option', () => {
    expect(on('Enter', 1)).toStrictEqual({ type: 'pick', index: 1 })
    expect(on('Enter', 0)).toStrictEqual({ type: 'pick', index: 0 })
    expect(on('Enter', 2)).toStrictEqual({ type: 'pick', index: 2 })
  })

  it('Enter picks nothing when the focused index addresses no option', () => {
    // `pick` is range-guarded so the container's `options[outcome.index]` can never be undefined. Ignoring
    // is the right answer rather than clamping: there is no row under the user's focus to pick.
    expect(on('Enter', 3)).toStrictEqual({ type: 'ignore' })
    expect(on('Enter', -1)).toStrictEqual({ type: 'ignore' })
  })

  it('Escape dismisses without picking, from any focused option', () => {
    expect(on('Escape', 0)).toStrictEqual({ type: 'dismiss' })
    expect(on('Escape', 1)).toStrictEqual({ type: 'dismiss' })
    expect(on('Escape', 2)).toStrictEqual({ type: 'dismiss' })
    // `dismiss` carries no index at all — there is no shape here that could report a selection.
    expect(Object.keys(on('Escape', 1))).toStrictEqual(['type'])
  })
})

describe('resolveComposerOptionsKey — everything else is left alone', () => {
  it('ignores keys the panel does not handle', () => {
    // Space is DELIBERATELY not handled, not forgotten: each row is a real <button>, so the native button
    // activation picks it through the onClick the panel already wires. Intercepting it here would be a
    // second path to the same outcome. Enter is intercepted only because it must be — without a
    // preventDefault the focused row's native activation would fire onSelect a second time.
    for (const key of [' ', 'Spacebar', 'Tab', 'Home', 'End', 'ArrowLeft', 'ArrowRight', 'a', '']) {
      expect(on(key, 1)).toStrictEqual({ type: 'ignore' })
    }
  })

  it('handles nothing but Escape when there are no options', () => {
    // The panel's contract is that consumers gate on options.length, but the function is total regardless.
    expect(on('Escape', 0, 0)).toStrictEqual({ type: 'dismiss' })
    expect(on('ArrowDown', 0, 0)).toStrictEqual({ type: 'ignore' })
    expect(on('ArrowUp', 0, 0)).toStrictEqual({ type: 'ignore' })
    expect(on('Enter', 0, 0)).toStrictEqual({ type: 'ignore' })
  })
})
