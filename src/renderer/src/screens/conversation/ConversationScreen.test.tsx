import { describe, it, expect, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ConversationScreen,
  MessageThread,
  Timeline,
  ThinkingIndicator,
  StallIndicator,
  QueuedBacklog,
  StatusSheet,
  RepairPrompt,
  ConnectionBanner,
  WorkspaceChip,
  isTurnRunning,
  InterruptButton,
  ScreenSnapshotView,
  ThreadOverflowMenuView,
  ChannelInfoSheetView,
  relayLeg,
  daemonLeg,
  ConnectionStatusIndicator
} from './ConversationScreen'
import { composerAvailability, CONNECTION_BANNER_COPY } from './composerSend'
import type { Message } from './messageViewModel'
import type { ThreadItem } from '../../store/threadTimeline'
import type { QueuedItem, ConversationCreatedPayload } from '@shared/wire/types'
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
  // #277: the empty branch is no longer inert. A fresh thread with no items renders the
  // pre-first-message empty state (a client-owned copy line + its decorative glyph) instead of null,
  // so the region reads as a purposeful invitation, not a blank gap. Still a distinct class from the
  // thread scroll region (never .conversation__thread, no data-thread-role — the split-brain guard
  // below) and no streaming cursor sneaks into the branch.
  it('an empty timeline renders the pre-first-message empty state (AC1)', () => {
    const markup = renderToStaticMarkup(<Timeline items={[]} />)
    expect(markup).toContain('conversation__empty')
    // The client-owned copy constant (AC3) — no daemon string reaches this branch.
    expect(markup).toContain('Send a message to get started')
    expect(markup).not.toContain('data-thread-role')
    expect(markup).not.toContain(CURSOR)
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

  // #179: the user's own message renders through the timeline as a right-aligned user bubble
  // (the coarse MessageThread's user treatment, now sourced from timelineStore). Its own thread
  // role — data-thread-role="user" — distinct from the assistant/tool roles and from
  // MessageBubble's data-message-role, so no test-count seam collides.
  it('renders a userText item as a right-aligned user bubble, no cursor, not an assistant (AC3)', () => {
    const items: ThreadItem[] = [{ kind: 'userText', text: 'hi there' }]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('message-row message-row--user')
    expect(markup).toContain('bubble bubble--user')
    expect(markup).toContain('data-thread-role="user">hi there')
    // A user bubble is neither an assistant bubble nor a streaming tail.
    expect(threadBubbleCount(markup)).toBe(0)
    expect(markup).not.toContain(CURSOR)
  })

  it('renders untrusted userText as visible characters, never live markup (AC3)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const items: ThreadItem[] = [{ kind: 'userText', text: '<b>x</b>' }]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })

  it('reads userText → assistantText as one ordered thread, cursor on the assistant tail only (AC3)', () => {
    const items: ThreadItem[] = [
      { kind: 'userText', text: 'the user asks' },
      { kind: 'assistantText', turnId: 't1', text: 'the assistant answers' }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    // Array order: the user bubble precedes the assistant bubble.
    expect(markup.indexOf('the user asks')).toBeLessThan(markup.indexOf('the assistant answers'))
    // Exactly one assistant bubble, and the streaming cursor trails only it (never the user bubble).
    expect(threadBubbleCount(markup)).toBe(1)
    expect(markup.match(new RegExp(CURSOR, 'g'))?.length ?? 0).toBe(1)
    expect(markup.indexOf(CURSOR)).toBeGreaterThan(markup.indexOf('the assistant answers'))
  })
})

// #286: the session-boundary delimiter row (Figma node 16-35). Server-rendered with a FIXED `now` via
// the Timeline prop so the relative time is deterministic (the deterministic-time unit tests live in
// sessionBoundaryViewModel.test.ts; here we prove the row's structure and its untrusted-text posture).
describe('Timeline — the session-boundary delimiter (#286)', () => {
  // A fixed `now` two hours after occurredAt → the title's time reads `2 hours ago` (the Figma copy).
  const now = Date.parse('2026-01-15T12:00:00.000Z')
  const twoHoursAgo = new Date(now - 2 * 3_600_000).toISOString()

  it('renders a titled horizontal rule row — no bubble, no cursor, no data-thread-role (AC1/AC4)', () => {
    const items: ThreadItem[] = [
      { kind: 'sessionBoundary', reason: 'workspace_change', workspaceCwd: '~/Workspace/Projects/KitchenClaw', occurredAt: twoHoursAgo }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} now={now} />)
    expect(markup).toContain('session-delimiter')
    expect(markup).toContain('session-delimiter__rule')
    // The full Figma title, path verbatim, over the long-form relative time.
    expect(markup).toContain('Workspace changed to ~/Workspace/Projects/KitchenClaw — 2 hours ago')
    // A distinct row: not attributed to assistant/user/tool, and not a streaming tail.
    expect(markup).not.toContain('data-thread-role')
    expect(threadBubbleCount(markup)).toBe(0)
    expect(markup).not.toContain(CURSOR)
  })

  it('renders the rule as an aria-hidden decorative element (purely visual, not semantic)', () => {
    const items: ThreadItem[] = [
      { kind: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: twoHoursAgo }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} now={now} />)
    // The provisional pathless clear label, and the rule carrying aria-hidden.
    expect(markup).toContain('New session — 2 hours ago')
    expect(markup).toMatch(/session-delimiter__rule[^>]*aria-hidden="true"/)
  })

  it('renders an untrusted workspaceCwd as visible characters, never live markup (AC4)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const items: ThreadItem[] = [
      { kind: 'sessionBoundary', reason: 'workspace_change', workspaceCwd: '<b>x</b>', occurredAt: twoHoursAgo }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} now={now} />)
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })

  it('sits in arrival order between the surrounding message groups, a fresh row (AC1)', () => {
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: 'before the break' },
      { kind: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: twoHoursAgo },
      { kind: 'userText', text: 'after the break' }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} now={now} />)
    expect(markup.indexOf('before the break')).toBeLessThan(markup.indexOf('session-delimiter'))
    expect(markup.indexOf('session-delimiter')).toBeLessThan(markup.indexOf('after the break'))
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

