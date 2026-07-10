import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ConversationScreen,
  MessageThread,
  Timeline,
  ThinkingIndicator,
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

  // #218: the pending tool row (Figma node 16-28) — the compact chip carrying the tool name and its
  // one-line input summary, distinct from the daemon message bubble. Supersedes the deferred no-op
  // that #217's transport slice fed but #203 could not yet draw. `result: null` is the pending state;
  // the resolved success/error treatment is #206.
  it('renders a pending tool row — the tool name and its input summary, not an assistant bubble', () => {
    const items: ThreadItem[] = [
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: 'read_file',
        inputSummary: 'kitchenclaw/db/schema.ts · 184 lines',
        result: null
      }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    // The compact tool chip, hooked by its own thread role — NOT the assistant daemon bubble.
    expect(markup).toContain('tool-row__chip')
    expect(markup).toContain('data-thread-role="tool"')
    // Both daemon-supplied runs render verbatim.
    expect(markup).toContain('read_file')
    expect(markup).toContain('kitchenclaw/db/schema.ts · 184 lines')
    // A tool row is not an assistant bubble and carries no streaming cursor.
    expect(threadBubbleCount(markup)).toBe(0)
    expect(markup).not.toContain(CURSOR)
  })

  // #218/AC4: `name` and `inputSummary` are untrusted daemon strings rendered as inert React children
  // (auto-escaped), the assistant-bubble posture one case up — never dangerouslySetInnerHTML, never
  // markup/path interpretation. Both fields are exercised.
  it('renders the tool name and summary as inert text, never live markup (AC4)', () => {
    // No apostrophes — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const items: ThreadItem[] = [
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: '<b>tool</b>',
        inputSummary: '<i>path</i>',
        result: null
      }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('&lt;b&gt;tool&lt;/b&gt;')
    expect(markup).toContain('&lt;i&gt;path&lt;/i&gt;')
    expect(markup).not.toContain('<b>tool</b>')
    expect(markup).not.toContain('<i>path</i>')
  })

  // #218/AC1: the reducer already interleaves a toolCall between assistantText items in arrival order
  // (#121); the view renders that order as-is. The tool row sits between the two bubbles and neither
  // reorders the list nor steals the cursor from the tail assistantText.
  it('renders a toolCall row between assistant bubbles in array order, cursor only on the tail (AC1)', () => {
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: 'before tool' },
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: 'read_file',
        inputSummary: 'schema.ts',
        result: null
      },
      { kind: 'assistantText', turnId: 't1', text: 'after tool' }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(threadBubbleCount(markup)).toBe(2)
    expect(markup.indexOf('before tool')).toBeLessThan(markup.indexOf('read_file'))
    expect(markup.indexOf('read_file')).toBeLessThan(markup.indexOf('after tool'))
    // Exactly one cursor, trailing the tail (last) assistantText — the tool row takes none.
    expect(markup.match(new RegExp(CURSOR, 'g'))?.length ?? 0).toBe(1)
    expect(markup.indexOf(CURSOR)).toBeGreaterThan(markup.indexOf('after tool'))
  })

  // #230: the resolved tool row. When #121's reducer fills a toolCall's `result` in place (matched by
  // toolUseId, replacing the item at its own index), the row resolves where it sits — the pending
  // dimming lifts and `result.isError` selects a success vs error treatment. The className is the
  // load-bearing seam: `tool-row--resolved` iff `result !== null`, `tool-row--error` on top iff isError.
  it('resolves a successful tool row in place — lifts the pending dimming, no error accent (AC2)', () => {
    const items: ThreadItem[] = [
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: 'read_file',
        inputSummary: 'schema.ts',
        result: { isError: false, resultSummary: '184 lines' }
      }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    // The wrapper carries the resolved modifier (dimming lifted) but NOT the error modifier.
    expect(markup).toContain('tool-row--resolved')
    expect(markup).not.toContain('tool-row--error')
    // The chip's inner markup is unchanged — same role, same daemon-supplied runs, still no bubble.
    expect(markup).toContain('tool-row__chip')
    expect(markup).toContain('data-thread-role="tool"')
    expect(markup).toContain('read_file')
    expect(markup).toContain('schema.ts')
    expect(threadBubbleCount(markup)).toBe(0)
    expect(markup).not.toContain(CURSOR)
  })

  it('resolves a failed tool row in place — carries both the resolved and error modifiers (AC3)', () => {
    const items: ThreadItem[] = [
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: 'read_file',
        inputSummary: 'missing.ts',
        result: { isError: true, resultSummary: 'ENOENT' }
      }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    // Error is driven by result.isError: both modifiers present (resolved lifts dimming, error accents).
    expect(markup).toContain('tool-row--resolved')
    expect(markup).toContain('tool-row--error')
  })

  // #230/AC1: the pending path is untouched — a `result: null` toolCall carries the bare `tool-row`
  // class and neither resolved modifier. Pins that this slice adds treatment only when a result fills.
  it('leaves a pending tool row (result: null) undimmed-modifier-free — no resolved modifier (AC1)', () => {
    const items: ThreadItem[] = [
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: 'read_file',
        inputSummary: 'schema.ts',
        result: null
      }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('class="tool-row"')
    expect(markup).not.toContain('tool-row--resolved')
    expect(markup).not.toContain('tool-row--error')
  })

  // #230/AC4: the resolved chip surfaces only `name` + `inputSummary` (the architect call against the
  // Figma mock, which has no result-text slot). `resultSummary` is untrusted daemon text and is NOT
  // rendered — a distinctive sentinel must not leak into the markup, so there's no new untrusted surface.
  it('does not surface result.resultSummary in the resolved chip (AC4)', () => {
    const items: ThreadItem[] = [
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: 'read_file',
        inputSummary: 'missing.ts',
        result: { isError: true, resultSummary: 'RESULT_SUMMARY_SENTINEL_zzz' }
      }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).not.toContain('RESULT_SUMMARY_SENTINEL_zzz')
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

// #215: the thinking indicator bound to the coarse `phase` scalar. ThinkingIndicator is the Timeline
// twin over a boolean rather than a ThreadItem[] — pure (isThinking in, markup out) — so a
// server-rendered string proves both the present affordance (thinking) and the zero-footprint absent
// case. Boolean input, not `phase`: the view structurally cannot render a daemon-supplied string
// (AC3). Injected boolean: no store, no IPC — the container's `thinking` branch is unreachable under
// server render (zustand v5 reads getInitialState() → phase: 'idle'), so the "showing" assertion lives
// here, exactly like Timeline's populated assertions.
describe('ThinkingIndicator — the pre-text working affordance', () => {
  it('is inert when not thinking — renders nothing (zero layout footprint, AC2)', () => {
    expect(renderToStaticMarkup(<ThinkingIndicator isThinking={false} />)).toBe('')
  })

  it('shows the daemon-styled Thinking affordance while thinking', () => {
    const markup = renderToStaticMarkup(<ThinkingIndicator isThinking={true} />)
    // The stable test seam (the bubble__cursor role), the muted daemon-bubble treatment, and the
    // client-owned static label — the ellipsis glyph … (U+2026), no apostrophe to survive escaping.
    expect(markup).toContain('conversation__thinking')
    expect(markup).toContain('bubble--thinking')
    expect(markup).toContain('Thinking…')
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

  // #215: the thinking indicator mounts against the idle timeline store (getInitialState phase:
  // 'idle'), so isThinking is false and it renders nothing — the inert render slice, layout unchanged
  // until #179 flips `interactive` (AC4). The analog of the "no bubble__cursor" smoke above; the
  // showing path is proven on the pure ThinkingIndicator describe.
  it('mounts the idle timeline with no thinking indicator (the inert render slice, AC4)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__thinking')
    expect(markup).not.toContain('Thinking…')
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
