import { describe, it, expect } from 'vitest'
import { join } from 'path'
import { selectDockIcon } from './dockIcon'

// The dev-only dock affordance is exercised through its real entry point with plain values for all
// three effectful inputs, the windowPresentation.test.ts / relayPolicy.test.ts idiom. Because
// dockIcon.ts imports no `electron`, this whole file runs in plain Node.
//
// The packaged-darwin case is the load-bearing one and the reason the two happy paths are not enough:
// `app.dock.setIcon` reaches outside the app into OS chrome, and AC2 says a packaged build is
// untouched. That is a property of the ORDER of two checks, which a later edit could reverse without
// changing anything the other cases observe.

describe('selectDockIcon', () => {
  it('names the committed master under the app path on an unpackaged macOS run', () => {
    expect(
      selectDockIcon({ isPackaged: false, platform: 'darwin', appPath: '/work/pyrycode-desktop' })
    ).toBe(join('/work/pyrycode-desktop', 'build', 'icon.png'))
  })

  it('sets no icon off darwin — Electron defines app.dock on macOS only', () => {
    for (const platform of ['win32', 'linux'] as const) {
      expect(
        selectDockIcon({ isPackaged: false, platform, appPath: '/work/pyrycode-desktop' }),
        platform
      ).toBeUndefined()
    }
  })

  it('short-circuits on isPackaged before the platform — a packaged macOS build is untouched', () => {
    expect(
      selectDockIcon({ isPackaged: true, platform: 'darwin', appPath: '/Applications/Pyrycode.app' })
    ).toBeUndefined()
  })
})