// #317: the stall indicator bound to the coarse `stalled` scalar. StallIndicator is the ThinkingIndicator
// twin over a boolean rather than a ThreadItem[] — pure (isStalled in, markup out) — so a server-rendered
// string proves both the present affordance (stalled) and the zero-footprint absent case. Boolean input,
// not the store type: the view structurally cannot render a daemon-supplied string (AC4 — the stall frame
// carries no daemon content). Injected boolean: no store, no IPC — the container's shown branch is
// unreachable under server render (zustand v5 reads getInitialState() → stalled: false), so the "showing"
// assertion lives here, exactly like Timeline's / ThinkingIndicator's populated assertions.
describe('StallIndicator — the stalled-turn problem-state affordance (#317)', () => {
  it('is inert when not stalled — renders nothing (zero layout footprint)', () => {
    expect(renderToStaticMarkup(<StallIndicator isStalled={false} />)).toBe('')
  })

  it('shows a stall-distinct affordance while stalled, never the thinking treatment (AC4)', () => {
    const markup = renderToStaticMarkup(<StallIndicator isStalled={true} />)
    // The stall-distinct wrapper + bubble classes (the problem-state treatment, built from --color-error).
    expect(markup).toContain('conversation__stall')
    expect(markup).toContain('bubble--stall')
    // The client-owned copy — apostrophe-free, U+2026 ellipsis (survives renderToStaticMarkup escaping),
    // never a daemon string.
    expect(markup).toContain('The turn seems to have stalled…')
    // Visually distinct from the thinking indicator (AC4) — a problem state, not normal progress.
    expect(markup).not.toContain('bubble--thinking')
  })
})

// #307: the running-turn interrupt control. isTurnRunning is the exported gate predicate; InterruptButton
// the exported pure view (the ThinkingIndicator pattern) — call / server-render them directly with
// injected values, no store. The gate is deliberately BROADER than ThinkingIndicator's (`phase ===
// 'thinking'` only): a turn is "running" in BOTH thinking and responding, so the interrupt affordance
// shows in either. The store-bound InterruptControl is untested glue (the QueuedBacklogControl posture);
// the activation→command proof lives in sendInterrupt.test.ts (the `node` env fires no clicks).
describe('isTurnRunning — the interrupt gate (broader than the thinking indicator)', () => {
  it('is running while thinking (AC1)', () => {
    expect(isTurnRunning('thinking')).toBe(true)
  })

  it('is running while responding — the broader-than-indicator phase (AC1)', () => {
    expect(isTurnRunning('responding')).toBe(true)
  })

  it('is not running while idle (AC1)', () => {
    expect(isTurnRunning('idle')).toBe(false)
  })
})

describe('InterruptButton — the running-turn interrupt affordance (#307)', () => {
  const noop = (): void => {}

  it('is inert when not running — renders nothing (zero layout footprint, AC1)', () => {
    expect(renderToStaticMarkup(<InterruptButton isRunning={false} onInterrupt={noop} />)).toBe('')
  })

  it('shows an icon-only button with an accessible name conveying stop/interrupt while running (AC1/AC4)', () => {
    const markup = renderToStaticMarkup(<InterruptButton isRunning={true} onInterrupt={noop} />)
    expect(markup).toContain('conversation__interrupt')
    // Match the exact button class (the closing quote excludes the .interrupt-button-icon svg class,
    // which shares the prefix) — one icon-only control.
    expect(markup).toContain('class="interrupt-button"')
    // The client-owned accessible name (icon-only control), never a daemon string; conveys both
    // "stop" and "interrupt" (AC4). Keyboard activation is free from the native <button> (AC4).
    expect(markup).toContain('aria-label="Stop the running turn"')
  })
})

