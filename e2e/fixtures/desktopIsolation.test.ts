import { describe, expect, it } from 'vitest'
import { e2eShowsWindow, SHOW_WINDOW_E2E_ENV_FLAG } from './desktopIsolation'

describe('e2e window presentation', () => {
  it('keeps the window hidden on macOS and Windows unless the run opts out', () => {
    for (const platform of ['darwin', 'win32'] as const) {
      expect(e2eShowsWindow({}, platform)).toBe(false)
      expect(e2eShowsWindow({ [SHOW_WINDOW_E2E_ENV_FLAG]: 'true' }, platform)).toBe(false)
      expect(e2eShowsWindow({ [SHOW_WINDOW_E2E_ENV_FLAG]: '1' }, platform)).toBe(true)
    }
  })

  it('shows the window on Linux without the opt-out, where a hidden window never paints', () => {
    // A Codex agent's shell drops the dispatcher's PYRY_E2E_SHOW_WINDOW, so the Linux default must
    // already be the one the gate uses.
    expect(e2eShowsWindow({}, 'linux')).toBe(true)
  })
})
