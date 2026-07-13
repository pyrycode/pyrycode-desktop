import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ServerRow } from './ServerRow'
import type { ServerInfoValue } from '../../store/serverInfoStore'

// The ConnectionStatusIndicator discipline (#330): the populated/null matrix (AC5) is proven on the PURE
// view with injected props, server-rendered to a string. The store-bound container's populated branch is
// unreachable under renderToStaticMarkup (zustand v5 reads getInitialState() = null), so the "seeded/fake
// store" is just the value a seeded `selectServerInfo` would return, passed straight in — never the global
// singleton `serverInfoStore` (a module-global; seeding it risks cross-test contamination and wouldn't
// reach the server-rendered container anyway).
const render = (serverInfo: ServerInfoValue | null): string =>
  renderToStaticMarkup(<ServerRow serverInfo={serverInfo} />)

const populated: ServerInfoValue = { serverId: 'juhana-mac-2026', relayUrl: 'wss://relay.example' }

describe('ServerRow', () => {
  it('renders the serverId and relayUrl when the store is populated (AC1)', () => {
    const markup = render(populated)
    expect(markup).toContain('Server') // the always-present label
    expect(markup).toContain('juhana-mac-2026') // primary identity line (serverId)
    expect(markup).toContain('wss://relay.example') // secondary line (desktop-added relayUrl)
    expect(markup).toContain('settings__server-status-slot') // the empty two-dot host slot
  })

  it('shows no loading placeholder once populated (AC3)', () => {
    expect(render(populated)).not.toContain('Loading')
  })

  it('degrades to a graceful placeholder — not blank values — before the fetch resolves (AC3)', () => {
    const markup = render(null)
    expect(markup).toContain('Server') // the label always renders
    expect(markup).toContain('Loading') // a purposeful placeholder, not an empty <p>
    expect(markup).not.toContain('juhana-mac-2026') // no stale value while loading
    expect(markup).toContain('settings__server-status-slot') // slot present in both states
  })

  it('renders an empty host slot with NO #330 two-dot marker in either state (AC4)', () => {
    // The slot is a class-labelled container only; #330's settings-side indicator brings its own
    // aria-label="Connection status". Rendering that marker here would collide.
    expect(render(populated)).not.toContain('aria-label="Connection status"')
    expect(render(null)).not.toContain('aria-label="Connection status"')
  })
})
