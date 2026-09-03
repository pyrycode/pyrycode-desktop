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
  API_RETRY_COPY,
  COMPACTING_COPY,
  STALL_COPY,
  UNRECOGNIZED_COPY,
  UNRECOGNIZED_TRUNCATED_COPY,
  unrecognizedSiteLabel,
  ToolRow,
  TOOL_RESULT_EMPTY_COPY,
  shouldShowThinking,
  QueuedBacklog,
  StatusSheet,
  ComposerErrorSlot,
  ConnectionBanner,
  ComposerErrorChip,
  ContextUsageReading,
  WorkspaceChip,
  isTurnRunning,
  ComposerSendButton,
  ThreadOverflowMenuView,
  ChannelInfoSheetView,
  requestArchiveConversation,
  requestDeleteConversation,
  relayLeg,
  daemonLeg,
  selectOpenTimelineFor
} from './ConversationScreen'
// #780's AC5 asserts one chrome from both sides, so the message-side renderer is imported here too.
import { AssistantMarkdown } from './AssistantMarkdown'
import { COMPOSER_ACTIONS_LABEL } from './ComposerActionsMenu'
import { createConversationTimelineStore } from '../../store/conversationTimelineStore'
import {
  CONNECTION_BANNER_COPY,
  COMPOSER_ERROR_CHIP_COPY,
  COMPOSER_ERROR_CHIP_PREFIX_COPY,
  COMPOSER_REPAIR_BUTTON_COPY
} from './composerSend'
import type { Message } from './messageViewModel'
import type { ThreadItem, ToolResult } from '../../store/threadTimeline'
import type { QueuedItem, ConversationCreatedPayload } from '@shared/wire/types'
import { sessionStore } from '../../store/sessionStore'
import { runConfigStore } from '../../store/runConfigStore'

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
  //
  // #780 extended it the same way with `name`, THIRD and positional rather than an options object or a
  // second parameter, for one reason: every existing caller must stay byte-identical. That is not
  // tidiness — it is what makes the regression baseline below a real check rather than a hope, since
  // every fixture that omits it keeps the name `read_file` and the shell carve-out fires on none of
  // them.
  function toolItem(
    result: ToolResult | null,
    input?: Readonly<Record<string, string>>,
    name = 'read_file'
  ): Extract<ThreadItem, { kind: 'toolCall' }> {
    return {
      kind: 'toolCall',
      turnId: 't1',
      toolUseId: 'u1',
      name,
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

  // #854 SPLITS the chip into two groups, so the two byte-level cases below are UPDATED rather than
  // loosened: the runs keep their element, their classes and their order, and gain one wrapper each
  // side. The path constant is not exported (no second caller), so the resolved chip is pinned as two
  // CONTIGUOUS fragments meeting at the `d` attribute rather than by inlining 300 characters of vector
  // into this file. Both fragments together still pin the whole chip end to end.
  const RESOLVED_CHIP_HEAD =
    '<button type="button" class="tool-row__chip tool-row__chip--toggle" data-thread-role="tool" aria-expanded="false">' +
    '<span class="tool-row__left">' +
    '<span class="tool-row__name">read_file</span>' +
    `<span class="tool-row__summary">${SHORTENED_PATH}</span>` +
    '</span>' +
    '<span class="tool-row__right">' +
    '<svg class="tool-row__chevron" viewBox="0 0 4 8" width="4" height="8" fill="currentColor" aria-hidden="true">' +
    '<path d="'
  const RESOLVED_CHIP_TAIL = '"></path></svg></span></button>'

  it('wraps the runs in a filling left group and closes with the hugging right group (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' }, { file_path: DEEP_PATH })} />
    )
    // Byte-level: the same two runs, in the same order, inside .tool-row__left; then .tool-row__right
    // as the chip's LAST child with the chevron as ITS last child — the position #856's count node
    // inserts in front of.
    expect(markup).toContain(RESOLVED_CHIP_HEAD)
    expect(markup).toContain(RESOLVED_CHIP_TAIL)
  })

  it('draws the headline on a pending row too — the swap is inside the shared runs (AC1)', () => {
    // `chipRuns` is declared once and consumed by both branches; this is the half a resolved-row test
    // cannot reach. #854: the left group reaches the <div> branch, the right group does not.
    const markup = renderToStaticMarkup(<ToolRow item={toolItem(null, { file_path: DEEP_PATH })} />)
    expect(markup).toContain(
      '<div class="tool-row__chip" data-thread-role="tool">' +
        '<span class="tool-row__left">' +
        '<span class="tool-row__name">read_file</span>' +
        `<span class="tool-row__summary">${SHORTENED_PATH}</span>` +
        '</span>' +
        '</div>'
    )
  })

  // #854. The unit tier sees markup only: a flush trailing edge and the ellipsis under a narrow window
  // are geometry and live in e2e/tool-row-toggle.spec.ts. What these four cases pin is the STRUCTURE
  // that geometry rests on — which group exists in which state, and that the chevron never varies.

  it('draws no trailing group at all on a pending row, not an empty one (#854 AC2)', () => {
    // AC2's "neither it nor a gap where it would be": an empty .tool-row__right would still take one
    // side of the chip's 12px gap and move the pending row's trailing edge, which is exactly the
    // property #722's three chip-width equalities pin.
    const markup = renderToStaticMarkup(<ToolRow item={toolItem(null)} />)
    expect(markup).not.toContain('tool-row__right')
    expect(markup).not.toContain('tool-row__chevron')
    expect(markup).not.toContain('<svg')
    expect(markup).toContain('tool-row__left')
  })

  it('draws the chevron decoratively, leaving the button named by its runs (#854 AC2)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} />
    )
    expect(markup).toContain('<svg class="tool-row__chevron"')
    expect(markup).toContain('aria-hidden="true"')
    // The chevron adds no accessible name of its own and no new attribute sink: the button's name is
    // still exactly its two text runs (WCAG 2.5.3), and the SAFETY block's three declined sinks hold.
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-controls')
    expect(markup).not.toContain('role="img"')
  })

  it('draws the chevron on an error row too — it follows the body, not the outcome (#854)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: true, resultSummary: 'ENOENT' })} />
    )
    expect(markup).toContain('tool-row__chevron')
    // The error accent is untouched: same wrapper classes, same retinting selector.
    expect(markup).toContain('class="tool-row tool-row--resolved tool-row--error"')
  })

  it('leaves an expanded row header byte-identical to the collapsed one (#854)', () => {
    // The chevron does not turn: Figma draws the collapsed state only, `aria-expanded` and the body
    // below already carry the open state, and ComposerActionsMenu declined exactly this once already.
    const collapsed = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} />
    )
    const expanded = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} defaultExpanded />
    )
    const rightGroup = (markup: string): string => {
      const match = /<span class="tool-row__right">[\s\S]*?<\/span>/.exec(markup)
      if (match === null) throw new Error('no trailing group in the rendered chip')
      return match[0]
    }
    expect(rightGroup(expanded)).toBe(rightGroup(collapsed))
    // And the body it opens is unchanged.
    expect(expanded).toContain('tool-row__body')
    expect(expanded).toContain('tool-row__result')
  })

  // #856 — the result count, the trailing group's FIRST child. The unit tier owns which element exists
  // in which state and what it contains; where it sits on screen (a column of trailing edges, an
  // unchanged row height) is geometry and lives in e2e/tool-row-toggle.spec.ts.
  //
  // The four cases above are this ticket's regression baseline UNEDITED: every one of their fixtures
  // omits `resultDetail`, so the chip RESOLVED_CHIP_HEAD pins IS the absent-count chip, byte for byte.
  // That is why the constant did not move — leaving it fixed is a stronger assertion than rewriting it.

  // The daemon's own example (#773). A précis with a unit word and interior spaces, never a bare number.
  const RESULT_DETAIL = '110 of 1676 lines'

  // The with-count chip's trailing group, as one contiguous fragment: the count element must sit
  // IMMEDIATELY after the group opens and IMMEDIATELY before the chevron, so a stray sibling between
  // them, or the two swapped, fails here rather than being caught only by a rendered geometry.
  const COUNTED_RIGHT_GROUP =
    '<span class="tool-row__right">' +
    `<span class="tool-row__count">${RESULT_DETAIL}</span>` +
    '<svg class="tool-row__chevron"'

  it('draws the count before the chevron in the trailing group (#856 AC1)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines', resultDetail: RESULT_DETAIL })}
      />
    )
    expect(markup).toContain(COUNTED_RIGHT_GROUP)
  })

  it('draws no count element at all when the detail is absent (#856 AC2)', () => {
    // Not an empty one: `.tool-row__right`'s gap falls only BETWEEN children, so "no gap where one
    // would be" follows from not rendering the element — no modifier class, no pending variant.
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} />
    )
    expect(markup).not.toContain('tool-row__count')
    expect(markup).toContain('<span class="tool-row__right"><svg class="tool-row__chevron"')
  })

  it('renders an empty detail byte-identically to an absent one (#856 AC2)', () => {
    // The strongest available form of "both draw the same thing, which is nothing": whole-markup
    // equality, not two not.toContain assertions that would also pass on two different renders.
    //
    // Upstream keeps absent and '' distinct on purpose (#773) — the decoder, the IPC event, the bridge
    // and the reducer each carry them separately. THIS ROW is where they finally mean the same thing,
    // and the collapse happens in ToolRow's predicate and nowhere else.
    const absent = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' })} />
    )
    const empty = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines', resultDetail: '' })} />
    )
    expect(empty).toBe(absent)
  })

  it('draws the count verbatim as escaped children, untrimmed and never an attribute (#856 AC3)', () => {
    // Leading and trailing spaces SURVIVE: the count is drawn verbatim, so nothing trims, parses or
    // reformats it. No apostrophes in the fixture (renderToStaticMarkup escapes ' → &#x27;).
    const hostile = '  <b>110</b> of 1676 lines  '
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines', resultDetail: hostile })}
      />
    )
    expect(markup).toContain('<span class="tool-row__count">  &lt;b&gt;110&lt;/b&gt; of 1676 lines  </span>')
    expect(markup).not.toContain('<b>110</b>')
    // "110 of 1676 lines" invites a tooltip carrying the whole count, and a cap that ellipsizes makes
    // `title` the natural next edit. Untrusted daemon text in an attribute — declined a seventh time.
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-label')
    // NO BARE `not.toContain('data-')` HERE, and the omission is deliberate rather than a gap: the chip
    // legitimately carries data-thread-role="tool", so that assertion would fail on correct markup. What
    // this case actually guards — the count reaching no attribute at all — is carried by the exact-bytes
    // fragment above: it pins the span's whole attribute list to `class`, so a data-* sink on the count
    // fails it. The `title`/`aria-label` pair stays because those two are the tempting sinks, not because
    // they are the only ones checked.
  })

  it('draws no count on a pending row — there is no result to read one from (#856)', () => {
    // Not a second predicate: `.tool-row__right` is gated on the same `result` binding, so a pending
    // row has no trailing group at all and the count question does not arise there.
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem(null)} />
    )
    expect(markup).not.toContain('tool-row__count')
    expect(markup).not.toContain('tool-row__right')
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

  // #855: WHICH run the picked text lands in. The routing itself is toolHeadline.test.ts's; what these
  // cases own is the MARKUP half — that a hidden run is ABSENT rather than empty, that both switches
  // reach the pending <div> as well as the resolved <button>, and that the lead's new occupant arrives
  // under the same escaping posture the summary run already held.
  //
  // REGRESSION BASELINE, free of charge and unusually sharp: every case above renders `read_file`, and
  // the two byte-level chips at :566-600 pin its whole header end to end. A routing keyed on the picked
  // KEY rather than on the TOOL — the mistake the ticket exists to forbid — takes them red at once, and
  // so does one that reaches a non-shell call. If one of them needs editing, the routing is wrong.
  const LEFT_GROUP = (runs: string): string => `<span class="tool-row__left">${runs}</span>`

  it('draws a described shell call as the subject alone, with no lead element (#855 AC1)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { description: 'DESC_SENTINEL_zzz', command: 'CMD_SENTINEL_zzz' },
          'Bash'
        )}
      />
    )
    // Byte-level, and that is the point: a bare not.toContain would be satisfied by an EMPTY lead
    // element being emitted beside a correct subject — which is the shape AC1 forbids, because it
    // would still take one side of the left group's 12px gap and push the subject off the hard left.
    expect(markup).toContain(LEFT_GROUP('<span class="tool-row__summary">DESC_SENTINEL_zzz</span>'))
    expect(markup).not.toContain('tool-row__name')
    // The collapsed row draws the description and NOT the command it arrived beside.
    expect(markup).not.toContain('CMD_SENTINEL_zzz')
  })

  it('draws an undescribed shell call as the lead alone, with no subject element (#855 AC2)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines' }, { command: 'git status' }, 'Bash')}
      />
    )
    // The CLASS is the type-and-ink claim — .tool-row__name is the design's mono/14/16/tertiary run,
    // reused verbatim rather than approximated by a modifier. That the cascade actually lands on it is
    // e2e/tool-row-toggle.spec.ts's, where a computed style exists to read.
    expect(markup).toContain(LEFT_GROUP('<span class="tool-row__name">git status</span>'))
    expect(markup).not.toContain('tool-row__summary')
    // The tool name is genuinely gone from the row, not merely moved: the command replaced it.
    expect(markup).not.toContain('>Bash<')
  })

  it('routes a still-running shell call the same way — the switches are in the shared runs (#855)', () => {
    // `chipRuns` is declared once and consumed by both branches, so this is the half a resolved-row
    // test cannot reach. Figma draws exactly this row ("Find all assertNever sites", 155:566).
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem(null, { description: 'DESC_SENTINEL_zzz' }, 'Bash')} />
    )
    expect(markup).toContain(
      '<div class="tool-row__chip" data-thread-role="tool">' +
        LEFT_GROUP('<span class="tool-row__summary">DESC_SENTINEL_zzz</span>') +
        '</div>'
    )
    expect(markup).not.toContain('tool-row__name')
  })

  it('keeps todays shape for a shell call carrying no input map at all (#855 AC4)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' }, undefined, 'Bash')} />
    )
    expect(markup).toContain(
      LEFT_GROUP(
        '<span class="tool-row__name">Bash</span><span class="tool-row__summary">schema.ts</span>'
      )
    )
  })

  it('leaves every other call on both runs — a path tool, a search, a long tail (#855 AC3)', () => {
    for (const [name, input, subject] of [
      ['Edit', { file_path: DEEP_PATH }, SHORTENED_PATH],
      ['Grep', { pattern: 'TODO' }, 'TODO'],
      ['mcp__codegraph__codegraph_callers', { symbol: 'RelayConnection' }, 'RelayConnection']
    ] as const) {
      const markup = renderToStaticMarkup(
        <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' }, input, name)} />
      )
      expect(markup).toContain(
        LEFT_GROUP(
          `<span class="tool-row__name">${name}</span>` +
            `<span class="tool-row__summary">${subject}</span>`
        )
      )
    }
  })

  it('renders a command in the lead as inert escaped children, never markup (#855 AC2)', () => {
    // No apostrophes in the fixture (renderToStaticMarkup escapes ' → &#x27;). The lead previously only
    // ever carried `item.name`; it now carries a model-authored shell command line, in the same sink
    // under the same escaping — so the SAFETY block's declined sinks are re-asserted on it here.
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { command: '<img src=x onerror=alert(1)>' },
          'Bash'
        )}
      />
    )
    expect(markup).toContain('<span class="tool-row__name">&lt;img src=x onerror=alert(1)&gt;</span>')
    expect(markup).not.toContain('<img')
    // A lead too wide for the header HARD-CUTS at the group boundary, which makes `title={command}`
    // the natural next edit. The answer is that the row opens and the body draws it in full.
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('href')
    expect(markup).not.toContain('dangerously')
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

  // #780: a shell call's command as a code block above the list, and both `description` and `command`
  // off the list. The rules themselves live in toolBody.test.ts; this block owns the MARKUP — the two
  // elements, their position, the escaping posture, and the chrome shared with a message's fence.
  //
  // REGRESSION BASELINE, free of charge and sharper than #706's. Every fixture above carries the name
  // `read_file`, so the carve-out fires on none of them — and two of them (':675-688' and ':691-705')
  // pass a `command` field into an EXPANDED row and assert it renders as a `tool-row__input-value`.
  // Under a name-keyed carve-out they stay green UNEDITED; under a field-keyed one — the mistake AC4
  // exists to forbid — they go red at once. If either needs editing to stay green, the carve-out was
  // keyed on the field name instead of the tool name: that is a stop signal, not a stale fixture.
  const CODE_BLOCK = '<div class="code-block"><pre class="code-block__body">'

  it('draws a Bash command as a code block above a list carrying neither field (AC1, AC2)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: 'RESULT_SENTINEL_zzz' },
          {
            description: 'DESC_SENTINEL_zzz',
            command: 'CMD_SENTINEL_zzz',
            timeout: 'TIMEOUT_SENTINEL_zzz'
          },
          'Bash'
        )}
        defaultExpanded
      />
    )
    expect(markup).toContain(`${CODE_BLOCK}CMD_SENTINEL_zzz</pre></div>`)
    // Every other field the call arrived with still renders, unchanged.
    expect(markup).toContain(INPUT_NAME('timeout'))
    expect(markup).toContain('<pre class="tool-row__input-value">TIMEOUT_SENTINEL_zzz</pre>')
    // Read off the NAME spans: a bare not.toContain('command') would be satisfied by nothing at all
    // here, and not.toContain('description') would be vacuous the moment a class string carried it.
    expect(markup).not.toContain(INPUT_NAME('description'))
    expect(markup).not.toContain(INPUT_NAME('command'))
    // Block, then the surviving list, then the result — one ordering claim across the whole body.
    expect(markup.indexOf('CMD_SENTINEL_zzz')).toBeLessThan(markup.indexOf(INPUT_NAME('timeout')))
    expect(markup.indexOf(INPUT_NAME('timeout'))).toBeLessThan(
      markup.indexOf('RESULT_SENTINEL_zzz')
    )
  })

  it('still draws the block when there is no description, headline repeat and all (AC3)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { command: 'CMD_SENTINEL_zzz' },
          'Bash'
        )}
        defaultExpanded
      />
    )
    expect(markup).toContain(`${CODE_BLOCK}CMD_SENTINEL_zzz</pre></div>`)
    // TWICE, and that is the WANTED shape rather than a defect to fix: with no `description` the
    // command takes the header's LEAD run (#855's routing) and the block draws it again below. The
    // header cuts on one line and the block does not, and a command long enough to be cut is exactly
    // the call the row was opened for. Do not add a guard suppressing it.
    //
    // #855 moved the header half from the summary run to the lead run — the same text in the same
    // chip, one element over. The count is what pins the repeat and it is UNCHANGED.
    expect(markup.split('CMD_SENTINEL_zzz')).toHaveLength(3)
    expect(markup).toContain('<span class="tool-row__name">CMD_SENTINEL_zzz</span>')
  })

  it('draws no block and the list alone for a Bash call with no command (AC3)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { description: 'DESC_SENTINEL_zzz', timeout: 'TIMEOUT_SENTINEL_zzz' },
          'Bash'
        )}
        defaultExpanded
      />
    )
    // No empty bordered box — the helper's null is what makes that structural.
    expect(markup).not.toContain('code-block')
    expect(markup).toContain(INPUT_NAME('timeout'))
    expect(markup).not.toContain(INPUT_NAME('description'))
  })

  it('draws the block and no list at all when the two carved-out fields are all there is (AC2)', () => {
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: 'RESULT_SENTINEL_zzz' },
          { description: 'DESC_SENTINEL_zzz', command: 'CMD_SENTINEL_zzz' },
          'Bash'
        )}
        defaultExpanded
      />
    )
    expect(markup).toContain(`${CODE_BLOCK}CMD_SENTINEL_zzz</pre></div>`)
    // Not an empty container either: #706 left no list-wrapper element to strand.
    expect(markup).not.toContain('tool-row__input')
    expect(markup).toContain('<pre class="tool-row__result">RESULT_SENTINEL_zzz</pre>')
  })

  it('draws the same chrome as a message fenced code block, header included (AC5)', () => {
    // ONE substring, asserted from both sides, so a structural divergence in either fails here — which
    // is what makes "a later restyle of one lands on both" a test rather than a claim. The chrome
    // itself lives entirely in CSS keyed on these two classes (#721 was a pure restyle across two CSS
    // files and zero TSX), so sharing the classes is what shares the chrome.
    const row = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines' }, { command: 'ls -la' }, 'Bash')}
        defaultExpanded
      />
    )
    const fence = renderToStaticMarkup(<AssistantMarkdown text={'```\nls -la\n```'} />)
    expect(row).toContain(CODE_BLOCK)
    expect(fence).toContain(CODE_BLOCK)
    // AC1's no language header, and #721's divider-on-the-header decision is what keeps the headerless
    // form from drawing a doubled edge.
    expect(row).not.toContain('code-block__header')
  })

  it('changes no other tools body, matching the tool NAME and not the field (AC4)', () => {
    // BashOutput is the load-bearing third: it is the name a `startsWith` test would wrongly catch,
    // and it is a real tool that carries a `command` field of its own.
    for (const name of ['read_file', 'Edit', 'BashOutput']) {
      const markup = renderToStaticMarkup(
        <ToolRow
          item={toolItem(
            { isError: false, resultSummary: '184 lines' },
            { description: 'DESC_SENTINEL_zzz', command: 'CMD_SENTINEL_zzz' },
            name
          )}
          defaultExpanded
        />
      )
      expect(markup).toContain(INPUT_NAME('description'))
      expect(markup).toContain(INPUT_NAME('command'))
      expect(markup).not.toContain('code-block')
    }
  })

  it('renders the command as inert escaped text, never markup (AC5)', () => {
    // No apostrophes in the fixture (renderToStaticMarkup escapes ' → &#x27;).
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem(
          { isError: false, resultSummary: '184 lines' },
          { description: 'a shell call', command: '<img src=x onerror=alert(1)>' },
          'Bash'
        )}
        defaultExpanded
      />
    )
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toContain('<img')
    // The block is unbounded in height, which makes `title={command}` the natural next edit; the
    // answer to a long command is that it wraps, never an attribute carrying daemon text.
    expect(markup).not.toContain('title=')
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('dangerously')
  })

  it('withholds the block from a collapsed Bash row (AC1)', () => {
    // The block lives INSIDE the body, like the field list, so a collapsed row cannot draw it.
    const markup = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines' }, { command: 'ls -la' }, 'Bash')}
      />
    )
    expect(markup).not.toContain('code-block')
    expect(markup).not.toContain('tool-row__body')
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

  // #967 REWROTE this case rather than retiring it. #609 asserted the rule against the user bubble and the
  // four daemon-bubble affordances of the day; three of those four are gone — their statuses are labels in
  // the composer status row now, on no bubble at all — so the case keeps the two subjects that still
  // reuse the daemon bubble's fill and measure, and the assertion is the same claim over a smaller set.
  // The two assertions that rested on the retry counter having its OWN SPAN went with the span: the
  // counter is interpolated into the label's single text run now (see apiRetryLabel), which is exactly
  // what removes the whitespace question they were checking.
  it('leaves the user bubble and the status-row label outside the rule (AC4, AC5)', () => {
    const MODIFIER = 'bubble--assistant-text'
    const userMarkup = renderToStaticMarkup(
      <Timeline items={[{ kind: 'userText', text: 'typed by the operator' }]} />
    )
    expect(userMarkup).toContain('bubble bubble--user')
    expect(userMarkup).not.toContain(MODIFIER)
    const labelMarkup = renderToStaticMarkup(
      <ThinkingIndicator state="thinking" toolName={null} retry={null} />
    )
    expect(labelMarkup).not.toContain(MODIFIER)
    // #609 (AC5): the markdown container is the assistant bubble's alone. Neither the user bubble nor the
    // status label gains it.
    expect(userMarkup).not.toContain(CONTAINER)
    expect(labelMarkup).not.toContain(CONTAINER)
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

// #969: the meta row at the foot of every text message bubble (Figma `Meta row` 132:4446 assistant /
// 132:4435 user) — a timestamp slot #970 fills, and the copy control this ticket ships. This tier owns
// the markup facts: WHICH rows carry the row, WHERE in the bubble it sits, and what the control is as
// an element. What the browser does with the geometry — the 6px corners, the 16/20 padding, the row's
// two alignments — is layout, unobservable under `environment: 'node'` with no DOM and no stylesheet;
// that half is e2e/message-copy.spec.ts, which also owns the click and the clipboard round-trip.
describe('Timeline — the message bubble meta row and its copy control (#969)', () => {
  const META = 'bubble__meta'
  const COPY = 'bubble__copy'
  // The client-owned accessible name. Written here as the literal the component's module-local constant
  // holds (the DROP_QUEUED_LABEL idiom — neither is exported), so a silent rename fails this tier.
  const COPY_LABEL = 'Copy message'

  const settled = (text: string): ThreadItem[] => [
    { kind: 'assistantText', turnId: 't1', text },
    { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
  ]

  it('ends the settled assistant bubble, the in-progress tail and the user bubble in a meta row', () => {
    // All three are text MESSAGE bubbles, which is the set AC2 names. The in-progress tail is included
    // deliberately: excluding it would reflow the bubble the moment a turn settles, and a partial reply
    // is as copyable as a finished one.
    const cases = [
      renderToStaticMarkup(<Timeline items={settled('a settled reply')} />),
      renderToStaticMarkup(<Timeline items={[{ kind: 'assistantText', turnId: 't1', text: 'growing' }]} />),
      renderToStaticMarkup(<Timeline items={[{ kind: 'userText', text: 'typed by the operator' }]} />)
    ]
    for (const markup of cases) {
      expect(markup.match(new RegExp(META, 'g'))?.length ?? 0).toBeGreaterThan(0)
      expect(markup).toContain(COPY)
    }
  })

  it('appends the row at the FOOT — after the markdown container, and after the streaming cursor', () => {
    // The append-never-prepend constraint, which interactiveRoundtrip.test.tsx pins from the other side
    // (its byte string asserts the markdown container opens the bubble). Ordering assertions rather than
    // a byte string, because what matters is the row's position relative to the content, not the exact
    // bytes between them.
    const settledMarkup = renderToStaticMarkup(<Timeline items={settled('the reply body')} />)
    expect(settledMarkup.indexOf(META)).toBeGreaterThan(settledMarkup.indexOf(CONTAINER))
    expect(settledMarkup.indexOf(META)).toBeGreaterThan(settledMarkup.indexOf('the reply body'))

    const streaming = renderToStaticMarkup(
      <Timeline items={[{ kind: 'assistantText', turnId: 't1', text: 'still growing' }]} />
    )
    expect(streaming.indexOf(META)).toBeGreaterThan(streaming.indexOf(CURSOR))

    const user = renderToStaticMarkup(<Timeline items={[{ kind: 'userText', text: 'user says' }]} />)
    expect(user.indexOf(META)).toBeGreaterThan(user.indexOf('user says'))
  })

  it('right-aligns the user row with its own modifier and leaves the assistant row unmodified', () => {
    const user = renderToStaticMarkup(<Timeline items={[{ kind: 'userText', text: 'mine' }]} />)
    expect(user).toContain(`${META} ${META}--user`)

    const assistant = renderToStaticMarkup(<Timeline items={settled('theirs')} />)
    expect(assistant).toContain(META)
    expect(assistant).not.toContain(`${META}--user`)
  })

  it('gives the copy control a real button with an accessible name, and no second focusable element', () => {
    const markup = renderToStaticMarkup(<Timeline items={settled('copy me')} />)
    // A real <button type="button"> IS the keyboard path (AC3): natively focusable, activated by Enter
    // and Space, no tabindex or key handler of our own to get wrong.
    expect(markup).toContain(`<button type="button" class="${COPY}" aria-label="${COPY_LABEL}"`)
    // Exactly one interactive element in the bubble — the control this ticket adds and nothing else.
    expect(markup.match(/<button/g)?.length ?? 0).toBe(1)
    expect(markup).not.toContain('tabindex')
  })

  it('keeps the message text out of the accessible name — the label is a client-owned constant', () => {
    // The trap "the control has an accessible name" invites: `aria-label={`Copy: ${text}`}` would put
    // relay-peer-authored text into an ATTRIBUTE, which CLAUDE.md's 2026-08-20 ruling forbids outright.
    // A distinctive fixture so the assertion cannot pass by coincidence.
    const markup = renderToStaticMarkup(<Timeline items={settled('zzqq-daemon-authored-zzqq')} />)
    expect(markup).toContain('zzqq-daemon-authored-zzqq')
    expect(markup).not.toContain('aria-label="zzqq')
    expect(markup).toContain(`aria-label="${COPY_LABEL}"`)
  })

  it('draws the glyph decoratively — one inline svg, hidden from the accessibility tree', () => {
    const markup = renderToStaticMarkup(<Timeline items={settled('glyph check')} />)
    // The Figma export's clipPath is a full-bleed 11x12 rect and is dropped as the no-op it is: the
    // glyph ships as a bare svg with a single path, this repo's icon convention.
    expect(markup).toContain('viewBox="0 0 11 12"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup.match(/<path/g)?.length ?? 0).toBe(1)
    expect(markup).not.toContain('clipPath')
  })

  it('draws NO meta row on the queued row — it has no time and nothing sent yet to copy', () => {
    const markup = renderToStaticMarkup(
      <QueuedBacklog
        items={[{ queued_msg_id: 1, text: 'waiting to send', ts: '2026-07-12T00:00:00Z' }]}
        onDrop={() => {}}
      />
    )
    // It DOES take the new geometry — same .bubble and .bubble--user, restyled by CSS alone.
    expect(markup).toContain('bubble bubble--user')
    expect(markup).not.toContain(META)
    expect(markup).not.toContain(COPY)
  })

  it('draws NO meta row on the unmounted MessageBubble residue, whose markup stays byte-identical', () => {
    // #179 unmounted this path; it is still exported and still unit-tested above, where its assertions
    // pin the message text as the bubble's SOLE child as a byte string. It inherits the CSS restyle and
    // nothing else, so those assertions stay green untouched — this case is what makes that structural.
    const markup = renderToStaticMarkup(
      <MessageThread messages={[{ id: 'm1', type: 'daemon', text: 'residue' }]} />
    )
    expect(markup).toContain('data-message-role="daemon">residue</div>')
    expect(markup).not.toContain(META)
    expect(markup).not.toContain(COPY)
  })

  it('leaves every load-bearing locator byte-stable across the restyle (AC5)', () => {
    // The classes and attributes the unit specs and the e2e tier locate rows by. A restyle that renamed
    // one would break specs this ticket never opened, so they are asserted together, in one place.
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          { kind: 'userText', text: 'ask' },
          ...settled('answer')
        ]}
      />
    )
    for (const locator of [
      'message-row',
      'message-row--user',
      'message-row--daemon',
      'bubble',
      'bubble--user',
      'bubble--daemon',
      'bubble__markdown',
      'data-thread-role="user"',
      'data-thread-role="assistant"'
    ]) {
      expect(markup).toContain(locator)
    }
    const streaming = renderToStaticMarkup(
      <Timeline items={[{ kind: 'assistantText', turnId: 't1', text: 'tail' }]} />
    )
    expect(streaming).toContain('bubble--assistant-text')
  })
})

// #286/#690: the session-boundary delimiter row, redrawn as the desktop inline separator (Figma node
// 119-3843): rule / centred label / rule on one line, with no relative time and so no `now` prop.
// The label's per-reason copy is asserted exactly in sessionBoundaryViewModel.test.ts; here we prove
// the row's structure and its untrusted-text posture.
describe('Timeline — the session-boundary delimiter (#286, redrawn #690)', () => {
  // occurredAt still rides the ThreadItem (the store owns it), it just reaches no renderer any more.
  const twoHoursAgo = new Date(Date.parse('2026-01-15T12:00:00.000Z') - 2 * 3_600_000).toISOString()

  it('brackets the label with TWO rules — no bubble, no cursor, no data-thread-role (AC1/AC4/AC5)', () => {
    const items: ThreadItem[] = [
      { kind: 'sessionBoundary', reason: 'workspace_change', workspaceCwd: '~/Workspace/Projects/KitchenClaw', occurredAt: twoHoursAgo }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('session-delimiter')
    // The unit tier cannot measure a width, but it CAN prove the two identically-classed siblings
    // that make the equal halves structural are both there and bracket the label (AC5s pure-tier
    // stand-in; the widths themselves are review-by-inspection, see the PR checklist).
    expect(markup.match(/session-delimiter__rule/g)).toHaveLength(2)
    expect(markup.indexOf('session-delimiter__rule')).toBeLessThan(
      markup.indexOf('session-delimiter__title')
    )
    expect(markup.indexOf('session-delimiter__title')).toBeLessThan(
      markup.lastIndexOf('session-delimiter__rule')
    )
    // The label, path verbatim — and no time appended to it.
    expect(markup).toContain('>Workspace changed to ~/Workspace/Projects/KitchenClaw<')
    expect(markup).not.toContain('ago')
    // A distinct row: not attributed to assistant/user/tool, and not a streaming tail.
    expect(markup).not.toContain('data-thread-role')
    expect(threadBubbleCount(markup)).toBe(0)
    expect(markup).not.toContain(CURSOR)
  })

  it('renders each rule as an aria-hidden decorative element (purely visual, not semantic)', () => {
    const items: ThreadItem[] = [
      { kind: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: twoHoursAgo }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    // The clear label bounded by its tags, so a re-appended time fails this assertion too.
    expect(markup).toContain('>Session reset<')
    expect(markup).toMatch(/session-delimiter__rule[^>]*aria-hidden="true"/)
  })

  it('renders an untrusted workspaceCwd as visible characters, never live markup (AC4)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const items: ThreadItem[] = [
      { kind: 'sessionBoundary', reason: 'workspace_change', workspaceCwd: '<b>x</b>', occurredAt: twoHoursAgo }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })

  it('sits in arrival order between the surrounding message groups, a fresh row (AC1)', () => {
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: 'before the break' },
      { kind: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: twoHoursAgo },
      { kind: 'userText', text: 'after the break' }
    ]
    const markup = renderToStaticMarkup(<Timeline items={items} />)
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
//
// #967: this view is now the row's label for ALL FOUR thread-status facts, so the three retired
// `describe` blocks (StallIndicator / ApiRetryIndicator / CompactingIndicator) fold their assertions into
// the cases below rather than being dropped — each folded status is proven on this element, with this
// element's base class, which is simultaneously the proof that nothing mounts for it anywhere else.
// `retry={null}` on the pre-existing cases is the same kind of mechanical prop addition `toolName` was;
// their assertions still stand verbatim. Two things a cold read gets wrong here: the tool name is now
// SCOPED to the working/thinking state (the three superseding states outrank it, which reverses #649's
// order and has its own case below), and `state === null` no longer means "a retry or compaction
// superseded the label" — those arrive as states of their own — it means there is nothing to say.
describe('ThinkingIndicator — the row label for all four thread statuses (#215, #648, #649, #967)', () => {
  it('is inert when there is nothing to say — renders nothing (zero layout footprint, AC3)', () => {
    expect(renderToStaticMarkup(<ThinkingIndicator state={null} toolName={null} retry={null} />)).toBe(
      ''
    )
  })

  it('shows the daemon-styled Thinking affordance while thinking', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="thinking" toolName={null} retry={null} />
    )
    // The stable test seam (the bubble__cursor role) — #796 RETAINED `conversation__thinking` when the
    // bubble treatment became the status row's label, precisely so this assertion and the two e2e
    // turn-liveness locators keep pointing at the same identity.
    expect(markup).toContain('conversation__thinking')
    // The WHOLE class attribute, not a bare toContain of the presentation class. Unlike #649's
    // deliberately non-prefixed `bubble--tool-label`, BEM's `composer-status__label--tool` DOES contain
    // `composer-status__label` as a substring, so a substring assertion would pass on markup that
    // dropped the base class and kept only the modifier — the exact vacuity .composer-status's own
    // comment was written to avoid. Pinning the attribute also pins that BOTH modifiers are absent here.
    expect(markup).toContain('class="conversation__thinking composer-status__label"')
    // The client-owned static label — the ellipsis glyph … (U+2026), no apostrophe to survive escaping.
    expect(markup).toContain(THINKING_COPY)
    // #648 hoisted this literal out of the JSX into an exported constant; its rendered text must not
    // change, so the value is pinned here rather than left to review.
    expect(THINKING_COPY).toBe('Thinking…')
  })

  it('shows the generic working affordance on the same surface while running but not thinking (#648, AC1)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="working" toolName={null} retry={null} />
    )
    // The same element and the same class attribute — one surface, two labels, no CSS change (AC1's
    // "the indicator is visible", not "a second indicator appears").
    expect(markup).toContain('conversation__thinking')
    expect(markup).toContain('class="conversation__thinking composer-status__label"')
    expect(markup).toContain(WORKING_COPY)
    // The label tracks the phase (AC2): the thinking copy is NOT what a tool-heavy stretch shows.
    expect(markup).not.toContain(THINKING_COPY)
  })

  it('carries five client-owned labels, lexically distinct from each other (AC2, AC5, #967)', () => {
    // Reachable without rendering (AC5) — all five exported since #967 moved STALL_COPY up beside its
    // siblings and exported it, so no test asserts a duplicated literal any more.
    const copies = [THINKING_COPY, WORKING_COPY, API_RETRY_COPY, COMPACTING_COPY, STALL_COPY]
    // A SET-SIZE check rather than ten pairwise not.toBe assertions: it proves the same distinctness and
    // stays correct when a sixth label lands, where an enumerated list silently stops covering the new one.
    expect(new Set(copies).size).toBe(copies.length)
    for (const copy of copies) {
      // Apostrophe-free (renderToStaticMarkup escapes `'` → `&#x27;`, the standing desktop lesson).
      expect(copy).not.toContain("'")
      // The U+2026 ellipsis character, never three dots — the shipped convention across all five.
      expect(copy).toContain('…')
      expect(copy).not.toContain('...')
    }
  })

  it('names the open tool on the same surface, replacing the generic copy (#649, AC1)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="working" toolName="Bash" retry={null} />
    )
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
    expect(
      renderToStaticMarkup(<ThinkingIndicator state="working" toolName={null} retry={null} />)
    ).not.toContain('composer-status__label--tool')
    expect(
      renderToStaticMarkup(<ThinkingIndicator state="thinking" toolName={null} retry={null} />)
    ).not.toContain('composer-status__label--tool')
  })

  it('renders nothing at all with a tool open but no state — the null guard still runs first (#649, AC3)', () => {
    // The `state === null` guard is still the first thing this view does, so an open tool cannot
    // resurrect a label the container decided not to show. What reaches this case CHANGED with #967: it
    // used to be a live api-retry or compaction (which blanked the state), and those now arrive as
    // states of their own. What is left is the honest empty case — an idle turn with no folded status
    // and no local send — where a stale unresolved toolCall can still be sitting in `items`.
    expect(renderToStaticMarkup(<ThinkingIndicator state={null} toolName="Bash" retry={null} />)).toBe(
      ''
    )
  })

  it('renders a hostile tool name as inert escaped text, never as markup (#649, AC4)', () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="working" toolName={hostile} retry={null} />
    )
    // Attribute-shaped guards, not a bare not.toContain: a `not.toContain('src=')` would pass
    // vacuously. The name reaches the DOM only as an auto-escaped React text child (the tool row's own
    // posture on `item.name`) — no dangerouslySetInnerHTML, no HTML sink.
    expect(markup).toContain('Running &lt;img')
    expect(markup).not.toContain('<img')
    // No live event-handler attribute escaped out of the name. Matching on the QUOTE is what makes this
    // a detector: escaped output carries a literal ` onerror=&quot;` run, so a bare /\son[a-z]+=/ would
    // fail on correct output — it is the unescaped `="` that only an HTML sink could produce.
    expect(markup).not.toMatch(/\son[a-z]+="/i)
    expect(markup).not.toContain('alert(1)"')
  })

  // #967: the three folded statuses. Each renders on the SAME element and the same base class as the
  // working label — that is the whole point of the fold, so each of these assertions is also the proof
  // that nothing else mounts anywhere for these states. The retry counter's cases move here verbatim from
  // the retired ApiRetryIndicator describe, with one change that is the ticket: the digits are part of the
  // label's single text run instead of a `.api-retry__counter` span.
  it('shows the retry label with the attempt counter in ONE text run (#967, AC1, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="retrying" toolName={null} retry={{ current: 3, total: 10 }} />
    )
    expect(markup).toContain('class="conversation__thinking composer-status__label"')
    // ONE run, asserted as one: the copy, the separator space and the digits are a single text child
    // closing the element. A constant-plus-span rendering could not satisfy this, which is what keeps
    // the truncation bound honest (one run ellipsizes once — see .composer-status__label--tool).
    expect(markup).toContain(`>${API_RETRY_COPY} attempt 3/10</span>`)
    // The retired span's class is gone from the markup, not merely unstyled.
    expect(markup).not.toContain('api-retry__counter')
    // Client-formatted digits, never a daemon string and never a computed fraction.
    expect(markup).not.toContain('NaN')
  })

  it('renders a known zero attempt verbatim — 0/10 is not the unknown sentinel (#967, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="retrying" toolName={null} retry={{ current: 0, total: 10 }} />
    )
    expect(markup).toContain(`>${API_RETRY_COPY} attempt 0/10</span>`)
  })

  it('omits the counter entirely when the count is unknown — never renders 0/0 (#967, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="retrying" toolName={null} retry={{ current: 0, total: 0 }} />
    )
    // Still a visible retry status…
    expect(markup).toContain(API_RETRY_COPY)
    // …with no counter at all. Both halves: the word the counter opens with is what a partial render
    // would leak, and `0/0` is what a missing guard would print.
    expect(markup).not.toContain('attempt')
    expect(markup).not.toContain('0/0')
    // Never a computed fraction — 0/0 is NaN.
    expect(markup).not.toContain('NaN')
  })

  it('degrades to the bare retry copy when the counter record is absent (#967)', () => {
    // Unreachable from the container, which derives `'retrying'` from `apiRetry !== null` and hands this
    // the same record — but the prop type admits it, and the bare copy is the honest answer. A degrade,
    // not a defence.
    expect(
      renderToStaticMarkup(<ThinkingIndicator state="retrying" toolName={null} retry={null} />)
    ).toContain(`>${API_RETRY_COPY}</span>`)
  })

  it('shows the compaction label on the same surface, in the rows own colour (#967, AC1)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="compacting" toolName={null} retry={null} />
    )
    expect(markup).toContain(`>${COMPACTING_COPY}</span>`)
    // No modifier at all: compaction is claude working normally, so it keeps --color-primary — painting
    // routine housekeeping as a failure would be a design bug (#496's own reasoning, carried).
    expect(markup).toContain('class="conversation__thinking composer-status__label"')
  })

  it('shows the stall label with the error-colour modifier and nothing else (#967, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="stalled" toolName={null} retry={null} />
    )
    expect(markup).toContain(`>${STALL_COPY}</span>`)
    // The WHOLE class attribute: the stall takes exactly one modifier, and the tool modifier is not it.
    // A substring assertion would pass on markup that had dropped the base class (the BEM vacuity
    // .composer-status's comment legislates against).
    expect(markup).toContain(
      'class="conversation__thinking composer-status__label composer-status__label--stalled"'
    )
  })

  it('keeps the stalled modifier off the other four states — it is the stall alone (#967, AC3)', () => {
    for (const state of ['thinking', 'working', 'retrying', 'compacting'] as const) {
      const markup = renderToStaticMarkup(
        <ThinkingIndicator state={state} toolName={null} retry={{ current: 1, total: 2 }} />
      )
      // Positive half first, so this cannot pass vacuously against markup with no label in it.
      expect(markup).toContain('composer-status__label')
      expect(markup).not.toContain('composer-status__label--stalled')
    }
  })

  it('outranks an open tool name in all three superseding states (#967, AC1)', () => {
    // The precedence #967 REVERSED. Through #963 the tool name won over the state, which was safe only
    // because a live retry or compaction blanked the state and this view returned before the label. With
    // all four facts in one slot, `state === 'retrying'` with a tool still open is reachable, and the old
    // order would have rendered the tool name where the row must say API_RETRY_COPY.
    const expected = {
      retrying: `${API_RETRY_COPY} attempt 3/10`,
      compacting: COMPACTING_COPY,
      stalled: STALL_COPY
    } as const
    for (const [state, copy] of Object.entries(expected)) {
      const markup = renderToStaticMarkup(
        <ThinkingIndicator
          state={state as 'retrying' | 'compacting' | 'stalled'}
          toolName="Bash"
          retry={{ current: 3, total: 10 }}
        />
      )
      expect(markup).toContain(`>${copy}</span>`)
      // Not the tool name, and not the tool modifier either — the name belongs to state 4 alone, so
      // neither the copy nor the one-line bound it carries may appear here.
      expect(markup).not.toContain('Bash')
      expect(markup).not.toContain('composer-status__label--tool')
    }
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

  // #797: the right-hand slot #796 reserved. `trailing` is the ROW's slot, `children` is the activity
  // group's — so the occupant lands as a SIBLING of the group, not a descendant of it. That is what
  // space-between right-aligns; nested inside the group it would sit beside the label instead.
  it('renders its trailing slot as a sibling of the activity group, not inside it (#797)', () => {
    const markup = renderToStaticMarkup(
      <ComposerStatusArea isRunning={false} trailing={<span className="probe-trailing" />} />
    )
    // The `</div>` immediately before it is the activity group's own close — the tight form of the
    // ordering assertion, which a nested occupant could not satisfy.
    expect(markup).toContain('</div><span class="probe-trailing"')
  })

  // AC1's "not an empty element", at the row level: with no occupant the slot contributes NOTHING to the
  // markup — `trailing` is rendered bare, with no .composer-status__trailing wrapper, so the three
  // non-error arms emit no empty div. Counted rather than substring-matched: a wrapper would be caught by
  // the count and missed by a not.toContain on a class name it was never given.
  it('contributes nothing to the markup when the trailing slot is empty (#797, AC1)', () => {
    const markup = renderToStaticMarkup(<ComposerStatusArea isRunning={false} />)
    expect(markup).toContain('class="composer-status"')
    expect(markup).toContain('class="composer-status__activity"')
    expect(markup.match(/<div/g)?.length).toBe(2)
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

// #493: the indicator-precedence predicate. The thinking gate NARROWS rather than the container deriving
// a mutually-exclusive status union, so both indicator views stay pure and unchanged in their own props
// (the isTurnRunning precedent of extracting the named gate). #496 extends `ThreadStatus` with one field
// and this predicate with one clause — the second proof the seam grows by one of each.
//
// #648 changes exactly one thing here: the phase clause becomes `isTurnRunning(phase)`, so the indicator
// holds for the whole running turn. Both supersede clauses are textually untouched, and every assertion
// below except the running-turn one stands verbatim from #493/#496 — they are the regression evidence
// that broadening the phase clause did not weaken the supersede rules (AC4).
// #967: the title used to name "the retry- and compaction-supersede rules", and the rules are still here
// — what changed is that this predicate is no longer the last word on them. It answers whether the WORKING
// label is what the row's one slot shows; the four-way order between the slot's occupants lives in
// `workingIndicatorState` below. Every assertion in this block stands verbatim from #493/#496/#648 apart
// from the one mechanical `stalled: false` token per literal, which is the point: they are the standing
// evidence that folding three statuses into one slot did not weaken either supersede rule.
describe('shouldShowThinking — the running-turn gate for the working label (#493, #496, #648, #967)', () => {
  it('shows the thinking indicator while thinking with nothing superseding it (AC4)', () => {
    expect(shouldShowThinking({ phase: 'thinking', apiRetry: null, compacting: false, stalled: false })).toBe(true)
  })

  it('hides the thinking indicator while a retry is in flight — the supersede rule (#493)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 3, total: 10 }, compacting: false, stalled: false })
    ).toBe(false)
  })

  it('hides it for a retry with an unknown count too — presence supersedes, not the counter (#493)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 0, total: 0 }, compacting: false, stalled: false })
    ).toBe(false)
  })

  it('hides the thinking indicator while compacting — the second supersede rule (AC4)', () => {
    expect(shouldShowThinking({ phase: 'thinking', apiRetry: null, compacting: true, stalled: false })).toBe(false)
  })

  it('hides it while both compacting and retrying (AC4)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 3, total: 10 }, compacting: true, stalled: false })
    ).toBe(false)
  })

  it('never shows thinking outside the thinking phase, compacting or not (AC4)', () => {
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: true, stalled: false })).toBe(false)
    expect(shouldShowThinking({ phase: 'responding', apiRetry: null, compacting: true, stalled: false })).toBe(false)
  })

  it('holds the indicator across the whole running turn when nothing is in flight (#648, AC1)', () => {
    // #648 reverses the phase clause: the pre-#648 gate was exactly `phase === 'thinking'`, which let the
    // indicator vanish for the tool-heavy bulk of a turn. It is now `isTurnRunning(phase)`, so `responding`
    // shows. `idle` still hides — the gate never widens past a running turn.
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: false, stalled: false })).toBe(false)
    expect(shouldShowThinking({ phase: 'responding', apiRetry: null, compacting: false, stalled: false })).toBe(true)
  })

  it('shows in both running phases and hides at idle — the isTurnRunning tie (#648, AC1, AC3)', () => {
    // The gate now REUSES isTurnRunning rather than re-deriving the phase test, so the tie is asserted
    // here rather than merely inherited: a future edit to either side that breaks agreement fails this.
    for (const phase of ['thinking', 'responding'] as const) {
      expect(shouldShowThinking({ phase, apiRetry: null, compacting: false, stalled: false })).toBe(
        isTurnRunning(phase)
      )
      expect(shouldShowThinking({ phase, apiRetry: null, compacting: false, stalled: false })).toBe(true)
    }
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: false, stalled: false })).toBe(
      isTurnRunning('idle')
    )
  })
})