// #324: the screen-snapshot action & display. ScreenSnapshotView is the exported pure view bundling the
// request button and the display region (the InterruptButton posture, but carrying the display too since
// action + display are one surface, per the ticket's one-`s` sizing note) — server-render it with injected
// props to prove every render branch without a store. The store-bound ScreenSnapshotControl is untested
// glue (the InterruptControl / QueuedBacklogControl posture); the activation→command proof lives in
// requestScreenSnapshot.test.ts (the `node` env fires no clicks). The disconnected + null-snapshot container
// smoke lives in the store-binding block below.
describe('ScreenSnapshotView — the screen-snapshot action & display (#324)', () => {
  const noop = (): void => {}
  const ts = '2026-07-13T00:00:00Z'

  it('shows the empty placeholder and no screen when no snapshot has arrived (null, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ScreenSnapshotView snapshot={null} canRequest={true} onRequest={noop} />
    )
    expect(markup).toContain('screen-snapshot__empty')
    expect(markup).toContain('No screen snapshot yet')
    // The null state is structurally distinct from a received blank screen: no <pre>.
    expect(markup).not.toContain('screen-snapshot__screen')
    expect(markup).not.toContain('<pre')
  })

  it('shows the held screen text in a <pre>, not the placeholder, once a snapshot arrives (AC3/AC5)', () => {
    const markup = renderToStaticMarkup(
      <ScreenSnapshotView snapshot={{ text: 'hello world', ts }} canRequest={true} onRequest={noop} />
    )
    expect(markup).toContain('screen-snapshot__screen')
    expect(markup).toContain('hello world')
    expect(markup).not.toContain('screen-snapshot__empty')
    expect(markup).not.toContain('No screen snapshot yet')
  })

  it('tells a received blank screen apart from "no snapshot yet": empty text still renders the <pre> (AC3)', () => {
    const markup = renderToStaticMarkup(
      <ScreenSnapshotView snapshot={{ text: '', ts }} canRequest={true} onRequest={noop} />
    )
    // A real received blank screen ({ text: '', ts }) renders the <pre> (present, empty content) —
    // structurally distinct from the null placeholder.
    expect(markup).toContain('screen-snapshot__screen')
    expect(markup).not.toContain('screen-snapshot__empty')
  })

  it('renders the screen text as escaped plain text, never live HTML (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ScreenSnapshotView snapshot={{ text: '<b>x</b>', ts }} canRequest={true} onRequest={noop} />
    )
    // Auto-escaped React children — untrusted daemon-relayed content renders as literal characters, never
    // an injected element (no dangerouslySetInnerHTML). Apostrophe-free fixture (renderToStaticMarkup
    // escapes `'` → `&#x27;`, the standing desktop lesson).
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })

  it('renders the request button enabled while connected (AC1/AC2)', () => {
    const markup = renderToStaticMarkup(
      <ScreenSnapshotView snapshot={null} canRequest={true} onRequest={noop} />
    )
    const requestButton = markup.match(/<button[^>]*class="screen-snapshot__request"[^>]*>/)?.[0] ?? ''
    expect(requestButton).not.toBe('')
    expect(requestButton).not.toContain('disabled')
  })

  it('disables the request button while not connected (AC2)', () => {
    const markup = renderToStaticMarkup(
      <ScreenSnapshotView snapshot={null} canRequest={false} onRequest={noop} />
    )
    const requestButton = markup.match(/<button[^>]*class="screen-snapshot__request"[^>]*>/)?.[0] ?? ''
    expect(requestButton).toContain('disabled')
  })
})

