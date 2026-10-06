import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsScreen } from './SettingsScreen'

// The #218 idiom: server-render the pure view with an injected callback — no DOM harness, no store, no
// live connection. SettingsScreen is a stateless scaffold (props in, markup out), so a server-rendered
// string proves its chrome + Connection container without a jsdom harness.
const noop = (): void => {}

const render = (): string =>
  // #1162's `onUnpaired` is REQUIRED, so dropping it from the shell's settings case is a compile
  // error rather than a Settings screen with no way to forget a server. There is no markup pin for
  // the pass-through: ServerRowControl server-renders the EMPTY store (zustand v5 reads
  // getInitialState()), so no row — and therefore no action — exists to observe here. Its detector is
  // the e2e tier, where settings-per-server-unpair.spec.ts drives the whole chain to the route flip.
  renderToStaticMarkup(<SettingsScreen onBack={noop} onPairAnother={noop} onUnpaired={noop} />)

describe('SettingsScreen', () => {
  it('places Thread directly between Notifications and Storage with the default-on collapse switch', () => {
    const markup = render()
    const headings = [...markup.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((match) => match[1])
    expect(headings.slice(headings.indexOf('Notifications'), headings.indexOf('Storage') + 1))
      .toEqual(['Notifications', 'Thread', 'Storage'])
    const thread = markup.slice(markup.indexOf('>Thread</h2>'), markup.indexOf('>Storage</h2>'))
    expect(thread).toContain('role="switch" aria-checked="true" aria-label="Collapse assistant tool uses"')
  })

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

  it('renders the "Defaults for new conversations" section heading (#404 AC1)', () => {
    expect(render()).toContain('>Defaults for new conversations</h2>')
  })

  it('mounts the #404 Default workspace row (placeholder branch) in the Defaults section (AC1/AC2)', () => {
    // Under server render the defaultWorkspaceStore hydrates to `null` (its typeof-window import guard),
    // so the row shows the "scratch" placeholder — proving the store-bound row is wired into the Defaults
    // section-body as an interactive button, not static text.
    const markup = render()
    expect(markup).toContain('Default workspace') // the row's primary label
    expect(markup).toContain('scratch') // the null-placeholder for the server default
    expect(markup).toContain('settings__default-workspace-row') // mounted as a button, not static text
  })

  it('keeps the workspace picker closed until the row is activated (#404 AC3)', () => {
    // The Control owns the picker open-state (useState, default false), so no picker sheet renders at rest.
    // Interaction (click → open) is not exercisable under renderToStaticMarkup; the closed default proves
    // the picker is not mounted app-level.
    expect(render()).not.toContain('Choose workspace') // the picker sheet's title
  })

  it('places the Defaults section between Connection and Storage (#404 AC1)', () => {
    // Mobile vertical order: Defaults (y=322) above Storage (y=910), below Connection.
    const markup = render()
    expect(markup.indexOf('Connection')).toBeLessThan(
      markup.indexOf('Defaults for new conversations')
    )
    expect(markup.indexOf('Defaults for new conversations')).toBeLessThan(markup.indexOf('Storage'))
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