// #648: the label discriminant, composed ON the gate above rather than duplicating it. So the
// client-owned labels are chosen in one place and the view receives a value it cannot confuse with a
// daemon string. Pure calls, no rendering.
//
// #967: SIX outcomes now — null plus the five states — because the row's one label slot took over #493's
// retry, #496's compaction and #317's stall, and this is the single place their order lives. Three things
// the block below pins: the order itself, that the first three states are NOT gated on a running turn
// (AC2 — they are read before the gate, and folding them behind it would have silently narrowed three
// shipped behaviours), and that the gate still governs the working label alone.
describe('workingIndicatorState — which label the rows one slot shows (#648, #967)', () => {
  it('picks the thinking label during the thinking slice (AC2)', () => {
    expect(workingIndicatorState({ phase: 'thinking', apiRetry: null, compacting: false, stalled: false })).toBe(
      'thinking'
    )
  })

  it('picks the generic working label for the rest of the running turn (AC1, AC2)', () => {
    // The phase that LASTS: the daemon flips to `responding` on the first reply token or tool step and
    // sends no further turn_state until the turn ends, so this covers the tool-heavy silent stretch that
    // used to show nothing at all.
    expect(workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: false, stalled: false })).toBe(
      'working'
    )
  })

  it('picks nothing at idle — no wrapper, no empty chrome (AC3)', () => {
    expect(workingIndicatorState({ phase: 'idle', apiRetry: null, compacting: false, stalled: false })).toBeNull()
  })

  // #967 CHANGED THESE THREE ANSWERS, and the change is the ticket rather than a regression: the working
  // label is still superseded in the newly covered phase, but the superseding status now takes the slot
  // with its OWN copy instead of blanking it. #493's and #496's supersede rules themselves are asserted
  // unchanged on `shouldShowThinking` above, which is why they were kept there.
  it('is superseded by a live retry in the newly covered phase too (AC4, #967)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: { current: 3, total: 10 }, compacting: false, stalled: false })
    ).toBe('retrying')
  })

  it('is superseded by an unknown-count retry too — presence supersedes, not the counter (AC4)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: { current: 0, total: 0 }, compacting: false, stalled: false })
    ).toBe('retrying')
  })

  it('is superseded by a live compaction in the newly covered phase too (AC4, #967)', () => {
    expect(workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: true, stalled: false })).toBe(
      'compacting'
    )
  })

  it('agrees with the gate wherever nothing supersedes — it delegates, it is not a parallel rule (AC4)', () => {
    // Scoped to the all-clear status since #967: with a folded status live this function answers from its
    // own order before the gate is consulted at all (AC2 — those three are not turn-gated), so the
    // agreement it still owes the gate is exactly over the working label's own inputs.
    for (const phase of ['thinking', 'responding', 'idle'] as const) {
      const status = { phase, apiRetry: null, compacting: false, stalled: false }
      expect(workingIndicatorState(status) !== null).toBe(shouldShowThinking(status))
    }
  })

  // #967: the four-way order. The first three states are NOT gated on a running turn — that is AC2, and
  // it is why they are read BEFORE `shouldShowThinking` rather than inside it.
  it('picks the retry state first, ahead of every other fact (#967, AC1)', () => {
    expect(
      workingIndicatorState({
        phase: 'responding',
        apiRetry: { current: 3, total: 10 },
        compacting: true,
        stalled: true
      })
    ).toBe('retrying')
  })

  it('picks compacting second, ahead of a stall and the working label (#967, AC1)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: true, stalled: true })
    ).toBe('compacting')
  })

  it('picks the stall third, ahead of the working label (#967, AC1)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: false, stalled: true })
    ).toBe('stalled')
  })

  it('shows all three folded states with no turn running (#967, AC2)', () => {
    // The regression this pins: folding the three in BEHIND `shouldShowThinking` would narrow three
    // shipped behaviours to the running turn. `thread-scroll-pin.spec.ts` drives exactly this case —
    // it pushes a stall onto a turn the primer already returned to `idle`.
    expect(
      workingIndicatorState({ phase: 'idle', apiRetry: null, compacting: false, stalled: true })
    ).toBe('stalled')
    expect(
      workingIndicatorState({
        phase: 'idle',
        apiRetry: { current: 3, total: 10 },
        compacting: false,
        stalled: false
      })
    ).toBe('retrying')
    expect(
      workingIndicatorState({ phase: 'idle', apiRetry: null, compacting: true, stalled: false })
    ).toBe('compacting')
  })
})

