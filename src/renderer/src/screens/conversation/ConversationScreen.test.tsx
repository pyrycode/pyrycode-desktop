import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ConversationScreen,
  SavedTimelineNotice,
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
  RESETTING_COPY,
  RESETTING_WRAPPING_UP_COPY,
  RESETTING_RESTARTING_COPY,
  HANDOFF_WRITTEN_COPY,
  HANDOFF_SKIPPED_COPY,
  UNRECOGNIZED_COPY,
  UNRECOGNIZED_TRUNCATED_COPY,
  unrecognizedSiteLabel,
  ToolRow,
  TOOL_RESULT_EMPTY_COPY,
  shouldShowThinking,
  StatusSheet,
  ComposerErrorSlot,
  ComposerTaskCount,
  ComposerUsageLimitNotice,
  ConnectionBanner,
  ComposerErrorChip,
  ContextUsageReading,
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
import { PERMISSION_MODE_LABELS } from './ComposerPermissionModeMenu'
import { COMPOSER_ATTACH_LABEL } from './ComposerAttach'
import { createConversationTimelineStore, conversationTimelineStore } from '../../store/conversationTimelineStore'
import {
  CONNECTION_BANNER_COPY,
  COMPOSER_ERROR_CHIP_COPY,
  COMPOSER_ERROR_CHIP_PREFIX_COPY,
  COMPOSER_REPAIR_BUTTON_COPY,
  COMPOSER_RECONNECT_BUTTON_COPY
} from './composerSend'
import {
  USAGE_LIMIT_EXHAUSTED_COPY,
  USAGE_LIMIT_WARNING_COPY
} from './usageLimitNotice'
import type { UsageLimitReading } from '../../store/usageLimitStore'
import type { ConnectionStatus } from '../../store/sessionStore'
import type { Message } from './messageViewModel'
import type { ThreadItem, ToolResult } from '../../store/threadTimeline'
import type { QueuedItem, ConversationCreatedPayload } from '@shared/wire/types'
import { sessionStore } from '../../store/sessionStore'
import { activeConversationStore } from '../../store/activeConversationStore'
import { conversationListStore } from '../../store/conversationListStore'
import { sessionIdStore } from '../../store/sessionIdStore'
import { runConfigStore } from '../../store/runConfigStore'
import { reportedContextStore } from '../../store/reportedContextStore'
import { runSettingsWriteStore } from '../../store/runSettingsWriteStore'
import { queueStore } from '../../store/queueStore'

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

// #1421: seed the run-config snapshot's token pair alone, leaving its other fields at their empty
// defaults — the reading's two consumers read nothing else off it. A getInitialState spy, for the standing
// reason: zustand v5 reads getInitialState() under renderToStaticMarkup, so a setState seed is invisible.
function seedRunConfigTokens(usedTokens: number, windowTokens: number): MockInstance {
  const initial = runConfigStore.getInitialState()
  return vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({
    ...initial,
    snapshot: { model: '', effort: '', yolo: false, permissionMode: 'default', usedTokens, windowTokens }
  })
}

// #1421: seed ONE conversation's reported reading. The eight fields beyond the token pair are filled with
// the empty-but-present values the daemon's own degenerate frame carries — this ticket reads none of them,
// and building the record whole is what keeps the seed a real ReportedContextReading rather than a cast.
function seedReportedContext(
  conversationId: string,
  tokens: { totalTokens: number; maxTokens: number }
): MockInstance {
  const initial = reportedContextStore.getInitialState()
  return vi.spyOn(reportedContextStore, 'getInitialState').mockReturnValue({
    ...initial,
    readings: new Map([
      [
        conversationId,
        {
          model: '',
          totalTokens: tokens.totalTokens,
          maxTokens: tokens.maxTokens,
          // Deliberately disagreeing with the token pair: #1421 recomputes from the pair and must never
          // display this field, so a surface that read it would show 1% and fail every assertion below.
          percentage: 1,
          categories: [],
          droppedCategories: 0,
          mcpTools: [],
          droppedMcpTools: 0,
          memoryFiles: [],
          droppedMemoryFiles: 0
        }
      ]
    ])
  })
}

function stageOpenConnection(status: ConnectionStatus): () => void {
  const active = { id: 'open', name: 'Open chat', cwd: '/workspace', is_promoted: false,
    last_used_at: '2026-09-12T00:00:00Z', workspace_label: null }
  const session = vi.spyOn(sessionStore, 'getInitialState').mockReturnValue({
    ...sessionStore.getInitialState(), status: { type: 'connecting' },
    statuses: new Map([['host', status]])
  })
  const open = vi.spyOn(activeConversationStore, 'getInitialState').mockReturnValue({
    ...activeConversationStore.getInitialState(), activeConversation: active
  })
  const list = vi.spyOn(conversationListStore, 'getInitialState').mockReturnValue({
    ...conversationListStore.getInitialState(), conversations: [{ ...active,
      serverId: 'host', is_archived: false, last_message_ts: active.last_used_at }]
  })
  return () => { session.mockRestore(); open.mockRestore(); list.mockRestore() }
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

// The Actions trigger's rendered `class` attribute, as one whole run. #988 lifted the shared
// footer-button treatment out of .composer__actions, so the trigger wears a two-class mix; three
// assertions in the footer block below pin that exact run, and one constant is what keeps them from
// drifting apart one at a time.
const ACTIONS_TRIGGER_CLASS_RUN = 'class="composer__footer-button composer__actions"'

// #863: the attach trigger's rendered `class` attribute, on the same terms and for the same reason — it
// wears the shared footer treatment as a two-class mix, and the mount proofs below locate it by that whole
// run rather than by a bare class.
const ATTACH_TRIGGER_CLASS_RUN = 'class="composer__footer-button composer__attach"'

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

  it('leaves no wrapper element of ANY name around an empty field list (#1103 AC3)', () => {
    // #1103 draws the design's two intra-body rhythms — 12px between the body's blocks, 8px between
    // consecutive fields. Figma gets the tighter one from a `Fields` frame nested inside `Body`, and the
    // obvious way to reproduce that is a .tool-row__fields wrapper. It was declined: a wrapper needs a
    // `.length > 0` guard, which turns "an absent, empty or fully carved-out map draws no field list AND
    // no empty container" from a structural fact back into a second condition that can drift. The
    // distances come from .tool-row__body's gap plus an adjacent-sibling correction instead.
    //
    // THE THREE ASSERTIONS THAT ALREADY POLICE THIS CANNOT CATCH THAT MISTAKE. All three (here, in the
    // absent-map case, and in #780's fully-carved-out shell case) are
    // `not.toContain('tool-row__input')` — a substring check on ONE class name, which a wrapper named
    // `tool-row__fields`, `tool-row__field-list` or anything else walks straight past while stranding an
    // empty container on screen, all three still green.
    //
    // So this pins the body's WHOLE subtree as one contiguous byte run rather than naming a class the
    // decision declined to mint. Any introduced element reddens it whatever it is called, and no banned
    // name has to be typed into the file to make that true.
    const markup = renderToStaticMarkup(
      <ToolRow item={toolItem({ isError: false, resultSummary: '184 lines' }, {})} defaultExpanded />
    )
    expect(markup).toContain(
      '<div class="tool-row__body"><pre class="tool-row__result">184 lines</pre></div>'
    )
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

  it('shares base chrome with message fences and keeps copying message-only (AC5)', () => {
    // Both surfaces keep the code-block and code-block__body classes for shared styling.
    // Message fences additionally carry the copy modifier and control; Bash commands do not.
    const row = renderToStaticMarkup(
      <ToolRow
        item={toolItem({ isError: false, resultSummary: '184 lines' }, { command: 'ls -la' }, 'Bash')}
        defaultExpanded
      />
    )
    const fence = renderToStaticMarkup(<AssistantMarkdown text={'```\nls -la\n```'} />)
    expect(row).toContain(CODE_BLOCK)
    expect(fence).toContain('<div class="code-block code-block--copyable"><pre class="code-block__body">')
    expect(fence).toContain('<button type="button" class="code-block__copy" aria-label="Copy code">')
    expect(row).not.toContain('code-block--copyable')
    expect(row).not.toContain('aria-label="Copy code"')
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
      <ThinkingIndicator state="thinking" toolName={null} retry={null} resetting={null} thinkingTokens={null} />
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
    expect(markup.match(/tabindex/g)).toHaveLength(1)
    expect(markup).toContain('class="conversation__thread" aria-label="Conversation history" tabindex="0"')
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

  // #1214 re-pointed this off the deleted QueuedBacklog onto the merged row, keeping the assertion's
  // subject exactly: a message the daemon reports queued still draws no meta row. That is now this
  // ticket's own ruling as much as #969's — the row is the timeline's own item and DOES carry a
  // createdAt, and the meta row is suppressed anyway, because a queued message has not been delivered
  // and because its unmatched sibling (synthesized from a wire item) has no time to show either.
  it('draws NO meta row while a row is queued — it has no delivery time and nothing sent yet to copy', () => {
    const markup = renderToStaticMarkup(
      <Timeline
        items={[{ kind: 'userText', text: 'waiting to send', messageId: 'm1', createdAt: 1768312500000 }]}
        queued={[{ queued_msg_id: 1, text: 'waiting to send', ts: '2026-07-12T00:00:00Z', message_id: 'm1' }]}
      />
    )
    // It DOES take the new geometry — same .bubble and .bubble--user, restyled by CSS alone.
    expect(markup).toContain('bubble bubble--user')
    expect(markup).toContain('data-thread-role="queued"')
    expect(markup).not.toContain(META)
    expect(markup).not.toContain(COPY)
    // …and the SAME item, once the daemon stops reporting it queued, draws the meta row it always did.
    const delivered = renderToStaticMarkup(
      <Timeline
        items={[{ kind: 'userText', text: 'waiting to send', messageId: 'm1', createdAt: 1768312500000 }]}
      />
    )
    expect(delivered).toContain(META)
    expect(delivered).toContain(COPY)
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

// #1014: the timestamp #969 left the slot empty for. What this tier owns is the WIRING — which items put
// a string in `bubble__meta-time`, that an unstamped one still emits the empty span #969 ships, and that
// nothing else in the row moved. WHICH characters the string is made of is messageTime.test.ts, which can
// assert them exactly without rendering anything; the fixtures here therefore use one moment and one
// expected string rather than re-testing the format.
describe('Timeline — the meta row timestamp (#1014)', () => {
  const TIME_SLOT = 'bubble__meta-time'
  // The empty slot exactly as #969 emits it — a self-closing JSX span renders as an open/close pair with
  // no children, and `{null}` children render identically, which is what makes AC3 a markup fact.
  const EMPTY_SLOT = `<span class="${TIME_SLOT}"></span>`

  // Local construction, the inverse of the formatter's local getters, so this expectation holds on a
  // runner in any zone (messageTime.test.ts's header records why nothing here may be a literal epoch).
  const CREATED_AT = new Date(2026, 0, 13, 13, 55).getTime()
  const DRAWN = '13.01.2026 - 13:55'

  it('renders the stamp inside the time slot on the settled assistant bubble', () => {
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          { kind: 'assistantText', turnId: 't1', text: 'a settled reply', createdAt: CREATED_AT },
          { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
        ]}
      />
    )
    expect(markup).toContain(`<span class="${TIME_SLOT}">${DRAWN}</span>`)
  })

  it('renders the stamp on the in-progress tail and on the user bubble too', () => {
    // The same three text bubbles #969's own first case names. The streaming tail is included for the
    // reason #969 gave: excluding it would reflow the bubble the moment the turn settles.
    const tail = renderToStaticMarkup(
      <Timeline items={[{ kind: 'assistantText', turnId: 't1', text: 'growing', createdAt: CREATED_AT }]} />
    )
    const user = renderToStaticMarkup(
      <Timeline items={[{ kind: 'userText', text: 'typed by the operator', createdAt: CREATED_AT }]} />
    )
    for (const markup of [tail, user]) {
      expect(markup).toContain(`<span class="${TIME_SLOT}">${DRAWN}</span>`)
    }
  })

  it('leaves the slot EMPTY for an item carrying no stamp — no placeholder, no `Invalid Date`, no NaN', () => {
    // #1013's contract: an absent `createdAt` is a LEGAL item, not a defect — it is what every producer
    // with no injected clock yields, which is also why the 39 stamp-free item literals elsewhere in this
    // file needed no edit. The read is `=== undefined`; `'createdAt' in item` would be TRUE here, because
    // the reducer assigns the field unconditionally, and an implementation using it renders the string
    // "undefined" instead of nothing.
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          { kind: 'userText', text: 'no clock was injected' },
          { kind: 'assistantText', turnId: 't1', text: 'nor here' },
          { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
        ]}
      />
    )
    expect(markup.match(new RegExp(EMPTY_SLOT, 'g'))?.length ?? 0).toBe(2)
    for (const wrong of ['Invalid Date', 'NaN', 'undefined', 'null']) {
      expect(markup).not.toContain(wrong)
    }
  })

  it('adds a text child and nothing else — the slot, the row and the control are otherwise unchanged', () => {
    // AC4. `bubble__meta-time` stays the sink: the string lands inside that span and nowhere else in the
    // bubble, the copy control still follows it in the same row, and no new element or class appeared.
    const markup = renderToStaticMarkup(
      <Timeline items={[{ kind: 'userText', text: 'mine', createdAt: CREATED_AT }]} />
    )
    expect(markup).toContain(
      `<div class="bubble__meta bubble__meta--user"><span class="${TIME_SLOT}">${DRAWN}</span><button type="button" class="bubble__copy" aria-label="Copy message"`
    )
    // Once, in that one sink — not duplicated into an attribute, a title or a second element.
    expect(markup.match(new RegExp(DRAWN.replace(/\./g, '\\.'), 'g'))?.length ?? 0).toBe(1)
  })

  it('gives no other row kind a timestamp — the tool rows, the separator and the queued rows are untouched', () => {
    // AC4's fence. None of these renders a BubbleMeta at all, so none can gain a time slot; asserting it
    // here is what keeps that structural rather than incidental.
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          {
            kind: 'toolCall',
            turnId: 't1',
            toolUseId: 'u1',
            name: 'Read',
            inputSummary: 'a file',
            result: null
          },
          {
            kind: 'sessionBoundary',
            reason: 'clear',
            workspaceCwd: null,
            occurredAt: '2026-01-13T13:55:00.000Z'
          }
        ]}
      />
    )
    expect(markup).not.toContain(TIME_SLOT)

    // #1214: the queued row is a merged timeline row now, so this reads it through Timeline. The wire `ts`
    // a queued message carries has never reached the renderer and this ticket does not start — and the
    // whole meta row is suppressed while queued, so neither the slot nor a formatted time appears.
    const queued = renderToStaticMarkup(
      <Timeline
        items={[]}
        queued={[{ queued_msg_id: 1, text: 'waiting to send', ts: '2026-01-13T13:55:00Z' }]}
      />
    )
    expect(queued).not.toContain(TIME_SLOT)
    expect(queued).not.toContain(DRAWN)
  })
})