// #294: the held queued backlog. QueuedBacklog is the pure, exported view (the ThinkingIndicator
// pattern) — server-render it with an injected QueuedItem[] to prove the empty→null posture and the
// populated rows without touching the queue store. The store-bound QueuedBacklogControl reads
// selectBacklogFor(MILESTONE_CONVERSATION_ID); its populated branch is NOT server-render-reachable
// (zustand v5's useStore reads getInitialState() = empty backlog), so the populated assertions live
// here, exactly like Timeline / ThinkingIndicator; the empty container smoke lives in the block below.
describe('QueuedBacklog — the held queued backlog (#294)', () => {
  const item = (queued_msg_id: number, text: string): QueuedItem => ({
    queued_msg_id,
    text,
    ts: '2026-07-12T00:00:00Z'
  })

  // #296: the drop affordance made onDrop a REQUIRED prop (the "a view that cannot answer is a bug"
  // rule). These render calls don't exercise the click path (renderToStaticMarkup can't fire clicks —
  // the id→command proof lives in dropQueuedMessage.test.ts), so a no-op onDrop satisfies the type.
  const noopDrop = (): void => {}

  it('renders nothing for an empty backlog — no region, no chrome (AC4)', () => {
    // Contrast the Timeline's empty-thread invitation: an empty backlog is silent, not an empty state.
    // With no rows there is no drop affordance either (#296 AC4) — a structural guarantee of empty→null.
    expect(renderToStaticMarkup(<QueuedBacklog items={[]} onDrop={noopDrop} />)).toBe('')
  })

  it('renders one row per queued item, in enqueue order, each showing its text (AC1)', () => {
    const markup = renderToStaticMarkup(
      <QueuedBacklog items={[item(1, 'first queued'), item(2, 'second queued')]} onDrop={noopDrop} />
    )
    expect(markup).toContain('conversation__queued')
    expect(markup).toContain('first queued')
    expect(markup).toContain('second queued')
    // Array position IS enqueue order: the first item precedes the second in the rendered markup.
    expect(markup.indexOf('first queued')).toBeLessThan(markup.indexOf('second queued'))
  })

  it('is visually distinct from delivered messages — the queued role, reusing the user bubble (AC2)', () => {
    const markup = renderToStaticMarkup(<QueuedBacklog items={[item(1, 'waiting to run')]} onDrop={noopDrop} />)
    // The dimmed region + the queued thread role are the distinctness seams…
    expect(markup).toContain('conversation__queued')
    expect(markup).toContain('data-thread-role="queued"')
    // …reusing the right-aligned user-bubble treatment (queued messages are the user's own sends)…
    expect(markup).toContain('bubble--user')
    // …but never the delivered user role, so a queued row is never counted as a delivered message.
    expect(markup).not.toContain('data-thread-role="user"')
  })

  it('renders untrusted text as plain text, never live markup (load-bearing)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (a prior desktop lesson).
    const markup = renderToStaticMarkup(<QueuedBacklog items={[item(1, '<b>x</b>')]} onDrop={noopDrop} />)
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })

  // #296: every queued row carries a drop / cancel affordance (AC1) — an icon-only button whose
  // accessible name is a client-owned aria-label. Exactly one per row (never on a delivered row — AC4/
  // AC5 are structural: only QueuedBacklog renders this button, and Timeline — which draws the delivered
  // rows — is untouched). The click→command wiring is proven in dropQueuedMessage.test.ts.
  it('carries one drop affordance per queued row, each with an accessible name (AC1)', () => {
    const markup = renderToStaticMarkup(
      <QueuedBacklog items={[item(1, 'first queued'), item(2, 'second queued')]} onDrop={noopDrop} />
    )
    // The accessible name is a client-owned aria-label (icon-only control), never a daemon string.
    expect(markup).toContain('aria-label="Drop queued message"')
    // Exactly one drop control per queued row — no more, no fewer. Match the exact button class (the
    // closing quote excludes the .queued-row__drop-icon svg class, which shares the prefix).
    expect(markup.match(/class="queued-row__drop"/g)?.length ?? 0).toBe(2)
    expect(markup.match(/aria-label="Drop queued message"/g)?.length ?? 0).toBe(2)
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

// #279: the prominent, disconnected-only connection banner. ConnectionBanner is the pure, exported
// view (the RepairPrompt pattern) — server-render it directly with each `status` prop to prove the
// present/absent matrix without touching the store. The store-bound ConnectionBannerControl container
// reads the same slice; its disconnected branch IS server-render-reachable (getInitialState =
// disconnected is a VISIBLE branch here, unlike RepairControl), so the mounted-visible case is proven
// in the ConversationScreen container block below.
describe('ConnectionBanner — the disconnected-only connection band', () => {
  const ack = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it('renders the client-owned copy while disconnected (AC1)', () => {
    const markup = renderToStaticMarkup(<ConnectionBanner status={{ type: 'disconnected' }} />)
    expect(markup).toContain('conversation__banner')
    expect(markup).toContain(CONNECTION_BANNER_COPY)
  })

  it('renders the client-owned copy while connecting (AC1)', () => {
    const markup = renderToStaticMarkup(<ConnectionBanner status={{ type: 'connecting' }} />)
    expect(markup).toContain(CONNECTION_BANNER_COPY)
  })

  it('renders the client-owned copy while in a connection error (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ConnectionBanner
        status={{ type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }}
      />
    )
    expect(markup).toContain(CONNECTION_BANNER_COPY)
  })

  it('renders nothing when connected (AC2)', () => {
    const markup = renderToStaticMarkup(<ConnectionBanner status={{ type: 'connected', ack }} />)
    expect(markup).toBe('')
  })

  // AC3: the banner text is the client-owned constant only — never a daemon-supplied string. Given an
  // error status carrying a secret in ConnectionError.message, the rendered band contains the copy and
  // NOT the message, so no daemon string can reach the banner (a structural guarantee — the view
  // renders CONNECTION_BANNER_COPY, nothing derived from `status`).
  it('never renders ConnectionError.message — only the client-owned copy (AC3)', () => {
    const markup = renderToStaticMarkup(
      <ConnectionBanner
        status={{
          type: 'error',
          error: { code: 'x', message: 'DAEMON_SECRET_DETAIL', retryable: false }
        }}
      />
    )
    expect(markup).toContain(CONNECTION_BANNER_COPY)
    expect(markup).not.toContain('DAEMON_SECRET_DETAIL')
  })

  // AC5: the prominent banner copy reads distinctly from the terse composer hints, so the two surfaces
  // never render as the same string stacked twice. Pinned against the actual composerAvailability
  // outputs (not hardcoded strings) so a future hint tweak can't silently collide with the banner.
  it('is lexically distinct from all three composer hints (AC5)', () => {
    const composerHints = [
      composerAvailability({ type: 'connecting' }).hint,
      composerAvailability({ type: 'disconnected' }).hint,
      composerAvailability({
        type: 'error',
        error: { code: 'x', message: 'm', retryable: false }
      }).hint
    ]
    expect(composerHints).not.toContain(CONNECTION_BANNER_COPY)
  })
})

// #330: the two-dot Relay/Pyrycode connection-status indicator. relayLeg / daemonLeg are the exported
// pure leg-mapping predicates (the isTurnRunning shape) — call them directly with each store value to
// prove the full leg → category → label matrix with no store, no render. ConnectionStatusIndicator is
// the exported pure view (the ConnectionBanner pattern) — server-render it with injected ConnectionLeg
// props to prove category → dot class, label legibility (AC2), and independent legs (AC4). The
// store-bound ConnectionStatusIndicatorControl is untested glue (the QueuedBacklogControl posture); its
// initial two-Offline render is proven in the ConversationScreen container block below.
describe('relayLeg — the relay-link leg mapping (#330)', () => {
  it('connected → up / "Relay Connected"', () => {
    expect(relayLeg('connected')).toEqual({ category: 'up', label: 'Relay Connected' })
  })

  // daemon-absent = relay reachable but no daemon behind it: the relay leg reads up with a DISTINCT
  // "Reachable" label — the missing daemon is the daemon leg's story, not a relay failure (AC4).
  it('daemon-absent → up / "Relay Reachable" (a reachable relay, not a relay failure)', () => {
    expect(relayLeg('daemon-absent')).toEqual({ category: 'up', label: 'Relay Reachable' })
  })

  it('offline → down / "Relay Offline"', () => {
    expect(relayLeg('offline')).toEqual({ category: 'down', label: 'Relay Offline' })
  })

  // AC1: null is the initial "relay not yet up" state — down, NOT in-progress (the relay leg has no
  // in-progress arm; that category is exercised only by the daemon leg's connecting).
  it('null → down / "Relay Offline" — the initial not-connected state (AC1)', () => {
    expect(relayLeg(null)).toEqual({ category: 'down', label: 'Relay Offline' })
  })
})

describe('daemonLeg — the daemon-session leg mapping (#330)', () => {
  const ack = { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] }

  it('connected → up / "Pyrycode Connected"', () => {
    expect(daemonLeg({ type: 'connected', ack })).toEqual({
      category: 'up',
      label: 'Pyrycode Connected'
    })
  })

  // AC3: the daemon dot reaches up ONLY on connected — connecting is in-progress (amber), never green.
  it('connecting → in-progress / "Pyrycode Connecting" — never up (AC3, no false green)', () => {
    expect(daemonLeg({ type: 'connecting' })).toEqual({
      category: 'in-progress',
      label: 'Pyrycode Connecting'
    })
  })

  it('disconnected → down / "Pyrycode Offline"', () => {
    expect(daemonLeg({ type: 'disconnected' })).toEqual({
      category: 'down',
      label: 'Pyrycode Offline'
    })
  })

  // error maps to the same down/"Offline" as disconnected and renders a fixed client-owned label — the
  // daemon ErrorPayload.message never reaches the leg (the banner #279 owns the error text).
  it('error → down / "Pyrycode Offline" — never a daemon-supplied string', () => {
    expect(
      daemonLeg({ type: 'error', error: { code: 'x', message: 'DAEMON_SECRET', retryable: false } })
    ).toEqual({ category: 'down', label: 'Pyrycode Offline' })
  })
})