// #650: the window the operator opens by pressing Enter, composed ON `workingIndicatorState` above rather
// than added as a fourth `ThreadStatus` field. The supersede rules are INHERITED here rather than
// restated: the third branch re-calls the same gate with one field substituted, so there is no second
// place the rule lives. Pure calls, no rendering.
//
// #967 DID take a fourth field, and #650's "that choice is what leaves every status literal standing
// verbatim" no longer holds — every literal in these three blocks gained one `stalled` token. The
// composition itself was right and survives untouched: a LOWER-priority fallback composes on a proven
// gate, while a stall sits in the MIDDLE of the order and could not be expressed that way without
// re-reading the two supersede facts here. See workingIndicatorStateWithLocalSend's own comment.
describe('workingIndicatorStateWithLocalSend — the locally-opened window (#650)', () => {
  it('opens the window at idle while a local send is pending, labelled thinking (AC1)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false }, true)
    ).toBe('thinking')
  })

  it('opens nothing at idle with no local send pending — todays behaviour, unchanged (AC1)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false }, false)
    ).toBeNull()
  })

  it('delegates unchanged wherever the daemon has already opened the window', () => {
    // The daemon's answer wins: for every phase and both pending values, a non-null daemon answer is
    // returned byte-identical, so no daemon-opened case changed behaviour at all.
    for (const phase of ['thinking', 'responding', 'idle'] as const) {
      for (const pending of [true, false]) {
        const status = { phase, apiRetry: null, compacting: false, stalled: false }
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
        { phase: 'responding', apiRetry: null, compacting: false, stalled: false },
        true
      )
    ).toBe('working')
  })

  // #967: these four still prove INHERITANCE — the whole point of writing the third branch as a re-call
  // — and the inheritance got stronger rather than weaker. Through #963 a live retry or compaction made
  // this return null because the same two gate clauses evaluated inside the re-call. Now
  // `workingIndicatorState` answers those two facts with their own LABEL from its first branch, so
  // statement 1 ("the daemon's answer wins") returns it and the re-call is never reached. Either way the
  // supersede rule lives in exactly one place, which is what these assert. AC2 is also visible here: the
  // status shows at `phase: 'idle'`, with no daemon turn running at all.
  it('inherits the retry supersede rule — a live retry outranks a locally-opened window (#967)', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 3, total: 10 }, compacting: false, stalled: false },
        true
      )
    ).toBe('retrying')
  })

  it('inherits it for an unknown-count retry too — presence supersedes, not the counter', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 0, total: 0 }, compacting: false, stalled: false },
        true
      )
    ).toBe('retrying')
  })

  it('inherits the compaction supersede rule too (#967)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: true, stalled: false }, true)
    ).toBe('compacting')
  })

  it('is superseded while both compacting and retrying — retry wins the tie (#967)', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 3, total: 10 }, compacting: true, stalled: false },
        true
      )
    ).toBe('retrying')
  })

  it('lets a stall outrank a locally-opened window too, with no turn running (#967, AC2)', () => {
    // The middle of the order, and the case a wrapper composed on the gate could not have expressed
    // without re-reading `apiRetry` and `compacting` itself — the reason #967 took the fourth field.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: true }, true)
    ).toBe('stalled')
    // And with no local send pending either: the three folded statuses were never gated on a send.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: true }, false)
    ).toBe('stalled')
  })

  it('hands over to the daemon with no label flicker at the seam (AC2)', () => {
    // The local window is labelled exactly what the daemon's first turn_state says, so the moment the
    // daemon takes over is invisible. `working` would have flipped Working → Thinking → Working at the
    // one seam this ticket exists to smooth.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false }, true)
    ).toBe(workingIndicatorState({ phase: 'thinking', apiRetry: null, compacting: false, stalled: false }))
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
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false }, true)
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

  // #951 REWROTE THIS TEST, and the reason is the whole point of the ticket: both glyphs are now the
  // same 28×28 export family, so `viewBox` — this test's original discriminator, asserted as ABSENT from
  // the idle branch — no longer distinguishes anything. The discriminator moves to a substring of each
  // path's own coordinates, and the shared 28×28 becomes an assertion in its own right below.
  it('swaps the glyph with the variant (the two Figma glyphs)', () => {
    const running = renderToStaticMarkup(
      <ComposerSendButton isRunning={true} canSend={true} onSend={noop} onInterrupt={noop} />
    )
    const idle = renderToStaticMarkup(
      <ComposerSendButton isRunning={false} canSend={true} onSend={noop} onInterrupt={noop} />
    )
    // The stop glyph's knocked-out square, and the chevron's first stroke away from the disc. Both are
    // substrings of their own subpath, never the whole `d` — a transcription diff in the disc the two
    // share should not fail a test about which variant rendered.
    expect(running).toContain('M10.5 8.75H17.5')
    expect(running).not.toContain('M20.6172')
    expect(idle).toContain('M20.6172')
    expect(idle).not.toContain('M10.5 8.75H17.5')
  })

  // #951 AC2: the idle control draws `circle-chevron-up-solid-full` at the stop glyph's size. Before this
  // ticket the send branch drew a bare 22px arrow in a 24-unit viewBox, so this is the assertion the
  // redraw exists to satisfy.
  it('draws both glyphs at the design 28×28 (#951)', () => {
    for (const isRunning of [false, true]) {
      const markup = renderToStaticMarkup(
        <ComposerSendButton isRunning={isRunning} canSend={true} onSend={noop} onInterrupt={noop} />
      )
      expect(markup).toContain('viewBox="0 0 28 28"')
      expect(markup).toContain('width="28"')
      expect(markup).toContain('height="28"')
    }
  })

  // The colour is the STYLESHEET's (.composer__send sets --color-primary) and reaches the glyph through
  // currentColor. The Figma export ships the resolved #9DCBFC on its path; inlining that would hardcode
  // one scheme's fallback hex, which is the standing rule this file's CSS states over and over. Static
  // markup cannot see a stylesheet, so what is provable here is the NEGATIVE — no colour of its own —
  // and the positive lives in e2e/composer-message-box.spec.ts.
  it('takes both glyph colours from currentColor, never the export hex (#951)', () => {
    for (const isRunning of [false, true]) {
      const markup = renderToStaticMarkup(
        <ComposerSendButton isRunning={isRunning} canSend={true} onSend={noop} onInterrupt={noop} />
      )
      expect(markup).toContain('fill="currentColor"')
      expect(markup.toLowerCase()).not.toContain('#9dcbfc')
    }
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

// #963: the status row's right-hand slot, now a THREE-way choice — the actionable-error button, the
// #797 chip, or nothing — where #167 had a separate block beneath the composer. ComposerErrorSlot is the
// pure, exported view (the RepairPrompt pattern it replaces, and the ComposerErrorChip pattern it
// delegates to): server-render it directly with an injected `status` to prove the whole matrix, which no
// store-bound container test can do (zustand v5's useStore reads getInitialState() = disconnected under
// server render, so only one arm is reachable there).
//
// Every error-arm assertion here is written in BOTH directions — the expected occupant present AND the
// other absent — because AC1's contract is one occupant per slot, and a one-directional assertion would
// pass on a slot that rendered both.
describe('ComposerErrorSlot — one occupant per slot (#963)', () => {
  const ack = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it('renders the actionable button and NOT the chip for a terminal, non-retryable error (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot
        status={{ type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }}
        onRepair={() => {}}
      />
    )
    expect(markup).toContain(`>${COMPOSER_REPAIR_BUTTON_COPY}</button>`)
    expect(markup).not.toContain('composer-status__error')
    expect(markup).not.toContain(COMPOSER_ERROR_CHIP_COPY)
  })

  // #167's AC4, preserved verbatim through the swap: a RETRYABLE daemon error is a transient
  // daemon-side condition, not a broken pairing, so it gets the plain chip and is never offered a
  // re-pair. shouldOfferRepair's `!retryable` gate is what makes this arm fall through to the chip.
  it('renders the chip and NOT the button for a retryable daemon error (AC1, #167 AC4)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot
        status={{
          type: 'error',
          error: { code: 'server.binary_offline', message: 'offline', retryable: true }
        }}
        onRepair={() => {}}
      />
    )
    expect(markup).toContain('composer-status__error')
    expect(markup).toContain(COMPOSER_ERROR_CHIP_COPY)
    expect(markup).not.toContain(COMPOSER_REPAIR_BUTTON_COPY)
  })

  // #167's AC5, likewise preserved: the self-inflicted UNPAIR_FAILED_ERROR that runUnpair dispatches
  // when the clear itself fails. Without shouldOfferRepair's `code !== 'unpair'` gate a failed re-pair
  // would immediately re-offer itself — a tight loop of a broken capability — so this arm must show the
  // chip even though it is terminal and non-retryable.
  it('renders the chip and NOT the button after a failed unpair (AC1, #167 AC5)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot
        status={{
          type: 'error',
          error: { code: 'unpair', message: 'Could not forget this pairing.', retryable: false }
        }}
        onRepair={() => {}}
      />
    )
    expect(markup).toContain('composer-status__error')
    expect(markup).not.toContain(COMPOSER_REPAIR_BUTTON_COPY)
  })

  // AC1's empty half, in the STRICT exact-empty form the ComposerErrorChip describe below uses: that is
  // what proves "the slot is empty, not an empty element", which a not.toContain would pass on a
  // rendered-but-empty wrapper.
  it('renders nothing at all while disconnected — not an empty element (AC1)', () => {
    expect(
      renderToStaticMarkup(<ComposerErrorSlot status={{ type: 'disconnected' }} onRepair={() => {}} />)
    ).toBe('')
  })

  it('renders nothing at all while connecting — not an empty element (AC1)', () => {
    expect(
      renderToStaticMarkup(<ComposerErrorSlot status={{ type: 'connecting' }} onRepair={() => {}} />)
    ).toBe('')
  })

  it('renders nothing at all while connected — not an empty element (AC1)', () => {
    expect(
      renderToStaticMarkup(<ComposerErrorSlot status={{ type: 'connected', ack }} onRepair={() => {}} />)
    ).toBe('')
  })

  // AC4, and the one assertion this view needs that the chip's own describe cannot supply. Unlike
  // ComposerErrorChip — which narrows on `status.type` and never touches the error arm at all — this
  // view calls shouldOfferRepair, which READS `status.error.retryable` and `.code`. Those two reads are
  // one line away from a value a future edit could render, so the guarantee is pinned rather than
  // argued: on the arm that reads them, neither sentinel reaches the markup.
  it('never renders ConnectionError.message or .code on the button arm (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot
        status={{
          type: 'error',
          error: { code: 'DAEMON_SECRET_CODE', message: 'DAEMON_SECRET_DETAIL', retryable: false }
        }}
        onRepair={() => {}}
      />
    )
    expect(markup).toContain(COMPOSER_REPAIR_BUTTON_COPY)
    expect(markup).not.toContain('DAEMON_SECRET_DETAIL')
    expect(markup).not.toContain('DAEMON_SECRET_CODE')
  })

  // AC4's accessible-name half: the visible text IS the name, so there is no aria-label to drift from
  // it and no hidden prefix — the label says "Pairing error" itself, which is exactly why the chip's
  // visually-hidden `Error: ` run is not carried over to this occupant.
  it('takes its accessible name from the visible text — no aria-label, no hidden prefix (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot
        status={{ type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }}
        onRepair={() => {}}
      />
    )
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('composer-status__error-prefix')
    expect(markup).not.toContain(COMPOSER_ERROR_CHIP_PREFIX_COPY.trim())
  })

  // The button wears the shared small-button base class plus its Error variant — the treatment the
  // question panel's three buttons wear too. A static render is the only place the class pair is
  // observable, and the variant is what carries the fill, so a base class alone would ship an unstyled
  // transparent button that every other assertion here would still pass.
  it('wears the shared small-button base class and its error variant (AC3)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot
        status={{ type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }}
        onRepair={() => {}}
      />
    )
    expect(markup).toContain('button-small')
    expect(markup).toContain('button-small--error')
    // A real <button>, not a div wearing a click handler — the accessible name, the focus ring AC3
    // requires and keyboard activation all come from the element, not from the class.
    expect(markup).toContain('<button')
    expect(markup).toContain('type="button"')
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
})

