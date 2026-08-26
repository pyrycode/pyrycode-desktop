import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ConversationScreen,
  MessageThread,
  Timeline,
  ThinkingIndicator,
  ComposerStatusArea,
  THINKING_COPY,
  WORKING_COPY,
  workingIndicatorState,
  workingIndicatorStateWithLocalSend,
  openToolName,
  toolWorkingCopy,
  StallIndicator,
  ApiRetryIndicator,
  API_RETRY_COPY,
  CompactingIndicator,
  COMPACTING_COPY,
  UNRECOGNIZED_COPY,
  UNRECOGNIZED_TRUNCATED_COPY,
  unrecognizedSiteLabel,
  ToolRow,
  TOOL_RESULT_EMPTY_COPY,
  shouldShowThinking,
  QueuedBacklog,
  StatusSheet,
  RepairPrompt,
  ConnectionBanner,
  WorkspaceChip,
  isTurnRunning,
  ComposerSendButton,
  ThreadOverflowMenuView,
  ChannelInfoSheetView,
  requestArchiveConversation,
  requestDeleteConversation,
  relayLeg,
  daemonLeg,
  ConnectionStatusIndicator,
  selectOpenTimelineFor
} from './ConversationScreen'
import { createConversationTimelineStore } from '../../store/conversationTimelineStore'
import { composerAvailability, CONNECTION_BANNER_COPY } from './composerSend'
import type { Message } from './messageViewModel'
import type { ThreadItem, ToolResult } from '../../store/threadTimeline'
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

// #609: the settled reply's markdown container. Its presence is the markup-level signal that a bubble
// took the markdown path; its absence, that the bubble is the still-growing plain-text tail.
const CONTAINER = 'bubble__markdown'

