import { describe, it, expect, beforeEach } from 'vitest'
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

describe('PairedShellView', () => {
  describe("route='list'", () => {
    it('shows the Channel List wrapper and never the thread', () => {
      const markup = renderToStaticMarkup(
        <PairedShellView route="list" onOpen={noop} onBack={noop} onOpenSettings={noop} onUnpaired={noop} />
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
        <PairedShellView route="thread" onOpen={noop} onBack={noop} onOpenSettings={noop} onUnpaired={noop} />
      )
      expect(markup).toContain(CONVERSATION_MARKER)
      expect(markup).toContain(BACK_MARKER)
    })
  })

  describe("route='settings'", () => {
    it('shows the Settings screen and neither the list nor the thread (#333)', () => {
      const markup = renderToStaticMarkup(
        <PairedShellView route="settings" onOpen={noop} onBack={noop} onOpenSettings={noop} onUnpaired={noop} />
      )
      expect(markup).toContain(SETTINGS_MARKER)
      expect(markup).not.toContain(LIST_MARKER)
      expect(markup).not.toContain(CONVERSATION_MARKER)
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
})
