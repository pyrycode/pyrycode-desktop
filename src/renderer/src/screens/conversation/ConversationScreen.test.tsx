import { describe, it, expect, beforeEach, vi, type MockInstance } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  ConversationScreen,
  MessageThread,
  TimelineRow,
  ThinkingIndicator,
  ComposerStatusArea,
  THINKING_COPY,
  WORKING_COPY,
  SENDING_COPY,
  WAITING_COPY,
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
  RESETTING_RESTARTING_CODEX_COPY,
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
  ContextUsageReading,
  isTurnRunning,
  isStatusIconTurning,
  ComposerSendButton,
  ChannelInfoSheetView,
  requestArchiveConversation,
  requestDeleteConversation,
  relayLeg,
  daemonLeg
} from './ConversationScreen'
// #780's AC5 asserts one chrome from both sides, so the message-side renderer is imported here too.
import { AssistantMarkdown } from './AssistantMarkdown'
import { COMPOSER_ACTIONS_LABEL } from './ComposerActionsMenu'
import { PERMISSION_MODE_LABELS } from './ComposerPermissionModeMenu'
import { COMPOSER_ATTACH_LABEL } from './ComposerAttach'
import {
  CONNECTION_BANNER_COPY,
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
// #1655 adds the optional capability flags, spread onto the snapshot only when a case names one.
function seedRunConfigTokens(
  usedTokens: number,
  windowTokens: number,
  capabilities: { contextUsageDetail?: boolean } = {}
): MockInstance {
  const initial = runConfigStore.getInitialState()
  return vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({
    ...initial,
    snapshot: {
      model: '',
      effort: '',
      yolo: false,
      permissionMode: 'default',
      usedTokens,
      windowTokens,
      ...capabilities
    }
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
// took the markdown path, on both streaming and settled assistant rows.
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

  it.each([false, true])('names the failed icon between the count and chevron (expanded=%s)', (expanded) => {
    const markup = renderToStaticMarkup(<ToolRow
      item={toolItem({ isError: true, resultSummary: 'ENOENT', resultDetail: 'no matches' })}
      defaultExpanded={expanded}
    />)
    expect(markup).toContain('tool-row--error')
    expect(markup).toContain('role="img" aria-label="Failed"')
    expect(markup).toContain('viewBox="0 0 16 16" width="16" height="16"')
    expect(markup.indexOf('tool-row__count')).toBeLessThan(markup.indexOf('aria-label="Failed"'))
    expect(markup.indexOf('aria-label="Failed"')).toBeLessThan(markup.indexOf('tool-row__chevron'))
  })

  it('shows the Failed icon without a count and keeps it off success, pending and denied rows', () => {
    const failed = toolItem({ isError: true, resultSummary: 'ENOENT' })
    expect(renderToStaticMarkup(<ToolRow item={failed} />)).toContain('aria-label="Failed"')
    for (const item of [
      toolItem(null), toolItem({ isError: false, resultSummary: 'done' }),
      { ...failed, denial: { toolName: 'read_file', decisionReasonType: 'rule', decisionReason: 'Denied by rule',
        message: 'Denied', truncatedFields: null, droppedFields: null } }
    ]) {
      expect(renderToStaticMarkup(<ToolRow item={item} />)).not.toContain('aria-label="Failed"')
    }
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
    // The failure-state hook stays on the wrapper; the icon supplies the visible treatment.
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
    { kind: 'assistantText', createdAt: 1768312500000, turnId: 't1', text },
    { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
  ]

  it('puts copy in an actions sibling beside each delivered bubble, including the streaming tail', () => {
    const cases = [
      { items: settled('settled'), side: 'assistant' },
      { items: settled('```ts\nconst x = 1\n```'), side: 'assistant' },
      { items: [{ kind: 'assistantText', createdAt: 1768312500000, turnId: 't1', text: 'streaming' }] as ThreadItem[], side: 'assistant' },
      { items: [{ kind: 'userText', createdAt: 1768312500000, text: 'mine' }] as ThreadItem[], side: 'user' },
      { items: [{ kind: 'userText', createdAt: 1768312500000, text: 'attached', attachments: [
        { attachmentId: 'file', filename: 'report.pdf' },
        { attachmentId: 'image', filename: 'chart.png' }
      ] }] as ThreadItem[], side: 'user' }
    ]
    for (const { items, side } of cases) {
      const markup = renderToStaticMarkup(<RowViews items={items} />)
      const actions = '<div class="message-actions"><button type="button" class="bubble__copy"'
      expect(markup).toContain(actions)
      expect(markup).toContain('<button type="button" class="bubble__copy bubble__reply" aria-label="Reply to message"')
      expect(markup.indexOf('Reply to message')).toBeGreaterThan(markup.indexOf('Copy message'))
      expect(markup).toContain('message-row--text')
      const meta = markup.match(/<div class="bubble__meta[^"]*">(.*?)<\/div>/)?.[1]
      expect(meta).toBeDefined()
      expect(meta).not.toContain('<button')
      if (side === 'assistant') {
        expect(markup).toContain('</span></div></div>' + actions)
      } else {
        expect(markup).toContain('</span></button></div><div class="bubble bubble--user"')
      }
    }
  })

  it('right-aligns the user row with its own modifier and leaves the assistant row unmodified', () => {
    const user = renderToStaticMarkup(<RowViews items={[{ kind: 'userText', createdAt: 1768312500000, text: 'mine' }]} />)
    expect(user).toContain(`${META} ${META}--user`)

    const assistant = renderToStaticMarkup(<RowViews items={settled('theirs')} />)
    expect(assistant).toContain(META)
    expect(assistant).not.toContain(`${META}--user`)
  })

  it('gives copy and reply native buttons with accessible names and no focusable icon', () => {
    const markup = renderToStaticMarkup(<RowViews items={settled('copy me')} />)
    // A real <button type="button"> IS the keyboard path (AC3): natively focusable, activated by Enter
    // and Space, no tabindex or key handler of our own to get wrong.
    expect(markup).toContain(`<button type="button" class="${COPY}" aria-label="${COPY_LABEL}"`)
    expect(markup).toContain('aria-label="Reply to message"')
    expect(markup.match(/<button/g)?.length ?? 0).toBe(2)
    expect(markup).not.toContain('tabindex')
  })

  it('keeps the message text out of the accessible name — the label is a client-owned constant', () => {
    // The trap "the control has an accessible name" invites: `aria-label={`Copy: ${text}`}` would put
    // relay-peer-authored text into an ATTRIBUTE, which CLAUDE.md's 2026-08-20 ruling forbids outright.
    // A distinctive fixture so the assertion cannot pass by coincidence.
    const markup = renderToStaticMarkup(<RowViews items={settled('zzqq-daemon-authored-zzqq')} />)
    expect(markup).toContain('zzqq-daemon-authored-zzqq')
    expect(markup).not.toContain('aria-label="zzqq')
    expect(markup).toContain(`aria-label="${COPY_LABEL}"`)
  })

  it('draws the glyph decoratively — one inline svg, hidden from the accessibility tree', () => {
    const markup = renderToStaticMarkup(<RowViews items={settled('glyph check')} />)
    // The Figma export's clipPath is a full-bleed 11x12 rect and is dropped as the no-op it is: the
    // glyph ships as a bare svg with a single path, this repo's icon convention.
    expect(markup).toContain('viewBox="0 0 11 12"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup.match(/<path/g)?.length ?? 0).toBe(1)
    expect(markup).not.toContain('clipPath')
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
      <RowViews
        items={[
          { kind: 'userText', createdAt: 1768312500000, text: 'ask' },
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
      <RowViews items={[{ kind: 'assistantText', createdAt: 1768312500000, turnId: 't1', text: 'tail' }]} />
    )
    expect(streaming).toContain('bubble__markdown')
  })
})

// #1014: the timestamp #969 left the slot empty for. What this tier owns is the WIRING — which items put
// a string in `bubble__meta-time`, that an unstamped row without stats emits no metadata, and that
// nothing else in the row moved. WHICH characters the string is made of is messageTime.test.ts, which can
// assert them exactly without rendering anything; the fixtures here therefore use one moment and one
// expected string rather than re-testing the format.
describe('Timeline — the meta row timestamp (#1014)', () => {
  const TIME_SLOT = 'bubble__meta-time'
  // Local construction, the inverse of the formatter's local getters, so this expectation holds on a
  // runner in any zone (messageTime.test.ts's header records why nothing here may be a literal epoch).
  const CREATED_AT = new Date(2026, 0, 13, 13, 55).getTime()
  const DRAWN = '13.01.2026 - 13:55'

  it('renders the stamp inside the time slot on the settled assistant bubble', () => {
    const markup = renderToStaticMarkup(
      <RowViews
        items={[
          { kind: 'assistantText', turnId: 't1', text: 'a settled reply', createdAt: CREATED_AT },
          { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
        ]}
      />
    )
    expect(markup).toContain(`<span class="${TIME_SLOT}">${DRAWN}</span>`)
  })

  it('omits metadata when neither a timestamp nor turn stats is available', () => {
    // #1013's contract: an absent `createdAt` is a LEGAL item, not a defect — it is what every producer
    // with no injected clock yields, which is also why the 39 stamp-free item literals elsewhere in this
    // file needed no edit. The read is `=== undefined`; `'createdAt' in item` would be TRUE here, because
    // the reducer assigns the field unconditionally, and an implementation using it renders the string
    // "undefined" instead of nothing.
    const markup = renderToStaticMarkup(
      <RowViews
        items={[
          { kind: 'userText', text: 'no clock was injected' },
          { kind: 'assistantText', turnId: 't1', text: 'nor here' },
          { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
        ]}
      />
    )
    expect(markup).not.toContain('bubble__meta')
    for (const wrong of ['Invalid Date', 'NaN', 'undefined', 'null']) {
      expect(markup).not.toContain(wrong)
    }
  })

  it('keeps the timestamp as text in the meta row without a copy control', () => {
    // The timestamp stays in its original slot while copy moves beside the bubble.
    const markup = renderToStaticMarkup(
      <RowViews items={[{ kind: 'userText', text: 'mine', createdAt: CREATED_AT }]} />
    )
    expect(markup).toContain(
      `<div class="bubble__meta bubble__meta--user bubble__meta--details"><span class="${TIME_SLOT}">${DRAWN}</span></div>`
    )
    // Once, in that one sink — not duplicated into an attribute, a title or a second element.
    expect(markup.match(new RegExp(DRAWN.replace(/\./g, '\\.'), 'g'))?.length ?? 0).toBe(1)
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
      createdAt: 1768312500000,
      attachments: [{ attachmentId: 'att-1', filename: 'report.pdf' }]
    }
  ]

  it('draws the row for a sent message that carries an attachment', () => {
    const markup = renderToStaticMarkup(<RowViews items={withOneFile} />)
    expect(rowCount(markup)).toBe(1)
    expect(markup).toContain(`<span class="${NAME_SLOT}">report.pdf</span>`)
    expect(markup).toContain(`<span class="${EXT_SLOT}" aria-hidden="true">PDF</span>`)
  })

  it('puts the row AFTER the message text and BEFORE the meta row (AC1)', () => {
    // The order criterion as a byte string on the near side and an index comparison on the far side. The
    // byte string is the load-bearing half: it is the user-arm analogue of the assistant pin
    // interactiveRoundtrip.test.tsx holds (`data-thread-role="assistant"><div class="bubble__markdown">`),
    // and it is what reddens if the row is ever prepended ahead of the text.
    const markup = renderToStaticMarkup(<RowViews items={withOneFile} />)
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
      <RowViews
        items={[
          {
            kind: 'userText',
            text: 'two of them',
            createdAt: 1768312500000,
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
      <RowViews
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
    const markup = renderToStaticMarkup(<RowViews items={withOneFile} />)
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
      <RowViews
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

  // #816: the row became a download control. What this tier owns is the ELEMENT and its accessible name;
  // the click, the keyboard and the wire are e2e/attachment-file-row.spec.ts's, and the two-ask sequencing
  // behind the handler is downloadAttachment.test.ts's.
  describe('as a download control (#816)', () => {
    it('is a real <button type="button">, not a div with a handler (AC1)', () => {
      const markup = renderToStaticMarkup(<RowViews items={withOneFile} />)
      // A real button is what makes one tab stop, Enter and Space, and screen-reader semantics come for
      // free instead of being rebuilt out of tabIndex + onKeyDown — the ChannelList row's ruling.
      expect(markup).toContain(`<button type="button" class="${ROW}" disabled="">`)
      expect(markup).not.toContain(`<div class="${ROW}">`)
      // `type="button"` matters beyond tidiness: the default is `submit`, and a submitting button inside a
      // form would reload the window rather than download anything.
      expect(markup).not.toContain(`<button class="${ROW}">`)
    })

    it('takes its accessible name from its TEXT CONTENT, with no aria-label (AC1)', () => {
      const markup = renderToStaticMarkup(<RowViews items={withOneFile} />)
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
        <RowViews
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
        <RowViews
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
        <RowViews
          items={[
            {
              kind: 'userText',
              text: 'both kinds',
              createdAt: 1768312500000,
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
        <RowViews
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

  it('renders each rule as an aria-hidden decorative element (purely visual, not semantic)', () => {
    const items: ThreadItem[] = [
      { kind: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: twoHoursAgo }
    ]
    const markup = renderToStaticMarkup(<RowViews items={items} />)
    // The clear label bounded by its tags, so a re-appended time fails this assertion too.
    expect(markup).toContain('>Session reset<')
    expect(markup).toMatch(/session-delimiter__rule[^>]*aria-hidden="true"/)
  })

  it('renders an untrusted workspaceCwd as visible characters, never live markup (AC4)', () => {
    // No apostrophes in the fixture — renderToStaticMarkup escapes ' → &#x27; (prior desktop lesson).
    const items: ThreadItem[] = [
      { kind: 'sessionBoundary', reason: 'workspace_change', workspaceCwd: '<b>x</b>', occurredAt: twoHoursAgo }
    ]
    const markup = renderToStaticMarkup(<RowViews items={items} />)
    expect(markup).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(markup).not.toContain('<b>x</b>')
  })

  it('sits in arrival order between the surrounding message groups, a fresh row (AC1)', () => {
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: 'before the break' },
      { kind: 'sessionBoundary', reason: 'clear', workspaceCwd: null, occurredAt: twoHoursAgo },
      { kind: 'userText', text: 'after the break' }
    ]
    const markup = renderToStaticMarkup(<RowViews items={items} />)
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

  // #1725: the local send window's two stages, on the same element and class as every other label.
  it.each([
    ['sending', SENDING_COPY, 'Sending…'],
    ['waiting', WAITING_COPY, 'Waiting for Claude']
  ] as const)('shows the %s stage of the local send window on the same surface (#1725)', (state, copy, text) => {
    const markup = renderToStaticMarkup(
      <ThinkingIndicator state={state} toolName={null} retry={null} resetting={null} thinkingTokens={null} />
    )
    expect(copy).toBe(text)
    expect(markup).toContain(`<span class="conversation__thinking composer-status__label">${text}</span>`)
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
  // #1725: the window now carries the sent id and whether a queue_state has listed it.
  const SENT = { messageId: 'm1', queued: false }
  const QUEUED = { messageId: 'm1', queued: true }
  const IDLE_STATUS = { phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null } as const

  it('opens the window at idle while a local send is pending, labelled sending (#1725 AC1)', () => {
    expect(workingIndicatorStateWithLocalSend(IDLE_STATUS, SENT)).toBe('sending')
  })

  it('reads waiting once a queue_state has listed the sent id (#1725 AC1)', () => {
    expect(workingIndicatorStateWithLocalSend(IDLE_STATUS, QUEUED)).toBe('waiting')
  })

  it('opens nothing at idle with no local send pending — todays behaviour, unchanged (AC1)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null }, null)
    ).toBeNull()
  })

  it('delegates unchanged wherever the daemon has already opened the window', () => {
    // The daemon's answer wins: for every phase and both pending values, a non-null daemon answer is
    // returned byte-identical, so no daemon-opened case changed behaviour at all.
    for (const phase of ['thinking', 'responding', 'idle'] as const) {
      for (const pending of [SENT, QUEUED, null]) {
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
        SENT
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
        SENT
      )
    ).toBe('retrying')
  })

  it('inherits it for an unknown-count retry too — presence supersedes, not the counter', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 0, total: 0 }, compacting: false, stalled: false, resetting: null },
        SENT
      )
    ).toBe('retrying')
  })

  it('inherits the compaction supersede rule too (#967)', () => {
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: true, stalled: false, resetting: null }, SENT)
    ).toBe('compacting')
  })

  it('is superseded while both compacting and retrying — retry wins the tie (#967)', () => {
    expect(
      workingIndicatorStateWithLocalSend(
        { phase: 'idle', apiRetry: { current: 3, total: 10 }, compacting: true, stalled: false, resetting: null },
        SENT
      )
    ).toBe('retrying')
  })

  it('lets a stall outrank a locally-opened window too, with no turn running (#967, AC2)', () => {
    // The middle of the order, and the case a wrapper composed on the gate could not have expressed
    // without re-reading `apiRetry` and `compacting` itself — the reason #967 took the fourth field.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: true, resetting: null }, SENT)
    ).toBe('stalled')
    // And with no local send pending either: the three folded statuses were never gated on a send.
    expect(
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: true, resetting: null }, null)
    ).toBe('stalled')
  })

  it('never answers thinking itself — that label comes only from the daemon phase (#1725 AC2)', () => {
    // #1725 reverses #650's flicker-free seam on purpose: a crash-looping claude left the local
    // `Thinking…` up for minutes. The daemon's own `thinking` phase is still `thinking`.
    for (const pending of [SENT, QUEUED]) {
      expect(workingIndicatorStateWithLocalSend(IDLE_STATUS, pending)).not.toBe('thinking')
    }
    expect(workingIndicatorStateWithLocalSend({ ...IDLE_STATUS, phase: 'thinking' }, QUEUED)).toBe('thinking')
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
      workingIndicatorStateWithLocalSend({ phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null }, SENT)
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
        { messageId: 'm1', queued: false }
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

  // #1653: a Codex conversation resets through the same path, so the restarting phase names Codex. The
  // agent SELECTS a constant exactly as the two wire tokens do; it is never interpolated.
  const RESET_PHASES = ['wrapping_up', 'restarting', ''] as const
  const RESET_HANDOFFS = ['pending', 'written', 'skipped', ''] as const
  const resetLabel = (
    resetting: { phase: (typeof RESET_PHASES)[number]; handoff: (typeof RESET_HANDOFFS)[number] },
    agent?: 'claude' | 'codex'
  ): string =>
    renderToStaticMarkup(
      <ThinkingIndicator
        state="resetting"
        toolName={null}
        retry={null}
        resetting={resetting}
        thinkingTokens={null}
        agent={agent}
      />
    )

  it('names codex in the restarting phase of a Codex conversation (#1653)', () => {
    expect(RESETTING_RESTARTING_CODEX_COPY).toBe('Resetting: restarting codex…')
    expect(resetLabel({ phase: 'restarting', handoff: 'pending' }, 'codex')).toContain(
      '>Resetting: restarting codex…</span>'
    )
    expect(resetLabel(RESTARTING_WRITTEN, 'codex')).toContain(
      `>${RESETTING_RESTARTING_CODEX_COPY} ${HANDOFF_WRITTEN_COPY}</span>`
    )
    expect(resetLabel(RESTARTING_SKIPPED, 'codex')).toContain(
      `>${RESETTING_RESTARTING_CODEX_COPY} ${HANDOFF_SKIPPED_COPY}</span>`
    )
    // The other phases carry no agent name and stay as they are.
    expect(resetLabel(WRAPPING, 'codex')).toContain(`>${RESETTING_WRAPPING_UP_COPY}</span>`)
    expect(resetLabel({ phase: '', handoff: '' }, 'codex')).toContain(`>${RESETTING_COPY}</span>`)
  })

  it('keeps every Claude phase byte-identical to the agent-less render (#1653)', () => {
    // Pinned against the literal as well as the prop-less render, so a drift in the constant itself
    // fails here rather than moving both sides together.
    expect(RESETTING_RESTARTING_COPY).toBe('Resetting: restarting claude…')
    for (const phase of RESET_PHASES) {
      for (const handoff of RESET_HANDOFFS) {
        expect(resetLabel({ phase, handoff }, 'claude')).toBe(resetLabel({ phase, handoff }))
      }
    }
  })

  it('draws only client-owned constants on a Codex conversation too (#1653)', () => {
    const allowed = new Set([
      RESETTING_COPY,
      RESETTING_WRAPPING_UP_COPY,
      RESETTING_RESTARTING_CODEX_COPY,
      `${RESETTING_RESTARTING_CODEX_COPY} ${HANDOFF_WRITTEN_COPY}`,
      `${RESETTING_RESTARTING_CODEX_COPY} ${HANDOFF_SKIPPED_COPY}`
    ])
    for (const phase of RESET_PHASES) {
      for (const handoff of RESET_HANDOFFS) {
        const label = resetLabel({ phase, handoff }, 'codex')
          .replace(/^<span class="[^"]*">/, '')
          .replace(/<\/span>$/, '')
        expect(allowed.has(label)).toBe(true)
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
    for (const copy of [
      RESETTING_COPY,
      RESETTING_WRAPPING_UP_COPY,
      RESETTING_RESTARTING_COPY,
      RESETTING_RESTARTING_CODEX_COPY
    ]) {
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

  it('keeps the newest open main-thread tool when a subagent starts a newer call', () => {
    const items: ThreadItem[] = [
      openCall('u1', 'Read'),
      openCall('u2', 'Bash'),
      {
        kind: 'toolCall', turnId: 't1', toolUseId: 'child', parentToolUseId: 'agent',
        name: 'Grep', inputSummary: 'src/', result: null
      }
    ]
    expect(openToolName(items)).toBe('Bash')
  })

  it('returns no tool when only subagent calls remain open', () => {
    const child: ThreadItem = {
      kind: 'toolCall', turnId: 't1', toolUseId: 'child', parentToolUseId: 'agent',
      name: 'Grep', inputSummary: 'src/', result: null
    }
    const denied: ThreadItem = {
      kind: 'toolCall', turnId: 't1', toolUseId: 'denied', name: 'Bash',
      inputSummary: 'npm test', result: null,
      denial: {
        toolName: 'Bash', decisionReasonType: 'rule', decisionReason: 'Denied',
        message: 'Permission required', truncatedFields: null, droppedFields: null
      }
    }
    expect(openToolName([child])).toBeNull()
    expect(openToolName([resolvedCall('agent', 'Agent'), child])).toBeNull()
    expect(openToolName([denied, child])).toBeNull()
  })

  it('treats an explicitly undefined parent ID as a main-thread call', () => {
    const item: ThreadItem = {
      kind: 'toolCall', turnId: 't1', toolUseId: 'u1', parentToolUseId: undefined,
      name: 'Read', inputSummary: 'src/a.ts', result: null
    }
    expect(openToolName([item])).toBe('Read')
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

// #1556: the status icon's own gate, which is `isTurnRunning` widened by the label's answer rather than a
// second reading of #650's `localSendPending`. Both inputs are injected, so this is the same store-free
// predicate test as its neighbour above.
//
// The AC2 arm is the load-bearing one and the reason every superseding state gets its own case: a held
// retry, a compaction, a stall or a reset at `idle` shows its LABEL beside a STILL mark, the converse
// render ComposerStatusArea's docblock records as intended. A gate written as `state !== null` would pass
// every other test in this block and silently spin all four.
describe('isStatusIconTurning — the status icon gate widened by the local window (#1556)', () => {
  const IDLE = { phase: 'idle', apiRetry: null, compacting: false, stalled: false, resetting: null } as const
  const SENT = { messageId: 'm1', queued: false }
  const QUEUED = { messageId: 'm1', queued: true }

  it('turns while the daemon reports a running turn, in both phases (AC1)', () => {
    expect(isStatusIconTurning('thinking', 'thinking')).toBe(true)
    expect(isStatusIconTurning('responding', 'working')).toBe(true)
  })

  it('turns at idle for both stages of the locally opened window, before any server phase (AC1)', () => {
    // Composed through the label's own derivation, never a hand-written state: what this ticket claims is
    // that the icon follows the LABEL, so the label's function is what has to produce the input.
    // #1725: the window's two stages, Sending and Waiting, both turn the glyph.
    expect(isStatusIconTurning('idle', workingIndicatorStateWithLocalSend(IDLE, SENT))).toBe(true)
    expect(isStatusIconTurning('idle', workingIndicatorStateWithLocalSend(IDLE, QUEUED))).toBe(true)
  })

  it('is still at idle with no local send — the control arm (AC1)', () => {
    expect(isStatusIconTurning('idle', workingIndicatorStateWithLocalSend(IDLE, null))).toBe(false)
    expect(isStatusIconTurning('idle', null)).toBe(false)
  })

  it('leaves the four superseding labels beside a still mark at idle (AC2)', () => {
    for (const state of ['retrying', 'compacting', 'stalled', 'resetting'] as const) {
      expect(isStatusIconTurning('idle', state)).toBe(false)
    }
  })

  it("keeps turning across the seam the daemon's first turn_state crosses (AC1)", () => {
    // The local window (idle + pending) and the daemon's first thinking phase are consecutive renders of
    // the same visible turn. #1725 changes the label across them (Waiting for Claude → Thinking…), but
    // the gate keeps its value — the "animation continues when the running phase arrives" half.
    const local = workingIndicatorStateWithLocalSend(IDLE, QUEUED)
    const daemon = workingIndicatorStateWithLocalSend({ ...IDLE, phase: 'thinking' }, null)
    expect(local).toBe('waiting')
    expect(daemon).toBe('thinking')
    expect(isStatusIconTurning('idle', local)).toBe(isStatusIconTurning('thinking', daemon))
  })

  it('does not turn for a thinking answer at idle — the local window never produces one (#1725)', () => {
    expect(isStatusIconTurning('idle', 'thinking')).toBe(false)
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

// Connection feedback belongs to the overlay; other occupants retain their priority and gating.
describe('ComposerErrorSlot', () => {
  const connected: ConnectionStatus = { type: 'connected', ack: {
    protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: []
  } }
  const occupants = {
    recovery: <span>RECOVERY</span>, refusal: <span>REFUSAL</span>, notice: <span>NOTICE</span>,
    history: <span>HISTORY</span>, mcpFailure: <span>MCP</span>, taskCount: <span>TASKS</span>
  }
  it.each<ConnectionStatus>([
    { type: 'disconnected' }, { type: 'connecting' },
    ...['transport', 'pairing-rejected', 'unpair', 'not-paired'].flatMap(code =>
      [false, true].map(retryable => ({ type: 'error' as const,
        error: { code, retryable, message: 'SECRET' } })))
  ])('keeps all composer occupants absent for $type', status => {
    expect(renderToStaticMarkup(<ComposerErrorSlot status={status} {...occupants} />)).toBe('')
  })
  it('keeps connected-only occupant priority', () => {
    const entries = Object.entries(occupants)
    for (let index = 0; index < entries.length; index++) {
      const props = Object.fromEntries(entries.slice(index))
      const markup = renderToStaticMarkup(<ComposerErrorSlot status={connected} notice={null} {...props} />)
      expect(markup).toBe(renderToStaticMarkup(entries[index][1]))
    }
    expect(renderToStaticMarkup(<ComposerErrorSlot status={connected} notice={null} />)).toBe('')
  })
})

describe('ComposerTaskCount — the background-task reading in the status row (#1435)', () => {
  it('reads "n tasks running" for a count above one (AC1)', () => {
    const markup = renderToStaticMarkup(<ComposerTaskCount count={6} onToggle={() => {}} />)
    expect(markup).toContain('6 tasks running')
  })

  // The singular is a distinct run, not a suffix trimmed off the plural, so it is asserted in both
  // directions: "1 tasks running" is the failure this catches and it contains the singular as a
  // substring, which a one-directional check would pass on.
  it('reads "1 task running" for exactly one task (AC1)', () => {
    const markup = renderToStaticMarkup(<ComposerTaskCount count={1} onToggle={() => {}} />)
    expect(markup).toContain('1 task running')
    expect(markup).not.toContain('1 tasks running')
  })

  // AC2, in the STRICT exact-empty form the neighbouring describes use. A not.toContain would pass on a
  // rendered-but-empty pill, which is precisely the criterion's failure mode — and it is why the
  // container creates no element at a zero count either (the `??` chain does not filter one).
  it('renders nothing at all at a zero count — not an empty element (AC2)', () => {
    expect(renderToStaticMarkup(<ComposerTaskCount count={0} onToggle={() => {}} />)).toBe('')
  })

  // The count reaches this view as `tasks.size + droppedTasks`, and `dropped_tasks` decodes through a
  // plain requireNumber — so a hostile or buggy daemon can drive the sum negative. It reads as absent,
  // never as "-3 tasks running".
  it('renders nothing at all at a negative count', () => {
    expect(renderToStaticMarkup(<ComposerTaskCount count={-3} onToggle={() => {}} />)).toBe('')
  })

  // AC5's class half, in both directions: a task count is not an error and must not wear the error
  // pair's treatment. The base class is what carries the Pill's ground, ink and 24px box, so a render
  // that dropped it would still pass every copy assertion above.
  it('wears the neutral Pill class and not the error chip treatment (AC5)', () => {
    const markup = renderToStaticMarkup(<ComposerTaskCount count={6} onToggle={() => {}} />)
    expect(markup).toContain('composer-status__tasks')
    expect(markup).not.toContain('composer-status__error')
    expect(markup).not.toContain('button-small')
  })

  // AC4's element half. A real <button>, not a div wearing a click handler: keyboard activation, the
  // focus ring and the accessible name all come from the element rather than from the class. The name is
  // the visible text, so there is no aria-label to drift from it and no hidden prefix — the copy says
  // what it is in plain words (the ComposerUsageLimitNotice ruling).
  // #1634: the pill toggles the drawer and wears the design's Primary outline only while it is open. The
  // closed render is byte-identical to the pre-#1634 pill, which is what keeps every other site unchanged.
  it('wears the open modifier and aria-expanded only while the drawer is open (#1634 AC2)', () => {
    const closed = renderToStaticMarkup(<ComposerTaskCount count={2} onToggle={() => {}} />)
    expect(closed).toContain('class="composer-status__tasks"')
    expect(closed).not.toContain('composer-status__tasks--open')
    expect(closed).not.toContain('aria-expanded')
    const open = renderToStaticMarkup(<ComposerTaskCount count={2} open onToggle={() => {}} />)
    expect(open).toContain('class="composer-status__tasks composer-status__tasks--open"')
    expect(open).toContain('aria-expanded="true"')
  })

  it('is a real button whose accessible name is its visible text (AC4)', () => {
    const markup = renderToStaticMarkup(<ComposerTaskCount count={6} onToggle={() => {}} />)
    expect(markup).toContain('<button')
    expect(markup).toContain('type="button"')
    expect(markup).not.toContain('aria-label')
    expect(markup).not.toContain('composer-status__error-prefix')
  })
})

// #811: the context-window reading, first occupant of the new composer footer row (Figma 110:3497).
// ContextUsageReading is the pure, exported view (the ComposerErrorChip pattern), so the whole
// present/absent matrix is proven by server-rendering it with injected figures and no store. The
// arithmetic itself lives in contextUsage.test.ts; what these prove is the MARKUP — that the reading is
// a reading and not a control, and that its absent arm renders nothing at all.
//
// #1728: the reading is the design's ring (Figma 347:5408 → Context), with the percentage and the
// warning state as visually hidden text. Each step is still pinned as EXACT markup, so nothing — no
// handler, no tabindex, no role, no visible text — can be added to any of them silently.
//
// The arc's dash is the reading's share of the r=6.5 circumference (40.841), hard-coded per case so the
// test does not re-derive it from the formula under test.
const contextRing = (className: string, dash: string, label: string): string =>
  `<span class="${className}">` +
  '<svg class="composer__context-ring" width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">' +
  '<circle class="composer__context-track" cx="7.5" cy="7.5" r="6.5"></circle>' +
  '<circle class="composer__context-arc" cx="7.5" cy="7.5" r="6.5" ' +
  `stroke-dasharray="${dash} 40.841" transform="matrix(0 -1 -1 0 15 15)"></circle></svg>` +
  `<span class="composer__context-label">${label}</span></span>`

describe('ContextUsageReading — the composer footer’s context circle (#811, #1728)', () => {
  it('draws the ring with the percentage as hidden text below 70% — no handler, no tabindex, no role', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={138000} windowTokens={200000} />
    )
    expect(markup).toBe(contextRing('composer__context', '28.180', 'Context: 69%'))
  })

  // The middle step wears the modifier the arc's colour follows, and its hidden text says "high", so the
  // warning is not carried by colour alone now that no percentage is visible.
  it('wears the warning modifier and says "high" from 70%', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={140000} windowTokens={200000} />
    )
    expect(markup).toBe(
      contextRing('composer__context composer__context--warning', '28.588', 'Context high: 70%')
    )
  })

  it('stays at the warning step at 84%', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={168000} windowTokens={200000} />
    )
    expect(markup).toBe(
      contextRing('composer__context composer__context--warning', '34.306', 'Context high: 84%')
    )
  })

  it('wears the error modifier and says "nearly full" from 85%', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={170000} windowTokens={200000} />
    )
    expect(markup).toBe(
      contextRing('composer__context composer__context--error', '34.715', 'Context nearly full: 85%')
    )
  })

  // The arc is derived from the reading, not copied from the design's static 75%: a known 0% draws no
  // arc (a zero dash) and a full window the whole circumference.
  it.each([
    [0, 0, '0.000'],
    [500, 0, '0.000'],
    [45000, 23, '9.393'],
    [200000, 100, '40.841']
  ] as const)('draws %i used tokens (%i%) as a %s-unit arc', (used, pct, dash) => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={used} windowTokens={200000} />
    )
    expect(markup).toContain(`stroke-dasharray="${dash} 40.841"`)
    expect(markup).toContain(`: ${pct}%</span>`)
  })

  // AC2's whole surface, in the STRICT form the ComposerErrorChip describe above uses: an exact-empty
  // markup, not a not.toContain. That is what proves "not an empty element holding the slot either" —
  // a substring assertion would pass on a rendered-but-empty <span>, and an unavailable reading must
  // not draw the dark 0% ring either.
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

  it('clamps an over-full session to a full ring rather than running past it', () => {
    const markup = renderToStaticMarkup(
      <ContextUsageReading usedTokens={250000} windowTokens={200000} />
    )
    expect(markup).toContain('stroke-dasharray="40.841 40.841"')
    expect(markup).toContain('Context nearly full: 100%')
    expect(markup).not.toContain('Infinity')
  })

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
    // Created / Total sessions / Total messages have no desktop field — deferred, not fabricated.
    expect(markup).not.toContain('Created')
    expect(markup).not.toContain('Total sessions')
    expect(markup).not.toContain('Total messages')
    expect(markup).toContain('Memory search status unknown')
  })

  it('shows daemon memory search availability and bounded, escaped providers', () => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={createdPayload()} onClose={noop}
      memorySearch={{ availability: 'available', providers: [
        { id: 'local', display_name: '<Local index>', installed: true, enabled: true, availability: 'available' },
        { id: 'disabled', display_name: 'D'.repeat(300), installed: true, enabled: false, availability: 'unavailable' }
      ] }} />)
    expect(markup).toContain('Memory search available')
    expect(markup).toContain('&lt;Local index&gt;')
    expect(markup).toContain('Installed, disabled')
    expect(markup).not.toContain('D'.repeat(300))
    expect(markup).not.toContain('<Local index>')
    expect(markup).not.toContain('Install</')
  })

  it.each([
    [{ availability: 'absent' as const, providers: [] }, 'No memory-search provider detected'],
    [{ availability: 'unavailable' as const, providers: [] }, 'Memory search unavailable'],
    [{ availability: 'unknown' as const, providers: [] }, 'Memory search status unknown']
  ])('renders report %j as %s without an installation nag', (memorySearch, expected) => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={createdPayload()} onClose={noop} memorySearch={memorySearch} />)
    expect(markup).toContain(expected)
    expect(markup).not.toContain('Install</')
    expect(markup).not.toContain('0 plugins')
    expect(markup).not.toContain('>None<')
  })

  it('keeps unavailable and unknown provider readings distinct', () => {
    const markup = renderToStaticMarkup(<ChannelInfoSheetView conversation={createdPayload()} onClose={noop}
      memorySearch={{ availability: 'unavailable', providers: [
        { id: 'offline', display_name: 'Offline index', installed: true, enabled: true, availability: 'unavailable' },
        { id: 'unclear', display_name: 'Unclear index', installed: true, enabled: true, availability: 'unknown' }
      ] }} />)
    expect(markup).toContain('Memory search unavailable')
    expect(markup).toContain('Installed, unavailable')
    expect(markup).toContain('Installed, status unknown')
    expect(markup).not.toContain('Memory search available')
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

  it('puts retryable connection feedback only in the overlay', () => {
    const restore = stageOpenConnection({ type: 'error',
      error: { code: 'server.binary_offline', message: 'SECRET', retryable: true } })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup).toContain(CONNECTION_BANNER_COPY)
      expect(markup).toContain('conversation__top-overlay')
      expect(markup).not.toContain('conversation__banner')
      expect(markup).not.toContain('composer-status__error')
      expect(markup).not.toContain('SECRET')
    } finally { restore() }
  })

  // #1604: pairing rejection through the mounted container. Re-pair is a pill in the Top overlay pinned
  // over the message area — ahead of the status row in the tree — and the row's slot falls through to the
  // chip. The only test that proves `TopOverlayControl` is mounted and reads the open host's status.
  //
  // The same getInitialState SPY as the chip test above, and for the same reason: zustand v5's useStore
  // reads getInitialState() under renderToStaticMarkup, never getState(), so the block's beforeEach
  // cannot stage this arm.
  it('mounts Re-pair in the Top overlay with no composer connection occupant', () => {
    const restore = stageOpenConnection({ type: 'error', error: { code: 'pairing-rejected', message: 'gave up', retryable: false } })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      const overlay = markup.indexOf('class="conversation__top-overlay"')
      const repair = markup.indexOf(`>${COMPOSER_REPAIR_BUTTON_COPY}</button>`)
      expect(overlay).toBeGreaterThan(markup.indexOf('class="conversation__message-area"'))
      expect(repair).toBeGreaterThan(overlay)
      expect(repair).toBeLessThan(markup.indexOf('class="composer-status"'))
      expect(markup.split(COMPOSER_REPAIR_BUTTON_COPY)).toHaveLength(2)
      expect(markup).not.toContain('composer-status__error')
      expect(markup).not.toContain(COMPOSER_RECONNECT_BUTTON_COPY)
      // The retired #167 block stays gone.
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
      // 84% is the warning step since #1728, so the mounted reading's hidden text says "high".
      expect(markup).toContain('Context high: 84%')
      expect(markup).toContain('stroke-dasharray="34.306 40.841"')
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

  // #1655: a session that reports no context-usage breakdown (a Codex session) keeps its reading but loses
  // the button — nothing would ever fill the panel. Absent and true keep today's trigger.
  it.each([
    ['false', false, false],
    ['true', true, true],
    ['absent', undefined, true]
  ] as const)('with contextUsageDetail %s, the reading is a breakdown trigger: %s', (_case, flag, trigger) => {
    const restore = stageOpenConnection(CONNECTED)
    const runConfig = seedRunConfigTokens(
      50000,
      200000,
      flag === undefined ? {} : { contextUsageDetail: flag }
    )
    try {
      const markup = renderToStaticMarkup(<ConversationScreen />)
      expect(markup).toContain('<span class="composer__context">')
      expect(markup).toContain('<span class="composer__context-label">Context: 25%</span>')
      expect(markup.includes('composer__context-trigger')).toBe(trigger)
    } finally {
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
  it('mounts the model control in the footer row, after the reading and Actions (AC1, AC4)', () => {
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
      // The design's item order since #1728: the reading, Actions, then the model control.
      expect(markup.indexOf('class="composer__context')).toBeGreaterThan(-1)
      expect(markup.indexOf('class="composer__context')).toBeLessThan(triggerAt)
      expect(modelAt).toBeGreaterThan(triggerAt)
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
  it('mounts the effort control in the footer row, after the reading and the model control (AC1, AC3)', () => {
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
        effectiveEffort: 'seeded-session-effort',
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
      // The design's item order since #1728: the reading, Actions, the model control, then effort.
      expect(markup.indexOf('class="composer__context')).toBeGreaterThan(-1)
      expect(markup.indexOf('class="composer__context')).toBeLessThan(
        markup.indexOf(ACTIONS_TRIGGER_CLASS_RUN)
      )
      expect(effortAt).toBeGreaterThan(modelAt)
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
        effectiveEffort: 'seeded-session-effort',
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
      // The footer's order in full since #1728 (Figma 347:5408): the reading, Actions, permission mode,
      // model, then effort.
      const contextAt = markup.indexOf('class="composer__context')
      expect(contextAt).toBeGreaterThan(-1)
      if (connected) expect(markup.indexOf(ACTIONS_TRIGGER_CLASS_RUN)).toBeGreaterThan(contextAt)
      else expect(markup).not.toContain(ACTIONS_TRIGGER_CLASS_RUN)
      expect(permissionAt).toBeGreaterThan(contextAt)
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
  // which since #1728 is the row's first item, and past every control. The same getInitialState SPY as the three
  // tests above, and for the same reason — zustand v5 reads getInitialState() under renderToStaticMarkup,
  // so a seeded snapshot is what makes the reading (and the three menu labels) appear at all.
  it('places the attach button last in the footer row, past all four controls and the reading (AC1)', () => {
    const initial = runConfigStore.getInitialState()
    const spy = vi.spyOn(runConfigStore, 'getInitialState').mockReturnValue({
      ...initial,
      snapshot: {
        model: 'seeded-session-model',
        effort: 'seeded-session-effort',
        effectiveEffort: 'seeded-session-effort',
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
    // #1604: with no pill to show, the Top overlay renders no element at all.
    expect(markup).toContain('conversation__top-overlay')
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
  it('renders the connection pill without a header band while disconnected', () => {
    const markup = renderToStaticMarkup(<ConversationScreen />)
    expect(markup).not.toContain('conversation__banner')
    expect(markup).toContain('top-overlay-pill--error" role="status"')
    expect(markup).toContain(CONNECTION_BANNER_COPY)
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
  // render). The opened menu is exercised in the top-bar Playwright spec.
  it.each([
    ['Current channel', 'Current channel'],
    [null, 'Unnamed conversation'],
    ['<script>example</script>', '&lt;script&gt;example&lt;/script&gt;']
  ])('renders the active top-bar name as text: %s', (name, expected) => {
    const snapshot = vi.spyOn(activeConversationStore, 'getInitialState').mockReturnValue({
      ...activeConversationStore.getInitialState(),
      activeConversation: {
        id: 'top-bar-chat', name, cwd: '/workspace', is_promoted: false,
        last_used_at: '2026-09-19T00:00:00Z', workspace_label: null
      }
    })
    try {
      const markup = renderToStaticMarkup(<ConversationScreen onBack={() => {}} />)
      expect(markup).toContain(`<p class="conversation__overflow-title">${expected}</p>`)
    } finally {
      snapshot.mockRestore()
    }
  })

  it('renders the overflow trigger, collapsed, when onBack is provided (the shell-mounted thread, AC1)', () => {
    const markup = renderToStaticMarkup(<ConversationScreen onBack={() => {}} />)
    expect(markup).toContain('composer-options-anchor composer-options-anchor--bottom-end')
    expect(markup).toContain('aria-label="More actions"')
    expect(markup).toContain('aria-expanded="false"')
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

  it('labels every drop site, with client-owned copy the daemon never supplies', () => {
    expect(unrecognizedSiteLabel('line_type')).toBe('whole message')
    expect(unrecognizedSiteLabel('assistant_block')).toBe('assistant block')
    expect(unrecognizedSiteLabel('user_block')).toBe('user block')
    expect(unrecognizedSiteLabel('undecodable')).toBe('could not be decoded')
    expect(unrecognizedSiteLabel('codex_method')).toBe('Codex notification')
    expect(unrecognizedSiteLabel('codex_item')).toBe('Codex item')
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
    [{ type: 'error', error: { code: 'transport', message: 'untrusted', retryable: true } }, false, null],
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

// #1621: a file the ASSISTANT sent (`attachment_offered`) draws as the same file row — or the same image
// slot — inside an assistant-side bubble of its own (Figma `File field` 132:4605, in context 102-4).
// Activation is the existing row's handler, so there is no click to prove here; what this tier owns is
// the side, the reuse of the row, the image fork, and the untrusted-filename posture.
describe('Timeline — a file the assistant offered (#1621)', () => {
  const rowCount = (markup: string): number => markup.match(/class="bubble__file"/g)?.length ?? 0
  const offer = (attachmentId: string, filename: string): ThreadItem => ({
    kind: 'attachmentOffer',
    attachment: { attachmentId, filename }
  })

  it('draws the existing file row inside an assistant-side bubble with no meta row', () => {
    const markup = renderToStaticMarkup(<RowViews items={[offer('offer-1', 'report.pdf')]} />)
    expect(markup).toContain(
      '<div class="message-row message-row--daemon"><div class="bubble bubble--daemon bubble--attachment-offer" ' +
        'data-thread-role="assistant"><button type="button" class="bubble__file" disabled="">'
    )
    expect(rowCount(markup)).toBe(1)
    expect(markup).toContain('<span class="bubble__file-name">report.pdf</span>')
    expect(markup).toContain('<span class="bubble__file-ext" aria-hidden="true">PDF</span>')
    expect(markup).not.toContain('bubble__meta')
    expect(markup).not.toContain('message-row--text')
    expect(markup).not.toContain('message-actions')
    expect(markup).not.toContain('data-thread-role="user"')
  })

  it('takes the image slot instead of the row when the name reads as an image', () => {
    const markup = renderToStaticMarkup(<RowViews items={[offer('offer-1', 'chart.png')]} />)
    expect(rowCount(markup)).toBe(0)
    expect(markup).toContain('bubble--attachment-offer')
    // The picture's fetch starts in an effect, which a static render does not run: nothing is drawn yet.
    expect(markup).not.toContain('chart.png')
  })

  it('draws one bubble per offer item', () => {
    const markup = renderToStaticMarkup(
      <RowViews items={[offer('offer-1', 'a.txt'), offer('offer-2', 'b.txt')]} />
    )
    expect(rowCount(markup)).toBe(2)
    expect(markup.match(/bubble--attachment-offer/g)?.length ?? 0).toBe(2)
  })

  it('renders a hostile filename only as escaped text, never inside an attribute', () => {
    const hostile = '"><img src=x onerror=alert(1)>.pdf'
    const markup = renderToStaticMarkup(<RowViews items={[offer('offer-1', hostile)]} />)
    expect(markup).not.toContain('<img')
    expect(markup).toContain(
      '<span class="bubble__file-name">&quot;&gt;&lt;img src=x onerror=alert(1)&gt;.pdf</span>'
    )
    // No attribute value anywhere carries any part of the name.
    const attributeValues = [...markup.matchAll(/="([^"]*)"/g)].map((match) => match[1])
    expect(attributeValues.some((value) => value.includes('onerror') || value.includes('.pdf'))).toBe(false)
  })
})

// #1627: the markdown-path link reaches only a settled assistant reply's markdown. The click and the
// reader are e2e/markdown-reader.spec.ts's.
describe('Timeline markdown-path links (#1627)', () => {
  const LINK = 'See [the plan](notes/Plan.md).'

  it('renders a settled assistant reply\'s markdown link as the reader control', () => {
    const items: ThreadItem[] = [
      { kind: 'assistantText', turnId: 't1', text: LINK },
      { kind: 'turnBoundary', turnId: 't1', stopReason: 'end_turn' }
    ]
    const markup = renderToStaticMarkup(<RowViews items={items} onOpenMarkdownPath={() => {}} />)
    expect(markup).toContain('<button type="button" class="markdown-link">the plan</button>')
    expect(markup).not.toContain('notes/Plan.md')
  })

  it('leaves a user message with the same text unchanged', () => {
    const markup = renderToStaticMarkup(
      <RowViews items={[{ kind: 'userText', text: LINK }]} onOpenMarkdownPath={() => {}} />
    )
    expect(markup).toContain(LINK)
    expect(markup).not.toContain('markdown-link')
  })
})

// Direct row fixtures reconstruct no arrival or lifecycle state.
function RowViews({ items, ...props }: { items: readonly ThreadItem[] } & Omit<React.ComponentProps<typeof TimelineRow>, 'item' | 'inProgress'>) {
  return <>{items.map((item, index) => <TimelineRow key={index} item={item} inProgress={false} {...props} />)}</>
}

describe('shared row presentation with explicit activity', () => {
  it('reveals markdown while active and settles the same escaped source with copy, reply and usage', () => {
    const item: ThreadItem = { kind: 'assistantText', turnId: 't', text: '**answer** <script>x</script>' }
    const streaming = renderToStaticMarkup(<TimelineRow item={item} inProgress />)
    const settled = renderToStaticMarkup(<TimelineRow item={item} inProgress={false} turnStats="12 out" onReply={() => {}} />)
    expect(streaming).toContain('bubble__cursor')
    expect(streaming).toContain('<strong>answer</strong>')
    expect(settled).not.toContain('bubble__cursor')
    expect(settled).toContain('12 out')
    expect(settled).toContain('aria-label="Copy message"')
    expect(settled).toContain('aria-label="Reply to message"')
    for (const html of [streaming, settled]) {
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    }
  })
})
