import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ServerRow, ServerRows } from './ServerRow'
import type { ServerInfoValue } from '../../store/serverInfoStore'

// The ConnectionStatusIndicator discipline (#330): the populated/null matrix (AC5) is proven on the PURE
// view with injected props, server-rendered to a string. The store-bound container's populated branch is
// unreachable under renderToStaticMarkup (zustand v5 reads getInitialState() = the empty list), so the
// "seeded/fake store" is just the value a seeded `selectServers` would return, passed straight in — never
// the global singleton `serverInfoStore` (a module-global; seeding it risks cross-test contamination and
// wouldn't reach the server-rendered container anyway). #1148 puts the one-row-per-entry loop on the
// exported `ServerRows` view for exactly this reason: a two-entry injection is a server render, whereas a
// loop inside the container would only be reachable through a vi.mock of the store module.
const render = (serverInfo: ServerInfoValue | null): string =>
  renderToStaticMarkup(<ServerRow serverInfo={serverInfo} />)

const renderList = (servers: ServerInfoValue[]): string =>
  renderToStaticMarkup(<ServerRows servers={servers} />)

// Occurrences of a needle in the markup — the row counter. `class="settings__server-row"` carries its
// closing quote so it cannot also match the `settings__server-row-text` / `-id` / `-relay` children.
const countOf = (markup: string, needle: string): number => markup.split(needle).length - 1

const populated: ServerInfoValue = { serverId: 'juhana-mac-2026', relayUrl: 'wss://relay.example' }
const second: ServerInfoValue = { serverId: 'pyrybox-2', relayUrl: 'wss://second-relay.example' }

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

describe('ServerRows', () => {
  it('renders one row per paired server, each with its own id and relay, in the given order (AC2)', () => {
    const markup = renderList([populated, second])

    expect(countOf(markup, 'class="settings__server-row"')).toBe(2)
    expect(markup).toContain('juhana-mac-2026')
    expect(markup).toContain('wss://relay.example')
    expect(markup).toContain('pyrybox-2')
    expect(markup).toContain('wss://second-relay.example')
    // Store order is preserved (oldest-paired first, straight through from list()) — not re-sorted.
    expect(markup.indexOf('juhana-mac-2026')).toBeLessThan(markup.indexOf('pyrybox-2'))
    // The "Server" label repeats per row rather than being hoisted into a section header.
    expect(countOf(markup, '>Server<')).toBe(2)
    // No row is a placeholder when every entry is present.
    expect(markup).not.toContain('Loading')
  })

  it('renders one row for one paired server', () => {
    const markup = renderList([populated])
    expect(countOf(markup, 'class="settings__server-row"')).toBe(1)
    expect(markup).toContain('juhana-mac-2026')
    expect(markup).not.toContain('Loading')
  })

  it('renders the existing placeholder row when nothing is paired — no blank section, no empty row (AC3)', () => {
    const markup = renderList([])
    expect(countOf(markup, 'class="settings__server-row"')).toBe(1)
    expect(markup).toContain('Server')
    expect(markup).toContain('Loading')
    expect(markup).toContain('settings__server-status-slot')
  })

  it('mints NO distinct "no servers" copy — the empty list renders byte-identically to the null row (AC3)', () => {
    // The exact-markup pin is the detector for "no new copy string": any new empty-state wording, or a
    // structurally different empty branch, breaks the equality even if it still contains 'Loading'.
    expect(renderList([])).toBe(render(null))
  })

  it('scales past two servers without collapsing or deduplicating rows', () => {
    const third: ServerInfoValue = { serverId: 'srv-3', relayUrl: 'wss://third.example' }
    expect(countOf(renderList([populated, second, third]), 'class="settings__server-row"')).toBe(3)
  })

  it('keeps every daemon-sourced value an escaped text child — never an attribute or a URL', () => {
    // CLAUDE.md: daemon text may be rendered, escaped and length-bounded, but never into a raw-markup
    // sink, an attribute, or a URL. With N rows a title= tooltip or an <a href={relayUrl}> is the
    // natural usability reflex for an overflowing relay line; this pins that neither is here.
    const hostile: ServerInfoValue = {
      serverId: '<script>alert(1)</script>',
      relayUrl: 'wss://relay.example/"onmouseover="alert(1)'
    }
    const markup = renderList([hostile, populated])

    // Escaped as a text child: the angle brackets and the quotes that would end an attribute are all
    // entity-encoded, so the injected `onmouseover=` survives only as inert text between &quot;s.
    expect(markup).not.toContain('<script>')
    expect(markup).toContain('&lt;script&gt;')
    expect(markup).toContain('&quot;onmouseover=&quot;')
    // ...and no row puts either value where escaping would not save it. React entity-encodes `"`, so
    // an attribute sink is the only way these could become markup — and there is none.
    expect(markup).not.toContain('href=')
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('dangerouslySetInnerHTML')
  })
})