// One markdown source exercising every construct AC1 lists — built with join('\n'), never an indented
// template literal: a template literal indented to match this code would put four leading spaces on each
// line, which CommonMark reads as an INDENTED CODE BLOCK, and the case would then pass or fail for a
// reason unrelated to what it claims (#608's hard-break fixture lesson). No apostrophes — renderToStaticMarkup
// escapes ' → &#x27;.
const MARKDOWN_SOURCE = [
  '# Heading one',
  '',
  'Text with **bold** and `code` here.',
  '',
  '```',
  'const x = 1',
  '```',
  '',
  '- first item',
  '- second item',
  '',
  '> quoted line'
].join('\n')

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

  // #696 re-pointed this from #230/AC4. #230 declined to draw `resultSummary` at all; #696 draws it in
  // an expanded body, so this is no longer "the row never surfaces the result" — it is the
  // COLLAPSED-DEFAULT GUARD: a row rendered through the timeline switch passes no expanded flag, so the
  // sentinel must still not leak. Body kept byte-identical on purpose; it is the only assertion pinning
  // that #697's toggle has not silently become the default.
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

  // #696: the expanded tool row. `ToolRow` is exported so the expanded branch is reachable at all in
  // this repo's server-render tier — nothing passes the flag yet (#697 owns the toggle, the state and
  // the e2e), so `<Timeline>` can only ever produce the collapsed form. Every case below is a pure
  // function of (item, expanded), rendered directly.
  //
  // #705 extended it with `input` rather than adding a second builder: this file has one builder and
  // one idiom, and every existing caller omits the parameter, which is what makes them the free
  // regression baseline below. The key is set unconditionally, mirroring #643's own reducer — an
  // omitted argument is a property holding `undefined`, which the picker reads as absence.
  function toolItem(
    result: ToolResult | null,
    input?: Readonly<Record<string, string>>
  ): Extract<ThreadItem, { kind: 'toolCall' }> {
    return {
      kind: 'toolCall',
      turnId: 't1',
      toolUseId: 'u1',
      name: 'read_file',
      inputSummary: 'schema.ts',
      input,
      result
    }
  }

  it('draws no body with the expanded flag absent — the collapsed row is unchanged (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: 'RESULT_SENTINEL_zzz' })} />
    )
    expect(markup).toContain('class="tool-row tool-row--resolved"')
    expect(markup).not.toContain('tool-row--expanded')
    expect(markup).not.toContain('tool-row__body')
    expect(markup).not.toContain('tool-row__result')
    expect(markup).not.toContain('RESULT_SENTINEL_zzz')
  })

  it('draws the result body below an unchanged headline when expanded (AC2)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} defaultExpanded />
    )
    // The headline keeps its own modifiers; the expanded modifier is appended last.
    expect(markup).toContain('class="tool-row tool-row--resolved tool-row--expanded"')
    expect(markup).not.toContain('tool-row--error')
    expect(markup).toContain('tool-row__chip')
    expect(markup).toContain('data-thread-role="tool"')
    expect(markup).toContain('tool-row__body')
    expect(markup).not.toContain('tool-row__body--error')
    expect(markup).toContain('tool-row__result')
    // The body sits BELOW the headline: tool name, then input summary, then the result text.
    expect(markup.indexOf('read_file')).toBeLessThan(markup.indexOf('schema.ts'))
    expect(markup.indexOf('schema.ts')).toBeLessThan(markup.indexOf('184 lines'))
  })

  it('marks an error result body as distinguishable from a successful one (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: true, resultSummary: 'ENOENT' })} defaultExpanded />
    )
    expect(markup).toContain('class="tool-row tool-row--resolved tool-row--error tool-row--expanded"')
    expect(markup).toContain('tool-row__body--error')
    expect(markup).toContain('ENOENT')
  })

  // AC2's second half: command output is unreadable if the newlines collapse (the defect #607 fixed for
  // assistant messages). The <pre> tag plus the surviving \n is what this tier can assert; the
  // `white-space: pre` declaration itself is invisible to a server render.
  it('preserves the newlines the daemon sent rather than collapsing them onto one line (AC2)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: 'line one\nline two' })}
        defaultExpanded
      />
    )
    expect(markup).toContain('<pre class="tool-row__result">line one\nline two</pre>')
  })

  it('draws no body for a pending row (result: null) regardless of the flag (AC3)', () => {
    const markup = renderToStaticMarkup(<ToolRow item={toolItem(null)} defaultExpanded />)
    expect(markup).toContain('class="tool-row"')
    expect(markup).not.toContain('tool-row--expanded')
    expect(markup).not.toContain('tool-row__body')
    expect(markup).not.toContain('tool-row__result')
    expect(markup).not.toContain('tool-row__empty')
  })

  it('renders an explicit empty state for an empty result, not a blank gap (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '' })} defaultExpanded />
    )
    expect(markup).toContain('tool-row__empty')
    expect(markup).toContain(TOOL_RESULT_EMPTY_COPY)
    expect(markup).not.toContain('tool-row__result')
  })

  // Pins the `=== ''` decision against a future `.trim()`: whitespace-only output is output the daemon
  // actually sent, and trimming would relabel it as absent.
  it('treats a whitespace-only result as real output, not the empty state', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '\n\n' })} defaultExpanded />
    )
    expect(markup).toContain('tool-row__result')
    expect(markup).not.toContain('tool-row__empty')
  })

  // AC5: the result reaches the DOM only as auto-escaped React children — the posture `name` and
  // `inputSummary` already hold. No apostrophes in the fixture (renderToStaticMarkup escapes ' →
  // &#x27;, see the note above).
  it('renders the result text as inert escaped children, never live markup (AC5)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '<img src=x onerror=alert(1)>' })}
        defaultExpanded
      />
    )
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toContain('<img')
  })

  it('still routes the toolCall arm through the timeline switch, collapsed (AC1)', () => {
    const items: ThreadItem[] = [toolItem({ isError: false, resultSummary: 'ROUTED_SENTINEL_zzz' })]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('tool-row__chip')
    expect(markup).not.toContain('tool-row--expanded')
    expect(markup).not.toContain('ROUTED_SENTINEL_zzz')
  })

  // #697: the toggle. The chip on a RESOLVED row becomes the control; the boolean behind it is
  // component-local useState, so this tier can only ever observe its mount-time value. The click
  // itself — and the collapse-again and the keyboard path — is e2e/tool-row-toggle.spec.ts; what
  // these cases pin is the markup that click needs to exist and to be reachable.

  it('renders a resolved chip as a real button, collapsed at rest (#697 AC1)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} />
    )
    // A real <button>, not a div with a handler: keyboard activation and screen-reader semantics come
    // for free (UnrecognizedRow's rationale, verbatim).
    expect(markup).toContain(
      '<button type="button" class="tool-row__chip tool-row__chip--toggle" data-thread-role="tool" aria-expanded="false">'
    )
    // No daemon string reaches an attribute: no aria-label, no title, no aria-controls/id pair.
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-controls')
    // Collapsed at rest — the body is withheld, not merely hidden.
    expect(markup).not.toContain('tool-row--expanded')
    expect(markup).not.toContain('tool-row__body')
  })

  it('takes defaultExpanded as the toggle mount-time value, not as a controlled one (#697 AC1)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} defaultExpanded />
    )
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('tool-row__result')
  })

  // #697 AC2's unit half. A pending row offers NO affordance — not a disabled button, no element at
  // all — so "activated while pending" is unreachable rather than guarded. The chip markup is pinned
  // byte-for-byte because "the pending treatment is unchanged" is the acceptance criterion.
  it('leaves a pending row (result: null) non-activatable, chip markup unchanged (#697 AC2)', () => {
    const markup = renderToStaticMarkup(<ToolRow item={toolItem(null)} />)
    expect(markup).toContain('<div class="tool-row__chip" data-thread-role="tool">')
    expect(markup).not.toContain('<button')
    expect(markup).not.toContain('aria-expanded')
    expect(markup).not.toContain('tool-row__chip--toggle')
  })

  // Markup-level insurance for the CSS specificity argument: `.tool-row--error .tool-row__chip`
  // (:943, specificity 0,2,0) out-ranks `.tool-row__chip--toggle` (0,1,0) and keeps retinting the
  // border — but only while the wrapper still carries tool-row--error and the button still carries
  // tool-row__chip. The cascade itself is invisible to a server render; these two class names are the
  // half of the claim this tier CAN pin.
  it('keeps the error-accent selector intact once the chip is a button (#697)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: true, resultSummary: 'ENOENT' })} />
    )
    expect(markup).toContain('class="tool-row tool-row--resolved tool-row--error"')
    expect(markup).toContain('<button type="button" class="tool-row__chip tool-row__chip--toggle"')
  })

  // #705: the headline swap. The rules themselves are toolHeadline.test.ts's; what these cases pin is
  // the MARKUP half — that the swap happened inside `chipRuns` (so it reaches the pending <div> as
  // well as the resolved <button>), that nothing else about the chip moved, and that the newly
  // untrusted string reaches the DOM under the same escaping posture `inputSummary` held.
  //
  // REGRESSION BASELINE, free of charge: every tool-row case above omits `input` and therefore falls
  // through to rule 4, so all of them must stay green UNCHANGED. If one of them needs editing, the
  // picker is wrong.
  const DEEP_PATH = 'src/renderer/src/screens/conversation/ConversationScreen.tsx'
  const SHORTENED_PATH = '.../src/screens/conversation/ConversationScreen.tsx'

  it('draws the shortened file_path in the summary run instead of inputSummary (AC1, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' }, { file_path: DEEP_PATH })} />
    )
    expect(markup).toContain(SHORTENED_PATH)
    // The builder's `inputSummary` is the sentinel: rule 4 no longer fires, so it must not appear.
    expect(markup).not.toContain('schema.ts')
  })

  it('leaves the chip element, classes and run order otherwise unchanged (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' }, { file_path: DEEP_PATH })} />
    )
    // Byte-level: same button, same two runs in the same order, no new element and no new class —
    // only the TEXT of the second run changed. This is the AC that keeps the row on the Figma mock.
    expect(markup).toContain(
      '<button type="button" class="tool-row__chip tool-row__chip--toggle" data-thread-role="tool" aria-expanded="false">' +
        '<span class="tool-row__name">read_file</span>' +
        `<span class="tool-row__summary">${SHORTENED_PATH}</span>` +
        '</button>'
    )
  })

  it('draws the headline on a pending row too — the swap is inside the shared runs (AC1)', () => {
    // `chipRuns` is declared once and consumed by both branches; this is the half a resolved-row test
    // cannot reach.
    const markup = renderToStaticMarkup(<ToolRow item={toolItem(null, { file_path: DEEP_PATH })} />)
    expect(markup).toContain(
      '<div class="tool-row__chip" data-thread-role="tool">' +
        '<span class="tool-row__name">read_file</span>' +
        `<span class="tool-row__summary">${SHORTENED_PATH}</span>` +
        '</div>'
    )
  })

  it('renders inputSummary unchanged when input is absent (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} />
    )
    expect(markup).toContain('<span class="tool-row__summary">schema.ts</span>')
  })

  it('renders inputSummary unchanged when input is an empty map (AC4)', () => {
    // Reads identically to absent, by design — the distinction survives at the item, not in the row.
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' }, {})} />
    )
    expect(markup).toContain('<span class="tool-row__summary">schema.ts</span>')
  })

  it('renders the headline as inert escaped children, never markup or an attribute (AC5)', () => {
    // No apostrophes in the fixture (renderToStaticMarkup escapes ' → &#x27;, see the note above).
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines' }, { pattern: '<i>path</i>' })}
      />
    )
    expect(markup).toContain('&lt;i&gt;path&lt;/i&gt;')
    expect(markup).not.toContain('<i>path</i>')
    // Shortening visibly discards information, which makes `title={fullPath}` the natural next edit.
    // It is untrusted daemon text in an attribute — declined here as it was for `resultSummary`.
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-label')
  })

  it('never draws the input KEY, only its value (AC1)', () => {
    // Keys are daemon-controlled display text too; drawing them is #706's separately reviewed call.
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem(null, { KEY_SENTINEL_zzz: 'the value' })} />
    )
    expect(markup).toContain('the value')
    expect(markup).not.toContain('KEY_SENTINEL_zzz')
  })

  // #706: the expanded body's field list — every entry of `item.input`, drawn as its name and its
  // value, above the result block. Deliberately LITERAL where #705 is selective: no shortening, no
  // salience pick, no re-ordering, and no skipping the field #705 promoted into the headline. This
  // list is the form that covers that pick's misses, so a field silently missing from it is worse
  // than a repeated one.
  //
  // REGRESSION BASELINE, free of charge — but not by the mechanism #705's own note describes. The
  // invariant that holds now is a DISJOINTNESS: the intersection of {carries `input`} and {renders
  // `defaultExpanded`} is empty above. Every input-carrying case (:531-603) is collapsed or pending,
  // so no body exists there at all; every defaultExpanded case (:365-494) omits `input`, so
  // Object.entries yields [] and the body is byte-identical to #696's. If one of them needs editing
  // to stay green, the render is conditioned wrongly rather than the test being stale.
  //
  // In particular ':596-603 never draws the input KEY' is NOT contradicted by this block: that is a
  // PENDING row, where no body and therefore no field list is reachable, so it still pins what it
  // always pinned — the collapsed CHIP draws no key. Its expanded counterpart is below.
  const INPUT_NAME = (name: string): string => `<span class="tool-row__input-name">${name}</span>`

  it('lists each input field above an unchanged result block (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: 'RESULT_SENTINEL_zzz' },
          { file_path: 'PATH_SENTINEL_zzz', limit: 'LIMIT_SENTINEL_zzz' }
        )}
        defaultExpanded
      />
    )
    expect(markup).toContain(INPUT_NAME('file_path'))
    expect(markup).toContain('<pre class="tool-row__input-value">PATH_SENTINEL_zzz</pre>')
    expect(markup).toContain(INPUT_NAME('limit'))
    expect(markup).toContain('<pre class="tool-row__input-value">LIMIT_SENTINEL_zzz</pre>')
    // #696's result block is untouched — same element, same lone class, same text.
    expect(markup).toContain('<pre class="tool-row__result">RESULT_SENTINEL_zzz</pre>')
    // Above it. `limit` is not the headline's pick (rule 2 takes `file_path`), so its only occurrence
    // is the one in the body — which is what makes this an ordering fact about the body.
    expect(markup.indexOf('LIMIT_SENTINEL_zzz')).toBeLessThan(markup.indexOf('RESULT_SENTINEL_zzz'))
  })

  it('renders the entries in arrival order and never re-sorts them (AC1)', () => {
    // Keys inserted NON-alphabetically. Alphabetical ARRIVAL is a daemon-side Go map-marshalling
    // artefact that no renderer test can pin; what is pinnable is the absence of a client transform,
    // and a `.sort()` anywhere in the render would invert this exact order.
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { zulu: 'v_zulu_zzz', alpha: 'v_alpha_zzz', mike: 'v_mike_zzz' }
        )}
        defaultExpanded
      />
    )
    // Positions are read off the NAME spans, not the values: the headline (rule 3) also carries the
    // first entry's VALUE, so a value-keyed assertion would still pass under a sorted body.
    expect(markup).toContain(INPUT_NAME('zulu'))
    expect(markup.indexOf(INPUT_NAME('zulu'))).toBeLessThan(markup.indexOf(INPUT_NAME('alpha')))
    expect(markup.indexOf(INPUT_NAME('alpha'))).toBeLessThan(markup.indexOf(INPUT_NAME('mike')))
  })

  it('keeps a trailing ellipsis marker the daemon added, unmodified (AC2)', () => {
    // The daemon shortens a value at 4000 runes and marks it with U+2026. The client never
    // re-truncates and never strips the marker: a value that legitimately ends in one is
    // indistinguishable from a shortened one, a cost the daemon already accepted.
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { command: 'SHORTENED_SENTINEL_zzz…' }
        )}
        defaultExpanded
      />
    )
    expect(markup).toContain('<pre class="tool-row__input-value">SHORTENED_SENTINEL_zzz…</pre>')
  })

  it('preserves the line breaks inside a value rather than collapsing them (AC3)', () => {
    // The <pre> tag plus the surviving \n is what this tier can assert; `white-space: pre` itself is
    // invisible to a server render. Never START a fixture with \n — an HTML parser eats a leading
    // newline in <pre>, so renderToStaticMarkup emits a second one.
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { command: 'line one\nline two' }
        )}
        defaultExpanded
      />
    )
    expect(markup).toContain('<pre class="tool-row__input-value">line one\nline two</pre>')
  })

  it('draws no field list at all for an empty input map (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' }, {})} defaultExpanded />
    )
    // Not an empty container either: there is no list-wrapper element to leave behind.
    expect(markup).not.toContain('tool-row__input')
    expect(markup).toContain('tool-row__body')
    expect(markup).toContain('<pre class="tool-row__result">184 lines</pre>')
  })

  it('renders an absent input map identically to an empty one (AC4)', () => {
    // Equality, not two independent not.toContain assertions: the AC asks for a body IDENTICAL to
    // the one #696 draws, which is what keeps talking to a pre-pyrycode#1678 daemon from reading as
    // a visible regression. The one-field render is the contrast that proves the assertion has teeth.
    const RESULT = { isError: false, resultSummary: '184 lines' }
    const absent = renderToStaticMarkup(<ToolRow item={toolItem(RESULT)} defaultExpanded />)
    const empty = renderToStaticMarkup(<ToolRow item={toolItem(RESULT, {})} defaultExpanded />)
    const oneField = renderToStaticMarkup(
      <ToolRow item={toolItem(RESULT, { limit: 'LIMIT_SENTINEL_zzz' })} defaultExpanded />
    )
    expect(empty).toBe(absent)
    expect(oneField).not.toBe(absent)
  })

  it('draws the input KEY in the expanded body, unlike the collapsed chip (AC1)', () => {
    // The deliberate positive counterpart to ':596-603 never draws the input KEY'. That case is a
    // PENDING row and pins the chip; this one is resolved and expanded and pins the body. Both are
    // correct: the key is chip-forbidden and body-required.
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines' }, { KEY_SENTINEL_zzz: 'the value' })}
        defaultExpanded
      />
    )
    expect(markup).toContain(INPUT_NAME('KEY_SENTINEL_zzz'))
  })

  it('withholds the field list from a collapsed row carrying input (AC5)', () => {
    // The mechanical half of the free regression baseline: the list lives INSIDE the body, so a
    // collapsed row cannot draw it however many fields the item carries.
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines' }, { file_path: 'a.ts' })}
      />
    )
    expect(markup).not.toContain('tool-row__input')
    expect(markup).not.toContain('tool-row__body')
  })

  it('renders names and values alike as inert escaped children, never markup (AC5)', () => {
    // Hostile in BOTH halves: an MCP tool can name a field anything, so a name is daemon-chosen
    // display text under exactly the same constraint as the value beside it. No apostrophes in the
    // fixture (renderToStaticMarkup escapes ' → &#x27;).
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { '<img src=x onerror=alert(1)>': '<i>v</i>' }
        )}
        defaultExpanded
      />
    )
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).toContain('&lt;i&gt;v&lt;/i&gt;')
    expect(markup).not.toContain('<img')
    expect(markup).not.toContain('<i>v</i>')
    // The four sinks the SAFETY block declines, re-asserted for the newly drawn strings.
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('dangerously')
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

  // #607: the whitespace-preservation anchor. `.bubble` sets no `white-space`, so the initial `normal`
  // collapses every newline and space run and a multi-paragraph reply arrives as one run-on block. The
  // rule that fixes it hangs on its OWN modifier — not on `.bubble` (which reaches the user bubble) and
  // not on `.bubble--daemon` (which reaches the four chrome affordances) — so "unchanged elsewhere" is
  // true BY CONSTRUCTION: the rule provably cannot reach an element that does not carry the class.
  //
  // This tier pins WHICH element carries it (a markup fact). What the browser then does with the
  // declaration is a layout fact, unobservable under `environment: 'node'` (vitest.config.ts:27) with no
  // DOM and no stylesheet — that half is e2e/assistant-whitespace.spec.ts.
  it('carries the whitespace modifier on the assistant bubble, appended to the daemon treatment', () => {
    const items: ThreadItem[] = [{ kind: 'assistantText', turnId: 't1', text: 'hello there' }]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('bubble bubble--daemon bubble--assistant-text')
    // Appended, never inserted: the daemon-bubble pair stays contiguous (the :113 assertion above).
    expect(markup).toContain('bubble bubble--daemon')
  })

  it('opens the settled container and the in-progress text flush against the bubble tag — no stray JSX whitespace', () => {
    // Only matters once whitespace is preserved: a newline the JSX transform left between the opening tag
    // and the content (or between the text and the cursor) would become a VISIBLE blank under the rule.
    // The transform strips whitespace-only lines containing a newline, so this already holds — this
    // assertion is what keeps it holding. #609 re-pointed the settled half: the settled bubble now opens
    // with the markdown container rather than with the reply text.
    const settled: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: 'settled reply' },
      { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
    ]
    expect(renderToStaticMarkup(<Timeline items={settled} />)).toContain(
      `data-thread-role="assistant"><div class="${CONTAINER}">`
    )
    // The in-progress tail: the text opens flush against the tag, and the cursor opens immediately after
    // the text run, contributing no whitespace of its own (AC5).
    const streaming: ThreadItem[] = [{ kind: 'assistantText', turnId: 't1', text: 'streaming reply' }]
    const streamingMarkup = renderToStaticMarkup(<Timeline items={streaming} />)
    expect(streamingMarkup).toContain('data-thread-role="assistant">streaming reply')
    expect(streamingMarkup).toContain('streaming reply<span')
  })

  it('carries the in-progress tail newlines and space runs into the markup verbatim — nothing upstream of CSS normalises', () => {
    // #609 re-pointed this case at the TAIL. Its fixture is a four-space-indented line, which CommonMark
    // reads as an indented code block, so "React escapes markup characters, never whitespace" is exactly
    // true only on the plain-text branch — which is the branch #607's rule still governs.
    const text = 'First paragraph.\n\nSecond paragraph.\n    indented    and    spaced'
    const items: ThreadItem[] = [{ kind: 'assistantText', turnId: 't1', text }]
    // The run survives byte-for-byte up to the cursor, so the rendering is the ONLY place it was being
    // discarded.
    expect(renderToStaticMarkup(<Timeline items={items} />)).toContain(`>${text}<span`)
  })

  it('leaves the user bubble and the four daemon-bubble affordances outside the rule (AC4, AC5)', () => {
    const MODIFIER = 'bubble--assistant-text'
    const userMarkup = renderToStaticMarkup(
      <Timeline items={[{ kind: 'userText', text: 'typed by the operator' }]} />
    )
    expect(userMarkup).toContain('bubble bubble--user')
    expect(userMarkup).not.toContain(MODIFIER)
    expect(renderToStaticMarkup(<ThinkingIndicator state="thinking" toolName={null} />)).not.toContain(
      MODIFIER
    )
    expect(renderToStaticMarkup(<StallIndicator isStalled={true} />)).not.toContain(MODIFIER)
    expect(renderToStaticMarkup(<CompactingIndicator isCompacting={true} />)).not.toContain(MODIFIER)
    const retryMarkup = renderToStaticMarkup(<ApiRetryIndicator retry={{ current: 3, total: 10 }} />)
    expect(retryMarkup).not.toContain(MODIFIER)
    // #609 (AC5): the markdown container is the assistant bubble's alone. Neither the user bubble nor any
    // of the four chrome affordances that reuse the daemon bubble's fill and measure gains it.
    expect(userMarkup).not.toContain(CONTAINER)
    expect(renderToStaticMarkup(<ThinkingIndicator state="thinking" toolName={null} />)).not.toContain(
      CONTAINER
    )
    expect(renderToStaticMarkup(<StallIndicator isStalled={true} />)).not.toContain(CONTAINER)
    expect(renderToStaticMarkup(<CompactingIndicator isCompacting={true} />)).not.toContain(CONTAINER)
    expect(retryMarkup).not.toContain(CONTAINER)
    // AC4's one spot where a preserved space could have become visible: the counter's separator is a
    // single space inside its own span, so it reads the same under either whitespace treatment.
    expect(retryMarkup).toContain(`${API_RETRY_COPY}<span`)
    expect(retryMarkup).toContain('> attempt 3/10<')
  })

  // #609: the settled reply renders through #608's AssistantMarkdown; the still-growing tail does not.
  // This tier pins the markup shape of each branch — which element carries the container, which
  // constructs became real tags, and that the escaping posture holds on BOTH sides of the new fork.
  // What the browser then does with the whitespace is layout, unobservable under `environment: 'node'`
  // — that half is e2e/assistant-whitespace.spec.ts.
  it('renders a settled assistant bubble through the markdown path — markup, not literal syntax (AC1)', () => {
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: MARKDOWN_SOURCE },
      { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    // Positive: every construct AC1 names became a real element. Each negative below is paired with one
    // of these — `not.toContain` alone passes against the empty string.
    expect(markup).toContain(CONTAINER)
    expect(markup).toContain('<h1>Heading one</h1>')
    expect(markup).toContain('<strong>bold</strong>')
    expect(markup).toContain('<code>code</code>')
    // #623 gave the fence its chrome; MARKDOWN_SOURCE's fence declares no language, so this tier sees
    // the no-header degrade. Still discharges "a fence became a real element" for the screen tier.
    expect(markup).toContain('<pre class="code-block__body">')
    expect(markup).toContain('<li>first item</li>')
    expect(markup).toContain('<blockquote>')
    // Negative: the source syntax is gone — it was interpreted, not shown. `&gt;` is how the blockquote
    // marker would have survived, since React escapes `>`.
    expect(markup).not.toContain('# Heading one')
    expect(markup).not.toContain('**bold**')
    expect(markup).not.toContain('&gt; quoted line')
  })

  it('never markdown-renders the in-progress tail — its syntax stays visible characters (AC2)', () => {
    const items: ThreadItem[] = [{ kind: 'assistantText', turnId: 't1', text: MARKDOWN_SOURCE }]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('# Heading one')
    expect(markup).toContain('**bold**')
    expect(markup).not.toContain(CONTAINER)
    expect(markup).not.toContain('<strong>')
    expect(markup).not.toContain('<h1>')
    // The tail is still the streaming tail: the cursor is unchanged by the fork.
    expect(markup).toContain(CURSOR)
  })

  it('puts the markdown container on the settled bubble alone, never on the tail or another row (AC2, AC5)', () => {
    const items: ThreadItem[] = [
      { kind: 'userText', text: 'typed by the operator' },
      { kind: 'assistantText', turnId: 't1', text: 'settled body' },
      {
        kind: 'toolCall',
        turnId: 't1',
        toolUseId: 'u1',
        name: 'read_file',
        inputSummary: 'a.ts',
        result: null
      },
      {
        kind: 'sessionBoundary',
        reason: 'workspace_change',
        workspaceCwd: '/home/user/next',
        occurredAt: '2026-01-15T10:00:00.000Z'
      },
      { kind: 'assistantText', turnId: 't2', text: 'growing tail' }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    // Exactly one of each, and they land on different bubbles: the container before the tail text, the
    // plain-text modifier after the settled body.
    expect(markup.match(new RegExp(CONTAINER, 'g'))?.length ?? 0).toBe(1)
    expect(markup.match(/bubble--assistant-text/g)?.length ?? 0).toBe(1)
    expect(markup.indexOf(CONTAINER)).toBeLessThan(markup.indexOf('growing tail'))
    expect(markup.indexOf('bubble--assistant-text')).toBeGreaterThan(markup.indexOf('settled body'))
  })

  it('keeps the escaping posture on the settled markdown path — HTML renders as characters (AC5)', () => {
    // The fork is exactly where two rendering paths drift apart, so #199s posture is re-proved on the new
    // branch: :141 covers the plain-text tail, this covers markdown. react-markdown escapes raw HTML by
    // default (no rehype-raw, no skipHtml — AssistantMarkdown.tsx:9-19), which is the same posture.
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: '<b>hi</b>' },
      { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain(CONTAINER)
    expect(markup).toContain('&lt;b&gt;hi&lt;/b&gt;')
    expect(markup).not.toContain('<b>hi</b>')
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

// #215/#648: the working indicator bound to the coarse `phase` scalar. ThinkingIndicator is the Timeline
// twin over a two-member union rather than a ThreadItem[] — pure (state in, markup out) — so a
// server-rendered string proves both present affordances (thinking, working) and the zero-footprint
// absent case. #648 widens the prop from `isThinking: boolean` to `WorkingIndicatorState | null`: still
// NOT `phase`. Injected state: no store, no IPC — the container's running branches are unreachable under
// server render (zustand v5 reads getInitialState() → phase: 'idle'), so the "showing" assertions live
// here, exactly like Timeline's populated assertions.
//
// #649: the "no daemon string reaches this view" claim above is now DELIBERATELY narrowed, per the
// operator's 2026-08-20 decision. The LABEL CHOICE is still a closed union of client-owned literals; one
// separately-typed `toolName` prop carries the single daemon string, rendered as an auto-escaped React
// text child exactly like the tool row's own `name` two rows above. What survives is the narrower half:
// the fixed copy around the name stays client-owned. `toolName={null}` on the pre-existing cases below is
// a mechanical prop addition — their assertions are #648's regression evidence and stand verbatim.
describe('ThinkingIndicator — the running-turn working affordance (#215, #648, #649)', () => {
  it('is inert when no turn is running — renders nothing (zero layout footprint, AC3)', () => {
    expect(renderToStaticMarkup(<ThinkingIndicator state={null} toolName={null} />)).toBe('')
  })

  it('shows the daemon-styled Thinking affordance while thinking', () => {
    const markup = renderToStaticMarkup(<ThinkingIndicator state="thinking" toolName={null} />)
    // The stable test seam (the bubble__cursor role) — #796 RETAINED `conversation__thinking` when the
    // bubble treatment became the status row's label, precisely so this assertion and the two e2e
    // turn-liveness locators keep pointing at the same identity.
    expect(markup).toContain('conversation__thinking')
    // The WHOLE class attribute, not a bare toContain of the presentation class. Unlike #649's
    // deliberately non-prefixed `bubble--tool-label`, BEM's `composer-status__label--tool` DOES contain
    // `composer-status__label` as a substring, so a substring assertion would pass on markup that
    // dropped the base class and kept only the modifier — the exact vacuity conversation.css:779-781
    // was written to avoid. Pinning the attribute also pins that the tool modifier is absent here.
    expect(markup).toContain('class="conversation__thinking composer-status__label"')
    // The client-owned static label — the ellipsis glyph … (U+2026), no apostrophe to survive escaping.
    expect(markup).toContain(THINKING_COPY)
    // #648 hoisted this literal out of the JSX into an exported constant; its rendered text must not
    // change, so the value is pinned here rather than left to review.
    expect(THINKING_COPY).toBe('Thinking…')
  })

  it('shows the generic working affordance on the same surface while running but not thinking (#648, AC1)', () => {
    const markup = renderToStaticMarkup(<ThinkingIndicator state="working" toolName={null} />)
    // The same element and the same class attribute — one surface, two labels, no CSS change (AC1's
    // "the indicator is visible", not "a second indicator appears").
    expect(markup).toContain('conversation__thinking')
    expect(markup).toContain('class="conversation__thinking composer-status__label"')
    expect(markup).toContain(WORKING_COPY)
    // The label tracks the phase (AC2): the thinking copy is NOT what a tool-heavy stretch shows.
    expect(markup).not.toContain(THINKING_COPY)
  })

  it('carries two client-owned labels, lexically distinct from each other and their siblings (AC2, AC5)', () => {
    // Reachable without rendering (AC5) — both exported, following API_RETRY_COPY / COMPACTING_COPY.
    expect(WORKING_COPY).not.toBe(THINKING_COPY)
    // Apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson).
    expect(WORKING_COPY).not.toContain("'")
    expect(THINKING_COPY).not.toContain("'")
    expect(WORKING_COPY).not.toBe(API_RETRY_COPY)
    expect(WORKING_COPY).not.toBe(COMPACTING_COPY)
    // STALL_COPY is module-private (#317) — asserted against its literal, as the CompactingIndicator
    // describe does.
    expect(WORKING_COPY).not.toBe('The turn seems to have stalled…')
  })

  it('names the open tool on the same surface, replacing the generic copy (#649, AC1)', () => {
    const markup = renderToStaticMarkup(<ThinkingIndicator state="working" toolName="Bash" />)
    // The same element and the same base classes plus ONE modifier — one surface, now three labels
    // (AC1 is "the indicator names the tool", not "a second indicator appears").
    expect(markup).toContain('conversation__thinking')
    expect(markup).toContain(
      'class="conversation__thinking composer-status__label composer-status__label--tool"'
    )
    expect(markup).toContain(toolWorkingCopy('Bash'))
    // The named label REPLACES the generic one rather than sitting beside it.
    expect(markup).not.toContain(WORKING_COPY)
    expect(markup).not.toContain(THINKING_COPY)
    // AC5's one-line bound rides on this modifier (see conversation.css). Asserted here because the
    // declarations themselves have no vitest detector — server render has no layout engine — so the
    // class being ON the element is the part a test can hold. #796 moved the bound off the deleted
    // .bubble ancestry onto the row's own truncation chain; the modifier is still where it hangs.
    expect(markup).toContain('composer-status__label--tool')
  })

  it('keeps the tool label off the two unnamed states — the modifier is the tool branch alone (AC3)', () => {
    // The #648 labels must render byte-identical markup, so their assertions above stay AC3's
    // regression evidence rather than being retyped against a moved target.
    expect(renderToStaticMarkup(<ThinkingIndicator state="working" toolName={null} />)).not.toContain(
      'composer-status__label--tool'
    )
    expect(renderToStaticMarkup(<ThinkingIndicator state="thinking" toolName={null} />)).not.toContain(
      'composer-status__label--tool'
    )
  })

  it('is still superseded with a tool open — the null state wins over the name (#649, AC3)', () => {
    // The `state === null` guard runs FIRST, so #493's live api-retry and #496's live compaction still
    // hide the indicator entirely in either phase; an open tool cannot resurrect it.
    expect(renderToStaticMarkup(<ThinkingIndicator state={null} toolName="Bash" />)).toBe('')
  })

  it('renders a hostile tool name as inert escaped text, never as markup (#649, AC4)', () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const markup = renderToStaticMarkup(<ThinkingIndicator state="working" toolName={hostile} />)
    // Attribute-shaped guards, not a bare not.toContain: a `not.toContain('src=')` would pass
    // vacuously. The name reaches the DOM only as an auto-escaped React text child (the tool row's own
    // posture at ConversationScreen.tsx:551) — no dangerouslySetInnerHTML, no HTML sink.
    expect(markup).toContain('Running &lt;img')
    expect(markup).not.toContain('<img')
    // No live event-handler attribute escaped out of the name. Matching on the QUOTE is what makes this
    // a detector: escaped output carries a literal ` onerror=&quot;` run, so a bare /\son[a-z]+=/ would
    // fail on correct output — it is the unescaped `="` that only an HTML sink could produce.
    expect(markup).not.toMatch(/\son[a-z]+="/i)
    expect(markup).not.toContain('alert(1)"')
  })
})

// #796: the fixed-height status row above the composer — the desktop layout's own status area (Figma
// node 111-3525), replacing the loose region the working indicator used to float in. Pure
// props-in/markup-out and exported so tests server-render it with injected values, no store: the
// container's running arm is unreachable under server render (zustand v5 reads getInitialState() →
// phase: 'idle'), so both spin arms are proven here, exactly like ThinkingIndicator's above.
//
// The turning-vs-still distinction is a CLASS, not a resolved style. A renderer spec is a static server
// render with no layout engine and no CSSOM (CLAUDE.md), so a class on the icon is the only form of that
// distinction a vitest assertion can hold — which is why the rotation is driven by a modifier rather
// than an inline style. The reduced-motion half (AC4) is structurally out of reach here and lives in
// e2e/composer-status-reduced-motion.spec.ts, this repo's first reduced-motion coverage anywhere.
describe('ComposerStatusArea — the status row above the composer and its turning icon (#796)', () => {
  it('turns the icon while a turn is running (AC3)', () => {
    const markup = renderToStaticMarkup(<ComposerStatusArea isRunning={true} />)
    expect(markup).toContain('composer-status__icon--spinning')
  })

  it('still renders the icon at rest, without the turning modifier (AC3)', () => {
    const markup = renderToStaticMarkup(<ComposerStatusArea isRunning={false} />)
    // BOTH halves. A lone not.toContain('--spinning') passes vacuously on markup with no icon at all,
    // so the still arm has to prove the icon is THERE and STILL — AC3 is "renders but does not rotate",
    // not "does not rotate". The whole class attribute, since the base class is a substring of the
    // modifier (the vacuity conversation.css:779-781 legislates against).
    expect(markup).toContain('class="composer-status__icon"')
    expect(markup).not.toContain('composer-status__icon--spinning')
  })

  it('holds the row whether or not it has status text, so the composer never moves (AC1, AC2)', () => {
    // The row NEVER returns null — the deliberate departure from the four indicators' null-at-rest
    // posture. Its own height reserves the space, so a textless row is still a rendered row, and the
    // composer does not jump when the label appears and disappears under it.
    const markup = renderToStaticMarkup(<ComposerStatusArea isRunning={false} />)
    expect(markup).toContain('class="composer-status"')
    expect(markup).toContain('class="composer-status__activity"')
  })

  it('hosts its status text in the left activity group, after the icon (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ComposerStatusArea isRunning={true}>
        <span className="probe-label">Thinking…</span>
      </ComposerStatusArea>
    )
    // Ordering by index — the WelcomeScreen.test.tsx:36-41 idiom, since a static markup string carries
    // no tree to query. Group, then icon, then label: the Figma's 14x16 vector at x=0 with the label at
    // x=22 (a --space-2 gap past it).
    const groupAt = markup.indexOf('composer-status__activity')
    const iconAt = markup.indexOf('composer-status__icon')
    const labelAt = markup.indexOf('probe-label')
    expect(groupAt).toBeGreaterThanOrEqual(0)
    expect(iconAt).toBeGreaterThan(groupAt)
    expect(labelAt).toBeGreaterThan(iconAt)
    // The label lands INSIDE the group, not after it — the group's closing tag trails the label.
    expect(markup.indexOf('</div></div>')).toBeGreaterThan(labelAt)
  })
})

// #649: the client-owned label that names the daemon's open tool. A function rather than a constant
// because this copy has a hole — but BOTH fixed runs (the leading verb and the trailing U+2026) live
// inside it, so "the fixed copy is client-owned and only the name is daemon-supplied" is true of one
// readable unit. Pure calls, no rendering.
describe('toolWorkingCopy — the client-owned label around the daemon tool name (#649)', () => {
  it('pins its rendered value, so the copy cannot drift silently (AC4)', () => {
    // The expect(THINKING_COPY).toBe('Thinking…') precedent — the value is held here rather than left
    // to review. The U+2026 ellipsis character, matching its four siblings.
    expect(toolWorkingCopy('Bash')).toBe('Running Bash…')
  })

  it('is apostrophe-free and lexically distinct from the four sibling labels (AC4)', () => {
    const copy = toolWorkingCopy('Bash')
    // renderToStaticMarkup escapes `'` → `&#x27;` — the standing desktop lesson.
    expect(copy).not.toContain("'")
    expect(copy).not.toBe(WORKING_COPY)
    expect(copy).not.toBe(THINKING_COPY)
    expect(copy).not.toBe(API_RETRY_COPY)
    expect(copy).not.toBe(COMPACTING_COPY)
    // The generic label must not be a substring either — the named label REPLACES it (AC1), so a
    // "Working… on Bash" shape would make the replacement unobservable in the markup assertions above.
    expect(copy).not.toContain(WORKING_COPY)
  })

  it('returns the daemon name verbatim — escaping is the renderers job, not this functions (AC4)', () => {
    // Pre-escaping here would double-escape once React escapes the text child, and would be the "new
    // mechanism" AC4 pins AGAINST. The function only wraps.
    expect(toolWorkingCopy('<img src=x>')).toBe('Running <img src=x>…')
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
    // Visually distinct from the working indicator (AC4) — a problem state, not normal progress.
    // #796 REPOINTED this from the retired `bubble--thinking`: once no component can emit that string
    // the assertion passes against nothing and silently stops testing anything. `composer-status__label`
    // is where the working indicator's treatment lives now, so this is the same claim, still falsifiable.
    expect(markup).not.toContain('composer-status__label')
  })
})

// #493: the api-retry indicator bound to the `apiRetry` status record. ApiRetryIndicator is the
// StallIndicator twin over `ApiRetryStatus | null` rather than a boolean — pure (status in, markup out).
// The prop carries two numbers and no string field, so the view structurally cannot receive, hence
// cannot render, a daemon-supplied string (AC1). Injected props: no store, no IPC — the container's
// showing branch is unreachable under server render (zustand v5 reads getInitialState() → apiRetry:
// null), so the "showing" assertions live here.
describe('ApiRetryIndicator — the api-error retry affordance (#493)', () => {
  it('is inert with no live retry — renders nothing (zero layout footprint)', () => {
    expect(renderToStaticMarkup(<ApiRetryIndicator retry={null} />)).toBe('')
  })

  it('shows a retry-distinct affordance with the attempt counter as digits (AC1, AC2)', () => {
    const markup = renderToStaticMarkup(<ApiRetryIndicator retry={{ current: 3, total: 10 }} />)
    // The retry-distinct wrapper + bubble classes (the problem-state treatment, built from --color-error).
    expect(markup).toContain('conversation__api-retry')
    expect(markup).toContain('bubble--api-retry')
    // The client-owned copy — apostrophe-free, U+2026 ellipsis (survives renderToStaticMarkup escaping),
    // never a daemon string. Conveys both the API error and the retrying.
    expect(markup).toContain(API_RETRY_COPY)
    expect(API_RETRY_COPY).not.toContain("'")
    // Client-formatted digits, never a daemon string and never a computed fraction.
    expect(markup).toContain('3')
    expect(markup).toContain('10')
    expect(markup).toContain('api-retry__counter')
    // Visually distinct from BOTH the working treatment and the stall treatment (AC1). #796 repointed
    // the first off the retired `bubble--thinking` — see the StallIndicator describe above.
    expect(markup).not.toContain('composer-status__label')
    expect(markup).not.toContain('bubble--stall')
  })

  it('renders a known zero attempt verbatim — 0/10 is not the unknown sentinel', () => {
    const markup = renderToStaticMarkup(<ApiRetryIndicator retry={{ current: 0, total: 10 }} />)
    expect(markup).toContain('api-retry__counter')
    expect(markup).toContain('0/10')
  })

  it('omits the counter entirely when the count is unknown — never renders 0/0 (AC3)', () => {
    const markup = renderToStaticMarkup(<ApiRetryIndicator retry={{ current: 0, total: 0 }} />)
    // Still a visible retry status…
    expect(markup).toContain('conversation__api-retry')
    expect(markup).toContain(API_RETRY_COPY)
    // …with no counter at all.
    expect(markup).not.toContain('api-retry__counter')
    expect(markup).not.toContain('0/0')
    // Never a computed fraction — 0/0 is NaN.
    expect(markup).not.toContain('NaN')
  })
})

// #496: the compaction indicator bound to the `compacting` scalar. CompactingIndicator is the
// StallIndicator twin — pure (isCompacting in, markup out) over a plain boolean, NOT the store type, so
// the view structurally cannot receive, hence cannot render, a daemon-supplied string (AC1 — #742
// widened the arm with a `conversationId` the bridge omits when it rebuilds the `ThreadEvent`). Injected
// boolean: no store, no IPC — the container's showing branch is unreachable under server render (zustand
// v5 reads getInitialState() → compacting: false), so the "showing" assertions live here.
describe('CompactingIndicator — the auto-compaction affordance (#496)', () => {
  it('is inert with no compaction in flight — renders nothing (zero layout footprint)', () => {
    expect(renderToStaticMarkup(<CompactingIndicator isCompacting={false} />)).toBe('')
  })

  it('shows a compaction-distinct affordance while compacting (AC1)', () => {
    const markup = renderToStaticMarkup(<CompactingIndicator isCompacting={true} />)
    // The compaction-distinct wrapper + bubble classes (the working-state treatment: muted text plus a
    // primary-role accent bar, never the error role the two problem states use).
    expect(markup).toContain('conversation__compacting')
    expect(markup).toContain('bubble--compacting')
    // The client-owned copy — never a daemon string.
    expect(markup).toContain(COMPACTING_COPY)
    // Visually distinct from all three sibling indicators (AC1). #796 repointed the first off the
    // retired `bubble--thinking` — see the StallIndicator describe above.
    expect(markup).not.toContain('composer-status__label')
    expect(markup).not.toContain('bubble--stall')
    expect(markup).not.toContain('bubble--api-retry')
  })

  it('carries client-owned copy that is textually distinct from its sibling indicators (AC1)', () => {
    // Apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson).
    expect(COMPACTING_COPY).not.toContain("'")
    expect(COMPACTING_COPY).not.toBe('Thinking…')
    // STALL_COPY is module-private (#317) — asserted against its literal, as the StallIndicator describe does.
    expect(COMPACTING_COPY).not.toBe('The turn seems to have stalled…')
    expect(COMPACTING_COPY).not.toBe(API_RETRY_COPY)
    // Reads as work on the conversation itself, so a silent screen is legible as progress.
    expect(COMPACTING_COPY.toLowerCase()).toContain('compacting')
  })
})

// #493: the indicator-precedence predicate. The thinking gate NARROWS rather than the container deriving
// a mutually-exclusive status union, so both indicator views stay pure and unchanged in their own props
// (the isTurnRunning precedent of extracting the named gate). #496 extends `ThreadStatus` with one field
// and this predicate with one clause — the second proof the seam grows by one of each.
//
// #648 changes exactly one thing here: the phase clause becomes `isTurnRunning(phase)`, so the indicator
// holds for the whole running turn. Both supersede clauses are textually untouched, and every assertion
// below except the running-turn one stands verbatim from #493/#496 — they are the regression evidence
// that broadening the phase clause did not weaken the supersede rules (AC4).
describe('shouldShowThinking — the running-turn gate with the retry- and compaction-supersede rules (#493, #496, #648)', () => {
  it('shows the thinking indicator while thinking with nothing superseding it (AC4)', () => {
    expect(shouldShowThinking({ phase: 'thinking', apiRetry: null, compacting: false })).toBe(true)
  })

  it('hides the thinking indicator while a retry is in flight — the supersede rule (#493)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 3, total: 10 }, compacting: false })
    ).toBe(false)
  })

  it('hides it for a retry with an unknown count too — presence supersedes, not the counter (#493)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 0, total: 0 }, compacting: false })
    ).toBe(false)
  })

  it('hides the thinking indicator while compacting — the second supersede rule (AC4)', () => {
    expect(shouldShowThinking({ phase: 'thinking', apiRetry: null, compacting: true })).toBe(false)
  })

  it('hides it while both compacting and retrying (AC4)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 3, total: 10 }, compacting: true })
    ).toBe(false)
  })

  it('never shows thinking outside the thinking phase, compacting or not (AC4)', () => {
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: true })).toBe(false)
    expect(shouldShowThinking({ phase: 'responding', apiRetry: null, compacting: true })).toBe(false)
  })

  it('holds the indicator across the whole running turn when nothing is in flight (#648, AC1)', () => {
    // #648 reverses the phase clause: the pre-#648 gate was exactly `phase === 'thinking'`, which let the
    // indicator vanish for the tool-heavy bulk of a turn. It is now `isTurnRunning(phase)`, so `responding`
    // shows. `idle` still hides — the gate never widens past a running turn.
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: false })).toBe(false)
    expect(shouldShowThinking({ phase: 'responding', apiRetry: null, compacting: false })).toBe(true)
  })

  it('shows in both running phases and hides at idle — the isTurnRunning tie (#648, AC1, AC3)', () => {
    // The gate now REUSES isTurnRunning rather than re-deriving the phase test, so the tie is asserted
    // here rather than merely inherited: a future edit to either side that breaks agreement fails this.
    for (const phase of ['thinking', 'responding'] as const) {
      expect(shouldShowThinking({ phase, apiRetry: null, compacting: false })).toBe(
        isTurnRunning(phase)
      )
      expect(shouldShowThinking({ phase, apiRetry: null, compacting: false })).toBe(true)
    }
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: false })).toBe(
      isTurnRunning('idle')
    )
  })
})