describe('ConnectionStatusIndicator — the two-dot pure view (#330)', () => {
  it('maps each category to its dot modifier class (up, in-progress, down)', () => {
    const up = renderToStaticMarkup(
      <ConnectionStatusIndicator
        relay={{ category: 'up', label: 'Relay Connected' }}
        daemon={{ category: 'in-progress', label: 'Pyrycode Connecting' }}
      />
    )
    // up → the success/green dot; in-progress → the warning/amber dot (the AC3 daemon-connecting story).
    expect(up).toContain('conn-dot--up')
    expect(up).toContain('conn-dot--in-progress')

    const down = renderToStaticMarkup(
      <ConnectionStatusIndicator
        relay={{ category: 'down', label: 'Relay Offline' }}
        daemon={{ category: 'down', label: 'Pyrycode Offline' }}
      />
    )
    expect(down).toContain('conn-dot--down')
  })

  // AC2: status is legible without colour — each leg's label text renders alongside its dot.
  it("renders each leg's label text so status reads without colour (AC2)", () => {
    const markup = renderToStaticMarkup(
      <ConnectionStatusIndicator
        relay={{ category: 'up', label: 'Relay Reachable' }}
        daemon={{ category: 'down', label: 'Pyrycode Offline' }}
      />
    )
    expect(markup).toContain('Relay Reachable')
    expect(markup).toContain('Pyrycode Offline')
  })

  // AC4: the two legs render independently — neither leg's category forces the other's. relay=up +
  // daemon=down coexist (the intended relay-up-daemon-handshaking / stale-relay-after-fatal render).
  it('renders independent legs — relay up and daemon down coexist (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ConnectionStatusIndicator
        relay={{ category: 'up', label: 'Relay Reachable' }}
        daemon={{ category: 'down', label: 'Pyrycode Offline' }}
      />
    )
    expect(markup).toContain('conn-dot--up')
    expect(markup).toContain('conn-dot--down')
  })

  // The dots are decorative (colour is redundant with the label, AC2) and the wrapper is a STATIC
  // labelled group, not a live region — the banner (#279) already announces disconnects, so a second
  // live region here would double-announce.
  it('marks the dots aria-hidden and the wrapper as a labelled group', () => {
    const markup = renderToStaticMarkup(
      <ConnectionStatusIndicator
        relay={{ category: 'up', label: 'Relay Connected' }}
        daemon={{ category: 'up', label: 'Pyrycode Connected' }}
      />
    )
    expect(markup).toContain('role="group"')
    expect(markup).toContain('aria-label="Connection status"')
    expect(markup).toContain('aria-hidden="true"')
  })
})

// #278: the pre-first-message workspace chip. WorkspaceChip is pure (props in, markup out) — a
// ConversationCreatedPayload | null + an isEmpty boolean + an optional onChange — so a server-rendered
// string proves the gate (empty AND present AND unpromoted) and the escaping of the untrusted cwd. The
// container store read (activeConversationStore) is covered by activeConversationStore.test.ts; the
// created-event write path by conversationCreatedBridge.test.ts + PairedShell composition.
function createdPayload(
  overrides: Partial<ConversationCreatedPayload> = {}
): ConversationCreatedPayload {
  return {
    id: 'c1',
    is_promoted: false,
    cwd: '/home/pyry/scratch',
    name: null,
    last_used_at: '2026-07-12T00:00:00Z',
    ...overrides
  }
}

