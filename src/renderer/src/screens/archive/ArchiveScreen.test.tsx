import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ArchiveScreen, ArchiveScreenView, type ArchiveTab } from './ArchiveScreen'

// The #218 idiom: server-render the pure view with injected callbacks — no DOM harness, no store, no
// live connection. ArchiveScreenView is a pure function of `selectedTab` (props in, markup out), so a
// server-rendered string at each tab value proves the chrome, the two-tab header, and the tab-switch
// (the panel's aria-labelledby follows the selection). The click glue (a tab's onClick invoking
// onSelectTab) is closed by composition — the click payload and the active marker both derive from the
// same tab.key, so a mismatch is structurally impossible — exactly as ChannelList.test.tsx never fires
// SettingsButton's click.
const noop = (): void => {}

const renderView = (selectedTab: ArchiveTab): string =>
  renderToStaticMarkup(
    <ArchiveScreenView selectedTab={selectedTab} onSelectTab={noop} onBack={noop} />
  )

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1

describe('ArchiveScreenView', () => {
  it('renders the "Archived" title (AC2)', () => {
    expect(renderView('channels')).toContain('>Archived</h1>')
  })

  it('renders the back affordance with its accessible name (AC2)', () => {
    expect(renderView('channels')).toContain('aria-label="Back"')
  })

  it('renders the root region marker for the screen (AC5)', () => {
    expect(renderView('channels')).toContain('aria-label="Archive screen"')
  })

  it('renders both tab labels in Figma order (Channels then Discussions), with no counts (AC4)', () => {
    const markup = renderView('channels')
    expect(markup).toContain('>Channels</button>')
    expect(markup).toContain('>Discussions</button>')
    // Bare labels — the parenthesised counts ("Channels (3)" / "Discussions (8)") are #348.
    expect(markup).not.toContain('(3)')
    expect(markup).not.toContain('(8)')
    // Figma order: Channels precedes Discussions.
    expect(markup.indexOf('>Channels</button>')).toBeLessThan(
      markup.indexOf('>Discussions</button>')
    )
  })

  it('marks exactly one tab selected — Channels at selectedTab=channels (AC4)', () => {
    const markup = renderView('channels')
    expect(countOccurrences(markup, 'aria-selected="true"')).toBe(1)
    expect(countOccurrences(markup, 'aria-selected="false"')).toBe(1)
    // The selected tab is Channels: its button carries aria-selected="true".
    expect(markup).toContain('id="archive-tab-channels" aria-selected="true"')
  })

  it('shows the channels body when Channels is selected — the panel labelled by the channels tab (AC4)', () => {
    expect(renderView('channels')).toContain('aria-labelledby="archive-tab-channels"')
  })

  it('switches the selected tab and the shown body when Discussions is selected (AC4)', () => {
    const markup = renderView('discussions')
    // Still exactly one selected, now flipped to Discussions.
    expect(countOccurrences(markup, 'aria-selected="true"')).toBe(1)
    expect(markup).toContain('id="archive-tab-discussions" aria-selected="true"')
    // The empty tab body is now labelled by the discussions tab — proving the shown body is a pure
    // function of the selection (the #348 mount point switches with the tab).
    expect(markup).toContain('aria-labelledby="archive-tab-discussions"')
  })
})

describe('ArchiveScreen', () => {
  it('enters with the Channels tab selected — the panel labelled by the channels tab (AC4)', () => {
    // Mirrors PairedShell's "enters at the list" container test: the container holds the only state
    // (selectedTab) and defaults to `channels`, so a server render shows the channels body first.
    const markup = renderToStaticMarkup(<ArchiveScreen onBack={noop} />)
    expect(markup).toContain('aria-labelledby="archive-tab-channels"')
    expect(markup).toContain('id="archive-tab-channels" aria-selected="true"')
  })
})