// #648: the label discriminant, composed ON the gate above rather than duplicating it. Three outcomes —
// null (nothing shows), 'thinking' and 'working' — so the two client-owned labels are chosen in one
// place and the view receives a value it cannot confuse with a daemon string. Pure calls, no rendering.
describe('workingIndicatorState — which client-owned label the running turn shows (#648)', () => {
  it('picks the thinking label during the thinking slice (AC2)', () => {
    expect(workingIndicatorState({ phase: 'thinking', apiRetry: null, compacting: false })).toBe(
      'thinking'
    )
  })

  it('picks the generic working label for the rest of the running turn (AC1, AC2)', () => {
    // The phase that LASTS: the daemon flips to `responding` on the first reply token or tool step and
    // sends no further turn_state until the turn ends, so this covers the tool-heavy silent stretch that
    // used to show nothing at all.
    expect(workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: false })).toBe(
      'working'
    )
  })

  it('picks nothing at idle — no wrapper, no empty chrome (AC3)', () => {
    expect(workingIndicatorState({ phase: 'idle', apiRetry: null, compacting: false })).toBeNull()
  })

  it('is superseded by a live retry in the newly covered phase too (AC4)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: { current: 3, total: 10 }, compacting: false })
    ).toBeNull()
  })

  it('is superseded by an unknown-count retry too — presence supersedes, not the counter (AC4)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: { current: 0, total: 0 }, compacting: false })
    ).toBeNull()
  })

  it('is superseded by a live compaction in the newly covered phase too (AC4)', () => {
    expect(workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: true })).toBeNull()
  })

  it('agrees with the gate on every phase — it delegates, it is not a parallel rule (AC4)', () => {
    for (const phase of ['thinking', 'responding', 'idle'] as const) {
      const status = { phase, apiRetry: null, compacting: false }
      expect(workingIndicatorState(status) !== null).toBe(shouldShowThinking(status))
    }
  })
})