describe('WorkspaceChip — the pre-first-message workspace pill (#278)', () => {
  it('renders the label, the cwd, and the change affordance on an empty new-discussion thread (AC1)', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceChip conversation={createdPayload({ cwd: '/home/pyry/scratch' })} isEmpty={true} />
    )
    expect(markup).toContain('conversation__workspace-chip')
    // The client-owned label constant — no daemon string reaches the label.
    expect(markup).toContain('Workspace')
    // The daemon-supplied cwd, rendered whole and opaque.
    expect(markup).toContain('/home/pyry/scratch')
    // The "change" affordance (AC4).
    expect(markup).toContain('Change')
  })

  it('renders nothing once the thread has a message — a pre-first-message affordance only (AC3)', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceChip conversation={createdPayload()} isEmpty={false} />
    )
    expect(markup).toBe('')
  })

  it('renders nothing when there is no active conversation', () => {
    const markup = renderToStaticMarkup(<WorkspaceChip conversation={null} isEmpty={true} />)
    expect(markup).toBe('')
  })

  it('renders nothing for a promoted conversation — a new-discussion affordance only (AC1)', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceChip conversation={createdPayload({ is_promoted: true })} isEmpty={true} />
    )
    expect(markup).toBe('')
  })

  it('renders an HTML-ish cwd escaped, never as live markup (AC2)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const markup = renderToStaticMarkup(
      <WorkspaceChip conversation={createdPayload({ cwd: '<b>hi</b>' })} isEmpty={true} />
    )
    expect(markup).toContain('&lt;b&gt;hi&lt;/b&gt;')
    expect(markup).not.toContain('<b>hi</b>')
  })

  it('disables the change affordance until a picker target is wired (AC4 placeholder)', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceChip conversation={createdPayload()} isEmpty={true} />
    )
    const changeButton = markup.match(/<button[^>]*aria-label="Change workspace"[^>]*>/)?.[0] ?? ''
    expect(changeButton).toContain('disabled')
  })

  it('enables the change affordance when an onChange target is provided (the #157 seam)', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceChip conversation={createdPayload()} isEmpty={true} onChange={() => {}} />
    )
    const changeButton = markup.match(/<button[^>]*aria-label="Change workspace"[^>]*>/)?.[0] ?? ''
    expect(changeButton).not.toContain('disabled')
  })
})

