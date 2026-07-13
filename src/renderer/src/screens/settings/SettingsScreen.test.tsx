import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsScreen } from './SettingsScreen'

// The #218 idiom: server-render the pure view with an injected callback — no DOM harness, no store, no
// live connection. SettingsScreen is a stateless scaffold (props in, markup out), so a server-rendered
// string proves its chrome + Connection container without a jsdom harness.
const noop = (): void => {}

const render = (): string =>
  renderToStaticMarkup(<SettingsScreen onBack={noop} onPairAnother={noop} />)

describe('SettingsScreen', () => {
  it('renders the "Settings" title (AC2)', () => {
    expect(render()).toContain('>Settings</h1>')
  })

  it('renders the back affordance with its accessible name (AC2)', () => {
    expect(render()).toContain('aria-label="Back"')
  })

  it('renders the "Connection" section heading (AC4)', () => {
    expect(render()).toContain('>Connection</h2>')
  })

  it('renders the root region marker for the screen (AC5)', () => {
    expect(render()).toContain('aria-label="Settings screen"')
  })

  it('mounts the #334 Server row (loading branch) in the Connection section (AC2/AC3)', () => {
    // The Connection section now composes ServerInfoData (headless loader) + ServerRowControl. Under
    // server render zustand v5 reads the store's initial `null`, so the row shows its loading branch —
    // proving both are wired into the section-body. No seeded value reaches a server-rendered container.
    const markup = render()
    expect(markup).toContain('Server') // the row's "Server" label
    expect(markup).toContain('Loading') // the not-yet-loaded placeholder
    expect(markup).toContain('settings__section-body') // still the documented mount point
    // AC4: this slice introduces no #330 two-dot marker; no seeded serverId at server render.
    expect(markup).not.toContain('aria-label="Connection status"')
    expect(markup).not.toContain('juhana-mac-2026')
  })

  it('mounts the #152 "Pair another server" row in the Connection section (AC1)', () => {
    // The nav row's text content is its accessible name (a <button>, no aria-label). Interaction
    // (click → onPairAnother) is not exercisable under renderToStaticMarkup; the wiring is closed by
    // composition — row present here + openPairServer → pairServer (pairedRoute.test.ts) + pairServer
    // route renders PairingScreen (PairedShell.test.tsx). Same server-render-only posture as the suite.
    const markup = render()
    expect(markup).toContain('Pair another server')
    expect(markup).toContain('settings__pair-another-row') // mounted as a button, not static text
  })

  it('renders the "Storage" section heading (#351 AC1)', () => {
    expect(render()).toContain('>Storage</h2>')
  })

  it('mounts the #351 archived-count row (placeholder branch) in the Storage section (AC2/AC4)', () => {
    // Under server render zustand v5 reads the store's initial `null`, so the container resolves to the
    // not-yet-loaded branch — the em-dash placeholder, never "0 archived" (a loaded value can't reach a
    // server-rendered container). The populated count paths are proven on the pure view.
    const markup = render()
    expect(markup).toContain('Archived conversations') // the row's label
    expect(markup).toContain('—') // the neutral not-yet-loaded placeholder
    expect(markup).not.toContain('0 archived') // 0 is a loaded value; must not appear pre-load
  })

  it('renders the "About" section heading (#350 AC1)', () => {
    expect(render()).toContain('>About</h2>')
  })

  it('renders the running build version readout (#350 AC2)', () => {
    // The version is the compile-time constant __APP_VERSION__, fed from package.json's `version` via
    // the Vite `define` mirrored into vitest.config.ts — today "0.1.0". Not a daemon round-trip.
    expect(render()).toContain('Version 0.1.0')
  })
})