// #650: the window the operator opens by pressing Enter, composed ON `workingIndicatorState` above rather
// than added as a fourth `ThreadStatus` field. That choice is what leaves every status literal in the two
// blocks above standing verbatim — they remain the regression evidence that #493's and #496's supersede
// rules survived. It also means the supersede rules are INHERITED here rather than restated: the third
// branch re-calls the same gate with one field substituted, so there is no second place the rule lives.
// Pure calls, no rendering.
describe('workingIndicatorStateWithLocalSend — the locally-opened window (#650)', () => {
  it('opens the window at idle while a local send is pending, labelled thinking (AC1)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false }, true)
    ).toBe('thinking')
  })

  it('opens nothing at idle with no local send pending — todays behaviour, unchanged (AC1)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false }, false)
    ).toBeNull()
  })

  it('delegates unchanged wherever the daemon has already opened the window', () => {
    // The daemon's answer wins: for every phase and both pending values, a non-null daemon answer is
    // returned byte-identical, so no daemon-opened case changed behaviour at all.
    for (const phase of ['thinking', 'responding', 'idle'] as const) {
      for (const pending of [true, false]) {
        const status = { phase, apiRetry: null, compacting: false }
        const daemon = workingIndicatorState(status)
        if (daemon !== null) {
          expect(workingIndicatorStateWithLocalSend(status, pending)).toBe(daemon)
        }
      }
    }
  })

  it('keeps the daemon label for a send issued mid-turn — responding stays working (AC1)', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'responding', apiRetry: null, compacting: false },
        true
      )
    ).toBe('working')
  })

  it('inherits the retry supersede rule — a live retry hides a locally-opened window too', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 3, total: 10 }, compacting: false },
        true
      )
    ).toBeNull()
  })

  it('inherits it for an unknown-count retry too — presence supersedes, not the counter', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 0, total: 0 }, compacting: false },
        true
      )
    ).toBeNull()
  })

  it('inherits the compaction supersede rule too', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: true }, true)
    ).toBeNull()
  })

  it('is superseded while both compacting and retrying', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 3, total: 10 }, compacting: true },
        true
      )
    ).toBeNull()
  })

  it('hands over to the daemon with no label flicker at the seam (AC2)', () => {
    // The local window is labelled exactly what the daemon's first turn_state says, so the moment the
    // daemon takes over is invisible. `working` would have flipped Working → Thinking → Working at the
    // one seam this ticket exists to smooth.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false }, true)
    ).toBe(workingIndicatorState({ phase: 'thinking', apiRetry: null, compacting: false }))
  })

  it('opens the window WITHOUT arming the stop variant (AC4)', () => {
    // The behavioural half: the indicator shows while `phase` is still the daemon-owned `idle`, and
    // isTurnRunning — the composer send button's only stop-variant gate — is false for that same phase,
    // so the button stays a Send affordance for a turn the daemon has not started.
    //
    // The structural half is type-level and no assertion here can reach it (renderer tests are
    // server-render only, so no container render can drive store state): #678's Composer takes
    // `phase` alone, isTurnRunning admits only a TurnPhase, and ComposerSendButton takes
    // `isRunning: boolean` — the new scalar has no path into any of the three.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false }, true)
    ).not.toBeNull()
    expect(isTurnRunning('idle')).toBe(false)
  })
})