// #276: the thread top-bar overflow menu. ThreadOverflowMenuView is the pure, exported view (the
// InterruptButton / ThinkingIndicator pattern) — server-render it with an injected `open` boolean to
// prove the collapsed trigger and the opened menu surface without a store or a DOM harness. The
// interaction shell (open/close toggle, Escape / outside-click dismiss, focus-return) lives in the
// in-file ThreadOverflowMenu container: it is untested reviewed glue, exactly like Composer.handleKeyDown
// and UnpairControl's phase transitions — the `node` env fires no clicks and runs no effects.
describe('ThreadOverflowMenuView — the thread overflow menu (#276)', () => {
  const noop = (): void => {}

  it('renders a collapsed icon-only trigger advertising a menu popup, no surface (AC1/AC2)', () => {
    const markup = renderToStaticMarkup(
      <ThreadOverflowMenuView open={false} onToggle={noop} onSelect={noop} />
    )
    // The icon-only trigger: a client-owned accessible name, the haspopup=menu affordance, and the
    // collapsed state (React stringifies aria booleans under renderToStaticMarkup → "false").
    expect(markup).toContain('aria-label="More actions"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    // Closed: the menu surface is not rendered.
    expect(markup).not.toContain('role="menu"')
    expect(markup).not.toContain('Channel info')
  })

  it('exposes a role=menu surface with a single Channel info item when open (AC2/AC4)', () => {
    const markup = renderToStaticMarkup(
      <ThreadOverflowMenuView open={true} onToggle={noop} onSelect={noop} />
    )
    // The trigger now advertises the expanded state…
    expect(markup).toContain('aria-expanded="true"')
    // …and the menu surface exposes role=menu with a menuitem carrying the (apostrophe-free) copy that
    // #155 wires to open the Channel Info sheet (Figma 20-48).
    expect(markup).toContain('role="menu"')
    expect(markup).toContain('role="menuitem"')
    expect(markup).toContain('Channel info')
  })
})

// #365: the Channel Info sheet. ChannelInfoSheetView is the pure, exported view (the StatusSheet /
// ThreadOverflowMenuView pattern) — server-render it with an injected conversation to prove the chrome,
// the populated About / Channel ID footer, the null-conversation placeholder, the empty Actions slot,
// the untrusted-string escaping, and the absence of the deferred Figma rows. `now` is injected so the
// Last-activity relative time is deterministic. The interaction shell (open toggle from the overflow
// menu, the Escape document-listener in the ChannelInfoSheet container) is untested reviewed glue —
// exactly like StatusSheet's open-on-StatusRow-click wiring and ThreadOverflowMenu's Escape effect —
// since the `node` env fires no clicks and runs no effects.
describe('ChannelInfoSheetView — the Channel Info sheet (#365)', () => {
  const noop = (): void => {}

  it('renders the bottom-sheet dialog chrome — handle, labelled dialog, close control (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} />
    )
    // The StatusSheet chrome, reused verbatim: a modal dialog labelled by its own title id, a scrim,
    // the drag handle, and the icon-only close control carrying its client-owned accessible name.
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby="channel-info-sheet-title"')
    expect(markup).toContain('id="channel-info-sheet-title"')
    expect(markup).toContain('status-sheet__handle')
    expect(markup).toContain('aria-label="Close"')
  })

  it('renders the conversation name, the Workspace + Last-activity rows, and the Channel ID footer (AC3/AC4)', () => {
    // now = last_used_at + 2h → formatLastActivity yields the deterministic "2h ago" bucket.
    const now = Date.parse('2026-07-12T00:00:00Z') + 2 * 60 * 60 * 1000
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView
        conversation={createdPayload({
          id: 'ch_abc123',
          name: 'kitchenclaw refactor',
          cwd: '/home/pyry/scratch',
          last_used_at: '2026-07-12T00:00:00Z'
        })}
        now={now}
        onClose={noop}
      />
    )
    // Header shows the daemon-derived name as inert auto-escaped text (AC3).
    expect(markup).toContain('kitchenclaw refactor')
    // About section header + the two supported detail rows.
    expect(markup).toContain('About')
    expect(markup).toContain('Workspace')
    expect(markup).toContain('/home/pyry/scratch')
    expect(markup).toContain('Last activity')
    expect(markup).toContain('2h ago')
    // The Channel ID footer carries the opaque daemon id behind a client-owned prefix.
    expect(markup).toContain('Channel ID: ch_abc123')
  })

  it('falls back to the unnamed-conversation label when name is null (no crash, no empty title)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload({ name: null })} onClose={noop} />
    )
    expect(markup).toContain('Unnamed conversation')
  })

  it('opens gracefully with a placeholder About when the active conversation is null (AC4)', () => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={null} onClose={noop} />)
    // Chrome + the empty-About placeholder + the Actions header still render…
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('No conversation details yet')
    expect(markup).toContain('Actions')
    // …but no detail rows and no Channel ID footer (there is no id when conversation is null).
    expect(markup).not.toContain('Workspace')
    expect(markup).not.toContain('Last activity')
    expect(markup).not.toContain('Channel ID')
  })

  it('renders the Actions section header over an empty slot — no action buttons this ticket (AC5)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} />
    )
    expect(markup).toContain('Actions')
    // The Archive / Delete / Rename / Change-workspace tickets fill the slot; none exist here (AC5/AC6).
    expect(markup).not.toContain('Rename')
    expect(markup).not.toContain('Archive')
    expect(markup).not.toContain('Delete')
    expect(markup).not.toContain('Change workspace')
  })

  it('renders untrusted name / cwd strings escaped, never as live markup (AC3)', () => {
    // No bare apostrophes rendered raw — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView
        conversation={createdPayload({ name: "Ada & Bob's <b>chan</b>", cwd: '<b>root</b>' })}
        onClose={noop}
      />
    )
    // The daemon strings reach the DOM only as auto-escaped React children — the sink is inert.
    expect(markup).toContain('&lt;b&gt;chan&lt;/b&gt;')
    expect(markup).toContain('&lt;b&gt;root&lt;/b&gt;')
    expect(markup).toContain('&#x27;')
    expect(markup).not.toContain('<b>chan</b>')
    expect(markup).not.toContain('<b>root</b>')
  })

  it('does not invent the deferred Figma rows that have no desktop wire field', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} />
    )
    // Created / Total sessions / Total messages / Memory are Figma 20-48 content with no field on
    // ConversationCreatedPayload — deferred, not fabricated.
    expect(markup).not.toContain('Created')
    expect(markup).not.toContain('Total sessions')
    expect(markup).not.toContain('Total messages')
    expect(markup).not.toContain('Memory')
  })

  // #368: the Rename action fills the Actions slot #365 left empty. It is gated on the `onRename`
  // callback, which the container supplies ONLY when there is an active conversation to rename — so
  // the button's presence maps one-to-one onto AC1 (present with a conversation, absent on the
  // list-opened null-conversation case).
  it('renders a Rename action in the Actions slot when a conversation and onRename are supplied (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} onRename={noop} />
    )
    // The tonal pill lands in the existing Actions mount point, labelled "Rename". The quote-terminated
    // class distinguishes the button (.channel-info__action) from the plural slot (.channel-info__actions).
    expect(markup).toContain('class="channel-info__action"')
    expect(markup).toContain('>Rename</button>')
  })

  it('offers no Rename action when the active conversation is null (the graceful-empty guard, AC1)', () => {
    // A list-opened thread (conversation === null) gets no onRename from the container, so the
    // Actions header renders over an empty slot — no Rename control, consistent with #365's empty About.
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={null} onClose={noop} />)
    expect(markup).toContain('Actions')
    expect(markup).not.toContain('class="channel-info__action"')
    expect(markup).not.toContain('Rename')
  })

  it('offers no Rename action when onRename is omitted, even with a conversation (callback-gated, AC1)', () => {
    // The button is gated on the callback, not the conversation alone — this proves the view honours
    // the container's null-guard contract rather than deriving the button from `conversation` itself.
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} />
    )
    expect(markup).not.toContain('class="channel-info__action"')
    expect(markup).not.toContain('Rename')
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

  // #179 AC4: the coarse MessageThread mount is retired, leaving the timeline the single thread
  // surface. Against the empty stores that means no thread region renders at all — no coarse
  // data-message-role bubbles, no timeline data-thread-role rows, and no second empty thread
  // container (MessageThread used to render an empty .conversation__thread even with no messages).
  it('renders exactly one thread surface — no split-brain, no empty second thread region (AC4)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(bubbleCount(markup)).toBe(0)
    expect(markup).not.toContain('data-thread-role')
    expect(markup).not.toContain('conversation__thread')
  })

  // #277: the timeline view mounts against the empty timeline store (getInitialState items: []), so
  // it now renders the pre-first-message empty state (replacing #203's `return null`) at first paint —
  // still contributing no streaming cursor. The populated path is proven on the pure Timeline above.
  it('mounts the empty timeline as the empty state, with no streaming cursor', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('conversation__empty')
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

  // #317: the stall indicator mounts against the initial timeline store (getInitialState stalled:
  // false), so isStalled is false and StallIndicator returns nothing — the inert render slice, layout
  // unchanged until a stall onset (the ThinkingIndicator-smoke analog). The showing path is proven on
  // the pure StallIndicator describe above.
  it('mounts the initial timeline with no stall indicator (the inert render slice)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__stall')
  })

  // #294: the queued-backlog control mounts against the empty queue store (getInitialState backlogs:
  // empty Map → selectBacklogFor returns EMPTY_BACKLOG), so QueuedBacklog returns null and no queued
  // region renders (AC4). This also keeps the #179 AC4 split-brain guard green — the region class is
  // `conversation__queued`, never the `conversation__thread` substring, and it emits no data-thread-role
  // when empty. The populated path is proven on the pure QueuedBacklog describe above.
  it('mounts the empty queue store with no queued backlog region (the inert render slice, AC4)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__queued')
  })

  // #307: the interrupt control mounts against the idle timeline store (getInitialState phase: 'idle'),
  // so isTurnRunning is false and InterruptButton returns null — no interrupt region renders. The inert
  // render slice, layout unchanged until a turn runs (the ThinkingIndicator-smoke analog); the running
  // path is proven on the pure InterruptButton describe above, and the dispatch in sendInterrupt.test.ts.
  // Also keeps window.pyry out of the container render — the bridge is dereferenced only in the click
  // closure, so the server render never touches it.
  it('mounts the idle timeline with no interrupt control (the inert render slice)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__interrupt')
    expect(markup).not.toContain('interrupt-button')
  })

  // #324: the screen-snapshot control mounts against the initial disconnected + null-snapshot stores
  // (zustand v5's useStore reads getInitialState() under server render → status disconnected, snapshot
  // null). So the request button renders DISABLED (the composer-send-gate parallel — disconnected is the
  // only server-render-reachable branch, AC2) and the "no snapshot yet" placeholder shows with no <pre>
  // (AC3). The showing / enabled / populated branches are proven on the pure ScreenSnapshotView describe
  // above. Also keeps window.pyry out of the container render — the bridge is dereferenced only in the
  // onRequest click closure, so the server render never touches it.
  it('mounts the disconnected, no-snapshot stores: the request button is disabled and the empty placeholder shows (AC2/AC3)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    const requestButton = markup.match(/<button[^>]*class="screen-snapshot__request"[^>]*>/)?.[0] ?? ''
    expect(requestButton).toContain('disabled')
    expect(markup).toContain('screen-snapshot__empty')
    expect(markup).toContain('No screen snapshot yet')
    expect(markup).not.toContain('screen-snapshot__screen')
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

  // #279: the connection banner mounts against the initial (disconnected) store — unlike the re-pair
  // affordance, disconnected is a VISIBLE branch, so ConnectionBannerControl's visible path IS reachable
  // under server render. It appears at the top of the thread and reads as distinct copy from the
  // composer's terse hint; both remain visible while disconnected (AC1/AC4/AC5), and no daemon string
  // reaches it (there is none at the initial disconnected status).
  it('renders the connection banner while disconnected, distinct from the composer hint (AC1/AC4/AC5)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    // The prominent banner and its client-owned copy are present…
    expect(markup).toContain('conversation__banner')
    expect(markup).toContain(CONNECTION_BANNER_COPY)
    // …alongside the terse composer hint, which reads as different copy (both visible, not duplicated).
    expect(markup).toContain('Not connected')
    expect(CONNECTION_BANNER_COPY).not.toContain('Not connected')
  })

  it('renders the banner above the message thread and below the header (top of the thread)', () => {
    // The banner mounts between UnpairControl (the header row) and the timeline surface, so its markup
    // precedes the thread's empty state.
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup.indexOf('conversation__banner')).toBeLessThan(markup.indexOf('conversation__empty'))
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

  // #330: the two-dot connection indicator mounts inside the status-row summary slot (beside — not
  // replacing — #181/#182's future run-config summary text). Under server render the initial store state
  // is relay = null (→ "Relay Offline") and daemon = disconnected (→ "Pyrycode Offline"), so both legs
  // render down — proving the container reads both stores with NO false green at rest (AC3).
  it('renders the two-dot connection indicator (both offline) in the status-row summary (#330)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('status-row__connection')
    expect(markup).toContain('Relay Offline')
    expect(markup).toContain('Pyrycode Offline')
    // Two down dots at the initial state — never up/green before a connection exists.
    expect(markup).not.toContain('conn-dot--up')
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

  // #276: the thread overflow menu is gated on onBack presence exactly like BackControl — mounted only
  // when the paired shell wires navigation. When onBack is provided the trailing more_vert trigger
  // renders (its popup advertised via aria-haspopup="menu"); it starts closed, so no menu surface is
  // present at first paint (the open toggle is untested useState glue — effects don't run under server
  // render). The pure view's open/closed contract is proven in the ThreadOverflowMenuView describe above.
  it('renders the overflow trigger, collapsed, when onBack is provided (the shell-mounted thread, AC1)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen onBack={() => {}} />)
    expect(markup).toContain('conversation__overflow')
    expect(markup).toContain('aria-haspopup="menu"')
    // Closed at first paint — no menu surface yet.
    expect(markup).not.toContain('role="menu"')
  })

  it('renders no overflow menu for a bare ConversationScreen (onBack absent — unchanged, AC1)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__overflow')
    // StatusRow keeps its own aria-haspopup="dialog"; only the menu popup must be absent.
    expect(markup).not.toContain('aria-haspopup="menu"')
  })
})