// #797: the connection-error chip in the composer status row — the FOURTH read of the ConnectionStatus
// slice (beside the composer gate, the re-pair prompt and the banner), and the narrowest: it reads the
// discriminant to decide whether to show and nothing out of the `error` arm at all. ComposerErrorChip is
// the pure, exported view (the ConnectionBanner pattern), so the whole four-arm matrix is proven by
// server-rendering it with an injected `status` and no store. The mounted, store-bound path is proven in
// the ConversationScreen container block below, which is the only place the `trailing` wiring is visible.
describe('ComposerErrorChip — the connection-error chip in the status row (#797)', () => {
  const ack = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it('renders the client-owned copy in the error arm (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorChip
        status={{ type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }}
      />
    )
    expect(markup).toContain('composer-status__error')
    expect(markup).toContain(COMPOSER_ERROR_CHIP_COPY)
  })

  // AC1's absent half, in the STRICT form: an exact-empty markup, not a not.toContain. That is what
  // proves "nothing is rendered in that slot — not an empty element", which a substring assertion would
  // pass on a rendered-but-empty wrapper.
  it('renders nothing at all while disconnected — not an empty element (AC1)', () => {
    expect(renderToStaticMarkup(<ComposerErrorChip status={{ type: 'disconnected' }} />)).toBe('')
  })

  it('renders nothing at all while connecting — not an empty element (AC1)', () => {
    expect(renderToStaticMarkup(<ComposerErrorChip status={{ type: 'connecting' }} />)).toBe('')
  })

  it('renders nothing at all while connected — not an empty element (AC1)', () => {
    expect(renderToStaticMarkup(<ComposerErrorChip status={{ type: 'connected', ack }} />)).toBe('')
  })

  // AC2: the chip's text is the client-owned constant only. TWO sentinels, not the banner test's one —
  // the AC names `message` AND `code`, and neither may reach the DOM as text, in an attribute, or in a
  // title. A structural guarantee, not a convention: the view narrows on `status.type` and never
  // destructures `status.error`, so there is no rendering path for either field.
  it('never renders ConnectionError.message or .code — only the client-owned copy (AC2)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorChip
        status={{
          type: 'error',
          error: { code: 'DAEMON_SECRET_CODE', message: 'DAEMON_SECRET_DETAIL', retryable: false }
        }}
      />
    )
    expect(markup).toContain(COMPOSER_ERROR_CHIP_COPY)
    expect(markup).not.toContain('DAEMON_SECRET_DETAIL')
    expect(markup).not.toContain('DAEMON_SECRET_CODE')
  })

  // AC4: colour is not the only signal. The marking is hidden TEXT, not an aria-label — a bare <div>/
  // <span> maps to role="generic", which ARIA 1.2 puts on the name-prohibited list, so an aria-label
  // would assert green here and be dropped by a real screen reader. Ordering matters: the prefix run
  // precedes the visible copy, so the two concatenate into "Error: Host connection down!".
  it('marks the chip as an error with hidden text ahead of the copy (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorChip
        status={{ type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }}
      />
    )
    expect(markup).toContain('composer-status__error-prefix')
    expect(markup).toContain(COMPOSER_ERROR_CHIP_PREFIX_COPY.trim())
    // The index idiom (WelcomeScreen.test.tsx:36-41) — a static markup string carries no tree to query.
    const prefixAt = markup.indexOf('composer-status__error-prefix')
    const copyAt = markup.indexOf(COMPOSER_ERROR_CHIP_COPY)
    expect(prefixAt).toBeGreaterThanOrEqual(0)
    expect(copyAt).toBeGreaterThan(prefixAt)
  })

  // The chip is NOT a live region. shouldShowBanner is true on the `error` arm, so a connected → error
  // transition mounts the banner and this chip in the same commit; a second polite region here would
  // announce one fact twice — the ConnectionStatusIndicator ruling, restated one component over.
  it('is not a live region — the banner already announces the disconnect', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorChip
        status={{ type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }}
      />
    )
    expect(markup).not.toContain('aria-live')
    expect(markup).not.toContain('role="status"')
    expect(markup).not.toContain('role="alert"')
  })
})

