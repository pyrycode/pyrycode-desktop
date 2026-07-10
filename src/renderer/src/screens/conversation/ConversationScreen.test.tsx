import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ConversationScreen,
  MessageThread,
  Timeline,
  StatusSheet,
  RepairPrompt
} from './ConversationScreen'
import type { Message } from './messageViewModel'
import type { ThreadItem } from '../../store/threadTimeline'
import { sessionStore } from '../../store/sessionStore'

// No DOM harness (jsdom/Testing Library) — mirrors PairingScreen.test.tsx. MessageThread
// is pure (Message[] in, markup out), so a server-rendered string proves the render:
// order, role→type-driven bubbles, and the empty case. ConversationScreen is the
// store-bound container; zustand v5's useStore reads getInitialState() under server
// rendering, so the container is exercised only for "reads the empty store, not the old
// placeholder array" — the reactive store→UI path is proven in sessionStore.test.ts and
// the wire→view-model adaptation in messageViewModel.test.ts.
function bubbleCount(markup: string): number {
  return markup.match(/data-message-role="/g)?.length ?? 0
}

describe('MessageThread', () => {
  it('an empty message list renders a valid empty thread — no bubbles, no crash', () => {
    const markup = renderToStaticMarkup(<MessageThread messages={[]} />)
    expect(bubbleCount(markup)).toBe(0)
  })

  it('renders one bubble per message, the type driving each bubble role', () => {
    const messages: Message[] = [
      { id: 'm1', type: 'user', text: 'text m1' },
      { id: 'm2', type: 'daemon', text: 'text m2' },
      { id: 'm3', type: 'user', text: 'text m3' }
    ]
    const markup = renderToStaticMarkup(<MessageThread messages={messages} />)
    expect(bubbleCount(markup)).toBe(3)
    // type → data-message-role, tied to each message's text end-to-end.
    expect(markup).toContain('data-message-role="user">text m1</div>')
    expect(markup).toContain('data-message-role="daemon">text m2</div>')
    expect(markup).toContain('data-message-role="user">text m3</div>')
  })

  it('renders messages in the order given, none dropped or reordered', () => {
    const messages: Message[] = [
      { id: 'm1', type: 'user', text: 'text m1' },
      { id: 'm2', type: 'daemon', text: 'text m2' },
      { id: 'm3', type: 'daemon', text: 'text m3' }
    ]
    const markup = renderToStaticMarkup(<MessageThread messages={messages} />)
    expect(markup.indexOf('text m1')).toBeLessThan(markup.indexOf('text m2'))
    expect(markup.indexOf('text m2')).toBeLessThan(markup.indexOf('text m3'))
  })
})

// #203: the streamed-assistant-text timeline view. Timeline is the MessageThread twin — pure
// (readonly ThreadItem[] in, markup out) — so a server-rendered string proves the render: one
// assistant bubble per assistantText item in array order, untrusted text escaped, and the streaming
// cursor derived structurally (the tail assistantText, not from `phase`). toolCall / turnBoundary
// draw nothing. Injected ThreadItem[]: no store, no IPC — the populated store path is unreachable
// under server render (zustand v5 reads getInitialState()), so the populated assertions live here.
function threadBubbleCount(markup: string): number {
  return markup.match(/data-thread-role="assistant"/g)?.length ?? 0
}

const CURSOR = 'bubble__cursor'

describe('Timeline — the streamed assistant text', () => {
  it('an empty timeline is inert — renders nothing (zero layout footprint, AC4)', () => {
    expect(renderToStaticMarkup(<Timeline items={[]} />)).toBe('')
  })

  it('renders one assistant bubble per assistantText item, carrying its text and the daemon-bubble treatment', () => {
    const items: ThreadItem[] = [{ kind: 'assistantText', turnId: 't1', text: 'hello there' }]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(threadBubbleCount(markup)).toBe(1)
    expect(markup).toContain('bubble bubble--daemon')
    expect(markup).toContain('data-thread-role="assistant">hello there')
  })

  it('renders untrusted delta text as visible characters, never live markup (discharges #199)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const items: ThreadItem[] = [{ kind: 'assistantText', turnId: 't1', text: '<b>hi</b>' }]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('&lt;b&gt;hi&lt;/b&gt;')
    expect(markup).not.toContain('<b>hi</b>')
  })

  it('shows the streaming cursor on the in-progress tail (a trailing, not-yet-closed assistantText)', () => {
    const items: ThreadItem[] = [{ kind: 'assistantText', turnId: 't1', text: 'streaming' }]
    expect(renderToStaticMarkup(<Timeline items={items} />)).toContain(CURSOR)
  })

  it('shows no cursor once the turn is closed by a trailing turnBoundary', () => {
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: 'done' },
      { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
    ]
    expect(renderToStaticMarkup(<Timeline items={items} />)).not.toContain(CURSOR)
  })

  it('preserves array order and shows the cursor only on the tail assistantText', () => {
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: 'first turn' },
      { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' },
      { kind: 'assistantText', turnId: 't2', text: 'second turn' }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(threadBubbleCount(markup)).toBe(2)
    expect(markup.indexOf('first turn')).toBeLessThan(markup.indexOf('second turn'))
    // Exactly one cursor, and it trails the second (tail) bubble's text.
    expect(markup.match(new RegExp(CURSOR, 'g'))?.length ?? 0).toBe(1)
    expect(markup.indexOf(CURSOR)).toBeGreaterThan(markup.indexOf('second turn'))
  })

  it('renders a toolCall as a safe no-op — no throw, no assistant bubble for it (its render is #205/#206)', () => {
    const items: ThreadItem[] = [
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: 'Read',
        inputSummary: 'file.ts',
        result: null
      }
    ]
    let markup = ''
    expect(() => {
      markup = renderToStaticMarkup(<Timeline items={items} />)
    }).not.toThrow()
    expect(threadBubbleCount(markup)).toBe(0)
    expect(markup).not.toContain(CURSOR)
  })

  it('renders a lone turnBoundary as nothing drawn — no divider, no crash', () => {
    const items: ThreadItem[] = [{ kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }]
    let markup = ''
    expect(() => {
      markup = renderToStaticMarkup(<Timeline items={items} />)
    }).not.toThrow()
    expect(threadBubbleCount(markup)).toBe(0)
    expect(markup).not.toContain(CURSOR)
  })
})

