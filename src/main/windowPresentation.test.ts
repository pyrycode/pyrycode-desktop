import { describe, it, expect } from 'vitest'
import { selectWindowPresentation, HIDDEN_WINDOW_ENV_FLAG } from './windowPresentation'

// The dev affordance is exercised through its real entry point — selectWindowPresentation — with plain
// values for the two effectful inputs, the relayPolicy.test.ts / secretBackend.test.ts idiom. Because
// windowPresentation.ts imports no `electron`, this whole file runs in plain Node.
//
// The packaged-plus-flag-set case below is the load-bearing one, and it is here for a reason the two
// happy paths do not cover: a window that is never shown while the app is otherwise fully live — IPC
// registered, daemon session connected, secrets readable — is an INVISIBLE PAIRED CLIENT. The whole
// safety of this affordance is that a shipped build cannot be talked into that state by anything an
// attacker can put in the environment. That is a property of the ORDER of two checks, which is exactly
// the kind of thing a later edit can reverse without changing any behaviour the other tests observe.

describe('selectWindowPresentation', () => {
  it('shows the window by default — unpackaged, no flag', () => {
    expect(selectWindowPresentation({ isPackaged: false, env: {} })).toBe('shown')
  })

  it('shows the window in a packaged build with no flag', () => {
    expect(selectWindowPresentation({ isPackaged: true, env: {} })).toBe('shown')
  })

  it('short-circuits on isPackaged before the flag — a packaged build cannot be made to hide its window', () => {
    expect(
      selectWindowPresentation({ isPackaged: true, env: { [HIDDEN_WINDOW_ENV_FLAG]: '1' } })
    ).toBe('shown')
  })

  it('hides the window when unpackaged AND opted in', () => {
    expect(
      selectWindowPresentation({ isPackaged: false, env: { [HIDDEN_WINDOW_ENV_FLAG]: '1' } })
    ).toBe('hidden')
  })

  it('opts in only on the exact string "1" — every other value shows the window', () => {
    for (const value of ['0', '', 'true', 'yes', ' 1', '1 ', 'hidden']) {
      expect(
        selectWindowPresentation({ isPackaged: false, env: { [HIDDEN_WINDOW_ENV_FLAG]: value } }),
        `flag=${JSON.stringify(value)}`
      ).toBe('shown')
    }
  })

  it('names the flag under the PYRY_ prefix the other two dev affordances use', () => {
    // Single-sourced here so the e2e harness imports the constant instead of retyping the string; the
    // prefix is what marks it as one of this app's own opt-ins rather than a Chromium or Electron var.
    expect(HIDDEN_WINDOW_ENV_FLAG.startsWith('PYRY_')).toBe(true)
  })
})