// #815: the file row a non-image attachment draws inside the message bubble (Figma `File field` 132:4605,
// in the bubble at 121:3860) — the outlined document glyph with its extension overlay, and the filename
// beside it. #1039 supplied the record this reads; until then there was no name to draw.
//
// WHAT THIS TIER OWNS: which items get a row, WHERE the row sits among the bubble's children, what the
// glyph is as an element, and the untrusted-text posture. What it cannot own is AC5 — a long name wrapping
// in the column beside the icon is layout, and `environment: 'node'` has no DOM and no stylesheet, so a
// static render cannot tell wrapping from truncation from overflow. That half is
// e2e/attachment-file-row.spec.ts, which measures boxes.
describe('Timeline — the attachment file row in the message bubble (#815)', () => {
  const ROW = 'bubble__file'
  const NAME_SLOT = 'bubble__file-name'
  const EXT_SLOT = 'bubble__file-ext'
  const META = 'bubble__meta'

  // Counts `.bubble__file` itself without also counting `.bubble__file-name` / `-icon` / `-ext`, which all
  // share the prefix. A bare `match(/bubble__file/g)` would report four rows for one.
  const rowCount = (markup: string): number =>
    markup.match(/class="bubble__file"/g)?.length ?? 0

  const withOneFile: ThreadItem[] = [
    {
      kind: 'userText',
      text: 'here is the report',
      attachments: [{ attachmentId: 'att-1', filename: 'report.pdf' }]
    }
  ]

  it('draws the row for a sent message that carries an attachment', () => {
    const markup = renderToStaticMarkup(<Timeline items={withOneFile} />)
    expect(rowCount(markup)).toBe(1)
    expect(markup).toContain(`<span class="${NAME_SLOT}">report.pdf</span>`)
    expect(markup).toContain(`<span class="${EXT_SLOT}" aria-hidden="true">PDF</span>`)
  })

  it('puts the row AFTER the message text and BEFORE the meta row (AC1)', () => {
    // The order criterion as a byte string on the near side and an index comparison on the far side. The
    // byte string is the load-bearing half: it is the user-arm analogue of the assistant pin
    // interactiveRoundtrip.test.tsx holds (`data-thread-role="assistant"><div class="bubble__markdown">`),
    // and it is what reddens if the row is ever prepended ahead of the text.
    const markup = renderToStaticMarkup(<Timeline items={withOneFile} />)
    // #816 turned the row into a <button>, so the pinned run carries the tag and its `type`. Updated
    // rather than loosened: the byte string is the whole point of this assertion, and a `<div` still
    // written here would pass a regex-shaped rewrite while the control had silently gone back to being
    // unfocusable. The attribute order is JSX order — `type` first, matching .bubble__copy's button.
    expect(markup).toContain(
      'data-thread-role="user">here is the report<button type="button" class="bubble__file" disabled="">'
    )
    expect(markup.indexOf(ROW)).toBeLessThan(markup.indexOf(META))
  })

  it('draws one row per attachment, in the order the record carries them', () => {
    // The drawing shows one file; the record is a list, in upload-completion order. Two rows, stacked on
    // the same 12px rhythm, is what the sibling-margin mechanism yields with no new construct.
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          {
            kind: 'userText',
            text: 'two of them',
            attachments: [
              { attachmentId: 'att-1', filename: 'first.pdf' },
              { attachmentId: 'att-2', filename: 'second.zip' }
            ]
          }
        ]}
      />
    )
    expect(rowCount(markup)).toBe(2)
    expect(markup.indexOf('first.pdf')).toBeLessThan(markup.indexOf('second.zip'))
    // Still ahead of the single meta row, which stays the bubble's last child with two rows above it.
    expect(markup.indexOf('second.zip')).toBeLessThan(markup.indexOf(META))
  })

  it('draws an EMPTY overlay, not a fallback word, when the name has no usable extension (AC4)', () => {
    // The characters themselves are attachmentExtensionLabel.test.ts's; what this tier owns is that the
    // empty string reaches the slot as an empty element rather than as a placeholder.
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          {
            kind: 'userText',
            text: 'no extension',
            attachments: [{ attachmentId: 'att-1', filename: 'README' }]
          }
        ]}
      />
    )
    expect(markup).toContain(`<span class="${EXT_SLOT}" aria-hidden="true"></span>`)
    for (const wrong of ['FILE', 'undefined', 'null']) {
      expect(markup).not.toContain(wrong)
    }
    // The name itself still draws in full — only the overlay is empty. Asserted as a COUNT rather than as
    // an absence in the overlay: `not.toContain('README')` would be unsatisfiable (the name slot holds it
    // legitimately), and the fact actually worth pinning is that the empty label did not fall back to
    // spilling the name into the second slot.
    expect(markup).toContain(`<span class="${NAME_SLOT}">README</span>`)
    expect(markup.match(/README/g)?.length ?? 0).toBe(1)
  })

  it('draws the glyph as inline SVG taking its ink from the row, with no remote reference (AC3)', () => {
    const markup = renderToStaticMarkup(<Timeline items={withOneFile} />)
    expect(markup).toContain('width="45" height="60"')
    expect(markup).toContain('viewBox="0 0 45 60"')
    // The drawing is an OUTLINE — `fill="none"` with a stroked path — so the ink arrives through `stroke`.
    // Filling this path would render a solid document, which is why AC3's literal `fill="currentColor"` is
    // not what ships; see the plan's § Design source and the component comment.
    expect(markup).toContain('stroke="currentColor"')
    expect(markup).toContain('aria-hidden="true"')
    // Figma's export hands back an https:// asset URL for this glyph. Inlining the path data is what keeps
    // a privileged renderer from making an outbound request on every message render.
    expect(markup).not.toContain('figma.com')
    expect(markup).not.toContain('<img')
  })

  it('renders the name as escaped children and puts it in NO attribute (AC2)', () => {
    // The name is the operator's own basename, delivered over IPC — this row is the first DOM sink it has
    // ever had. It reaches the DOM as React children only: never an attribute, a title, a URL or innerHTML.
    const hostile = '<b>bold</b>&.svg'
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          {
            kind: 'userText',
            text: 'careful',
            attachments: [{ attachmentId: 'att-1', filename: hostile }]
          }
        ]}
      />
    )
    expect(markup).toContain('&lt;b&gt;bold&lt;/b&gt;&amp;.svg')
    expect(markup).not.toContain('<b>bold</b>')
    // No attribute carries the name — `title=`, `alt=` and `href=` are each an easy accident here, and a
    // name-derived React `key` is the step that makes `id={filename}` look natural next.
    for (const sink of ['title="', 'alt="', 'href=', 'data-filename']) {
      expect(markup).not.toContain(sink)
    }
    // The daemon-side storage handle is not display data and stays out of the markup entirely; #816 needs
    // it in a click handler, not in the DOM.
    expect(markup).not.toContain('att-1')
  })

  it('draws NO row for a message with no attachments, or for any other row kind', () => {
    // AC1's fence, as a COUNT over the whole markup rather than a per-string absence — the shape #969 used
    // for the same question about the meta row. An assistant bubble can never carry one: `MessagePayload`
    // has no attachment field and there is no list verb, so the field describes only files this client
    // minted itself.
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          { kind: 'userText', text: 'nothing attached' },
          { kind: 'assistantText', turnId: 't1', text: 'a reply' },
          { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' },
          {
            kind: 'toolCall',
            turnId: 't1',
            toolUseId: 'u1',
            name: 'Read',
            inputSummary: 'a file',
            result: null
          }
        ]}
      />
    )
    expect(rowCount(markup)).toBe(0)
    expect(markup).not.toContain(ROW)

    // #1214: an UNMATCHED queued row is synthesized from a wire item that carries no attachments at all,
    // so it can draw no file row — the strongest form of this assertion, and structural.
    const queued = renderToStaticMarkup(
      <Timeline
        items={[]}
        queued={[{ queued_msg_id: 1, text: 'waiting to send', ts: '2026-01-13T13:55:00Z' }]}
      />
    )
    expect(queued).not.toContain(ROW)

    // The unmounted MessageBubble residue, whose own assertions pin the message text as the bubble's sole
    // child. It reuses .bubble--user and so inherits the CSS passively, and gains no row.
    const residue = renderToStaticMarkup(
      <MessageThread messages={[{ id: 'm1', type: 'user', text: 'residue' }]} />
    )
    expect(residue).toContain('data-message-role="user">residue</div>')
    expect(residue).not.toContain(ROW)
  })

  // #816: the row became a download control. What this tier owns is the ELEMENT and its accessible name;
  // the click, the keyboard and the wire are e2e/attachment-file-row.spec.ts's, and the two-ask sequencing
  // behind the handler is downloadAttachment.test.ts's.
  describe('as a download control (#816)', () => {
    it('is a real <button type="button">, not a div with a handler (AC1)', () => {
      const markup = renderToStaticMarkup(<Timeline items={withOneFile} />)
      // A real button is what makes one tab stop, Enter and Space, and screen-reader semantics come for
      // free instead of being rebuilt out of tabIndex + onKeyDown — the ChannelList row's ruling.
      expect(markup).toContain(`<button type="button" class="${ROW}" disabled="">`)
      expect(markup).not.toContain(`<div class="${ROW}">`)
      // `type="button"` matters beyond tidiness: the default is `submit`, and a submitting button inside a
      // form would reload the window rather than download anything.
      expect(markup).not.toContain(`<button class="${ROW}">`)
    })

    it('takes its accessible name from its TEXT CONTENT, with no aria-label (AC1)', () => {
      const markup = renderToStaticMarkup(<Timeline items={withOneFile} />)
      const row = markup.slice(markup.indexOf(`<button type="button" class="${ROW}"`))

      // ⭐ The criterion is "an accessible name that includes the file name", and the name is COMPUTED
      // FROM CONTENTS: the glyph and the extension overlay are both aria-hidden, so what is announced is
      // exactly the filename. An aria-label would satisfy the same criterion by putting untrusted,
      // model-chosen text into an ATTRIBUTE — the sink #815 closed on purpose — and there is no
      // visually-hidden utility in this repo to prefix a client-owned verb with instead.
      expect(row).toContain(`<span class="${NAME_SLOT}">report.pdf</span>`)
      expect(row.slice(0, row.indexOf('>'))).not.toContain('aria-label')
      // Neither half is separately focusable: the icon and the name are one control, which is the AC.
      expect(row).not.toContain('tabindex')
      // The overlay's aria-hidden is load-bearing twice over — it keeps the announced name exactly the
      // filename with nothing doubled, and it is #815's bidi mitigation, which this slice must not weaken.
      expect(row).toContain(`<span class="${EXT_SLOT}" aria-hidden="true">PDF</span>`)
    })

    it('gives two attachments two independent controls, and still leaks no identifier', () => {
      const markup = renderToStaticMarkup(
        <Timeline
          items={[
            {
              kind: 'userText',
              text: 'two of them',
              attachments: [
                { attachmentId: 'att-1', filename: 'first.pdf' },
                { attachmentId: 'att-2', filename: 'second.zip' }
              ]
            }
          ]}
        />
      )
      // Two rows, two buttons — each addressing its own attachment through its own closure. Counted rather
      // than matched by string, so a shared control wrapping both rows would redden here.
      expect(rowCount(markup)).toBe(2)
      expect(markup.match(/<button type="button" class="bubble__file" disabled="">/g)?.length ?? 0).toBe(2)
      // Becoming a control did not give the storage handle a reason to appear in the DOM: it reaches the
      // click closure and nothing else.
      for (const id of ['att-1', 'att-2']) expect(markup).not.toContain(id)
    })
  })

  // #1045: the slot's other filling. What this tier owns is WHICH of the two an attachment gets and where
  // the result sits among the bubble's children. The picture itself draws nothing here — the fetch starts
  // in a useEffect and effects do not run under renderToStaticMarkup — so "an image draws no file row" is
  // exactly the observable fact, and it is the one that matters: the row is what it replaces.
  describe('an image attachment takes the slot instead (#1045)', () => {
    it('draws NO file row for an image, and the row unchanged for everything else', () => {
      const markup = renderToStaticMarkup(
        <Timeline
          items={[
            {
              kind: 'userText',
              text: 'a picture',
              attachments: [{ attachmentId: 'att-1', filename: 'holiday.png' }]
            },
            {
              kind: 'userText',
              text: 'a document',
              attachments: [{ attachmentId: 'att-2', filename: 'report.pdf' }]
            }
          ]}
        />
      )
      // One row across both bubbles: the document's. The image's would have been the second.
      expect(rowCount(markup)).toBe(1)
      expect(markup).toContain(`<span class="${NAME_SLOT}">report.pdf</span>`)
      // The image's name reaches no DOM sink at all in this state — the picture is not drawn yet and the
      // fallback is not the state. It is NOT `not.toContain('holiday')` by luck: the image branch has no
      // markup here whatsoever.
      expect(markup).not.toContain('holiday.png')
    })

    it('draws one of each, in the order the record holds them, still between text and meta', () => {
      // AC1's last clause. The image contributes no markup in this state, so ORDER is asserted where it
      // is observable: the file row for the SECOND attachment still lands after the message text and
      // before the meta row, which is the position it would have to leave if the branch had reordered or
      // wrapped the map.
      const markup = renderToStaticMarkup(
        <Timeline
          items={[
            {
              kind: 'userText',
              text: 'both kinds',
              attachments: [
                { attachmentId: 'att-1', filename: 'holiday.png' },
                { attachmentId: 'att-2', filename: 'report.pdf' }
              ]
            }
          ]}
        />
      )
      expect(rowCount(markup)).toBe(1)
      expect(markup).toContain(
        'data-thread-role="user">both kinds<button type="button" class="bubble__file" disabled="">'
      )
      expect(markup.indexOf(ROW)).toBeLessThan(markup.indexOf(META))
    })

    it('reads the WHOLE extension, so a decorative-label match is not an image', () => {
      // The one case that separates `isImageAttachmentName` from `attachmentExtensionLabel`, asserted
      // where it is drawn rather than only in the helper's own spec: the label slot says PNG and the row
      // is still a row. attachmentIsImage.test.ts pins the pair directly.
      const markup = renderToStaticMarkup(
        <Timeline
          items={[
            {
              kind: 'userText',
              text: 'not really a png',
              attachments: [{ attachmentId: 'att-1', filename: 'photo.p-n-g' }]
            }
          ]}
        />
      )
      expect(rowCount(markup)).toBe(1)
      expect(markup).toContain(`<span class="${EXT_SLOT}" aria-hidden="true">PNG</span>`)
    })
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
    expect(renderToStaticMarkup(<ThinkingIndicator state={null} toolName={null} retry={null} resetting={null} thinkingTokens={null} />)).toBe(
      ''
    )
  })

  it('shows the daemon-styled Thinking affordance while thinking', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="thinking" toolName={null} retry={null} resetting={null} thinkingTokens={null} />
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

  // #1314: the reading rides INSIDE the thinking label's one text run. Rendered rather than called
  // directly, because `thinkingLabel` is module-private on `apiRetryLabel`'s precedent — what matters is
  // what reaches the DOM, and asserting on the markup is what pins the single-run rule too.
  describe('the thinking-token estimate in the label (#1314)', () => {
    const thinkingMarkup = (thinkingTokens: number | null): string =>
      renderToStaticMarkup(
        <ThinkingIndicator
          state="thinking"
          toolName={null}
          retry={null}
          resetting={null}
          thinkingTokens={thinkingTokens}
        />
      )

    it('reads exactly as before with no estimate held (AC2)', () => {
      expect(thinkingMarkup(null)).toContain(`>${THINKING_COPY}</span>`)
    })

    it.each([
      [840, 'Thinking… ~840 tokens'],
      // Zero is a READING, not an absence — the wire has no `omitempty`. A truthiness test anywhere on
      // the path renders the bare copy here and this is the assertion that catches it.
      [0, 'Thinking… ~0 tokens'],
      [999, 'Thinking… ~999 tokens'],
      // At 1000 and above the reading rounds to the nearest hundred (AC3). 1250 rounds UP, 1249 DOWN —
      // the pair that pins the rounding rather than a floor or a truncation.
      [1000, 'Thinking… ~1000 tokens'],
      [1250, 'Thinking… ~1300 tokens'],
      [1249, 'Thinking… ~1200 tokens'],
      [12345, 'Thinking… ~12300 tokens']
    ])('renders %i as %s (AC3)', (estimate, expected) => {
      expect(thinkingMarkup(estimate)).toContain(`>${expected}</span>`)
    })

    it('is ONE text run, never constant-plus-span', () => {
      // The row's label ellipsizes as a unit, so two runs would draw two ellipses on overflow. The
      // `>…</span>` shape above already implies it; this asserts it directly, and it is the assertion a
      // "give the number its own class" edit has to fail.
      const markup = thinkingMarkup(640)
      expect(markup).toBe(
        '<span class="conversation__thinking composer-status__label">Thinking… ~640 tokens</span>'
      )
    })

    it.each([NaN, Infinity, -Infinity, -5])(
      'degrades to the bare copy for %p — the decode proves `number` and nothing more',
      (hostile) => {
        // `requireNumber` narrows on `typeof value === 'number'`, which admits every one of these, and
        // structured clone carries them across the contextBridge intact. This is the defensive-formatting
        // obligation in the arm's own SECURITY block, and the reason it is a degrade rather than a throw.
        const markup = thinkingMarkup(hostile)
        expect(markup).toContain(`>${THINKING_COPY}</span>`)
        expect(markup).not.toContain('NaN')
        expect(markup).not.toContain('Infinity')
        expect(markup).not.toContain('~')
      }
    )

    it('rounds a fractional reading rather than rendering its digits', () => {
      expect(thinkingMarkup(840.7)).toContain('>Thinking… ~841 tokens</span>')
    })

    it.each(['working', 'retrying', 'compacting', 'stalled'] as const)(
      'never reaches the %s label — the estimate belongs to thinking alone (AC2)',
      (state) => {
        const markup = renderToStaticMarkup(
          <ThinkingIndicator
            state={state}
            toolName={null}
            retry={{ current: 3, total: 10 }}
            resetting={null}
            thinkingTokens={1500}
          />
        )
        expect(markup).not.toContain('tokens')
        expect(markup).not.toContain('1500')
      }
    )

    it('does not survive the tool label — a named tool still replaces the copy whole', () => {
      // `toolLabel` supersedes `statusRowCopy` unconditionally for thinking/working (#967). Unchanged
      // behaviour, asserted because the estimate is exactly the kind of thing a later edit appends to
      // every branch.
      const markup = renderToStaticMarkup(
        <ThinkingIndicator state="thinking" toolName="Bash" retry={null} resetting={null} thinkingTokens={900} />
      )
      expect(markup).toContain('Running Bash…')
      expect(markup).not.toContain('tokens')
    })

    it('reaches the DOM as a text child and nothing else — no attribute carries it', () => {
      // CLAUDE.md: daemon-derived values may be rendered escaped, never into an attribute, a URL, a
      // title or a log. The `text-overflow: ellipsis` on this label is the standing temptation to add a
      // title tooltip; the shipped treatment has none and the estimate does not introduce one.
      const markup = thinkingMarkup(1500)
      expect(markup).not.toContain('title=')
      expect(markup).not.toContain('aria-label=')
      expect(markup).not.toContain('data-')
    })
  })

  it('shows the generic working affordance on the same surface while running but not thinking (#648, AC1)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="working" toolName={null} retry={null} resetting={null} thinkingTokens={null} />
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
      <ThinkingIndicator state="working" toolName="Bash" retry={null} resetting={null} thinkingTokens={null} />
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
      renderToStaticMarkup(<ThinkingIndicator state="working" toolName={null} retry={null} resetting={null} thinkingTokens={null} />)
    ).not.toContain('composer-status__label--tool')
    expect(
      renderToStaticMarkup(<ThinkingIndicator state="thinking" toolName={null} retry={null} resetting={null} thinkingTokens={null} />)
    ).not.toContain('composer-status__label--tool')
  })

  it('renders nothing at all with a tool open but no state — the null guard still runs first (#649, AC3)', () => {
    // The `state === null` guard is still the first thing this view does, so an open tool cannot
    // resurrect a label the container decided not to show. What reaches this case CHANGED with #967: it
    // used to be a live api-retry or compaction (which blanked the state), and those now arrive as
    // states of their own. What is left is the honest empty case — an idle turn with no folded status
    // and no local send — where a stale unresolved toolCall can still be sitting in `items`.
    expect(renderToStaticMarkup(<ThinkingIndicator state={null} toolName="Bash" retry={null} resetting={null} thinkingTokens={null} />)).toBe(
      ''
    )
  })

  it('renders a hostile tool name as inert escaped text, never as markup (#649, AC4)', () => {
    const hostile = '<img src=x onerror="alert(1)">'
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="working" toolName={hostile} retry={null} resetting={null} thinkingTokens={null} />
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
      <ThinkingIndicator
        state="retrying"
        toolName={null}
        retry={{ current: 3, total: 10 }}
        resetting={null}
        thinkingTokens={null}
      />
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
      <ThinkingIndicator
        state="retrying"
        toolName={null}
        retry={{ current: 0, total: 10 }}
        resetting={null}
        thinkingTokens={null}
      />
    )
    expect(markup).toContain(`>${API_RETRY_COPY} attempt 0/10</span>`)
  })

  it('omits the counter entirely when the count is unknown — never renders 0/0 (#967, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator
        state="retrying"
        toolName={null}
        retry={{ current: 0, total: 0 }}
        resetting={null}
        thinkingTokens={null}
      />
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
      renderToStaticMarkup(<ThinkingIndicator state="retrying" toolName={null} retry={null} resetting={null} thinkingTokens={null} />)
    ).toContain(`>${API_RETRY_COPY}</span>`)
  })

  it('shows the compaction label on the same surface, in the rows own colour (#967, AC1)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="compacting" toolName={null} retry={null} resetting={null} thinkingTokens={null} />
    )
    expect(markup).toContain(`>${COMPACTING_COPY}</span>`)
    // No modifier at all: compaction is claude working normally, so it keeps --color-primary — painting
    // routine housekeeping as a failure would be a design bug (#496's own reasoning, carried).
    expect(markup).toContain('class="conversation__thinking composer-status__label"')
  })

  it('shows the stall label with the error-colour modifier and nothing else (#967, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state="stalled" toolName={null} retry={null} resetting={null} thinkingTokens={null} />
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
        <ThinkingIndicator
          state={state}
          toolName={null}
          retry={{ current: 1, total: 2 }}
          resetting={null}
          thinkingTokens={null}
        />
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
          resetting={null}
          thinkingTokens={null}
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
    expect(shouldShowThinking({ phase: 'thinking', apiRetry: null, compacting: false, stalled: false, resetting: null })).toBe(true)
  })

  it('hides the thinking indicator while a retry is in flight — the supersede rule (#493)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 3, total: 10 }, compacting: false, stalled: false, resetting: null })
    ).toBe(false)
  })

  it('hides it for a retry with an unknown count too — presence supersedes, not the counter (#493)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 0, total: 0 }, compacting: false, stalled: false, resetting: null })
    ).toBe(false)
  })

  it('hides the thinking indicator while compacting — the second supersede rule (AC4)', () => {
    expect(shouldShowThinking({ phase: 'thinking', apiRetry: null, compacting: true, stalled: false, resetting: null })).toBe(false)
  })

  it('hides it while both compacting and retrying (AC4)', () => {
    expect(
      shouldShowThinking({ phase: 'thinking', apiRetry: { current: 3, total: 10 }, compacting: true, stalled: false, resetting: null })
    ).toBe(false)
  })

  it('never shows thinking outside the thinking phase, compacting or not (AC4)', () => {
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: true, stalled: false, resetting: null })).toBe(false)
    expect(shouldShowThinking({ phase: 'responding', apiRetry: null, compacting: true, stalled: false, resetting: null })).toBe(false)
  })

  it('holds the indicator across the whole running turn when nothing is in flight (#648, AC1)', () => {
    // #648 reverses the phase clause: the pre-#648 gate was exactly `phase === 'thinking'`, which let the
    // indicator vanish for the tool-heavy bulk of a turn. It is now `isTurnRunning(phase)`, so `responding`
    // shows. `idle` still hides — the gate never widens past a running turn.
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null })).toBe(false)
    expect(shouldShowThinking({ phase: 'responding', apiRetry: null, compacting: false, stalled: false, resetting: null })).toBe(true)
  })

  it('shows in both running phases and hides at idle — the isTurnRunning tie (#648, AC1, AC3)', () => {
    // The gate now REUSES isTurnRunning rather than re-deriving the phase test, so the tie is asserted
    // here rather than merely inherited: a future edit to either side that breaks agreement fails this.
    for (const phase of ['thinking', 'responding'] as const) {
      expect(shouldShowThinking({ phase, apiRetry: null, compacting: false, stalled: false, resetting: null })).toBe(
        isTurnRunning(phase)
      )
      expect(shouldShowThinking({ phase, apiRetry: null, compacting: false, stalled: false, resetting: null })).toBe(true)
    }
    expect(shouldShowThinking({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null })).toBe(
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
    expect(workingIndicatorState({ phase: 'thinking', apiRetry: null, compacting: false, stalled: false, resetting: null })).toBe(
      'thinking'
    )
  })

  it('picks the generic working label for the rest of the running turn (AC1, AC2)', () => {
    // The phase that LASTS: the daemon flips to `responding` on the first reply token or tool step and
    // sends no further turn_state until the turn ends, so this covers the tool-heavy silent stretch that
    // used to show nothing at all.
    expect(workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: false, stalled: false, resetting: null })).toBe(
      'working'
    )
  })

  it('picks nothing at idle — no wrapper, no empty chrome (AC3)', () => {
    expect(workingIndicatorState({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null })).toBeNull()
  })

  // #967 CHANGED THESE THREE ANSWERS, and the change is the ticket rather than a regression: the working
  // label is still superseded in the newly covered phase, but the superseding status now takes the slot
  // with its OWN copy instead of blanking it. #493's and #496's supersede rules themselves are asserted
  // unchanged on `shouldShowThinking` above, which is why they were kept there.
  it('is superseded by a live retry in the newly covered phase too (AC4, #967)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: { current: 3, total: 10 }, compacting: false, stalled: false, resetting: null })
    ).toBe('retrying')
  })

  it('is superseded by an unknown-count retry too — presence supersedes, not the counter (AC4)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: { current: 0, total: 0 }, compacting: false, stalled: false, resetting: null })
    ).toBe('retrying')
  })

  it('is superseded by a live compaction in the newly covered phase too (AC4, #967)', () => {
    expect(workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: true, stalled: false, resetting: null })).toBe(
      'compacting'
    )
  })

  it('agrees with the gate wherever nothing supersedes — it delegates, it is not a parallel rule (AC4)', () => {
    // Scoped to the all-clear status since #967: with a folded status live this function answers from its
    // own order before the gate is consulted at all (AC2 — those three are not turn-gated), so the
    // agreement it still owes the gate is exactly over the working label's own inputs.
    for (const phase of ['thinking', 'responding', 'idle'] as const) {
      const status = { phase, apiRetry: null, compacting: false, stalled: false, resetting: null }
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
        stalled: true,
        resetting: null
      })
    ).toBe('retrying')
  })

  it('picks compacting second, ahead of a stall and the working label (#967, AC1)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: true, stalled: true, resetting: null })
    ).toBe('compacting')
  })

  it('picks the stall third, ahead of the working label (#967, AC1)', () => {
    expect(
      workingIndicatorState({ phase: 'responding', apiRetry: null, compacting: false, stalled: true, resetting: null })
    ).toBe('stalled')
  })

  it('shows all three folded states with no turn running (#967, AC2)', () => {
    // The regression this pins: folding the three in BEHIND `shouldShowThinking` would narrow three
    // shipped behaviours to the running turn. `thread-scroll-pin.spec.ts` drives exactly this case —
    // it pushes a stall onto a turn the primer already returned to `idle`.
    expect(
      workingIndicatorState({ phase: 'idle', apiRetry: null, compacting: false, stalled: true, resetting: null })
    ).toBe('stalled')
    expect(
      workingIndicatorState({
        phase: 'idle',
        apiRetry: { current: 3, total: 10 },
        compacting: false,
        stalled: false,
        resetting: null
      })
    ).toBe('retrying')
    expect(
      workingIndicatorState({ phase: 'idle', apiRetry: null, compacting: true, stalled: false, resetting: null })
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
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null }, true)
    ).toBe('thinking')
  })

  it('opens nothing at idle with no local send pending — todays behaviour, unchanged (AC1)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null }, false)
    ).toBeNull()
  })

  it('delegates unchanged wherever the daemon has already opened the window', () => {
    // The daemon's answer wins: for every phase and both pending values, a non-null daemon answer is
    // returned byte-identical, so no daemon-opened case changed behaviour at all.
    for (const phase of ['thinking', 'responding', 'idle'] as const) {
      for (const pending of [true, false]) {
        const status = { phase, apiRetry: null, compacting: false, stalled: false, resetting: null }
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
        { phase: 'responding', apiRetry: null, compacting: false, stalled: false, resetting: null },
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
        { phase: 'idle', apiRetry: { current: 3, total: 10 }, compacting: false, stalled: false, resetting: null },
        true
      )
    ).toBe('retrying')
  })

  it('inherits it for an unknown-count retry too — presence supersedes, not the counter', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 0, total: 0 }, compacting: false, stalled: false, resetting: null },
        true
      )
    ).toBe('retrying')
  })

  it('inherits the compaction supersede rule too (#967)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: true, stalled: false, resetting: null }, true)
    ).toBe('compacting')
  })

  it('is superseded while both compacting and retrying — retry wins the tie (#967)', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 3, total: 10 }, compacting: true, stalled: false, resetting: null },
        true
      )
    ).toBe('retrying')
  })

  it('lets a stall outrank a locally-opened window too, with no turn running (#967, AC2)', () => {
    // The middle of the order, and the case a wrapper composed on the gate could not have expressed
    // without re-reading `apiRetry` and `compacting` itself — the reason #967 took the fourth field.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: true, resetting: null }, true)
    ).toBe('stalled')
    // And with no local send pending either: the three folded statuses were never gated on a send.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: true, resetting: null }, false)
    ).toBe('stalled')
  })

  it('hands over to the daemon with no label flicker at the seam (AC2)', () => {
    // The local window is labelled exactly what the daemon's first turn_state says, so the moment the
    // daemon takes over is invisible. `working` would have flipped Working → Thinking → Working at the
    // one seam this ticket exists to smooth.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null }, true)
    ).toBe(workingIndicatorState({ phase: 'thinking', apiRetry: null, compacting: false, stalled: false, resetting: null }))
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
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null }, true)
    ).not.toBeNull()
    expect(isTurnRunning('idle')).toBe(false)
  })
})