// #649: the open-tool derivation — a pure read over the `items` slice the container already holds, so
// "a tool is running right now" needs no new wire field, no new store state and no new subscription.
// Kept a separately-testable named helper (the isTurnRunning / workingIndicatorState precedent) rather
// than inlined in the container, because the container's populated branch is unreachable under server
// render. Pure calls, no rendering.
describe('openToolName — which tool the running turn currently has open (#649)', () => {
  // `items` is append-only and fillResult fills IN PLACE without reordering, so array order IS start
  // order — the whole basis of the "most recently started" tie-break below.
  function openCall(toolUseId: string, name: string): ThreadItem {
    return { kind: 'toolCall', turnId: 't1', toolUseId, name, inputSummary: 'src/a.ts', result: null }
  }
  function resolvedCall(toolUseId: string, name: string): ThreadItem {
    return {
      kind: 'toolCall',
      turnId: 't1',
      toolUseId,
      name,
      inputSummary: 'src/a.ts',
      result: { isError: false, resultSummary: '12 lines' }
    }
  }

  it('finds nothing in an empty timeline', () => {
    expect(openToolName([])).toBeNull()
  })

  it('finds nothing in a timeline with no tool calls at all', () => {
    const items: ThreadItem[] = [
      { kind: 'userText', text: 'run the build' },
      { kind: 'assistantText', turnId: 't1', text: 'on it' }
    ]
    expect(openToolName(items)).toBeNull()
  })

  it('names the tool of a call whose result is still null (AC1)', () => {
    expect(openToolName([openCall('u1', 'Bash')])).toBe('Bash')
  })

  it('names nothing once the call resolves — no turn_state needed (AC2)', () => {
    // The toolResult filling the item is sufficient on its own: the label is derived purely from
    // `items`, so fillResult returning a new array is the entire clearing mechanism.
    expect(openToolName([resolvedCall('u1', 'Bash')])).toBeNull()
  })

  it('names the most recently started of several open at once (AC1s tie-break)', () => {
    expect(openToolName([openCall('u1', 'Read'), openCall('u2', 'Bash')])).toBe('Bash')
  })

  it('selects on result === null, not on position — a later resolved call does not win', () => {
    // The discriminating case: a naive "last toolCall" read would answer Bash here.
    expect(openToolName([openCall('u1', 'Read'), resolvedCall('u2', 'Bash')])).toBe('Read')
  })

  it('falls back to the earlier open call when the later one resolves (AC2)', () => {
    const items = [openCall('u1', 'Read'), openCall('u2', 'Bash')]
    expect(openToolName(items)).toBe('Bash')
    // The fillResult shape: a NEW array with a copied item, which is what re-renders the container.
    const afterResult = [items[0], resolvedCall('u2', 'Bash')]
    expect(openToolName(afterResult)).toBe('Read')
  })

  it('reverts to no name once every call has resolved (AC2)', () => {
    expect(openToolName([resolvedCall('u1', 'Read'), resolvedCall('u2', 'Bash')])).toBeNull()
  })

  it('ignores non-toolCall items sitting after the open call', () => {
    const items: ThreadItem[] = [
      openCall('u1', 'Bash'),
      { kind: 'assistantText', turnId: 't1', text: 'building…' }
    ]
    expect(openToolName(items)).toBe('Bash')
  })
})