// #177: the Run configuration host modal. StatusSheet is the pure, exported open-state chrome (the
// MessageThread pattern) — server-render it directly to prove the handle/title/close/empty-body
// shell. The open/dismiss toggle in ConversationScreen is trivial useState glue, unreachable under
// server render (same discipline as Composer's `text` and #166's confirm phase); the container
// smoke tests below see only the closed initial state.
describe('StatusSheet — the Run configuration host modal', () => {
  it('renders the sheet title', () => {
    const markup = renderToStaticMarkup(<StatusSheet onClose={() => {}} />)
    expect(markup).toContain('Run configuration')
  })

  it('renders an accessible close control', () => {
    const markup = renderToStaticMarkup(<StatusSheet onClose={() => {}} />)
    expect(markup).toContain('aria-label="Close"')
  })

  it('renders the drag handle and an accessible modal dialog', () => {
    const markup = renderToStaticMarkup(<StatusSheet onClose={() => {}} />)
    expect(markup).toContain('status-sheet__handle')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
  })

  it('renders an empty scrollable body — the shell hosts no sections yet', () => {
    const markup = renderToStaticMarkup(<StatusSheet onClose={() => {}} />)
    expect(markup).toContain('status-sheet__body')
    // Every scoped-out section (owned by #181 / #182 / #72) is absent — this pins "shell only".
    for (const section of ['Model', 'Effort', 'YOLO', 'Context window', 'Log data', 'Download']) {
      expect(markup).not.toContain(section)
    }
  })
})

// #167: the proactive re-pair affordance. RepairPrompt is the pure, exported view (the MessageThread
// pattern) — server-render it directly with an arbitrary `status` prop to prove the present/absent
// matrix (AC1) without touching the store. The store-bound RepairControl container's populated branch
// is NOT server-render-reachable (zustand v5's useStore reads getInitialState() = disconnected under
// server render), which is exactly why visibility is a prop-driven pure view rather than store-read.
describe('RepairPrompt — the proactive re-pair affordance', () => {
  it('renders a Re-pair button for a terminal, non-retryable error status (AC1 present)', () => {
    const markup = renderToStaticMarkup(
      <RepairPrompt
        status={{ type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }}
        onRepair={() => {}}
      />
    )
    expect(markup).toContain('>Re-pair</button>')
  })

  it('renders nothing for a retryable daemon error (AC1/AC4 absent)', () => {
    const markup = renderToStaticMarkup(
      <RepairPrompt
        status={{
          type: 'error',
          error: { code: 'server.binary_offline', message: 'offline', retryable: true }
        }}
        onRepair={() => {}}
      />
    )
    expect(markup).toBe('')
  })

  it('renders nothing for a non-error status (AC1 absent)', () => {
    const markup = renderToStaticMarkup(
      <RepairPrompt status={{ type: 'disconnected' }} onRepair={() => {}} />
    )
    expect(markup).toBe('')
  })
})

