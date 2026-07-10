import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App, { AppView } from './App'
import { sessionStore } from './store/sessionStore'

// No DOM harness (jsdom/Testing Library) — mirrors PairingScreen.test.tsx / ConversationScreen.test.tsx.
// AppView is the pure route→screen view (props in, markup out), so a server-rendered string proves
// which screen each route mounts. App is the async container (owns the launch query + route state);
// it is exercised only for "the initial paint is neutral", exactly as the untested
// useDaemonEventBridge / PairingScreen IPC wiring is left to a smoke test. The launch effect and
// onPaired→setRoute glue are guaranteed by composing the tested routeForStatus mapping and AppView.
const noop = (): void => {}

// A conversation-screen marker that never appears on the pairing screen, and vice versa.
const CONVERSATION_MARKER = 'aria-label="Send"'
const PAIRING_MARKER = 'Paste pairing code'

describe('AppView', () => {
  it("route='pending' renders neither screen — an empty, neutral paint (AC3)", () => {
    // The pending phase mounts no screen; the dark canvas (color-scheme: dark) shows through.
    expect(
      renderToStaticMarkup(<AppView route="pending" onPaired={noop} onUnpaired={noop} />)
    ).toBe('')
  })

  describe("route='pairing'", () => {
    // PairingScreen dereferences window.pyry at render (target = bridge ?? window.pyry); the node
    // env has no window. An empty `pyry` suffices — no method is called until interaction, and the
    // render never drives interaction.
    beforeEach(() => {
      globalThis.window = { pyry: {} } as unknown as Window & typeof globalThis
    })
    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'window')
    })

    it('shows the pairing screen and never the conversation screen (AC2)', () => {
      const markup = renderToStaticMarkup(
        <AppView route="pairing" onPaired={noop} onUnpaired={noop} />
      )
      expect(markup).toContain(PAIRING_MARKER)
      expect(markup).not.toContain(CONVERSATION_MARKER)
    })
  })

  describe("route='conversation'", () => {
    beforeEach(() => {
      // setState shallow-merges (preserving dispatch); reset to a clean, empty session. Kept as a
      // defensive baseline now that the conversation route enters PairedShell's list view (which reads
      // no store); the thread view it opens into is the store-bound ConversationScreen.
      sessionStore.setState({ status: { type: 'disconnected' }, messages: [] })
    })

    it('enters the paired shell at the list view, never straight into the thread (#140)', () => {
      // #140 put the inner list ⇄ thread shell under the conversation route: it now enters at the
      // Channel List home screen (#141), not directly on the ConversationScreen thread. The server
      // render seeds no store, so the always-present list wrapper is empty inside — asserting the
      // wrapper marker is sufficient and stable.
      const markup = renderToStaticMarkup(
        <AppView route="conversation" onPaired={noop} onUnpaired={noop} />
      )
      expect(markup).toContain('aria-label="Conversations"')
      expect(markup).not.toContain(CONVERSATION_MARKER)
      expect(markup).not.toContain(PAIRING_MARKER)
    })
  })
})

describe('App', () => {
  it('the initial paint is neutral — renders nothing, never a flash of the wrong screen (AC3)', () => {
    // Under server rendering effects never run, so the launch query stays unresolved and the route
    // stays 'pending' → AppView renders null. useDaemonEventBridge's effect never fires either, so
    // window.pyry is never touched — safe without a window stub.
    let markup: string | undefined
    expect(() => {
      markup = renderToStaticMarkup(<App />)
    }).not.toThrow()
    expect(markup).toBe('')
  })
})