// #1517: the sixth label and the new TOP of the row's order. The order block above pins five; this one
// pins that a live reset outranks every one of them, and that the label is assembled from client-owned
// constants SELECTED by the two decoded tokens rather than interpolating either.
describe('the resetting label — the rows sixth state (#1517)', () => {
  const WRAPPING = { phase: 'wrapping_up', handoff: 'pending' } as const
  const RESTARTING_WRITTEN = { phase: 'restarting', handoff: 'written' } as const
  const RESTARTING_SKIPPED = { phase: 'restarting', handoff: 'skipped' } as const

  it('outranks retry, compaction, the stall and a running turn (AC3)', () => {
    // Every superseding fact live at once, plus a running turn: the reset still takes the slot. A
    // lower position would render `Thinking…` across the whole wrap-up phase, which is the unnamed
    // pause this ticket exists to remove.
    expect(
      workingIndicatorState({
        phase: 'responding',
        apiRetry: { current: 3, total: 10 },
        compacting: true,
        stalled: true,
        resetting: WRAPPING
      })
    ).toBe('resetting')
  })

  it('shows at idle too — it is not gated on a running turn', () => {
    // The first three superseding states are read BEFORE the gate for the reason #967's block records;
    // the reset joins them, and the restarting phase in particular has no turn of its own.
    expect(
      workingIndicatorState({
        phase: 'idle',
        apiRetry: null,
        compacting: false,
        stalled: false,
        resetting: RESTARTING_WRITTEN
      })
    ).toBe('resetting')
  })

  it('yields the slot back the moment the record clears', () => {
    expect(
      workingIndicatorState({
        phase: 'responding',
        apiRetry: null,
        compacting: false,
        stalled: false,
        resetting: null
      })
    ).toBe('working')
    expect(
      workingIndicatorState({
        phase: 'idle',
        apiRetry: null,
        compacting: false,
        stalled: false,
        resetting: null
      })
    ).toBeNull()
  })

  it('is the daemon answer a local send never relabels (#650)', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: WRAPPING },
        true
      )
    ).toBe('resetting')
  })

  it('reads the wrapping-up copy on the first edge and the restarting copy on the second (AC1)', () => {
    const label = (resetting: typeof WRAPPING | typeof RESTARTING_WRITTEN): string =>
      renderToStaticMarkup(
        <ThinkingIndicator
          state="resetting"
          toolName={null}
          retry={null}
          resetting={resetting}
          thinkingTokens={null}
        />
      )
    expect(label(WRAPPING)).toContain(`>${RESETTING_WRAPPING_UP_COPY}</span>`)
    expect(label(RESTARTING_WRITTEN)).toContain(
      `>${RESETTING_RESTARTING_COPY} ${HANDOFF_WRITTEN_COPY}</span>`
    )
  })

  it('carries the skipped suffix on a skipped handoff', () => {
    expect(
      renderToStaticMarkup(
        <ThinkingIndicator
          state="resetting"
          toolName={null}
          retry={null}
          resetting={RESTARTING_SKIPPED}
          thinkingTokens={null}
        />
      )
    ).toContain(`>${RESETTING_RESTARTING_COPY} ${HANDOFF_SKIPPED_COPY}</span>`)
  })

  it('degrades to bare copy rather than blanking the row on a combination the daemon never emits', () => {
    // All sixteen (active, phase, handoff) combinations decode — the wire docblock is explicit that a
    // narrowed token is still a CLAIM BY A PEER. `apiRetryLabel(null)`'s posture applies: degrade to
    // the bare constant, never throw and never let a hostile or buggy daemon empty the status row.
    const label = (resetting: { phase: '' | 'restarting'; handoff: '' | 'pending' }): string =>
      renderToStaticMarkup(
        <ThinkingIndicator
          state="resetting"
          toolName={null}
          retry={null}
          resetting={resetting}
          thinkingTokens={null}
        />
      )
    expect(label({ phase: '', handoff: '' })).toContain(`>${RESETTING_COPY}</span>`)
    expect(label({ phase: '', handoff: 'pending' })).toContain(`>${RESETTING_COPY}</span>`)
    // Restarting with the handoff still unresolved: the phase copy stands, the suffix does not.
    expect(label({ phase: 'restarting', handoff: 'pending' })).toContain(
      `>${RESETTING_RESTARTING_COPY}</span>`
    )
    expect(label({ phase: 'restarting', handoff: '' })).toContain(`>${RESETTING_RESTARTING_COPY}</span>`)
  })

  it('draws ONLY client-owned constants over all sixteen token combinations (AC4)', () => {
    // The tokens SELECT copy and are never interpolated into it — asserted as membership in the closed
    // set of strings the constants can produce, NOT as `not.toContain(token)`. A substring check is the
    // wrong instrument here and would be vacuously false: `RESETTING_RESTARTING_COPY` contains the word
    // "restarting" and `HANDOFF_WRITTEN_COPY` the word "written" as ordinary English. Membership is what
    // actually fails on an interpolation — `Resetting: wrapping_up…` is not in this set.
    //
    // All SIXTEEN combinations, not the producer's three rows: every one of them decodes (the decoder
    // refuses to cross-validate the pair) and a hostile daemon can send any of them, so the sweep is the
    // claim. Its other half is that no combination renders empty.
    const allowed = new Set([
      RESETTING_COPY,
      RESETTING_WRAPPING_UP_COPY,
      RESETTING_RESTARTING_COPY,
      `${RESETTING_RESTARTING_COPY} ${HANDOFF_WRITTEN_COPY}`,
      `${RESETTING_RESTARTING_COPY} ${HANDOFF_SKIPPED_COPY}`
    ])
    const phases = ['wrapping_up', 'restarting', ''] as const
    const handoffs = ['pending', 'written', 'skipped', ''] as const
    for (const phase of phases) {
      for (const handoff of handoffs) {
        const markup = renderToStaticMarkup(
          <ThinkingIndicator
            state="resetting"
            toolName={null}
            retry={null}
            resetting={{ phase, handoff }}
            thinkingTokens={null}
          />
        )
        const label = markup.replace(/^<span class="[^"]*">/, '').replace(/<\/span>$/, '')
        expect(allowed.has(label)).toBe(true)
        expect(label).not.toBe('')
      }
    }
  })

  it('outranks an open tool name and keeps reset copy in one truncating text run', () => {
    // The reset modifier bounds long copy without changing the row's primary colour or typography.
    const markup = renderToStaticMarkup(
      <ThinkingIndicator
        state="resetting"
        toolName="Bash"
        retry={{ current: 3, total: 10 }}
        resetting={WRAPPING}
        thinkingTokens={900}
      />
    )
    expect(markup).toContain(`>${RESETTING_WRAPPING_UP_COPY}</span>`)
    expect(markup).not.toContain('Bash')
    expect(markup).toBe(
      `<span class="conversation__thinking composer-status__label composer-status__label--resetting">${RESETTING_WRAPPING_UP_COPY}</span>`
    )
  })

  it('keeps every reset constant apostrophe-free and on the U+2026 ellipsis', () => {
    // renderToStaticMarkup escapes `'` → `&#x27;` (the standing desktop lesson), and three dots are
    // not the character the five sibling constants use.
    for (const copy of [RESETTING_COPY, RESETTING_WRAPPING_UP_COPY, RESETTING_RESTARTING_COPY]) {
      expect(copy).not.toContain("'")
      expect(copy).not.toContain('...')
      expect(copy.endsWith('…')).toBe(true)
    }
    for (const suffix of [HANDOFF_WRITTEN_COPY, HANDOFF_SKIPPED_COPY]) {
      expect(suffix).not.toContain("'")
    }
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
// Composer itself (untested, the queued backlog's own drop-closure posture); the activation→command proof lives in
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

  it('disables the stop variant when the session cannot send', () => {
    // The deliberate asymmetry: `canSend` gates the send variant only. A turn can be running while the
    // session is disconnected, and hiding the only interrupt affordance there would be a new behaviour.
    // Without this test a later tidy-up collapsing the two gates into one would pass silently.
    const markup = renderToStaticMarkup(
      <ComposerSendButton isRunning={true} canSend={false} onSend={noop} onInterrupt={noop} />
    )
    expect(markup).toContain('aria-label="Stop the running turn"')
    expect(buttonTags(markup)[0]).toContain('disabled')
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

// #294, re-pointed onto the merged row by #1214: the daemon's queued backlog, drawn INSIDE the thread.
// #294 drew it as a separate `.conversation__queued` region below the timeline, which meant a message sent
// mid-turn appeared twice — the composer's optimistic echo here and a near-identical queued copy there.
// The rows are folded now (foldQueuedRows → Timeline), so these assertions render Timeline with a `queued`
// backlog instead of the deleted QueuedBacklog view. Every one of #294/#296's original subjects survives:
// enqueue order, the queued-vs-delivered seam, the untrusted-text posture and one drop control per queued
// row. The correlation itself is proven exhaustively in foldQueuedRows.test.ts; what lives here is what
// the MARKUP does with it. The container's own empty-store branch stays in the block below.
describe('the merged queued row — the backlog folded into the thread (#1214)', () => {
  const item = (queued_msg_id: number, text: string, message_id?: string): QueuedItem => ({
    queued_msg_id,
    text,
    ts: '2026-07-12T00:00:00Z',
    ...(message_id === undefined ? {} : { message_id })
  })

  const echo = (text: string, messageId: string): ThreadItem => ({ kind: 'userText', text, messageId })

  // renderToStaticMarkup cannot fire clicks (the id→command proof lives in dropQueuedMessage.test.ts and
  // the click itself in e2e/), so these renders pass no handler at all — which is also the assertion that
  // `onDropQueued` really is optional and a handler-less render draws the control rather than throwing.

  it('keeps one focusable thread region when both timeline and backlog are empty', () => {
    // The empty-thread invitation, not a silent region: EmptyThread is a distinct surface.
    const markup = renderToStaticMarkup(<Timeline items={[]} queued={[]} />)
    expect(markup.match(/class="conversation__thread"/g)).toHaveLength(1)
    expect(markup).not.toContain('queued-row__drop')
  })

  it('draws the queued rows and NOT the empty state when the timeline is empty but the backlog is not', () => {
    // Reachable from a reconnect into another device's backlog, and from a conversation opened fresh in
    // this window. Before the fold this drew the empty-state invitation with queued rows underneath it.
    const markup = renderToStaticMarkup(<Timeline items={[]} queued={[item(1, 'somebody else queued this')]} />)
    expect(markup).toContain('conversation__thread')
    expect(markup).toContain('somebody else queued this')
    expect(markup).not.toContain('conversation__empty')
  })

  it('renders one row per queued item, in snapshot order, each showing its text (AC1)', () => {
    const markup = renderToStaticMarkup(
      <Timeline items={[]} queued={[item(1, 'first queued'), item(2, 'second queued')]} />
    )
    expect(markup).toContain('first queued')
    expect(markup).toContain('second queued')
    // Array position IS snapshot order: the first item precedes the second in the rendered markup.
    expect(markup.indexOf('first queued')).toBeLessThan(markup.indexOf('second queued'))
  })

  it('draws a mid-turn send ONCE — one row, wearing the queued treatment, never a second copy (AC1)', () => {
    // The bug this ticket fixes: the echo and the backlog item are the same message, so they are one row.
    const markup = renderToStaticMarkup(
      <Timeline items={[echo('sent mid turn', 'm1')]} queued={[item(1, 'sent mid turn', 'm1')]} />
    )
    expect(markup.match(/sent mid turn/g)?.length ?? 0).toBe(1)
    expect(markup.match(/class="message-row/g)?.length ?? 0).toBe(1)
    expect(markup).toContain('data-thread-role="queued"')
    expect(markup).not.toContain('data-thread-role="user"')
  })

  it('distinguishes the not-yet-run state by an attribute and a class, never by container (AC1)', () => {
    const markup = renderToStaticMarkup(
      <Timeline
        items={[echo('already ran', 'm1'), echo('still waiting', 'm2')]}
        queued={[item(1, 'still waiting', 'm2')]}
      />
    )
    // Both rows sit in the SAME container — the distinctness is the role attribute and the modifier…
    expect(markup.match(/conversation__thread/g)?.length ?? 0).toBe(1)
    expect(markup).not.toContain('conversation__queued')
    expect(markup).toContain('data-thread-role="user">already ran')
    expect(markup).toContain('data-thread-role="queued">still waiting')
    // …with the modifier APPENDED to the shared class run, never prepended (the whole-run assertion at
    // the userText row's own test matches the `message-row message-row--user` prefix).
    expect(markup).toContain('class="message-row message-row--user message-row--queued"')
    expect(markup.match(/class="message-row message-row--user"/g)?.length ?? 0).toBe(1)
    // …reusing the right-aligned user-bubble treatment (queued messages are the user's own sends).
    expect(markup.match(/bubble bubble--user/g)?.length ?? 0).toBe(2)
  })

  it('keeps the row where it is and lifts the treatment when the message runs (AC3)', () => {
    // The SAME timeline, folded against a backlog that no longer names the message: same index, same
    // text, no jump to the tail and no second row — only the treatment goes.
    const items: ThreadItem[] = [echo('ran', 'm1'), { kind: 'assistantText', turnId: 't1', text: 'a reply' }]
    const whileQueued = renderToStaticMarkup(<Timeline items={items} queued={[item(1, 'ran', 'm1')]} />)
    const afterRunning = renderToStaticMarkup(<Timeline items={items} queued={[]} />)
    expect(whileQueued.indexOf('ran')).toBeLessThan(whileQueued.indexOf('a reply'))
    expect(afterRunning.indexOf('ran')).toBeLessThan(afterRunning.indexOf('a reply'))
    expect(afterRunning).toContain('data-thread-role="user">ran')
    expect(afterRunning).not.toContain('queued')
    expect(afterRunning.match(/class="message-row/g)?.length ?? 0).toBe(2)
  })

  it('keeps two identical texts queued back to back as two distinct rows (AC4)', () => {
    const markup = renderToStaticMarkup(
      <Timeline
        items={[echo('same words', 'm1'), echo('same words', 'm2')]}
        queued={[item(7, 'same words', 'm1'), item(8, 'same words', 'm2')]}
      />
    )
    expect(markup.match(/same words/g)?.length ?? 0).toBe(2)
    expect(markup.match(/data-thread-role="queued"/g)?.length ?? 0).toBe(2)
  })

  it('draws a queued item matching no local echo as its own row, never attached to another (AC4)', () => {
    const markup = renderToStaticMarkup(
      <Timeline items={[echo('mine', 'm1')]} queued={[item(9, 'from another device', 'zz')]} />
    )
    expect(markup.match(/class="message-row/g)?.length ?? 0).toBe(2)
    expect(markup).toContain('data-thread-role="user">mine')
    expect(markup).toContain('data-thread-role="queued">from another device')
  })

  it('renders untrusted text as plain text, never live markup (load-bearing)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (a prior desktop lesson).
    const markup = renderToStaticMarkup(<Timeline items={[]} queued={[item(1, '<b>x</b>')]} />)
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })

  // #296: every queued row carries a drop / cancel affordance (AC1) — an icon-only button whose
  // accessible name is a client-owned aria-label. #1214 turned "no delivered row can reach this button"
  // from a structural fact (only QueuedBacklog drew it) into a CONDITION on the folded row, so it is
  // asserted head-on here rather than left to the shape of the file. The click→command wiring is proven
  // in dropQueuedMessage.test.ts.
  it('carries one drop affordance per queued row, each with an accessible name (AC2)', () => {
    const markup = renderToStaticMarkup(
      <Timeline items={[]} queued={[item(1, 'first queued'), item(2, 'second queued')]} />
    )
    // The accessible name is a client-owned aria-label (icon-only control), never a daemon string.
    expect(markup).toContain('aria-label="Drop queued message"')
    // Exactly one drop control per queued row — no more, no fewer. Match the exact button class (the
    // closing quote excludes the .queued-row__drop-icon svg class, which shares the prefix).
    expect(markup.match(/class="queued-row__drop"/g)?.length ?? 0).toBe(2)
    expect(markup.match(/aria-label="Drop queued message"/g)?.length ?? 0).toBe(2)
  })

  it('rides the queued rows and ONLY those — never a delivered row of any kind (AC2)', () => {
    const markup = renderToStaticMarkup(
      <Timeline
        items={[
          echo('a delivered send', 'm1'),
          { kind: 'assistantText', turnId: 't1', text: 'a reply' },
          { kind: 'toolCall', turnId: 't1', toolUseId: 'u1', name: 'Read', inputSummary: 'a file', result: null }
        ]}
        queued={[item(1, 'the only queued one', 'm2')]}
      />
    )
    expect(markup.match(/class="queued-row__drop"/g)?.length ?? 0).toBe(1)
    expect(markup.match(/data-thread-role="queued"/g)?.length ?? 0).toBe(1)
    // The drop control precedes its own bubble and follows every delivered row — it is inside the queued
    // row, not loose in the thread.
    expect(markup.indexOf('a delivered send')).toBeLessThan(markup.indexOf('queued-row__drop'))
    expect(markup.indexOf('queued-row__drop')).toBeLessThan(markup.indexOf('the only queued one'))
  })

  it('draws no queued treatment anywhere when the backlog prop is omitted entirely', () => {
    // The optional-prop contract the 72 existing `<Timeline` render sites depend on: absent `queued`
    // folds against an empty backlog and yields today's rows.
    const markup = renderToStaticMarkup(<Timeline items={[echo('plain send', 'm1')]} />)
    expect(markup).toContain('class="message-row message-row--user"')
    expect(markup).toContain('data-thread-role="user"')
    expect(markup).not.toContain('queued')
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

// Inject status to prove the slot's branch decisions and mutual exclusion under static rendering.
// Store-bound renders use getInitialState(), so they cannot exercise every status without a spy.
describe('ComposerErrorSlot — one occupant per slot (#963)', () => {
  const ack = {
    protocol_version: '1',
    server_id: 's',
    conn_id: 'c',
    capabilities: []
  }

  it.each([
    ['pairing-rejected', 'Pairing error - Re-pair'],
    ['DAEMON_CODE_SENTINEL', 'Connection error - Reconnect']
  ])('renders only the fixed button for %s without error fields', (code, copy) => {
    const markup = renderToStaticMarkup(<ComposerErrorSlot
      status={{ type: 'error', error: { code, message: 'DAEMON_MESSAGE_SENTINEL', retryable: false } }}
      onRepair={() => {}} onReconnect={() => {}}
      notice={<span>NOTICE</span>} recovery={<span>RECOVERY</span>}
      refusal={<span>REFUSAL</span>} history={<span>HISTORY</span>} taskCount={<span>TASKS</span>}
    />)
    expect(markup).toBe(`<button type="button" class="button-small button-small--error">${copy}</button>`)
    expect(markup).not.toMatch(/DAEMON_|aria-label|title=|data-/)
  })

  it.each(['unpair', 'not-paired'])('retains only the chip for %s', code => {
    const markup = renderToStaticMarkup(<ComposerErrorSlot
      status={{ type: 'error', error: { code, message: 'private', retryable: false } }}
      onRepair={() => {}} onReconnect={() => {}} notice={null}
    />)
    expect(markup).toContain(COMPOSER_ERROR_CHIP_COPY)
    expect(markup).not.toContain('<button')
  })

  it('renders Re-pair and NOT the chip for explicit non-retryable pairing rejection', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot onReconnect={() => {}}
        status={{ type: 'error', error: { code: 'pairing-rejected', message: 'gave up', retryable: false } }}
        onRepair={() => {}}
        notice={null}
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
      <ComposerErrorSlot onReconnect={() => {}}
        status={{
          type: 'error',
          error: { code: 'server.binary_offline', message: 'offline', retryable: true }
        }}
        onRepair={() => {}}
        notice={null}
      />
    )
    expect(markup).toContain('composer-status__error')
    expect(markup).toContain(COMPOSER_ERROR_CHIP_COPY)
    expect(markup).not.toContain(COMPOSER_REPAIR_BUTTON_COPY)
  })

  // Failed unpair is excluded from both recovery actions to avoid a self-loop.
  it('renders the chip and NOT the button after a failed unpair (AC1, #167 AC5)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot onReconnect={() => {}}
        status={{
          type: 'error',
          error: { code: 'unpair', message: 'Could not forget this pairing.', retryable: false }
        }}
        onRepair={() => {}}
        notice={null}
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
      renderToStaticMarkup(<ComposerErrorSlot onReconnect={() => {}} status={{ type: 'disconnected' }} onRepair={() => {}} notice={null} />)
    ).toBe('')
  })

  it('renders nothing at all while connecting — not an empty element (AC1)', () => {
    expect(
      renderToStaticMarkup(<ComposerErrorSlot onReconnect={() => {}} status={{ type: 'connecting' }} onRepair={() => {}} notice={null} />)
    ).toBe('')
  })

  it('renders nothing at all while connected — not an empty element (AC1)', () => {
    expect(
      renderToStaticMarkup(<ComposerErrorSlot onReconnect={() => {}} status={{ type: 'connected', ack }} onRepair={() => {}} notice={null} />)
    ).toBe('')
  })

  // AC4, and the one assertion this view needs that the chip's own describe cannot supply. Unlike
  // ComposerErrorChip — which narrows on `status.type` and never touches the error arm at all — this
  // view calls shouldOfferReconnect, which READS `status.error.retryable` and `.code`. Those two reads are
  // one line away from a value a future edit could render, so the guarantee is pinned rather than
  // argued: on the arm that reads them, neither sentinel reaches the markup.
  it('never renders ConnectionError.message or .code on the button arm (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot onReconnect={() => {}}
        status={{
          type: 'error',
          error: { code: 'DAEMON_SECRET_CODE', message: 'DAEMON_SECRET_DETAIL', retryable: false }
        }}
        onRepair={() => {}}
        notice={null}
      />
    )
    expect(markup).toContain(COMPOSER_RECONNECT_BUTTON_COPY)
    expect(markup).not.toContain('DAEMON_SECRET_DETAIL')
    expect(markup).not.toContain('DAEMON_SECRET_CODE')
  })

  // AC4's accessible-name half: the visible text IS the name, so there is no aria-label to drift from
  // it and no hidden prefix — the label says "Pairing error" itself, which is exactly why the chip's
  // visually-hidden `Error: ` run is not carried over to this occupant.
  it('takes its accessible name from the visible text — no aria-label, no hidden prefix (AC4)', () => {
    const markup = renderToStaticMarkup(
      <ComposerErrorSlot onReconnect={() => {}}
        status={{ type: 'error', error: { code: 'pairing-rejected', message: 'gave up', retryable: false } }}
        onRepair={() => {}}
        notice={null}
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
      <ComposerErrorSlot onReconnect={() => {}}
        status={{ type: 'error', error: { code: 'pairing-rejected', message: 'gave up', retryable: false } }}
        onRepair={() => {}}
        notice={null}
      />
    )
    expect(markup).toContain('button-small')
    expect(markup).toContain('button-small--error')
    // A real <button>, not a div wearing a click handler — the accessible name, the focus ring AC3
    // requires and keyboard activation all come from the element, not from the class.
    expect(markup).toContain('<button')
    expect(markup).toContain('type="button"')
  })

  // #1321's AC4 — the precedence, proven with a SENTINEL rather than with a real notice, so this block
  // asserts the slot's ordering and nothing about the notice's own markup (which its own describe owns).
  // Every arm is written in BOTH directions, the #963 rule above: a slot that rendered both occupants
  // would pass a one-directional check.
  describe('the usage-limit notice is the lowest-priority occupant (#1321 AC4)', () => {
    const sentinel = <p>USAGE_NOTICE_SENTINEL</p>

    it('yields to the actionable-error button on a terminal, non-retryable error', () => {
      const markup = renderToStaticMarkup(
        <ComposerErrorSlot onReconnect={() => {}}
          status={{ type: 'error', error: { code: 'pairing-rejected', message: 'gave up', retryable: false } }}
          onRepair={() => {}}
          notice={sentinel}
        />
      )
      expect(markup).toContain(COMPOSER_REPAIR_BUTTON_COPY)
      expect(markup).not.toContain('USAGE_NOTICE_SENTINEL')
    })

    it('yields to the connection-error chip on a retryable daemon error', () => {
      const markup = renderToStaticMarkup(
        <ComposerErrorSlot onReconnect={() => {}}
          status={{
            type: 'error',
            error: { code: 'server.binary_offline', message: 'offline', retryable: true }
          }}
          onRepair={() => {}}
          notice={sentinel}
        />
      )
      expect(markup).toContain(COMPOSER_ERROR_CHIP_COPY)
      expect(markup).not.toContain('USAGE_NOTICE_SENTINEL')
    })

    // The notice fills the slot only while the connection is HEALTHY. `disconnected` and `connecting`
    // are stricter than AC4 asks for and deliberately so: #279's banner is up on both, and a quota
    // claim beside it would contradict the more urgent fact.
    it.each([
      ['disconnected', { type: 'disconnected' } as ConnectionStatus],
      ['connecting', { type: 'connecting' } as ConnectionStatus]
    ])('renders nothing at all while %s — not the notice, not an empty element', (_label, status) => {
      expect(
        renderToStaticMarkup(
          <ComposerErrorSlot onReconnect={() => {}} status={status} onRepair={() => {}} notice={sentinel} />
        )
      ).toBe('')
    })

    it('renders the notice, and only the notice, while connected', () => {
      const markup = renderToStaticMarkup(
        <ComposerErrorSlot onReconnect={() => {}} status={{ type: 'connected', ack }} onRepair={() => {}} notice={sentinel} />
      )
      expect(markup).toBe('<p>USAGE_NOTICE_SENTINEL</p>')
    })

    // The empty half: a connected slot with no reading renders nothing at all, which is what keeps the
    // row's geometry identical to its pre-#1321 shape in the overwhelmingly common case.
    it('renders nothing at all while connected with no notice to draw', () => {
      expect(
        renderToStaticMarkup(
          <ComposerErrorSlot onReconnect={() => {}} status={{ type: 'connected', ack }} onRepair={() => {}} notice={null} />
        )
      ).toBe('')
    })
  })

  // #1435's AC3 — the task count is the slot's LAST reading, so every occupant above outranks it. A
  // SENTINEL pill element, the #1321 technique one describe up: this block asserts the ordering and
  // nothing about the pill's own markup, which the ComposerTaskCount describe below owns. Every arm is
  // written in BOTH directions, the #963 rule this describe opens with — a slot that rendered two
  // occupants would pass a one-directional check.
  describe('the task count is the lowest-priority occupant (#1435 AC3)', () => {
    const pill = <p>TASK_COUNT_SENTINEL</p>
    const above = <p>HIGHER_READING_SENTINEL</p>

    it('yields to the actionable-error button on a terminal, non-retryable error', () => {
      const markup = renderToStaticMarkup(
        <ComposerErrorSlot onReconnect={() => {}}
          status={{ type: 'error', error: { code: 'pairing-rejected', message: 'gave up', retryable: false } }}
          onRepair={() => {}}
          notice={null}
          taskCount={pill}
        />
      )
      expect(markup).toContain(COMPOSER_REPAIR_BUTTON_COPY)
      expect(markup).not.toContain('TASK_COUNT_SENTINEL')
    })

    it('yields to the connection-error chip on a retryable daemon error', () => {
      const markup = renderToStaticMarkup(
        <ComposerErrorSlot onReconnect={() => {}}
          status={{
            type: 'error',
            error: { code: 'server.binary_offline', message: 'offline', retryable: true }
          }}
          onRepair={() => {}}
          notice={null}
          taskCount={pill}
        />
      )
      expect(markup).toContain(COMPOSER_ERROR_CHIP_COPY)
      expect(markup).not.toContain('TASK_COUNT_SENTINEL')
    })

    // The four connected-arm readings, each proven to outrank the pill on its own. Driven off the prop
    // NAME so a future reordering of the `??` chain reddens here rather than silently demoting one of
    // them past the count.
    it.each([['recovery'], ['refusal'], ['notice'], ['history']] as const)(
      'yields to the %s reading while connected',
      (slot) => {
        const markup = renderToStaticMarkup(
          <ComposerErrorSlot onReconnect={() => {}}
            status={{ type: 'connected', ack }}
            onRepair={() => {}}
            notice={slot === 'notice' ? above : null}
            recovery={slot === 'recovery' ? above : null}
            refusal={slot === 'refusal' ? above : null}
            history={slot === 'history' ? above : null}
            taskCount={pill}
          />
        )
        expect(markup).toContain('HIGHER_READING_SENTINEL')
        expect(markup).not.toContain('TASK_COUNT_SENTINEL')
      }
    )

    it('fills the slot while connected with every reading above it absent (AC1)', () => {
      const markup = renderToStaticMarkup(
        <ComposerErrorSlot onReconnect={() => {}}
          status={{ type: 'connected', ack }}
          onRepair={() => {}}
          notice={null}
          taskCount={pill}
        />
      )
      expect(markup).toBe('<p>TASK_COUNT_SENTINEL</p>')
    })

    // AC2's connection half, in the strict exact-empty form: the count says nothing about a link that is
    // down, and #279's banner is up on both arms saying so.
    it.each([
      ['disconnected', { type: 'disconnected' } as ConnectionStatus],
      ['connecting', { type: 'connecting' } as ConnectionStatus]
    ])('renders nothing at all while %s — not the pill, not an empty element', (_label, status) => {
      expect(
        renderToStaticMarkup(
          <ComposerErrorSlot onReconnect={() => {}} status={status} onRepair={() => {}} notice={null} taskCount={pill} />
        )
      ).toBe('')
    })

    // The prop is OPTIONAL, matching `recovery` / `refusal` / `history` — omitting it must leave the
    // pre-#1435 render byte-identical, which is what let every existing call site in this file stand
    // unchanged. The exact empty string is the assertion, since a `?? null` that had become `?? <></>`
    // would pass a not.toContain.
    it('renders nothing at all while connected with the prop omitted entirely', () => {
      expect(
        renderToStaticMarkup(
          <ComposerErrorSlot onReconnect={() => {}} status={{ type: 'connected', ack }} onRepair={() => {}} notice={null} />
        )
      ).toBe('')
    })
  })
})

// #1435: the task count's own pure view. An injected count, the ComposerUsageLimitNotice discipline and
// for its reason — zustand v5's useStore reads getInitialState() under renderToStaticMarkup, so a
// store-bound container test can reach exactly one arm, and the count's arms are only assertable if the
// number is a prop.
describe('ComposerTaskCount — the background-task reading in the status row (#1435)', () => {
  it('reads "n tasks running" for a count above one (AC1)', () => {
    const markup = renderToStaticMarkup(<ComposerTaskCount count={6} onOpen={() => {}} />)
    expect(markup).toContain('6 tasks running')
  })

  // The singular is a distinct run, not a suffix trimmed off the plural, so it is asserted in both
  // directions: "1 tasks running" is the failure this catches and it contains the singular as a
  // substring, which a one-directional check would pass on.
  it('reads "1 task running" for exactly one task (AC1)', () => {
    const markup = renderToStaticMarkup(<ComposerTaskCount count={1} onOpen={() => {}} />)
    expect(markup).toContain('1 task running')
    expect(markup).not.toContain('1 tasks running')
  })

  // AC2, in the STRICT exact-empty form the neighbouring describes use. A not.toContain would pass on a
  // rendered-but-empty pill, which is precisely the criterion's failure mode — and it is why the
  // container creates no element at a zero count either (the `??` chain does not filter one).
  it('renders nothing at all at a zero count — not an empty element (AC2)', () => {
    expect(renderToStaticMarkup(<ComposerTaskCount count={0} onOpen={() => {}} />)).toBe('')
  })

  // The count reaches this view as `tasks.size + droppedTasks`, and `dropped_tasks` decodes through a
  // plain requireNumber — so a hostile or buggy daemon can drive the sum negative. It reads as absent,
  // never as "-3 tasks running".
  it('renders nothing at all at a negative count', () => {
    expect(renderToStaticMarkup(<ComposerTaskCount count={-3} onOpen={() => {}} />)).toBe('')
  })

  // AC5's class half, in both directions: a task count is not an error and must not wear the error
  // pair's treatment. The base class is what carries the Pill's ground, ink and 24px box, so a render
  // that dropped it would still pass every copy assertion above.
  it('wears the neutral Pill class and not the error chip treatment (AC5)', () => {
    const markup = renderToStaticMarkup(<ComposerTaskCount count={6} onOpen={() => {}} />)
    expect(markup).toContain('composer-status__tasks')
    expect(markup).not.toContain('composer-status__error')
    expect(markup).not.toContain('button-small')
  })

  // AC4's element half. A real <button>, not a div wearing a click handler: keyboard activation, the
  // focus ring and the accessible name all come from the element rather than from the class. The name is
  // the visible text, so there is no aria-label to drift from it and no hidden prefix — the copy says
  // what it is in plain words (the ComposerUsageLimitNotice ruling).
  it('is a real button whose accessible name is its visible text (AC4)', () => {
    const markup = renderToStaticMarkup(<ComposerTaskCount count={6} onOpen={() => {}} />)
    expect(markup).toContain('<button')
    expect(markup).toContain('type="button"')
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('composer-status__error-prefix')
  })
})

// #1321: the notice's own pure view. Injected reading + injected instant, which is the only shape a
// static server render can prove in this repo — and `usageLimitNotice.test.ts` owns the copy itself, so
// this block asserts only what is a property of the MARKUP.
describe('ComposerUsageLimitNotice — the usage-limit reading in the status row (#1321)', () => {
  const NOW = Math.floor(new Date(2026, 8, 9, 13, 55, 0, 0).getTime() / 1000)

  const reading = (over: Partial<UsageLimitReading>): UsageLimitReading => ({
    status: 'rejected',
    limitType: 'five_hour',
    resetsAt: 0,
    ...over
  })

  // The absent case in the STRICT exact-empty form the two describes above use: that is what proves
  // "nothing at all", which a not.toContain would pass on a rendered-but-empty wrapper.
  it('renders nothing at all with no reading — not an empty element', () => {
    expect(
      renderToStaticMarkup(<ComposerUsageLimitNotice reading={null} nowSeconds={NOW} />)
    ).toBe('')
  })

  // AC1/AC2's markup half. Both directions on each arm: the treatment carries the fill, so a view
  // emitting the base class alone — or both modifiers — would pass a one-directional check and ship an
  // unstyled notice, or a warning wearing the error fill.
  it('wears the exhausted modifier, and not the warning one, for a `rejected` reading (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ComposerUsageLimitNotice reading={reading({ status: 'rejected' })} nowSeconds={NOW} />
    )
    expect(markup).toContain('composer-status__usage')
    expect(markup).toContain('composer-status__usage--exhausted')
    expect(markup).not.toContain('composer-status__usage--warning')
    expect(markup).toContain(USAGE_LIMIT_EXHAUSTED_COPY)
  })

  it('wears the warning modifier, and not the exhausted one, for any other status (AC2)', () => {
    const markup = renderToStaticMarkup(
      <ComposerUsageLimitNotice reading={reading({ status: 'allowed_warning' })} nowSeconds={NOW} />
    )
    expect(markup).toContain('composer-status__usage--warning')
    expect(markup).not.toContain('composer-status__usage--exhausted')
    expect(markup).toContain(USAGE_LIMIT_WARNING_COPY)
  })

  // A <div>, on ComposerErrorChip's recorded reason — no global margin reset here, so a <p>'s UA margin
  // would move a row whose height is its occupant's.
  it('is a <div>, and carries no live region and no hidden prefix', () => {
    const markup = renderToStaticMarkup(
      <ComposerUsageLimitNotice reading={reading({})} nowSeconds={NOW} />
    )
    expect(markup.startsWith('<div')).toBe(true)
    expect(markup).not.toContain('aria-')
    expect(markup).not.toContain('role=')
    expect(markup).not.toContain('composer-status__error-prefix')
  })

  // AC3's DOM half, and the discharge of the constraint `usageLimitStore` inherited. Sentinels on both
  // untrusted fields, checked against the WHOLE markup rather than the text — which covers the class
  // attribute too, the one place a treatment interpolated into a template would have leaked.
  it('lets no daemon-authored string reach the DOM, in text or in an attribute (AC3)', () => {
    const markup = renderToStaticMarkup(
      <ComposerUsageLimitNotice
        reading={{ status: 'DAEMON_STATUS', limitType: 'DAEMON_LIMIT', resetsAt: 0 }}
        nowSeconds={NOW}
      />
    )
    expect(markup).not.toContain('DAEMON_STATUS')
    expect(markup).not.toContain('DAEMON_LIMIT')
    expect(markup).toBe(
      `<div class="composer-status__usage composer-status__usage--warning">${USAGE_LIMIT_WARNING_COPY}</div>`
    )
  })

  // AC3's `resetsAt: 0` half at the markup tier — no epoch anywhere on screen — plus the unnamed-window
  // arm, both in one render because both are absences and an exact-markup assertion proves them together.
  it('drops the reset clause and the window name rather than inventing either (AC3)', () => {
    const markup = renderToStaticMarkup(
      <ComposerUsageLimitNotice
        reading={{ status: 'rejected', limitType: 'overage', resetsAt: 0 }}
        nowSeconds={NOW}
      />
    )
    expect(markup).toBe(
      `<div class="composer-status__usage composer-status__usage--exhausted">${USAGE_LIMIT_EXHAUSTED_COPY}</div>`
    )
    expect(markup).not.toContain('1970')
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
  //
  // #1062 turned ONE exact pin into THREE, one per severity step, and that is the tripwire this
  // component's own comment promised working rather than an obstacle to route around: the reading now has
  // three renderings and each one is pinned whole. The primary arm below is byte-identical to the string
  // this file pinned before #1062 — the step that reads "nothing to see" must not have moved at all.
  it('renders the percentage as a single bare text run — no handler, no tabindex, no role (AC1, AC3)', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={98000} windowTokens={200000} />
    )
    expect(markup).toBe('<span class="composer__context">Context: 49%</span>')
  })

  // #1062 AC2/AC4: the middle step wears the modifier and NOTHING else changes — same prefix, same single
  // run, same base class LEADING (which is what keeps the five footer-order assertions further down this
  // file, all of which locate the reading by substring, honest). The 50 here is the boundary itself:
  // contextUsageStep's own tests pin 49/50 as values, and this pins that the view actually asks it.
  it('wears the warning modifier from 50%, with the text unchanged (AC2, AC4)', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={100000} windowTokens={200000} />
    )
    expect(markup).toBe(
      '<span class="composer__context composer__context--warning">Context: 50%</span>'
    )
  })

  // #1062 AC2/AC4: the top step, where the string itself changes. The word is the non-colour channel for
  // the one step that means "act now", and it is a WORD rather than a glyph because a glyph inside a text
  // run cannot be hidden from a screen reader. Still one run, still nothing but a class attribute.
  it('wears the error modifier and says "high" from 70% (AC2, AC4)', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={140000} windowTokens={200000} />
    )
    expect(markup).toBe(
      '<span class="composer__context composer__context--error">Context high: 70%</span>'
    )
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

  // An over-full session is the top step by definition, so #1062's word rides the clamp too — this is the
  // longest string the reading can ever produce (18 characters, the bound .composer__context's nowrap
  // comment now states).
  it('clamps an over-full session to 100% rather than running past it', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={250000} windowTokens={200000} />
    )
    expect(markup).toContain('Context high: 100%')
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

// A ConversationCreatedPayload fixture — the store's held value, verbatim off the wire. It arrived with
// #278's workspace chip and outlived it: #1486 removed that chip, and the ChannelInfoSheetView tests below
// are this helper's readers now. The container store read (activeConversationStore) is covered by
// activeConversationStore.test.ts; the created-event write path by conversationCreatedBridge.test.ts +
// PairedShell composition.
function createdPayload(
  overrides: Partial<ConversationCreatedPayload> = {}
): ConversationCreatedPayload {
  return {
    id: 'c1',
    is_promoted: false,
    cwd: '/home/pyry/scratch',
    name: null,
    last_used_at: '2026-07-12T00:00:00Z',
    workspace_label: null,
    ...overrides
  }
}

// #276: the thread top-bar overflow menu. ThreadOverflowMenuView is the pure, exported view (the
// ComposerSendButton / ThinkingIndicator pattern) — server-render it with an injected `open` boolean to
// prove the collapsed trigger and the opened menu surface without a store or a DOM harness. The
// interaction shell (open/close toggle, Escape / outside-click dismiss, focus-return) lives in the
// in-file ThreadOverflowMenu container: it is untested reviewed glue, exactly like Composer.handleKeyDown
// and Composer.handleSubmit — the `node` env fires no clicks and runs no effects. (UnpairControl's phase
// transitions were the other example until #1061 deleted that control.)
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

  it('places the #1078 System prompt slot between the About detail and the Actions header', () => {
    // Position, not content — the section owns its own header and is unit-tested in
    // SystemPromptSection.test.tsx. The ticket puts it beside the About rows and ABOVE the actions, and
    // nothing else would catch a slot that drifted below them.
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView
        conversation={createdPayload()}
        onClose={noop}
        systemPromptSection={<p>the slot</p>}
      />
    )
    expect(markup.indexOf('Last activity')).toBeLessThan(markup.indexOf('the slot'))
    expect(markup.indexOf('the slot')).toBeLessThan(markup.indexOf('Actions'))
  })

  it('omits the #1078 System prompt slot entirely when the container supplies none', () => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={null} onClose={noop} />)
    expect(markup).not.toContain('System prompt')
  })

  it('renders the Actions section header over an empty slot — no action buttons this ticket (AC5)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} />
    )
    expect(markup).toContain('Actions')
    // The Archive / Delete / Edit-chat / Change-workspace tickets fill the slot; none exist here (AC5/AC6).
    expect(markup).not.toContain('Edit chat')
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

  // #368: the rename action fills the Actions slot #365 left empty. It is gated on the `onRename`
  // callback, which the container supplies ONLY when there is an active conversation to rename — so
  // the button's presence maps one-to-one onto AC1 (present with a conversation, absent on the
  // list-opened null-conversation case).
  it('renders an Edit chat action in the Actions slot when a conversation and onRename are supplied (AC1)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} onRename={noop} />
    )
    // The tonal pill lands in the existing Actions mount point, labelled "Edit chat" since #1440 — the
    // word moved with the dialog it opens, while `onRename` kept its prop name. The quote-terminated
    // class distinguishes the button (.channel-info__action) from the plural slot (.channel-info__actions).
    expect(markup).toContain('class="channel-info__action"')
    expect(markup).toContain('>Edit chat</button>')
  })

  // #1431: the SAME pill, one word apart. `is_promoted` is the wire's only signal for "this is a saved
  // channel rather than an ad-hoc discussion", and the view already reads three other fields off the
  // payload it holds — so the word is derived there rather than handed in as a second authority on a
  // fact already in scope. These two cases are each other's negative: whichever word renders, the other
  // must be absent, because a sheet showing both would mean the branch fell through.
  it('reads Edit channel, not Edit chat, when the open conversation is a promoted channel (#1431)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView
        conversation={createdPayload({ is_promoted: true, name: 'Saved channel' })}
        onClose={noop}
        onRename={noop}
      />
    )
    expect(markup).toContain('class="channel-info__action"')
    expect(markup).toContain('>Edit channel</button>')
    expect(markup).not.toContain('Edit chat')
  })

  it('keeps Edit chat for a non-promoted conversation (#1431)', () => {
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView
        conversation={createdPayload({ is_promoted: false, name: 'Scratch chat' })}
        onClose={noop}
        onRename={noop}
      />
    )
    expect(markup).toContain('>Edit chat</button>')
    expect(markup).not.toContain('Edit channel')
  })

  it('offers no Edit chat action when the active conversation is null (the graceful-empty guard, AC1)', () => {
    // A list-opened thread (conversation === null) gets no onRename from the container, so the
    // Actions header renders over an empty slot — no Edit chat control, consistent with #365's empty About.
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={null} onClose={noop} />)
    expect(markup).toContain('Actions')
    expect(markup).not.toContain('class="channel-info__action"')
    expect(markup).not.toContain('Edit chat')
  })

  it('offers no Edit chat action when onRename is omitted, even with a conversation (callback-gated, AC1)', () => {
    // The button is gated on the callback, not the conversation alone — this proves the view honours
    // the container's null-guard contract rather than deriving the button from `conversation` itself.
    const markup = renderToStaticMarkup(
      <ChannelInfoSheetView conversation={createdPayload()} onClose={noop} />
    )
    expect(markup).not.toContain('class="channel-info__action"')
    expect(markup).not.toContain('Edit chat')
  })

  // #366: the Archive action fills the Actions slot's second row, reusing #368's `.channel-info__action`
  // tonal pill verbatim. Like Edit chat it is callback-gated (`onArchive`), which the container supplies
  // ONLY for an active conversation — so its presence maps one-to-one onto AC1. Edit chat and Archive now
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
    // The HELD timeline itself, not a copy. That `Object.is` identity is what makes the switch cheap: a
    // write for another conversation rebuilds the outer map but copies every survivor by reference, so
    // this screen does not re-render (`withNewSliceAtHead`'s by-reference survivor copy). Since #1259 a
    // key holds a `ConversationSlice` — the timeline plus the state of the ask that backfilled it — so
    // the identity to assert is the slice's `timeline` half, which is exactly what `selectTimelineFor`
    // projects. That indirection is also what keeps a history-request write from waking this screen.
    expect(thread).toBe(store.getState().timelines.get('conv-a')?.timeline)
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
  const CONNECTED: ConnectionStatus = {
    type: 'connected',
    ack: { protocol_version: '1', server_id: 'host', conn_id: 'connection', capabilities: [] }
  }
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
    expect(markup.match(/class="conversation__thread"/g)).toHaveLength(1)
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
    const restore = stageOpenConnection({
        type: 'error',
        error: { code: 'server.binary_offline', message: 'offline', retryable: true }
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
      restore()
    }
  })

  // #963: the actionable button's PRESENT arm through the mounted container — the only test that proves
  // the slot control reached the row's `trailing` prop with a working `onRepair`, and the only one that
  // can prove `.composer__repair` is gone from the tree in the very state that used to render it.
  //
  // The same getInitialState SPY as the chip test above, and for the same reason: zustand v5's useStore
  // reads getInitialState() under renderToStaticMarkup, never getState(), so the block's beforeEach
  // cannot stage this arm. The status here differs from the chip test's only in being one shouldOfferRepair
  // admits — explicit, non-retryable pairing rejection — which is what flips the
  // slot's occupant.
  it('mounts the actionable button in the status row once the pairing is terminally dead (AC1, AC2)', () => {
    const restore = stageOpenConnection({ type: 'error', error: { code: 'pairing-rejected', message: 'gave up', retryable: false } })
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
      restore()
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

  it('hides Actions without connected ownership while retaining the footer', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).toContain('class="composer__footer"')
    expect(markup).not.toContain(ACTIONS_TRIGGER_CLASS_RUN)
  })

  it('places the closed Actions trigger first in the connected footer', () => {
    const restore = stageOpenConnection(CONNECTED)
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      const footerAt = markup.indexOf('class="composer__footer"')
      const anchorAt = markup.indexOf('class="composer-options-anchor"')
      expect(footerAt).toBeGreaterThanOrEqual(0)
      expect(anchorAt).toBeGreaterThan(footerAt)
      expect(markup.indexOf(ACTIONS_TRIGGER_CLASS_RUN)).toBeGreaterThan(anchorAt)
      expect(markup).toContain(COMPOSER_ACTIONS_LABEL)
      expect(markup).toContain('aria-expanded="false"')
      expect(markup).not.toContain('composer-options__item')
      expect(markup.slice(footerAt, anchorAt)).not.toContain('composer__context')
    } finally {
      restore()
    }
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
      snapshot: {
        model: '',
        effort: '',
        yolo: false,
        permissionMode: 'default',
        usedTokens: 168000,
        windowTokens: 200000
      }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      // 84% is the top step since #1062, so the mounted reading says "high" — the seeded figures are the
      // design's own (Figma 110:3497) and are left as they are, because a mount proof is stronger when it
      // reads the string the shipped surface actually shows.
      expect(markup).toContain('Context high: 84%')
      // In the ROW, not loose in the composer: the reading follows .composer__footer's opening tag.
      expect(markup.indexOf('composer__context')).toBeGreaterThan(
        markup.indexOf('class="composer__footer"')
      )
    } finally {
      spy.mockRestore()
    }
  })

  // #1421: claude's own reading displaces the settings-derived figure. BOTH stores are seeded, with
  // percentages that share no text — 25% from the settings pair, 73% from the reading — so the assertion
  // fails in both directions: an unwired read leaves 25% standing, and a fallback firing wrongly would
  // show it too. Staged over stageOpenConnection, because the reading is keyed by the OPEN conversation's
  // id and an unstaged screen has none (which is the fallback arm, covered by the shipped test above).
  //
  // getInitialState spies for the same reason as every sibling here: zustand v5's useStore reads
  // getInitialState() under renderToStaticMarkup, never getState(), so a setState seed is invisible.
  it('renders claude’s reported figure in the footer, not the settings-derived one (AC1)', () => {
    const restore = stageOpenConnection(CONNECTED)
    const runConfig = seedRunConfigTokens(50000, 200000)
    const reported = seedReportedContext('open', { totalTokens: 146000, maxTokens: 200000 })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup).toContain('Context high: 73%')
      expect(markup).not.toContain('Context: 25%')
    } finally {
      reported.mockRestore()
      runConfig.mockRestore()
      restore()
    }
  })

  // AC3's sharp edge at the surface: a PRESENT reading whose maximum is zero is a real reading claude
  // reported, so it wins and resolves to the unavailable state this control already ships (no element at
  // all) — it does NOT fall back. The settings pair beside it is seeded non-zero, so a fallback firing
  // here would draw "Context: 25%" and fail loudly rather than silently.
  it('shows no reading for a present reading whose maximum is zero, rather than falling back (AC3)', () => {
    const restore = stageOpenConnection(CONNECTED)
    const runConfig = seedRunConfigTokens(50000, 200000)
    const reported = seedReportedContext('open', { totalTokens: 146000, maxTokens: 0 })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup).not.toContain('composer__context')
      expect(markup).not.toContain('Context:')
    } finally {
      reported.mockRestore()
      runConfig.mockRestore()
      restore()
    }
  })

  // The absent arm through the MOUNTED control, with a conversation open — the shipped mount test above
  // covers it with none open, which takes the NO_REPORTED_CONTEXT path instead. This one proves the real
  // selector misses: a reading held for ANOTHER conversation leaves this one on the settings figure,
  // rather than the other chat's reading leaking across.
  it('keeps the settings-derived figure when the reading belongs to another conversation (AC1)', () => {
    const restore = stageOpenConnection(CONNECTED)
    const runConfig = seedRunConfigTokens(50000, 200000)
    const reported = seedReportedContext('some-other-conversation', {
      totalTokens: 146000,
      maxTokens: 200000
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup).toContain('Context: 25%')
      expect(markup).not.toContain('73%')
    } finally {
      reported.mockRestore()
      runConfig.mockRestore()
      restore()
    }
  })

  // #988: the model menu's mount site — the only proof the control is wired into the row, since every
  // assertion in ComposerModelMenu.test.tsx passes on an UNMOUNTED component.
  //
  // The same getInitialState SPY as the reading above, and for the same reason: zustand v5 reads
  // getInitialState() under renderToStaticMarkup. With no model list published (the model-list store's
  // initial state is an empty map) the control renders AC4's inert label, which is exactly what makes
  // this a mount proof — the label is the seeded snapshot's own model value, so it can only appear if the
  // container actually read the snapshot.
  it('mounts the model control in the footer row, between Actions and the reading (AC1, AC4)', () => {
    const restoreConnection = stageOpenConnection(CONNECTED)
    const sessionId = vi.spyOn(sessionIdStore, 'getInitialState').mockReturnValue({
      ...sessionIdStore.getInitialState(), sessionId: 'held-session'
    })
    const initial = runConfigStore.getInitialState()
    const spy = vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({
      ...initial,
      snapshot: {
        model: 'seeded-session-model',
        effort: '',
        yolo: false,
        permissionMode: 'default',
        usedTokens: 168000,
        windowTokens: 200000
      }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      const triggerAt = markup.indexOf(ACTIONS_TRIGGER_CLASS_RUN)
      const modelAt = markup.indexOf('composer__model-label')
      expect(triggerAt).toBeGreaterThan(-1)
      // The design's item order: Actions, then the model control, then the reading.
      expect(modelAt).toBeGreaterThan(triggerAt)
      expect(markup.indexOf('composer__context')).toBeGreaterThan(modelAt)
      // The mount proof's own half, through the mounted container: nothing is published, so the label is
      // derived from the session's own model value — `seeded-session-model` reads as `Seeded` since
      // #1095. Still a mount proof, and a slightly stronger one: only a container that read the snapshot
      // AND ran the derivation can produce this string.
      expect(markup).toContain('>Seeded<')
      expect(markup).not.toContain('>seeded-session-model<')
      // AC4's inert arm: THIS control announces no popup and opens no anchor. The count is 2 rather than
      // 1 since #682 — the seeded snapshot names a permission mode, and that control's entries are a
      // client-owned constant and its owning host is connected, so it is operable here. Both counts moved
      // together, which is what keeps this an assertion about the model control's inert arm.
      expect(markup.split('aria-haspopup="menu"').length - 1).toBe(2)
      expect(markup.split('class="composer-options-anchor"').length - 1).toBe(2)
    } finally {
      spy.mockRestore()
      restoreConnection()
      sessionId.mockRestore()
    }
  })

  // #989: the effort menu's mount site — required, not optional coverage, for the reason stated above:
  // every assertion in ComposerEffortMenu.test.tsx passes on an UNMOUNTED component.
  //
  // The snapshot seeds a non-empty EFFORT as well as a non-empty model, which is what makes both footer
  // menus visible at once and lets this test pin the row's ORDER — the one claim neither component's own
  // file can make. With no model list published (the model-list store's initial state is an empty map)
  // both render their inert arms, so each label can only appear if its container actually read the
  // snapshot. Connected ownership leaves Actions and permission mode operable.
  it('mounts the effort control in the footer row, between the model control and the reading (AC1, AC3)', () => {
    const restoreConnection = stageOpenConnection(CONNECTED)
    const sessionId = vi.spyOn(sessionIdStore, 'getInitialState').mockReturnValue({
      ...sessionIdStore.getInitialState(), sessionId: 'held-session'
    })
    const initial = runConfigStore.getInitialState()
    const spy = vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({
      ...initial,
      snapshot: {
        model: 'seeded-session-model',
        effort: 'seeded-session-effort',
        yolo: false,
        permissionMode: 'default',
        usedTokens: 168000,
        windowTokens: 200000
      }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      const modelAt = markup.indexOf('composer__model-label')
      const effortAt = markup.indexOf('composer__effort-label')
      expect(markup.indexOf(ACTIONS_TRIGGER_CLASS_RUN)).toBeGreaterThan(-1)
      expect(modelAt).toBeGreaterThan(-1)
      // The design's item order: Actions, the model control, the effort control, then the reading.
      expect(effortAt).toBeGreaterThan(modelAt)
      expect(markup.indexOf('composer__context')).toBeGreaterThan(effortAt)
      // The session's effort VERBATIM, through the mounted container — no relabelling, no capitalisation.
      expect(markup).toContain('>seeded-session-effort<')
      // AC3's inert arm: THIS control adds no popup announcement and no anchor. 2 rather than 1 since
      // #682 for the reason given one test above — connected ownership and the seeded mode make that control, and
      // only that control, operable here.
      expect(markup.split('aria-haspopup="menu"').length - 1).toBe(2)
      expect(markup.split('class="composer-options-anchor"').length - 1).toBe(2)
    } finally {
      spy.mockRestore()
      restoreConnection()
      sessionId.mockRestore()
    }
  })

  // #682: the permission-mode menu's mount site — required, not optional coverage, for the reason the two
  // tests above state: every assertion in ComposerPermissionModeMenu.test.tsx passes on an UNMOUNTED
  // component.
  //
  // The snapshot seeds all three fields, which is what draws every footer control at once and lets this
  // test pin the row's FULL order — the one claim no component's own file can make. With no model list
  // published the model and effort controls render their inert arms while this one is operable (its
  // entries are a client-owned constant), so the row's popup and anchor counts are exactly 2: the Actions
  // trigger and this one. That pair of counts is also the mount proof's sharpest half — it can only hold
  // if this container really read the snapshot.
  it.each([true, false])('mounts the permission-mode control in footer order with connected ownership: %s', (connected) => {
    const restoreConnection = connected ? stageOpenConnection(CONNECTED) : () => {}
    const sessionId = vi.spyOn(sessionIdStore, 'getInitialState').mockReturnValue({
      ...sessionIdStore.getInitialState(), sessionId: 'held-session'
    })
    const initial = runConfigStore.getInitialState()
    const spy = vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({
      ...initial,
      snapshot: {
        model: 'seeded-session-model',
        effort: 'seeded-session-effort',
        yolo: false,
        permissionMode: 'acceptEdits',
        usedTokens: 168000,
        windowTokens: 200000
      }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      const permissionAt = markup.indexOf('composer__permission-label')
      const modelAt = markup.indexOf('composer__model-label')
      // Figma 110:3494's order, in full: Actions, permission mode, model, effort, then the reading.
      if (connected) expect(markup.indexOf(ACTIONS_TRIGGER_CLASS_RUN)).toBeGreaterThan(-1)
      else expect(markup).not.toContain(ACTIONS_TRIGGER_CLASS_RUN)
      expect(permissionAt).toBeGreaterThan(markup.indexOf(ACTIONS_TRIGGER_CLASS_RUN))
      expect(modelAt).toBeGreaterThan(permissionAt)
      expect(markup.indexOf('composer__effort-label')).toBeGreaterThan(modelAt)
      // The DISPLAY name for the seeded mode, through the mounted container — the camelCase machine value
      // must not reach the row, which is where this control departs from the effort trigger beside it.
      expect(markup).toContain(`>${PERMISSION_MODE_LABELS.acceptEdits}<`)
      expect(markup).not.toContain('>acceptEdits<')
      // Connected ownership enables permission choices; without ownership all mutation menus stay hidden.
      // Held labels and their order must survive in both presentations.
      expect(markup.split('aria-haspopup="menu"').length - 1).toBe(connected ? 2 : 0)
      expect(markup.split('class="composer-options-anchor"').length - 1).toBe(connected ? 2 : 0)
    } finally {
      spy.mockRestore()
      restoreConnection()
      sessionId.mockRestore()
    }
  })

  // #863: the attach button's mount site, and the only proof it is wired into the row — every assertion in
  // ComposerAttach.test.tsx passes on an UNMOUNTED component.
  //
  // It renders UNCONDITIONALLY, unlike the three menus beside it: they each go inert or absent until a
  // run-config snapshot has arrived, while this control has no daemon-published anything to be missing.
  // So this half needs no store spy at all — which is itself the assertion, since a control gated on a
  // snapshot it does not need would fail here.
  it('mounts the attach button in the footer row against the empty stores (AC1)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    const footerAt = markup.indexOf('class="composer__footer"')
    const attachAt = markup.indexOf(ATTACH_TRIGGER_CLASS_RUN)
    expect(footerAt).toBeGreaterThanOrEqual(0)
    expect(attachAt).toBeGreaterThan(footerAt)
    expect(markup).toContain(`aria-label="${COMPOSER_ATTACH_LABEL}"`)
    // It adds no popup and no anchor to the row: it is a button, not a menu. Stated here because the
    // anchor and aria-haspopup counts three tests up are re-derived by every footer ticket that lands a
    // MENU, and this one deliberately leaves them where it found them — which is why those two counts
    // needed no re-count with this ticket, unlike every sibling before it.
    //
    // Read off the attach button's OWN tag, not off the whole markup: the Actions trigger renders both an
    // anchor and an aria-haspopup in this same render, so a document-wide `not.toContain` asserts the
    // opposite of what it looks like and fails against a correct implementation.
    const attachTag = markup.match(/<button[^>]*composer__attach"[^>]*>/)?.[0]
    expect(attachTag).toBeTruthy()
    expect(attachTag).not.toContain('aria-haspopup')
    expect(attachTag).not.toContain('aria-expanded')
    expect(attachTag).not.toContain('disabled')
  })

  // AC1's "the row's LAST item", in the only form a static render can state it: past the context reading,
  // which is the item the design puts immediately before it. The same getInitialState SPY as the three
  // tests above, and for the same reason — zustand v5 reads getInitialState() under renderToStaticMarkup,
  // so a seeded snapshot is what makes the reading (and the three menu labels) appear at all.
  it('places the attach button last in the footer row, past all four controls and the reading (AC1)', () => {
    const initial = runConfigStore.getInitialState()
    const spy = vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({
      ...initial,
      snapshot: {
        model: 'seeded-session-model',
        effort: 'seeded-session-effort',
        yolo: false,
        permissionMode: 'acceptEdits',
        usedTokens: 168000,
        windowTokens: 200000
      }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      const attachAt = markup.indexOf(ATTACH_TRIGGER_CLASS_RUN)
      const contextAt = markup.indexOf('composer__context')
      expect(contextAt).toBeGreaterThan(-1)
      expect(attachAt).toBeGreaterThan(contextAt)
      // And past every control ahead of the reading, so this holds as the row's order changes rather than
      // only against the reading's current position.
      expect(attachAt).toBeGreaterThan(markup.indexOf('composer__effort-label'))
      expect(attachAt).toBeGreaterThan(markup.indexOf('composer__model-label'))
      expect(attachAt).toBeGreaterThan(markup.indexOf('composer__permission-label'))
      expect(attachAt).toBeGreaterThan(markup.indexOf(ACTIONS_TRIGGER_CLASS_RUN))
    } finally {
      spy.mockRestore()
    }
  })

  // AC5's second half at the mount site: with no outcome arrived, the composer reserves NOTHING for one.
  // The pure view's own absent arm is proven exact-empty in ComposerAttach.test.tsx; what this adds is
  // that the mounted container starts there — a hook seeded with anything but `null` would fail here.
  it('reserves no space for an outcome before one arrives (AC5)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('composer__attach-outcome')
    // The button is present in the same render, so this is not passing because the composer is absent.
    expect(markup).toContain(ATTACH_TRIGGER_CLASS_RUN)
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

  // #294: the screen's queued-backlog read mounts against the empty queue store (getInitialState backlogs:
  // empty Map → selectBacklogFor returns EMPTY_BACKLOG), so the fold marks nothing and no queued row
  // renders. The populated path is proven on the merged-row describe above.
  //
  // #1214: `.conversation__queued` is GONE as a region — this assertion is now a permanent guard that it
  // never comes back, which is AC5's other half. It cannot go vacuous by accident: the class exists
  // nowhere in `src/` any more, so a re-introduced region would have to re-add it deliberately.
  it('mounts the empty queue store with no queued row and no queued region at all (AC5)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__queued')
    expect(markup).not.toContain('data-thread-role="queued"')
    expect(markup).not.toContain('queued-row__drop')
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

  // #1061: the unpair escape hatch #166 put above the thread is gone, and with it the bare
  // `.conversation__header` row it was the only occupant of. The drawing's Content frame (Figma
  // 106:3321) stacks a message area straight onto an input area, so the thread now starts where that
  // row used to.
  //
  // The first two assertions are the REDDENING detectors: both strings are in this container's markup
  // before the deletion, so this test fails against the old tree and passes only once the component is
  // gone. The third cannot redden through this route — the confirm phase is unreachable under server
  // render, where zustand reports its initial snapshot and no click fires — and it is here as a guard
  // against a re-introduction, not as the proof. AC2's proof is STRUCTURAL: `UnpairControl` is deleted
  // rather than gated, so there is no phase of it left to reach.
  it('renders no unpair control and no header row above the thread (#1061)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__header')
    expect(markup).not.toContain('>Unpair</button>')
    expect(markup).not.toContain('Forget this pairing?')
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

  it('renders the banner above the message thread (top of the thread)', () => {
    // The banner mounts above the timeline surface, so its markup precedes the thread's empty state.
    // It used to be described as sitting between UnpairControl (the header row) and the timeline;
    // #1061 deleted that row, and the banner is now the first thing in the region. The assertion is
    // unchanged and still means what it always meant.
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

  // #1064 AC1: #140's leading back affordance is GONE. Its job since #670 was to deselect — the sidebar
  // is permanently mounted, so the list it "returned to" was already on screen — and the desktop drawing
  // (Figma 106:3321) has no leading affordance above the thread at all.
  //
  // This is #140's own `onBack`-present test INVERTED, and it is the shipped detector for the deletion.
  // Its `onBack`-absent twin went with the control: BackControl already rendered null without the prop,
  // so that assertion passed before this change and after it, discriminating nothing. `onBack` is passed
  // HERE on purpose — it is still the "mounted in the paired shell" signal that gates the overflow menu
  // below, so this is the arm on which the affordance used to render.
  //
  // The accessible name, not the class, is what the assertion reads: AC1 asks for unreachable rather
  // than merely invisible, and a `display: none` rule would still leave the name in the markup.
  it('renders no back affordance on the shell-mounted thread (#1064 AC1)', () => {
    expect(renderToStaticMarkup(<ConversationScreen onBack={() => {}} />)).not.toContain(
      'aria-label="Back"'
    )
  })

  // #276: the thread overflow menu is gated on onBack presence — mounted only when the paired shell wires
  // navigation. That gate used to be shared with this screen's own BackControl, which is the phrasing that
  // stood here; #1064 deleted that control, so the gate is now the overflow menu's alone. (The name is not
  // re-pointed at the SettingsScreen / ArchiveScreen BackControls, which still exist: they are separate
  // per-screen controls that never shared this gate.) When onBack is provided the trailing more_vert trigger
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

  it('renders no menus for a bare ConversationScreen without connected ownership', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__overflow')
    expect(markup).not.toContain('aria-haspopup="menu"')
    expect(markup).not.toContain(ACTIONS_TRIGGER_CLASS_RUN)
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


describe('model rejection in the mounted status row', () => {
  const copy = 'Could not change the model — try again.'
  const connected: ConnectionStatus = {
    type: 'connected',
    ack: { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] }
  }

  it.each([
    [connected, true, null],
    [{ type: 'error', error: { code: 'transport', message: 'untrusted', retryable: true } }, false, COMPOSER_ERROR_CHIP_COPY],
    [{ type: 'error', error: { code: 'transport', message: 'untrusted', retryable: false } }, false, COMPOSER_RECONNECT_BUTTON_COPY],
    [{ type: 'disconnected' }, false, null]
  ] as const)('arbitrates connection priority for %j', (status, visible, higherPriorityCopy) => {
    const restore = stageOpenConnection(status)
    const settings = vi.spyOn(runSettingsWriteStore, 'getInitialState').mockReturnValue({
      ...runSettingsWriteStore.getInitialState(), error: 'model'
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup.includes(copy)).toBe(visible)
      if (visible) expect(markup).toContain('composer-status__error--settings" role="alert"')
      if (higherPriorityCopy !== null) expect(markup).toContain(higherPriorityCopy)
    } finally {
      settings.mockRestore()
      restore()
    }
  })
})

it('disables the held running-turn interrupt when sending is unavailable', () => {
  const markup = renderToStaticMarkup(<ComposerSendButton isRunning canSend={false} onSend={() => {}} onInterrupt={() => {}} />)
  expect(markup).toContain('disabled=""')
})

describe('saved timeline notices', () => {
  it.each([false, true])('isolates saved rows and suppresses partial working state (connected=%s)', connected => {
    const reset = stageOpenConnection(connected ? { type: 'connected', ack: { protocol_version: '1', server_id: 'host', conn_id: 'c', capabilities: [] } } : { type: 'disconnected' })
    const store = createConversationTimelineStore(undefined, () => 'host')
    const held = vi.spyOn(conversationTimelineStore, 'getInitialState').mockImplementation(() => store.getState())
    const render = () => renderToStaticMarkup(<ConversationScreen savedTimelineTarget={{ serverId: 'host', conversationId: 'open' }} />)
    try {
      store.getState().beginLocalTimelineRead('host', 'open')!.complete({ version: 1, kind: 'timeline',
        serverId: 'host', conversationId: 'open', items: [{ kind: 'assistantText', turnId: 'partial', text: 'Saved partial' }],
        prependedRows: 0, coverage: { status: 'unknown' } })
      const html = render()
      expect(html).toContain('Saved partial')
      expect(html).not.toContain('bubble__cursor')
      expect(html).not.toContain('aria-label="Assistant working"')
      expect(html.includes('Offline. Showing saved messages.')).toBe(!connected)
      store.getState().dispatchFor('open', { type: 'assistantDelta', turnId: 'new', seq: 0, text: 'New live reply' })
      expect(render()).toContain('New live reply')
      expect(render().includes('bubble__cursor')).toBe(connected)
      store.getState().beginLocalTimelineRead('other', 'open')!.complete({ version: 1, kind: 'timeline',
        serverId: 'other', conversationId: 'open', items: [{ kind: 'userText', text: 'Other host secret' }],
        prependedRows: 0, coverage: { status: 'unknown' } })
      expect(render()).not.toContain('Other host secret')
    } finally { held.mockRestore(); reset() }
  })

  it.each([false, true])('keeps held queues readable offline but excludes them from restored slices (restored=%s)', (restored) => {
    const reset = stageOpenConnection({ type: 'disconnected' })
    const store = createConversationTimelineStore(undefined, () => 'a')
    if (restored) {
      store.getState().beginLocalTimelineRead('a', 'open')!.complete(null)
    } else {
      store.getState().dispatchFor('open', { type: 'assistantDelta', turnId: 't', seq: 0, text: 'Held reply' })
    }
    const held = vi.spyOn(conversationTimelineStore, 'getInitialState').mockImplementation(() => store.getState())
    const queue = vi.spyOn(queueStore, 'getInitialState').mockReturnValue({
      ...queueStore.getInitialState(), backlogs: new Map([['open', [{ queued_msg_id: 4, text: 'Held queued work', ts: '2026-09-13' }]]])
    })
    try {
      const html = renderToStaticMarkup(<ConversationScreen savedTimelineTarget={{ serverId: 'a', conversationId: 'open' }} />)
      expect(html.includes('Held queued work')).toBe(!restored)
      if (!restored) expect(html).toMatch(/class="queued-row__drop"[^>]*disabled=""/)
    } finally { queue.mockRestore(); held.mockRestore(); reset() }
  })
  it('keeps explicit saved coordinates after metadata reseeding and rejects another host held under the same id', () => {
    const reset = stageOpenConnection({ type: 'disconnected' })
    const store = createConversationTimelineStore()
    const held = vi.spyOn(conversationTimelineStore, 'getInitialState').mockImplementation(() => store.getState())
    const render = () => renderToStaticMarkup(<ConversationScreen savedTimelineTarget={{ serverId: 'a', conversationId: 'open' }} />)
    try {
      for (const serverId of ['a', 'b']) {
        store.getState().beginLocalTimelineRead(serverId, 'open')!.complete({ version: 1, kind: 'timeline',
          serverId, conversationId: 'open', items: [{ kind: 'userText', text: `${serverId} saved copy` }],
          prependedRows: 0, coverage: { status: 'unknown' } })
        const html = render()
        if (serverId === 'a') expect(html).toContain('a saved copy')
        else {
          expect(html).not.toContain('b saved copy')
          // The rejected other-host slice reads as a read still pending, never as a settled result.
          // Asserted positively since #1447: the settled-empty copy it used to exclude no longer exists,
          // which would leave a negative assertion passing over any render at all.
          expect(html).toContain('Loading saved messages…')
        }
      }
    } finally { held.mockRestore(); reset() }
  })
  it('does not render a streaming cursor from an unfinished saved reply', () => {
    const html = renderToStaticMarkup(<Timeline saved items={[{ kind: 'assistantText', turnId: 'partial', text: 'saved' }]} />)
    expect(html).toContain('saved')
    expect(html).not.toContain('bubble__cursor')
  })
  it('distinguishes local failure, pending and offline saved results', () => {
    const render = (status: 'loading' | 'loaded' | 'failed') =>
      renderToStaticMarkup(<SavedTimelineNotice status={status} />)
    expect(render('failed')).toContain('Could not read saved messages on this device.')
    expect(render('loading')).toContain('Loading saved messages…')
    expect(render('loaded')).toContain('Offline. Showing saved messages.')
  })
  // #1447's AC1, both connection states in one case: an empty local copy is the ordinary state of a chat
  // first opened on this machine, not a fault, so it gets no notice at all. The offline leg's second
  // assertion is the other half of that AC — the #279 banner is what announces a disconnection, and it
  // still does, which is why the notice going quiet here costs the reader nothing.
  it.each([false, true])('shows no saved-timeline notice for a loaded, empty local read (connected=%s)', connected => {
    const reset = stageOpenConnection(connected
      ? { type: 'connected', ack: { protocol_version: '1', server_id: 'host', conn_id: 'c', capabilities: [] } }
      : { type: 'disconnected' })
    const store = createConversationTimelineStore(undefined, () => 'host')
    const held = vi.spyOn(conversationTimelineStore, 'getInitialState').mockImplementation(() => store.getState())
    try {
      store.getState().beginLocalTimelineRead('host', 'open')!.complete(null)
      const html = renderToStaticMarkup(<ConversationScreen savedTimelineTarget={{ serverId: 'host', conversationId: 'open' }} />)
      expect(html).not.toContain('No messages are saved on this device.')
      expect(html).not.toContain('Offline. Showing saved messages.')
      expect(html.includes(CONNECTION_BANNER_COPY)).toBe(!connected)
    } finally { held.mockRestore(); reset() }
  })
  it('puts the saved coverage notice before rows without a history action', () => {
    const html = renderToStaticMarkup(<Timeline items={[{ kind: 'userText', text: 'saved row' }]} olderSaved />)
    expect(html).toContain('Older messages require a connection.')
    expect(html.indexOf('Older messages require a connection.')).toBeLessThan(html.indexOf('saved row'))
    expect(renderToStaticMarkup(<Timeline items={[]} />)).not.toContain('Older messages require')
  })
})