describe('ConversationScreen — store binding', () => {
  beforeEach(() => {
    // setState shallow-merges (preserving dispatch); reset to a clean, empty session.
    sessionStore.setState({ status: { type: 'disconnected' }, messages: [] })
  })

  it('renders without throwing, sourcing the thread from the empty store (no placeholder)', () => {
    let markup = ''
    expect(() => {
      markup = renderToStaticMarkup(<ConversationScreen />)
    }).not.toThrow()
    // The old placeholder array held 8 messages; the store is empty → zero bubbles.
    expect(bubbleCount(markup)).toBe(0)
  })

  // #203: the timeline view mounts against the empty timeline store (getInitialState items: []), so
  // it returns null and contributes no streaming cursor — the inert render slice, layout unchanged
  // until #179 flips `interactive` (AC4). The populated path is proven on the pure Timeline above.
  it('mounts the empty timeline with no streaming cursor (the inert render slice, AC4)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('bubble__cursor')
  })

  it('renders the composer with a text input and an accessible send control', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('<textarea')
    expect(markup).toContain('aria-label="Send"')
  })

  // #166: the conversation shell carries the unpair escape hatch — a header-row trigger with a
  // stable accessible name. Only the idle phase is reachable under server render (the confirm-toggle
  // and unpairing transitions are trivial useState glue, unit-tested nowhere — same discipline as
  // Composer's `text` and PairingScreen's container wiring, which are smoke-only). window.pyry.unpair
  // is dereferenced only in the click handler, so the container smoke-render never touches the bridge.
  it('renders the unpair trigger (its accessible text is present in the idle-phase markup)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('>Unpair</button>')
  })

  // #167: the proactive re-pair affordance is absent in the disconnected initial state (the only state
  // server-render sees). RepairControl mounts safely against the empty store — shouldOfferRepair is
  // false, so RepairPrompt returns null. The populated true-branch is proven in the RepairPrompt
  // pure-view describe above, not here (the zustand server-snapshot gotcha noted below).
  it('does not render the re-pair affordance while disconnected (RepairControl mounts, shows nothing)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('>Re-pair</button>')
  })

  // #31: while not connected the send control is disabled and the composer shows an inline
  // "why" hint. The initial store state is `disconnected`, and zustand v5's useStore reads
  // getInitialState() under server rendering (never setState), so this container smoke test always
  // sees the disconnected branch. The connected/enabled branch is therefore NOT smoke-testable here
  // — it is covered by the composerAvailability(connected) pure test in composerSend.test.ts.
  it('disables the send control while the session is not connected', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    const sendButtonTag = markup.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''
    expect(sendButtonTag).toContain('disabled')
  })

  it('renders an inline status hint (a polite live region) while not connected', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('class="composer__hint"')
    expect(markup).toContain('role="status"')
  })

  // #177: the status row between the thread and the composer is the trigger that opens the Run
  // configuration sheet. The row always renders, so its accessible name is reachable under server
  // render; the sheet is closed initially, so its close control is absent. The open toggle is
  // trivial useState glue, asserted through the pure StatusSheet surface above, not a click harness.
  it('renders the status-row trigger that opens the Run configuration sheet', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('aria-label="Run configuration"')
  })

  it('does not render the sheet while closed (its close control is absent)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    // `Run configuration` is also the trigger's aria-label, so key "sheet closed" on the close
    // control's accessible name, which exists only inside the sheet.
    expect(markup).not.toContain('aria-label="Close"')
  })

  it('shows no live model · effort · context summary in the collapsed status row (#181/#182 own it)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('Opus 4.7')
    expect(markup).not.toContain('% used')
    expect(markup).not.toContain('high')
  })

  // #140: the leading back affordance (Figma 16-9's arrow_back). Gated on the optional `onBack` prop
  // exactly like #166's `onUnpaired`: present only when the shell wires navigation, so the existing
  // bare `<ConversationScreen />` render is unchanged (AC3).
  it('renders the back affordance when onBack is provided (the shell-mounted thread)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen onBack={() => {}} />)
    expect(markup).toContain('aria-label="Back"')
  })

  it('renders no back affordance for a bare ConversationScreen (onBack absent — unchanged, AC3)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('aria-label="Back"')
  })
})
