import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ServerRow, ServerRows, type ServerRowUnpair, type UnpairPhase } from './ServerRow'
import type { ServerInfoValue } from '../../store/serverInfoStore'

// The ConnectionStatusIndicator discipline (#330): the populated/null matrix (AC5) is proven on the PURE
// view with injected props, server-rendered to a string. The store-bound container's populated branch is
// unreachable under renderToStaticMarkup (zustand v5 reads getInitialState() = the empty list), so the
// "seeded/fake store" is just the value a seeded `selectServers` would return, passed straight in — never
// the global singleton `serverInfoStore` (a module-global; seeding it risks cross-test contamination and
// wouldn't reach the server-rendered container anyway). #1148 puts the one-row-per-entry loop on the
// exported `ServerRows` view for exactly this reason: a two-entry injection is a server render, whereas a
// loop inside the container would only be reachable through a vi.mock of the store module.
// #1162: the unpair action's props are REQUIRED, following PairedShellView's `paneKey` rule —
// forgetting to wire the action is the exact regression the prop exists to prevent, so it is a
// compile error rather than a silent `undefined`. The render helpers absorb that in ONE place with
// idle-phase spies, so every pre-existing case reads exactly as it did; the phase matrix below passes
// its own.
const idleUnpair = (): ServerRowUnpair => ({
  phase: 'idle',
  onArm: vi.fn(),
  onCancel: vi.fn(),
  onConfirm: vi.fn()
})

const render = (serverInfo: ServerInfoValue | null, unpair = idleUnpair()): string =>
  renderToStaticMarkup(<ServerRow serverInfo={serverInfo} unpair={unpair} />)

type ListUnpair = Parameters<typeof ServerRows>[0]['unpair']

const listUnpair = (phase: UnpairPhase = { kind: 'idle' }): ListUnpair => ({
  phase,
  onArm: vi.fn(),
  onCancel: vi.fn(),
  onConfirm: vi.fn()
})

const renderList = (servers: ServerInfoValue[], unpair = listUnpair()): string =>
  renderToStaticMarkup(<ServerRows servers={servers} unpair={unpair} />)

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

// #1162 — the per-row Unpair action's three-phase matrix. It lives on the PURE views for the same
// reason #1148 put the row loop there: the store-bound container's populated branch is unreachable
// under renderToStaticMarkup (zustand v5 reads getInitialState() = the empty list), and nothing in
// this repo can click, so a phase that is a PROP is the only form a static server render can prove.
// The transitions themselves (click → arm → confirm → the row leaves) are the e2e tier's, in
// settings-per-server-unpair.spec.ts.
describe('ServerRow — the unpair action (#1162)', () => {
  it('idle: offers Unpair and nothing else (AC1)', () => {
    const markup = render(populated, { ...idleUnpair(), phase: 'idle' })

    expect(markup).toContain('>Unpair<')
    // No one-click forget survives the move from #166's two-phase control (AC2): the erase verb is
    // not reachable in the resting state.
    expect(markup).not.toContain('>Confirm<')
    expect(markup).not.toContain('Forget this server')
    expect(markup).not.toContain('Forgetting')
  })

  it('confirming: asks before it forgets anything, with both answers live (AC2)', () => {
    const markup = render(populated, { ...idleUnpair(), phase: 'confirming' })

    expect(markup).toContain('Forget this server?')
    expect(markup).toContain('>Cancel<')
    expect(markup).toContain('>Confirm<')
    // The idle trigger is replaced, not accompanied — one row, one live decision.
    expect(markup).not.toContain('>Unpair<')
    // Both answers are enabled while the question stands.
    expect(markup).not.toContain('disabled')
  })

  it('unpairing: both buttons are disabled, so a double-click cannot launch a second erase', () => {
    const markup = render(populated, { ...idleUnpair(), phase: 'unpairing' })

    expect(markup).toContain('Forgetting…')
    expect(markup).not.toContain('>Confirm<') // the label becomes the busy copy
    // BOTH buttons carry it — Cancel too, so backing out mid-erase cannot re-arm the row under a
    // request that is still in flight. Counted, not merely contained: a single `disabled` would pass
    // a `toContain` while leaving the other button live.
    expect(countOf(markup, 'disabled=""')).toBe(2)
  })

  it('renders NO action at all on the not-yet-loaded row — there is no server to forget', () => {
    const markup = render(null)
    expect(markup).not.toContain('Unpair')
    expect(markup).not.toContain('settings__server-row-unpair')
  })

  it('keeps the serverId out of every attribute — the buttons name themselves (CLAUDE.md)', () => {
    // `serverId` is `record.server`, which arrived in a pairing payload: daemon-authored text, which
    // may be rendered escaped but never placed in an attribute. With N identically-labelled Unpair
    // buttons an aria-label={serverId} is the natural disambiguation reflex; this pins that it is not
    // here. e2e addresses rows by position over the store's pinned order instead.
    const hostile: ServerInfoValue = { serverId: 'srv"><img src=x>', relayUrl: 'wss://r.example' }
    const markup = render(hostile, { ...idleUnpair(), phase: 'confirming' })

    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&quot;&gt;&lt;img')
  })
})

describe('ServerRows — one armed row at a time (#1162)', () => {
  const armed = (kind: 'confirming' | 'unpairing', serverId: string): UnpairPhase => ({
    kind,
    serverId
  })

  it('arms exactly the named row and leaves every other row un-armed', () => {
    const markup = renderList([populated, second], listUnpair(armed('confirming', second.serverId)))

    // One prompt, one Cancel, one Confirm across the whole list...
    expect(countOf(markup, 'Forget this server?')).toBe(1)
    expect(countOf(markup, '>Confirm<')).toBe(1)
    // ...and the OTHER row still offers its own resting Unpair, so arming one row neither disables
    // nor arms its neighbour.
    expect(countOf(markup, '>Unpair<')).toBe(1)
    // The prompt sits in the SECOND row, not the first: everything before the second row's id line
    // is still the first row's idle markup.
    expect(markup.indexOf('Forget this server?')).toBeGreaterThan(markup.indexOf(populated.serverId))
  })

  it('an armed id that names no rendered row arms nothing', () => {
    // The container cannot produce this today (the id always comes off a rendered row), but the view
    // is total: a stale id left behind by a list that changed under the phase must not arm an
    // arbitrary row — it must arm none.
    const markup = renderList([populated, second], listUnpair(armed('confirming', 'srv-gone')))

    expect(markup).not.toContain('Forget this server?')
    expect(countOf(markup, '>Unpair<')).toBe(2)
  })

  it('matches the armed row by its FULL id, never by a prefix', () => {
    // The e2e fixture's two ids are 'fake-daemon' and 'fake-daemon-2' — the first is a substring of
    // the second. A `startsWith`/`includes` match here would arm both rows on one click; `===` is
    // what makes the arming per-row. This is the unit-level twin of the exact-text assertion the e2e
    // spec uses for the same reason.
    const prefix: ServerInfoValue = { serverId: 'fake-daemon', relayUrl: 'wss://a.example' }
    const longer: ServerInfoValue = { serverId: 'fake-daemon-2', relayUrl: 'wss://b.example' }
    const markup = renderList([prefix, longer], listUnpair(armed('confirming', prefix.serverId)))

    expect(countOf(markup, 'Forget this server?')).toBe(1)
    expect(countOf(markup, '>Unpair<')).toBe(1)
  })

  it('every row is idle when nothing is armed', () => {
    const markup = renderList([populated, second])
    expect(countOf(markup, '>Unpair<')).toBe(2)
    expect(markup).not.toContain('Forget this server?')
  })
})