// #811: the context-window reading, first occupant of the new composer footer row (Figma 110:3497).
// ContextUsageReading is the pure, exported view (the ComposerErrorChip pattern), so the whole
// present/absent matrix is proven by server-rendering it with injected figures and no store. The
// arithmetic itself lives in contextUsage.test.ts; what these prove is the MARKUP — that the reading is
// a reading and not a control, and that its absent arm renders nothing at all.
describe('ContextUsageReading — the composer footer’s context percentage (#811)', () => {
  // An EXACT markup assertion, not a toContain, and deliberately so: AC3 ("it is a reading, not a
  // control: no click handler, not focusable") is structural in a string this short — no onclick, no
  // tabindex, no role, no href, no <button> and nothing else can hide in it. Do not relax this to a
  // substring check; the exactness IS the assertion.
  it('renders the percentage as a single bare text run — no handler, no tabindex, no role (AC1, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={146000} windowTokens={200000} />
    )
    expect(markup).toBe('<span class="composer__context">Context: 73%</span>')
  })

  // AC2's whole surface, in the STRICT form the ComposerErrorChip describe above uses: an exact-empty
  // markup, not a not.toContain. That is what proves "not an empty element holding the slot either" —
  // a substring assertion would pass on a rendered-but-empty <span>.
  it('renders nothing at all when the window count is 0 — not an empty element (AC2)', () => {
    expect(renderToStaticMarkup(<ContextUsageReading usedTokens={146000} windowTokens={0} />)).toBe('')
  })

  // The two absent states the store can produce collapse into one path: the container coalesces a
  // not-yet-loaded `snapshot === null` to 0, which is the same value the daemon sends for "usage
  // unavailable". Neither divides, and neither leaves a misleading reading behind.
  it('renders no misleading 0% and no Infinity% on an absent window (AC2)', () => {
    const markup = renderToStaticMarkup(<ContextUsageReading usedTokens={0} windowTokens={0} />)
    expect(markup).not.toContain('Context:')
    expect(markup).not.toContain('0%')
    expect(markup).not.toContain('Infinity')
    expect(markup).not.toContain('NaN')
  })

  it('clamps an over-full session to 100% rather than running past it', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={250000} windowTokens={200000} />
    )
    expect(markup).toContain('Context: 100%')
    expect(markup).not.toContain('Infinity')
  })

  // The reading is NOT a live region. After #810 the figures refresh on every connect and every turn
  // end, so a polite region here would announce a percentage after every single turn — the
  // ComposerErrorChip ruling, and stronger here because the update cadence is the turn itself.
  it('is not a live region — the figure re-renders on every turn end', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={168000} windowTokens={200000} />
    )
    expect(markup).not.toContain('aria-live')
    expect(markup).not.toContain('role="status"')
  })
})