// #307/#678: the running-turn stop affordance. isTurnRunning is the exported gate predicate;
// ComposerSendButton the exported pure view (the ThinkingIndicator pattern) — call / server-render them
// directly with injected values, no store. The gate is deliberately BROADER than ThinkingIndicator's
// (`phase === 'thinking'` only): a turn is "running" in BOTH thinking and responding, so the stop variant
// shows in either. #678 folded the affordance into the composer's send button, so the store-bound glue is
// Composer itself (untested, the QueuedBacklogControl posture); the activation→command proof lives in
// sendInterrupt.test.ts (the `node` env fires no clicks).
describe('isTurnRunning — the stop-variant gate (broader than the thinking indicator)', () => {
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

// #678: the composer's one control with two variants. Unlike #307's standalone InterruptButton it NEVER
// returns null — that is what makes AC1's "exactly one stop affordance renders" structural rather than a
// convention: the composer row holds exactly one button in every state, so a second stop cannot be stacked
// above it. `isRunning` and `canSend` are separate booleans and only `canSend` gates, so the stop variant
// is never disabled (#307's behaviour preserved verbatim).
describe('ComposerSendButton — the composer send/stop control (#678)', () => {
  const noop = (): void => {}

  function buttonTags(markup: string): readonly string[] {
    return markup.match(/<button[^>]*>/g) ?? []
  }

  it('is the send variant at idle, enabled while the session can send (AC1/AC5)', () => {
    const markup = renderToStaticMarkup(
      <ComposerSendButton isRunning={false} canSend={true} onSend={noop} onInterrupt={noop} />
    )
    expect(markup).toContain('aria-label="Send"')
    expect(buttonTags(markup)[0]).not.toContain('disabled')
  })

  it('is the send variant at idle, disabled while the session cannot send (#31 preserved)', () => {
    const markup = renderToStaticMarkup(
      <ComposerSendButton isRunning={false} canSend={false} onSend={noop} onInterrupt={noop} />
    )
    expect(markup).toContain('aria-label="Send"')
    expect(buttonTags(markup)[0]).toContain('disabled')
  })

  it('becomes the stop variant while a turn runs — and the send affordance is gone (AC1/AC5)', () => {
    const markup = renderToStaticMarkup(
      <ComposerSendButton isRunning={true} canSend={true} onSend={noop} onInterrupt={noop} />
    )
    // The client-owned accessible name, reused verbatim from #307's INTERRUPT_LABEL — a load-bearing
    // e2e locator that may never be reworded. Keyboard activation is free from the native <button>.
    expect(markup).toContain('aria-label="Stop the running turn"')
    // AC1: exactly one stop affordance renders, because the send one is not also on screen.
    expect(markup).not.toContain('aria-label="Send"')
  })

  it('never disables the stop variant, even when the session cannot send', () => {
    // The deliberate asymmetry: `canSend` gates the send variant only. A turn can be running while the
    // session is disconnected, and hiding the only interrupt affordance there would be a new behaviour.
    // Without this test a later tidy-up collapsing the two gates into one would pass silently.
    const markup = renderToStaticMarkup(
      <ComposerSendButton isRunning={true} canSend={false} onSend={noop} onInterrupt={noop} />
    )
    expect(markup).toContain('aria-label="Stop the running turn"')
    expect(buttonTags(markup)[0]).not.toContain('disabled')
  })

  it('renders exactly one button in either state — never null (the one-control invariant, AC1)', () => {
    for (const isRunning of [false, true]) {
      const markup = renderToStaticMarkup(
        <ComposerSendButton isRunning={isRunning} canSend={true} onSend={noop} onInterrupt={noop} />
      )
      expect(markup).not.toBe('')
      expect(buttonTags(markup)).toHaveLength(1)
    }
  })

  it('swaps the glyph with the variant (the Figma stop glyph, 28×28)', () => {
    // Assert on a distinguishing substring of the stop glyph's own coordinate space, not the whole path.
    const running = renderToStaticMarkup(
      <ComposerSendButton isRunning={true} canSend={true} onSend={noop} onInterrupt={noop} />
    )
    const idle = renderToStaticMarkup(
      <ComposerSendButton isRunning={false} canSend={true} onSend={noop} onInterrupt={noop} />
    )
    expect(running).toContain('viewBox="0 0 28 28"')
    expect(idle).not.toContain('viewBox="0 0 28 28"')
  })
})

// #294: the held queued backlog. QueuedBacklog is the pure, exported view (the ThinkingIndicator
// pattern) — server-render it with an injected QueuedItem[] to prove the empty→null posture and the
// populated rows without touching the queue store. The store-bound QueuedBacklogControl reads
// selectBacklogFor(the active conversation id, #448); its populated branch is NOT server-render-reachable
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

  // #719 AC1 (reversing #330's AC1): null is the initial "no status has arrived yet" sentinel, which is
  // definitionally none of the three the wire delivers — so it reads unknown, distinct from both down
  // ("known to be down") and up. NOT in-progress either: the relay leg still has no in-progress arm, and
  // nothing is probing — this state is the ABSENCE of information, not an attempt to get it. Since #718
  // put the dots on the sidebar, which is on screen from the first frame, collapsing this into down made
  // every cold start claim an outage before anyone had asked.
  it('null → unknown / "Relay Unknown" — not yet known, not known to be down (#719 AC1)', () => {
    expect(relayLeg(null)).toEqual({ category: 'unknown', label: 'Relay Unknown' })
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
  it('maps each category to its dot modifier class (up, in-progress, down, unknown)', () => {
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

    // #719's fourth category — the neutral not-yet-known dot, and its label rendering so the state reads
    // without colour (AC2's legibility rule applies to it like the other three).
    const unknown = renderToStaticMarkup(
      <ConnectionStatusIndicator
        relay={{ category: 'unknown', label: 'Relay Unknown' }}
        daemon={{ category: 'down', label: 'Pyrycode Offline' }}
      />
    )
    expect(unknown).toContain('conn-dot--unknown')
    expect(unknown).toContain('Relay Unknown')
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
// ComposerSendButton / ThinkingIndicator pattern) — server-render it with an injected `open` boolean to
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

  // #366: the Archive action fills the Actions slot's second row, reusing #368's `.channel-info__action`
  // tonal pill verbatim. Like Rename it is callback-gated (`onArchive`), which the container supplies
  // ONLY for an active conversation — so its presence maps one-to-one onto AC1. Rename and Archive now
  // share the class, so these assertions anchor on the label `>Archive</button>`, never on the class.
  it('renders an Archive action in the Actions slot when a conversation and onArchive are supplied (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} onArchive={noop} />
    )
    expect(markup).toContain('>Archive</button>')
  })

  it('offers no Archive action when the active conversation is null (the graceful-empty guard, AC1)', () => {
    // A list-opened thread (conversation === null) gets no onArchive from the container, so the Actions
    // header renders over an empty slot — no Archive control, consistent with #365's empty About.
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={null} onClose={noop} />)
    expect(markup).toContain('Actions')
    expect(markup).not.toContain('>Archive</button>')
  })

  it('offers no Archive action when onArchive is omitted, even with a conversation (callback-gated, AC1)', () => {
    // Gated on the callback, not the conversation — proves the view honours the container's null-guard
    // rather than deriving the button from `conversation` itself.
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} />
    )
    expect(markup).not.toContain('>Archive</button>')
  })

  // #377: Delete is the third action — destructive-last (edit → soft-remove → permanent delete) and a
  // two-step: the pill opens an inline confirm (state owned by the container, threaded as props) before
  // any dispatch. Anchor on `>Delete</button>` / the `--danger` class, never on the shared
  // `.channel-info__action` class (Rename/Archive carry it) nor the bare word "Delete" (the confirm
  // prompt copy contains it as text).
  it('renders a destructive Delete action when a conversation and onDelete are supplied (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} onDelete={noop} />
    )
    expect(markup).toContain('>Delete</button>')
    expect(markup).toContain('channel-info__action--danger')
    // The pill, not the confirm step: no confirm prompt, no Cancel control until it is activated.
    expect(markup).not.toContain('>Cancel</button>')
  })

  it('offers no Delete action when the active conversation is null (the graceful-empty guard, AC1)', () => {
    // A list-opened thread (conversation === null) gets no onDelete from the container, so the Actions
    // header renders over an empty slot — no Delete control, consistent with #365's empty About.
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={null} onClose={noop} />)
    expect(markup).toContain('Actions')
    expect(markup).not.toContain('>Delete</button>')
    expect(markup).not.toContain('channel-info__action--danger')
  })

  it('offers no Delete action when onDelete is omitted, even with a conversation (callback-gated, AC1)', () => {
    // Gated on the callback, not the conversation — proves the view honours the container's null-guard
    // rather than deriving the button from `conversation` itself.
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} />
    )
    expect(markup).not.toContain('>Delete</button>')
    expect(markup).not.toContain('channel-info__action--danger')
  })

  it('swaps the Delete pill for an inline confirm — prompt, Cancel, and destructive Delete — when pending (AC2/AC3)', () => {
    // deleteConfirmPending renders the confirm block in place of the pill. Activating Delete only opens
    // this step (its onClick is onDelete, which sets state) — no dispatch is reachable from a pure
    // render, so "no dispatch on activate" (AC2) holds by construction. Cancel is the no-op escape (AC3).
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView
        conversation={createdPayload()}
        onClose={noop}
        onDelete={noop}
        deleteConfirmPending={true}
        onDeleteConfirm={noop}
        onDeleteCancel={noop}
      />
    )
    // The confirm prompt + both controls appear only in the pending sub-state.
    expect(markup).toContain('This cannot be undone')
    expect(markup).toContain('>Cancel</button>')
    // The confirm button retains the destructive treatment.
    expect(markup).toContain('>Delete</button>')
    expect(markup).toContain('channel-info__action--danger')
  })
})

