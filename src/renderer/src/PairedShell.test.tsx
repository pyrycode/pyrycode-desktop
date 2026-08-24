import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PairedShell, PairedShellView } from './PairedShell'
import { nextPairedRoute } from './pairedRoute'
import { sessionStore } from './store/sessionStore'

// No DOM harness — mirrors App.test.tsx. PairedShellView is the pure route→view (props in, markup
// out), so a server-rendered string proves which view each route mounts. PairedShell is the container
// (owns the nav reducer), exercised only for "enters at the list". The click-driven open→thread→back
// transition is guaranteed by composing the separately-tested nextPairedRoute (pairedRoute.test.ts)
// with PairedShellView — exactly as App.test.tsx leaves the onPaired→setRoute glue to composition.
const noop = (): void => {}

// Markers that discriminate the two views: the thread carries the composer's Send control and the
// leading back affordance; the list carries the Channel List's always-present wrapper (#141). Its
// row content is covered by ChannelList.test.tsx, not here.
const CONVERSATION_MARKER = 'aria-label="Send"'
const BACK_MARKER = 'aria-label="Back"'
const LIST_MARKER = 'aria-label="Conversations"'
// The settings view's root region marker (#333). A settings-UNIQUE discriminator: neither the list's
// entry-button `aria-label="Settings"` nor the thread's `aria-label="Back"` matches it, and — unlike the
// "Connection" heading text — it does not collide with the thread's `aria-label="Connection status"`.
const SETTINGS_MARKER = 'aria-label="Settings screen"'
// The archive view's root region marker (#347). An archive-UNIQUE discriminator: the list's Archive
// entry button is `aria-label="Archive"` (no trailing "screen"), so it does not match this marker, and
// neither do the thread's/settings' markers.
const ARCHIVE_MARKER = 'aria-label="Archive screen"'
// The pair-server view's marker (#152): the reused PairingScreen's field accessible name
// (PairingScreen.tsx:96) — the sole occurrence of that string in the whole renderer, so neither the
// list, thread, settings, nor archive markers match it. #664 moved this off the EntryCard heading,
// which #665's restyle removes; the accessible name survives that restyle.
const PAIRING_MARKER = 'aria-label="Pairing code"'

describe('PairedShellView', () => {
  describe("route='list'", () => {
    // #670 AC4: with no active conversation the chat pane mounts NO ConversationScreen — it renders
    // `null`, not a mounted-but-blank thread. The absence assertion below is that proof at unit level
    // (four e2e assertions lean on the same fact via `.conversation` toHaveCount(0)); the sidebar half
    // is unchanged from #141.
    it('shows the Channel List wrapper and never the thread', () => {
      const markup = renderToStaticMarkup(
        <PairedShellView route="list" onOpen={noop} onBack={noop} onOpenSettings={noop} onOpenArchive={noop} onUnpaired={noop} onOpenPairServer={noop} onPairServerPaired={noop} onPairServerCancelled={noop} />
      )
      expect(markup).toContain(LIST_MARKER)
      expect(markup).not.toContain(CONVERSATION_MARKER)
    })
  })

  describe("route='thread'", () => {
    beforeEach(() => {
      // setState shallow-merges (preserving dispatch); reset to a clean, empty session so the
      // store-bound ConversationScreen renders deterministically (App.test.tsx does the same).
      sessionStore.setState({ status: { type: 'disconnected' }, messages: [] })
    })

    it('shows the conversation thread with its leading back affordance', () => {
      const markup = renderToStaticMarkup(
        <PairedShellView route="thread" onOpen={noop} onBack={noop} onOpenSettings={noop} onOpenArchive={noop} onUnpaired={noop} onOpenPairServer={noop} onPairServerPaired={noop} onPairServerCancelled={noop} />
      )
      expect(markup).toContain(CONVERSATION_MARKER)
      expect(markup).toContain(BACK_MARKER)
    })

    // #670 AC1: both panes at once. Opening a conversation no longer REPLACES the list — the two-pane
    // shell renders the sidebar beside the thread, so the list marker is present on the THREAD route
    // too. This is the unit-level "selecting a conversation does not hide the sidebar" proof; the
    // geometric half (the sidebar's fixed 400px, the window's 800px floor) is e2e-only, since the node
    // environment has no layout engine to measure against.
    it('keeps the sidebar mounted beside the thread (#670, AC1)', () => {
      const markup = renderToStaticMarkup(
        <PairedShellView route="thread" onOpen={noop} onBack={noop} onOpenSettings={noop} onOpenArchive={noop} onUnpaired={noop} onOpenPairServer={noop} onPairServerPaired={noop} onPairServerCancelled={noop} />
      )
      expect(markup).toContain(LIST_MARKER)
      expect(markup).toContain(CONVERSATION_MARKER)
    })
  })

  describe("route='settings'", () => {
    // #670 AC5: the two absence assertions below now also carry "Settings opens FULL SCREEN over both
    // panes" — the settings arm replaces the whole two-pane shell rather than filling one pane. Do not
    // delete them as redundant with the presence assertion; they are the over-both-panes proof.
    it('shows the Settings screen and neither the list nor the thread (#333)', () => {
      const markup = renderToStaticMarkup(
        <PairedShellView route="settings" onOpen={noop} onBack={noop} onOpenSettings={noop} onOpenArchive={noop} onUnpaired={noop} onOpenPairServer={noop} onPairServerPaired={noop} onPairServerCancelled={noop} />
      )
      expect(markup).toContain(SETTINGS_MARKER)
      expect(markup).not.toContain(LIST_MARKER)
      expect(markup).not.toContain(CONVERSATION_MARKER)
    })
  })

  describe("route='archive'", () => {
    // #670 AC5, the same reading as the settings block above: the two absence assertions are the
    // "Archive opens full screen OVER both panes" proof, not redundancy.
    it('shows the Archive screen and neither the list nor the thread (#347)', () => {
      const markup = renderToStaticMarkup(
        <PairedShellView route="archive" onOpen={noop} onBack={noop} onOpenSettings={noop} onOpenArchive={noop} onUnpaired={noop} onOpenPairServer={noop} onPairServerPaired={noop} onPairServerCancelled={noop} />
      )
      expect(markup).toContain(ARCHIVE_MARKER)
      expect(markup).not.toContain(LIST_MARKER)
      expect(markup).not.toContain(CONVERSATION_MARKER)
    })
  })

  describe("route='pairServer'", () => {
    // PairingScreen derefs window.pyry at render (target = bridge ?? window.pyry); the node env has no
    // window. An empty `pyry` suffices — no bridge method runs during a static render (App.test.tsx
    // stubs the same way for its pairing route).
    beforeEach(() => {
      globalThis.window = { pyry: {} } as unknown as Window & typeof globalThis
    })
    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    // #670 AC5 again: `not.toContain(LIST_MARKER)` is the "Pair-another-server opens full screen over
    // both panes" proof.
    it('reuses the existing pairing screen and shows neither the list nor the settings (#152, AC2)', () => {
      const markup = renderToStaticMarkup(
        <PairedShellView
          route="pairServer"
          onOpen={noop}
          onBack={noop}
          onOpenSettings={noop}
          onOpenArchive={noop}
          onUnpaired={noop}
          onOpenPairServer={noop}
          onPairServerPaired={noop}
          onPairServerCancelled={noop}
        />
      )
      expect(markup).toContain(PAIRING_MARKER)
      expect(markup).not.toContain(LIST_MARKER)
      expect(markup).not.toContain(SETTINGS_MARKER)
    })
  })
})

