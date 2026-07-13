import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SettingsScreen } from './SettingsScreen'

// The #218 idiom: server-render the pure view with an injected callback — no DOM harness, no store, no
// live connection. SettingsScreen is a stateless scaffold (props in, markup out), so a server-rendered
// string proves its chrome + Connection container without a jsdom harness.
const noop = (): void => {}

const render = (): string => renderToStaticMarkup(<SettingsScreen onBack={noop} />)

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
})