// #366: the exported dispatch helper. The sheet renders server-side only, so the click handler cannot be
// exercised via a DOM event — the helper is exported to keep the dispatch directly unit-testable, exactly
// as `requestUnarchiveConversation` is (its mirror-image twin). Bare fire-and-forget: `sendCommand`
// returns void, no try/catch.
describe('requestArchiveConversation', () => {
  it('dispatches the archiveConversation command for the conversation id, fire-and-forget (AC2)', () => {
    const fakeSend = vi.fn()
    requestArchiveConversation(fakeSend, 'conv-x')
    expect(fakeSend).toHaveBeenCalledTimes(1)
    expect(fakeSend).toHaveBeenCalledWith({
      type: 'archiveConversation',
      payload: { conversation_id: 'conv-x' }
    })
  })
})

// #377: the exported dispatch helper cloned from requestArchiveConversation (a single REQUIRED
// `conversation_id`, fire-and-forget). Exported to keep the dispatch directly unit-testable — the sheet
// renders server-side only, so the confirm handler cannot be exercised via a DOM event.
describe('requestDeleteConversation', () => {
  it('dispatches the deleteConversation command for the conversation id, fire-and-forget (AC4)', () => {
    const fakeSend = vi.fn()
    requestDeleteConversation(fakeSend, 'conv-d')
    expect(fakeSend).toHaveBeenCalledTimes(1)
    expect(fakeSend).toHaveBeenCalledWith({
      type: 'deleteConversation',
      payload: { conversation_id: 'conv-d' }
    })
  })
})