// #330: the two-dot Relay/Pyrycode connection-status mappings. relayLeg / daemonLeg are the exported
// pure leg-mapping predicates (the isTurnRunning shape) — call them directly with each store value to
// prove the full leg → category → label matrix with no store, no render.
//
// #962 retired the VIEW half of #330 with the status row that hosted it, so the two describes below are
// what is left of this ticket in this file: the `ConnectionStatusIndicator` matrix describe and the
// container's at-rest two-dot assertion both went with the component. Neither mapping moved and no
// coverage of them is lost. The category → dot-class rendering is still proven at the unit tier on the
// sidebar's surviving view — `ChannelList.test.tsx`'s four `DOT_*_MARKER` constants pin exactly the four
// modifier classes these mappings emit — and the four classes' shipped COLOURS, which no node-environment
// render can see, are read back from the stylesheet in `e2e/connection-dot-colours.spec.ts`.
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
describe('ThreadOverflowMenuView — the thread overflow menu (#276, #962)', () => {
  const noop = (): void => {}
  const openMenu = (): string =>
    renderToStaticMarkup(
      <ThreadOverflowMenuView
        open={true}
        onToggle={noop}
        onSelectChannelInfo={noop}
        onSelectRunConfiguration={noop}
        onSelectBackgroundTasks={noop}
      />
    )

  it('renders a collapsed icon-only trigger advertising a menu popup, no surface (AC1/AC2)', () => {
    const markup = renderToStaticMarkup(
      <ThreadOverflowMenuView
        open={false}
        onToggle={noop}
        onSelectChannelInfo={noop}
        onSelectRunConfiguration={noop}
        onSelectBackgroundTasks={noop}
      />
    )
    // The icon-only trigger: a client-owned accessible name, the haspopup=menu affordance, and the
    // collapsed state (React stringifies aria booleans under renderToStaticMarkup → "false").
    expect(markup).toContain('aria-label="More actions"')
    expect(markup).toContain('aria-haspopup="menu"')
    expect(markup).toContain('aria-expanded="false"')
    // Closed: the menu surface is not rendered, and none of the three items' copy is on screen.
    expect(markup).not.toContain('role="menu"')
    expect(markup).not.toContain('Channel info')
    expect(markup).not.toContain('Run configuration')
    expect(markup).not.toContain('Background tasks')
  })

  // #962 AC2. This describe is the ONLY surface that can see the shipped copy and the shipped order:
  // the container is in-file, the screen gates the menu on `onBack`, and the `node` env fires no
  // clicks — so a bare `<ConversationScreen />` can never open the menu. The two new labels are also
  // the accessible names four e2e opens locate by, which is why they are literals in the view rather
  // than data the container injects: a typo has to redden a unit assertion, not just time out a drive.
  it('exposes three menuitems — Channel info, Run configuration, Background tasks (AC2)', () => {
    const markup = openMenu()
    // The trigger now advertises the expanded state…
    expect(markup).toContain('aria-expanded="true"')
    // …and the menu surface exposes role=menu with one menuitem per action. A menuitem's accessible
    // name is its CONTENT, so the two retired triggers' aria-labels land here as text, not attributes.
    expect(markup).toContain('role="menu"')
    expect(markup).toContain('Channel info')
    expect(markup).toContain('Run configuration')
    expect(markup).toContain('Background tasks')
    // Exactly three: a fourth item, or an item that lost its role, fails here.
    expect(markup.split('role="menuitem"').length - 1).toBe(3)
  })

  // AC2's ordering, stated as document order. Channel info keeps the first slot it has held since
  // #276; the two new items follow it in the order the ticket fixes.
  it('orders the items Channel info, then Run configuration, then Background tasks (AC2)', () => {
    const markup = openMenu()
    expect(markup.indexOf('Channel info')).toBeLessThan(markup.indexOf('Run configuration'))
    expect(markup.indexOf('Run configuration')).toBeLessThan(markup.indexOf('Background tasks'))
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

  // #797: the chip's absent arm through the mounted container. The beforeEach leaves the session store
  // `disconnected`, which is NOT the error arm, so the reserved slot stays empty in the shipped tree.
  it('mounts the status row with no error chip while disconnected (AC1)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('class="composer-status"')
    expect(markup).not.toContain('composer-status__error')
    expect(markup).not.toContain(COMPOSER_ERROR_CHIP_COPY)
  })

  // #797: the chip's PRESENT arm through the mounted container — the only test that proves the
  // `trailing` prop at the ComposerStatusArea mount actually reached the row. Without it an unwired prop
  // passes every pure-view assertion above.
  //
  // A getInitialState SPY, not setState. This file's standing note applies here — zustand v5's useStore
  // reads getInitialState() under renderToStaticMarkup, never getState() — so the block's beforeEach
  // cannot stage a non-initial arm, and this branch would otherwise be unreachable (the spec assumed the
  // beforeEach was enough; it is not, measured 2026-08-27). Spying the store's initial snapshot is the
  // narrowest seam that reaches it: one store, one render, no production code touched, restored
  // immediately since this config sets no restoreMocks.
  //
  // #963 REPOINTED THE STAGED STATUS, and the test would otherwise have gone red rather than vacuous. It
  // staged `code: 'transport', retryable: false` — which is precisely the arm shouldOfferRepair admits, so
  // the slot now fills it with the actionable button and the chip is correctly absent. The chip's own
  // mounted arm is a RETRYABLE daemon error (#167's AC4: transient, not a broken pairing), so that is what
  // this stages now. The claim is unchanged — the `trailing` prop reaches the row with the chip in it —
  // and the button's mounted arm is proven by its own test below.
  it('mounts the error chip in the status row once the session is in a retryable error arm (AC1)', () => {
    const initial = sessionStore.getInitialState()
    const spy = vi.spyOn(sessionStore, 'getInitialState').mockReturnValue({
      ...initial,
      status: {
        type: 'error',
        error: { code: 'server.binary_offline', message: 'offline', retryable: true }
      }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup).toContain('composer-status__error')
      expect(markup).toContain(COMPOSER_ERROR_CHIP_COPY)
      // In the ROW, not loose in the region: the chip trails .composer-status in the shipped tree.
      expect(markup.indexOf('composer-status__error')).toBeGreaterThan(
        markup.indexOf('class="composer-status"')
      )
    } finally {
      spy.mockRestore()
    }
  })

  // #963: the actionable button's PRESENT arm through the mounted container — the only test that proves
  // the slot control reached the row's `trailing` prop with a working `onRepair`, and the only one that
  // can prove `.composer__repair` is gone from the tree in the very state that used to render it.
  //
  // The same getInitialState SPY as the chip test above, and for the same reason: zustand v5's useStore
  // reads getInitialState() under renderToStaticMarkup, never getState(), so the block's beforeEach
  // cannot stage this arm. The status here differs from the chip test's only in being one shouldOfferRepair
  // admits — terminal, non-retryable, and not the self-inflicted 'unpair' code — which is what flips the
  // slot's occupant.
  it('mounts the actionable button in the status row once the pairing is terminally dead (AC1, AC2)', () => {
    const initial = sessionStore.getInitialState()
    const spy = vi.spyOn(sessionStore, 'getInitialState').mockReturnValue({
      ...initial,
      status: { type: 'error', error: { code: 'transport', message: 'gave up', retryable: false } }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup).toContain(COMPOSER_REPAIR_BUTTON_COPY)
      // In the ROW, not loose in the region: the button trails .composer-status in the shipped tree.
      expect(markup.indexOf(COMPOSER_REPAIR_BUTTON_COPY)).toBeGreaterThan(
        markup.indexOf('class="composer-status"')
      )
      // One occupant per slot, asserted through the mount and not only in the pure view (AC1).
      expect(markup).not.toContain('composer-status__error')
      expect(markup).not.toContain(COMPOSER_ERROR_CHIP_COPY)
      // AC2: the retired block is absent in the exact state that used to render it.
      expect(markup).not.toContain('composer__repair')
    } finally {
      spy.mockRestore()
    }
  })

  // #811: the composer footer row is the second thing in this region that mounts UNCONDITIONALLY. It
  // holds its own height with nothing inside it, which is what keeps the message box from moving when
  // the reading appears and disappears (AC4) — the .composer-status guarantee, one row lower. Against
  // the initial run-config store (snapshot: null → windowTokens: 0) there is no reading to hold.
  it('mounts the composer footer row with no reading against the empty run-config store (AC2, AC4)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('class="composer__footer"')
    expect(markup).not.toContain('composer__context')
    expect(markup).not.toContain('Context:')
  })

  // The design's DOM order: the footer sits BELOW the message box, not above it. Cheap insurance
  // against the row being dropped in at the wrong end of the composer column.
  it('places the footer row after the message-box row (Figma 110:3494)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    const rowAt = markup.indexOf('class="composer__row"')
    const footerAt = markup.indexOf('class="composer__footer"')
    expect(rowAt).toBeGreaterThanOrEqual(0)
    expect(footerAt).toBeGreaterThan(rowAt)
  })

  // #680: the Actions menu's mount site. Every assertion in ComposerActionsMenu.test.tsx passes on an
  // UNMOUNTED component, so these two are the only proof the control is actually wired into the footer.
  //
  // They render against a DISCONNECTED session — this block's beforeEach leaves it there, and zustand v5
  // reads getInitialState() under renderToStaticMarkup anyway (the standing note at :2972-2977). That is
  // convenient rather than limiting: it also pins AC4's static half, that the trigger renders ENABLED
  // while the composer cannot send. Picking sends nothing because `sendText`'s first line is the canSend
  // gate, not because the menu is unopenable.
  it('mounts the Actions trigger in the footer row, closed and enabled while disconnected (AC1, AC4)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    const footerAt = markup.indexOf('class="composer__footer"')
    const triggerAt = markup.indexOf('class="composer__actions"')
    expect(footerAt).toBeGreaterThanOrEqual(0)
    expect(triggerAt).toBeGreaterThan(footerAt)
    expect(markup).toContain(COMPOSER_ACTIONS_LABEL)
    // Closed at mount: aria-expanded="false" and no panel in the tree.
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).not.toContain('composer-options__item')
    // Enabled: the trigger's own tag carries no `disabled`, unlike the send control one row up.
    const triggerTag = markup.match(/<button[^>]*class="composer__actions"[^>]*>/)?.[0] ?? ''
    expect(triggerTag).not.toContain('disabled')
  })

  // The design's item order: Actions is the footer's leftmost control (Figma 110:3494, x=0), ahead of the
  // context reading. The container smoke renders against the initial run-config store, where the reading
  // is ABSENT — so the comparison is against the row's own opening tag, not against composer__context.
  it('places the Actions trigger first in the footer row (Figma 115:3677 at x=0)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    const anchorAt = markup.indexOf('class="composer-options-anchor"')
    const footerAt = markup.indexOf('class="composer__footer"')
    expect(anchorAt).toBeGreaterThan(footerAt)
    // Nothing of the footer's own between the row's tag and the anchor: the anchor opens the row.
    expect(markup.slice(footerAt, anchorAt)).not.toContain('composer__context')
  })

  // #811: the reading's PRESENT arm through the mounted container — the only test that proves
  // ContextUsageControl is actually wired into the row. An unwired control passes every pure-view
  // assertion above.
  //
  // A getInitialState SPY, not setState — the standing note at the #797 test above applies verbatim:
  // zustand v5's useStore reads getInitialState() under renderToStaticMarkup, never getState(), so a
  // setState before the render is invisible (measured 2026-08-27, #797). Restored in a finally since
  // this config sets no restoreMocks.
  it('mounts the reading inside the footer row once the snapshot carries real figures (AC1)', () => {
    const initial = runConfigStore.getInitialState()
    const spy = vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({
      ...initial,
      snapshot: { model: '', effort: '', yolo: false, usedTokens: 168000, windowTokens: 200000 }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup).toContain('Context: 84%')
      // In the ROW, not loose in the composer: the reading follows .composer__footer's opening tag.
      expect(markup.indexOf('composer__context')).toBeGreaterThan(
        markup.indexOf('class="composer__footer"')
      )
    } finally {
      spy.mockRestore()
    }
  })

  // #967: the three inert-render smoke tests that stood here — one each for #317's stall, #493's retry
  // and #496's compaction block — are GONE, and their coverage is subsumed rather than dropped. All three
  // asserted that a status renders nothing against the initial timeline store; the three regions they
  // named no longer exist, and the row's own smoke test at the top of this block already asserts no
  // `conversation__thinking` and no `composer-status__label` against that same store, which is the same
  // "nothing renders at rest" claim for all four states at once. Re-pointing them at the label would have
  // produced three byte-identical copies of that one assertion. The four showing paths are proven on the
  // pure ThinkingIndicator describe above, where they always were — every container test renders the
  // initial store (zustand v5 reads getInitialState() under server render), so no container render can
  // reach a folded state at all.

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

  // #963: the re-pair affordance is absent in the disconnected initial state — shouldOfferRepair is
  // false, so the slot renders nothing. The populated branch is proven in the ComposerErrorSlot
  // pure-view describe above and, through the mount, in the spied container test earlier in this block.
  //
  // The second assertion is AC2's other half and it is the one that can only be made HERE: #167's
  // `.composer__repair` block beneath the composer is gone from the tree, not merely emptied. A pure
  // view cannot prove the absence of a sibling it never rendered.
  it('does not render the re-pair affordance or its retired block while disconnected', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain(COMPOSER_REPAIR_BUTTON_COPY)
    expect(markup).not.toContain('composer__repair')
  })

  // #31: while not connected the send control is disabled. (It also used to show an inline "why" caption
  // beside it; #968 retired that, and the test below pins its absence.) The initial store state is
  // `disconnected`, and zustand v5's useStore reads
  // getInitialState() under server rendering (never setState), so this container smoke test always
  // sees the disconnected branch. The connected/enabled branch is therefore NOT smoke-testable here
  // — it is covered by the composerAvailability(connected) pure test in composerSend.test.ts.
  it('disables the send control while the session is not connected', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    const sendButtonTag = markup.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''
    expect(sendButtonTag).toContain('disabled')
  })

  // #968: no connection caption sits above the message box in any state. `disconnected` is the only arm
  // a container render can reach (zustand's server snapshot is the state captured at creation) and it is
  // the arm the caption used to show in, so this render is the one that could still carry it. The other
  // three arms are covered structurally by composerSend.test.ts's exact-`toEqual` matrix: a gate that
  // returns no string cannot render one. Asserting on the CLASS rather than on the retired copy keeps the
  // three literals out of the file AC4's own grep reads.
  it('renders no connection caption above the message box (#968)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('composer__hint')
  })

  // #279: the connection banner mounts against the initial (disconnected) store — unlike the re-pair
  // affordance, disconnected is a VISIBLE branch, so ConnectionBannerControl's visible path IS reachable
  // under server render. It appears at the top of the thread, carrying its client-owned copy, and no
  // daemon string reaches it (there is none at the initial disconnected status). Since #968 it is the
  // ONLY thing said about the connection in this arm, which is why its presence here matters more than
  // it did when the composer's caption said it a second time.
  it('renders the connection banner while disconnected (AC1/AC4)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('conversation__banner')
    expect(markup).toContain(CONNECTION_BANNER_COPY)
  })

  it('renders the banner above the message thread and below the header (top of the thread)', () => {
    // The banner mounts between UnpairControl (the header row) and the timeline surface, so its markup
    // precedes the thread's empty state.
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup.indexOf('conversation__banner')).toBeLessThan(markup.indexOf('conversation__empty'))
  })

  // #962 AC1: the region between the thread and the composer is EMPTY. The desktop drawing (102:4)
  // stacks the message area straight onto the input area, so the mobile run-configuration row (#177)
  // and the background-task trigger (#581) are both gone; their overlays are reached from the overflow
  // menu instead, and the sheet's own controls now live in the input footer (#682/#683/#811).
  //
  // Keyed on the CLASS and ATTRIBUTE forms, never on the bare label strings: `Run configuration` and
  // `Background tasks` are legitimately present elsewhere in this file (the menu describe's items,
  // StatusSheet's title), so a bare-string negative would be both wrong here and self-defeating there.
  // The row also took the two-dot indicator with it — the sidebar host row has carried the connection
  // dots since #718, and the four colour bindings moved to channels.css rather than dying with it.
  it('renders nothing between the thread and the composer — no status row, no task trigger (AC1)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('status-row')
    expect(markup).not.toContain('background-task-trigger')
    expect(markup).not.toContain('aria-label="Run configuration"')
    expect(markup).not.toContain('aria-label="Background tasks"')
    // The indicator went with the row; nothing on this screen paints a connection dot any more.
    expect(markup).not.toContain('conn-dot')
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
    // Only the thread's menu popup must be absent here. #680 mounted the footer's Actions trigger, which
    // legitimately advertises aria-haspopup="menu" — so the bare absence check this line used to make is
    // no longer the right proxy. (StatusRow used to carry the region's only aria-haspopup="dialog" and
    // was the other half of this note; #962 retired it, which changes nothing about the count below —
    // it was never one of the menu popups.) Pinned as a COUNT instead, and
    // pinned to the composer's trigger: a second menu popup appearing in the bare tree still fails here,
    // which is the guard #276 wanted.
    expect(markup.split('aria-haspopup="menu"').length - 1).toBe(1)
    expect(markup).toContain('class="composer__actions" aria-haspopup="menu"')
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
