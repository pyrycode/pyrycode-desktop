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

  it('is a data-free scaffold — no #334 Server row yet (AC4)', () => {
    // The Connection section is an empty container this slice; #334 mounts the store-bound Server row
    // (the "Server" label + the `juhana-mac-2026` host sentinel) into it later.
    const markup = render()
    expect(markup).not.toContain('Server')
    expect(markup).not.toContain('juhana-mac-2026')
    // The mount point exists but is empty.
    expect(markup).toContain('settings__section-body')
  })
})