// #758: the chat pane's thread binding — the selector the container hands to
// `useConversationTimelineStore`, so the thread on screen is the OPEN conversation's own retained
// timeline rather than the flat, single-thread store `activateConversation` resets on every switch.
//
// Tested HERE, at the selector, rather than through the container below, because this repo's renderer
// tier CANNOT see a seeded store: `vitest.config.ts` is `environment: 'node'` and zustand v5's `useStore`
// reads `getInitialState()` under `renderToStaticMarkup` (the note at the head of this file, restated in
// six sibling describes). A `setState` before a server render is invisible, so every container test in
// this file renders the EMPTY stores — which is exactly this selector's `null` branch, and cannot
// distinguish one conversation's rows from another's. The screen-level proof of that distinction is
// `e2e/conversation-switch-keeps-both-threads.spec.ts`, the only tier in this repo that can click.
//
// The fixture drives the REAL store through its real write path (`dispatchFor`), so the copy-on-write
// identity these assertions rest on is the shipped one and not a hand-built map's.
describe('selectOpenTimelineFor', () => {
  // Two conversations, each holding one row of its own. A FRESH `new Map()` per store, never
  // `initialConversationTimelineState` — that exported constant holds a module-shared mutable map
  // (conversationTimelineStore.ts:340-349).
  function twoHeldThreads(): ReturnType<typeof createConversationTimelineStore> {
    const store = createConversationTimelineStore({ timelines: new Map() })
    store.getState().dispatchFor('conv-a', { type: 'userText', text: 'alpha' })
    store.getState().dispatchFor('conv-b', { type: 'userText', text: 'beta' })
    return store
  }

  it("hands back the open conversation's own held slice, never a neighbour's (AC1)", () => {
    const store = twoHeldThreads()
    const thread = selectOpenTimelineFor('conv-a')(store.getState())
    expect(thread?.items).toEqual([{ kind: 'userText', text: 'alpha' }])
    // The chrome travels with the rows — the whole slice is one value, so the phase and the four
    // scalars can no more come from another conversation than the rows can.
    expect(thread?.localSendPending).toBe(true)
    // The HELD slice itself, not a copy. That `Object.is` identity is what makes the switch cheap: a
    // write for another conversation rebuilds the outer map but copies every survivor by reference, so
    // this screen does not re-render (conversationTimelineStore.ts:214-217).
    expect(thread).toBe(store.getState().timelines.get('conv-a'))
  })

  it("reads null for an open conversation with nothing retained — never a neighbour's rows (AC3)", () => {
    const store = twoHeldThreads()
    // `null` means "nothing is held", the reading the container renders as the shipped empty thread.
    // It must not be an empty slice and must not resolve onto a neighbour.
    expect(selectOpenTimelineFor('conv-c')(store.getState())).toBeNull()
  })

  it('reads null when nothing is open, even with a slice held under the empty-string id', () => {
    const store = twoHeldThreads()
    // The `?? ''` sentinel regression guard (BackgroundTaskPanel.tsx:342's idiom, rejected here): `''`
    // is an ORDINARY key in this store — `dispatchFor` mints a slice for whatever id the daemon
    // asserts — so substituting it for "no conversation open" would render that slice as the open
    // conversation's thread while nothing is open. Branching performs no lookup at all.
    store.getState().dispatchFor('', { type: 'userText', text: 'from an empty conversation id' })
    expect(selectOpenTimelineFor(null)(store.getState())).toBeNull()
  })

  it('shows the thread as it now stands after a switch away and back (AC2)', () => {
    const store = twoHeldThreads()
    const away = selectOpenTimelineFor('conv-a')(store.getState())
    // `conv-b` is on screen; a row arrives for `conv-a` while the operator is elsewhere.
    store.getState().dispatchFor('conv-b', { type: 'userText', text: 'beta again' })
    store.getState().dispatchFor('conv-a', { type: 'userText', text: 'arrived while away' })
    const back = selectOpenTimelineFor('conv-a')(store.getState())
    expect(back?.items).toEqual([
      { kind: 'userText', text: 'alpha' },
      { kind: 'userText', text: 'arrived while away' }
    ])
    expect(back).not.toBe(away)
  })

  it("a write for another conversation leaves the open one's slice identical", () => {
    const store = twoHeldThreads()
    const before = selectOpenTimelineFor('conv-a')(store.getState())
    store.getState().dispatchFor('conv-b', { type: 'userText', text: 'beta again' })
    // Same object → zustand's `Object.is` short-circuit → no re-render for the conversation on screen.
    expect(selectOpenTimelineFor('conv-a')(store.getState())).toBe(before)
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

  // #215/#648: the working indicator mounts against the idle timeline store (getInitialState phase:
  // 'idle'), so `workingIndicatorState` returns null and it renders nothing — the inert render slice,
  // layout unchanged. The analog of the "no bubble__cursor" smoke above; both showing paths are proven
  // on the pure ThinkingIndicator describe. #648 pins the idle container against the NEW label too: a
  // gate that widened past a running turn would surface WORKING_COPY here.
  it('mounts the idle timeline with no working indicator (the inert render slice, AC3)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__thinking')
    expect(markup).not.toContain(THINKING_COPY)
    expect(markup).not.toContain(WORKING_COPY)
  })

  // #796: the status row is the one thing in that region that mounts UNCONDITIONALLY — it holds its
  // height with no label inside it, which is what keeps the composer from moving when the working
  // indicator above appears and disappears (AC2). Its icon is still at idle (AC3); the container
  // derives `isTurnRunning(phase)` from the same getInitialState() → phase: 'idle' the assertion above
  // relies on, so this is the inert arm of the same read.
  it('mounts the status row at idle — present, holding its height, icon not turning (AC2, AC3)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('class="composer-status"')
    expect(markup).toContain('class="composer-status__icon"')
    expect(markup).not.toContain('composer-status__icon--spinning')
    // Present but textless: the row mounts, the label inside it does not.
    expect(markup).not.toContain('composer-status__label')
  })

  // #317: the stall indicator mounts against the initial timeline store (getInitialState stalled:
  // false), so isStalled is false and StallIndicator returns nothing — the inert render slice, layout
  // unchanged until a stall onset (the ThinkingIndicator-smoke analog). The showing path is proven on
  // the pure StallIndicator describe above.
  it('mounts the initial timeline with no stall indicator (the inert render slice)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__stall')
  })

  // #493: the api-retry indicator mounts against the initial timeline store (getInitialState apiRetry:
  // null), so ApiRetryIndicator returns nothing — the inert render slice (the StallIndicator-smoke
  // analog). The showing path is proven on the pure ApiRetryIndicator describe above.
  it('mounts the initial timeline with no api-retry indicator (the inert render slice)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__api-retry')
    expect(markup).not.toContain(API_RETRY_COPY)
  })

  // #496: the compaction indicator mounts against the initial timeline store (getInitialState compacting:
  // false), so CompactingIndicator returns nothing — the inert render slice (the ApiRetryIndicator-smoke
  // analog). The showing path is proven on the pure CompactingIndicator describe above.
  it('mounts the initial timeline with no compaction indicator (the inert render slice)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__compacting')
    expect(markup).not.toContain(COMPACTING_COPY)
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

  // #307/#678: the composer mounts against the idle timeline store (getInitialState phase: 'idle'), so
  // isTurnRunning is false and the send button renders its SEND variant — no stop affordance exists
  // anywhere on the screen (AC1). Asserting on the accessible name rather than a class is what keeps this
  // a real regression guard: #678 deleted the .conversation__interrupt / .interrupt-button classes, so a
  // class-based assertion would now be vacuously true. The running path is proven on the pure
  // ComposerSendButton describe above, and the dispatch in sendInterrupt.test.ts. This also keeps
  // window.pyry out of the container render — the bridge is dereferenced only in the click closure.
  it('mounts the idle timeline with no stop affordance (the inert render slice)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('Stop the running turn')
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
  // is relay = null (→ "Relay Unknown" since #719 — not yet known rather than known-offline) and daemon =
  // disconnected (→ "Pyrycode Offline", untouched by #719, which is AC3's cross-check at container level),
  // proving the container reads both stores with NO false green at rest (#330 AC3).
  it('renders the two-dot connection indicator (relay unknown, daemon offline) in the status-row summary (#330, #719)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('status-row__connection')
    expect(markup).toContain('Relay Unknown')
    expect(markup).toContain('Pyrycode Offline')
    // The assertion that proves the container actually renders #719's new category at rest.
    expect(markup).toContain('conn-dot--unknown')
    // Never up/green before a connection exists.
    expect(markup).not.toContain('conn-dot--up')
  })

  // #581: the background-task panel's trigger sits beside the status row, between the thread and the
  // composer. It renders UNCONDITIONALLY — not gated on tasks existing — so both non-populated readings
  // stay reachable through the UI; that also makes its accessible name a plain markup assertion on the
  // default screen render. It is icon-only, so aria-label supplies the name (the StatusRow pattern).
  it('renders the background-task panel trigger with an accessible name (#581 AC2)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('aria-label="Background tasks"')
    expect(markup).toContain('background-task-trigger')
  })

  // #581: the panel is closed at first paint, so no task list renders on the conversation surface. This
  // is the assertable half of "no background-task information appears in the chat timeline" — it fails
  // if anyone mounts the list inline instead of behind the trigger. The other half is structural and
  // needs no test: ThreadItem (ADR 0008) has no background-task arm and the bridge writes only
  // backgroundTaskRosterStore, never the timeline reducer, so there is no code path to assert against.
  // (The open toggle is trivial useState glue; the panel's own surface is proven on the pure
  // BackgroundTaskPanelView describe in BackgroundTaskPanel.test.tsx.)
  it('does not render the background-task panel or any task row while closed (#581 AC5)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('background-task-panel-title')
    expect(markup).not.toContain('background-task-panel__row')
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

describe('the unrecognized-message timeline row', () => {
  const ITEM: ThreadItem = {
    kind: 'unrecognizedMessage',
    site: 'line_type',
    messageType: 'some_future_event',
    raw: '{"type":"some_future_event","detail":"something new"}',
    truncated: false
  }

  it('renders collapsed: the label, the type, and the drop site on one line', () => {
    const markup = renderToStaticMarkup(<Timeline items={[ITEM]} />)
    expect(markup).toContain('unrecognized-row')
    expect(markup).toContain(UNRECOGNIZED_COPY)
    expect(markup).toContain('some_future_event')
    expect(markup).toContain('whole message')
  })

  it('is a real button carrying aria-expanded, closed at rest', () => {
    // A <button>, not a div with a click handler, so keyboard activation and screen-reader
    // semantics come for free rather than being re-implemented and half-missed.
    const markup = renderToStaticMarkup(<Timeline items={[ITEM]} />)
    expect(markup).toContain('<button')
    expect(markup).toContain('aria-expanded="false"')
  })

  it('withholds the raw payload until expanded — it is not merely hidden in the DOM', () => {
    const markup = renderToStaticMarkup(<Timeline items={[ITEM]} />)
    expect(markup).not.toContain('something new')
    expect(markup).not.toContain('unrecognized-row__raw')
  })

  it('omits the type slot entirely when the site read no type at all', () => {
    const undecodable: ThreadItem = { ...ITEM, site: 'undecodable', messageType: '' }
    const markup = renderToStaticMarkup(<Timeline items={[undecodable]} />)
    expect(markup).toContain('could not be decoded')
    // An empty type renders no slot, rather than an empty pair of quotes.
    expect(markup).not.toContain('unrecognized-row__type')
  })

  it('carries no thread role — claude did not say this, the daemon did', () => {
    const markup = renderToStaticMarkup(<Timeline items={[ITEM]} />)
    expect(markup).not.toContain('data-thread-role')
  })

  it('escapes markup in the daemon-supplied type rather than rendering it', () => {
    // The row's whole payload is content the daemon could NOT interpret, so it is the least
    // trustworthy string on the timeline. React escapes text children; this pins that.
    const hostile: ThreadItem = { ...ITEM, messageType: '<img src=x onerror=alert(1)>' }
    const markup = renderToStaticMarkup(<Timeline items={[hostile]} />)
    expect(markup).not.toContain('<img')
    expect(markup).toContain('&lt;img')
  })

  it('labels every drop site, with client-owned copy the daemon never supplies', () => {
    expect(unrecognizedSiteLabel('line_type')).toBe('whole message')
    expect(unrecognizedSiteLabel('assistant_block')).toBe('assistant block')
    expect(unrecognizedSiteLabel('user_block')).toBe('user block')
    expect(unrecognizedSiteLabel('undecodable')).toBe('could not be decoded')
  })

  it('renders one row per repeat, never collapsing them', () => {
    const markup = renderToStaticMarkup(<Timeline items={[ITEM, ITEM, ITEM]} />)
    expect(markup.split('unrecognized-row__summary').length - 1).toBe(3)
  })

  it('keeps the truncation note out of the collapsed row', () => {
    const cut: ThreadItem = { ...ITEM, truncated: true }
    const markup = renderToStaticMarkup(<Timeline items={[cut]} />)
    expect(markup).not.toContain(UNRECOGNIZED_TRUNCATED_COPY)
  })
})