describe('PairedShell', () => {
  it('enters at the list view — the Channel List, not straight into the thread (AC2)', () => {
    const markup = renderToStaticMarkup(<PairedShell onUnpaired={noop} />)
    expect(markup).toContain(LIST_MARKER)
    expect(markup).not.toContain(CONVERSATION_MARKER)
  })

  // #242 nav is closed by composition, not a jsdom harness: the bridge test proves a conversationCreated
  // event reaches the injected onCreated (which PairedShell wires to dispatch({ type: 'open' })), and
  // PairedShellView route='thread' rendering the thread is covered above — so all that remains is that
  // `open` from `list` lands on `thread`. That transition is already unit-proven in pairedRoute.test.ts;
  // this one-line assertion documents the seam the created-event nav reuses (no new route or nav arm).
  it('a created-event → open dispatch reuses the list→thread transition (AC3)', () => {
    expect(nextPairedRoute('list', { type: 'open' })).toBe('thread')
  })

  // #333: the entry→route seam the ChannelList settings button drives, closed by composing the
  // separately-tested reducer (pairedRoute.test.ts) with the view (PairedShellView route='settings'
  // above) — the same composition posture the created-event nav uses, no jsdom harness.
  it('the settings button → openSettings dispatch lands on the settings route (#333)', () => {
    expect(nextPairedRoute('list', { type: 'openSettings' })).toBe('settings')
  })

  // #347: the entry→route seam the ChannelList Archive button drives, closed by composing the
  // separately-tested reducer (pairedRoute.test.ts) with the archive view (PairedShellView route='archive'
  // above) — the same composition posture the settings/created-event navs use, no jsdom harness.
  it('the Archive button → openArchive dispatch lands on the archive route (#347)', () => {
    expect(nextPairedRoute('list', { type: 'openArchive' })).toBe('archive')
  })

  // #152: the three pair-server seams the shell wires, closed by composing the separately-tested
  // reducer (pairedRoute.test.ts) with the pairServer view (PairedShellView above) — the same
  // composition posture the settings/created-event navs use, no jsdom harness. The Settings row →
  // openPairServer entry, and the two PairingScreen exits (cancel → settings, paired → list) land on
  // their distinct destinations.
  it('the Settings "Pair another server" row → openPairServer opens the pair-server route (#152)', () => {
    expect(nextPairedRoute('settings', { type: 'openPairServer' })).toBe('pairServer')
  })

  it('PairingScreen onCancel → pairServerCancelled returns to settings, non-destructive (#152, AC4)', () => {
    expect(nextPairedRoute('pairServer', { type: 'pairServerCancelled' })).toBe('settings')
  })

  it('PairingScreen onPaired → pairServerPaired lands on the new server’s list (#152, AC3)', () => {
    expect(nextPairedRoute('pairServer', { type: 'pairServerPaired' })).toBe('list')
  })

  // #393: a notification click reuses the existing `open` transition (no new route or nav arm). The
  // list→thread leg is already asserted above for #242; these two prove AC2's "regardless of which
  // paired view was showing" — `open` is absolute, so it lands on `thread` from settings and archive
  // just as it does from the list.
  it('a notification-activated → open dispatch lands on thread from settings (#393, AC2)', () => {
    expect(nextPairedRoute('settings', { type: 'open' })).toBe('thread')
  })

  it('a notification-activated → open dispatch lands on thread from archive (#393, AC2)', () => {
    expect(nextPairedRoute('archive', { type: 'open' })).toBe('thread')
  })
})
