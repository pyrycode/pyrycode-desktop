import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerErrorSlot, ComposerHistoryFailure, ConversationScreen } from './ConversationScreen'
import { sessionStore, type ConnectionStatus } from '../../store/sessionStore'
import { conversationTimelineStore, createConversationTimelineStore } from '../../store/conversationTimelineStore'
import { activeConversationStore } from '../../store/activeConversationStore'
import { conversationListStore } from '../../store/conversationListStore'
import { usageLimitStore } from '../../store/usageLimitStore'
import { runSettingsWriteStore } from '../../store/runSettingsWriteStore'
import { sessionIdStore } from '../../store/sessionIdStore'
import type { TimelineState } from '../../store/threadTimeline'

afterEach(() => vi.restoreAllMocks())

const history = (retryable = true) => <ComposerHistoryFailure retryable={retryable} onRetry={() => {}} />
const render = (status: ConnectionStatus, overrides = {}) => renderToStaticMarkup(
  <ComposerErrorSlot status={status} onRepair={() => {}} notice={null} history={history()} {...overrides} />)

describe('history status occupant', () => {
  it.each([false, true])('renders fixed error copy with Retry only when retryable=%s', retryable => {
    const markup = renderToStaticMarkup(history(retryable))
    expect(markup).toContain('Could not load older messages')
    expect(markup.includes('>Retry</button>')).toBe(retryable)
    expect(markup).toContain('role="status"')
  })

  it('falls back to history only when preceding occupants are absent', () => {
    expect(render({ type: 'connected' })).toContain('Could not load older messages')
    for (const occupant of ['recovery', 'refusal', 'notice']) {
      const markup = render({ type: 'connected' }, { [occupant]: <span>Higher priority</span> })
      expect(markup).toBe('<span>Higher priority</span>')
    }
    expect(render({ type: 'connected' }, { recovery: <span>Recovery</span>, refusal: <span>Refusal</span>, notice: <span>Notice</span> }))
      .toBe('<span>Recovery</span>')
    expect(render({ type: 'connected' }, { refusal: <span>Refusal</span>, notice: <span>Notice</span> }))
      .toBe('<span>Refusal</span>')
  })

  it.each<ConnectionStatus>([
    { type: 'disconnected' }, { type: 'connecting' },
    { type: 'error', error: { code: 'offline', message: 'sentinel', retryable: true } },
    { type: 'error', error: { code: 'pairing', message: 'sentinel', retryable: false } }
  ])('keeps connection and repair priority for $type', status => {
    expect(render(status)).not.toContain('Could not load older messages')
    expect(render(status)).not.toContain('>Retry</button>')
  })
})

function stageScreen(host = 'host', displayed = 'chat', status: ConnectionStatus = { type: 'connected' },
  timeline: Partial<TimelineState> = {}) {
  const timelines = createConversationTimelineStore()
  timelines.getState().markViewed('chat')
  timelines.getState().markHistoryRequested('chat', host)
  timelines.getState().recordHistoryFailure('chat', 'history-unavailable', true)
  const slice = timelines.getState().timelines.get('chat')!
  vi.spyOn(conversationTimelineStore, 'getInitialState').mockReturnValue({ ...timelines.getState(),
    timelines: new Map([['chat', { ...slice, timeline: { ...slice.timeline, ...timeline } }]]) })
  const active = { id: displayed, name: 'Chat', cwd: '', is_promoted: false, last_used_at: '', workspace_label: null }
  vi.spyOn(activeConversationStore, 'getInitialState').mockReturnValue({
    ...activeConversationStore.getInitialState(), activeConversation: active })
  vi.spyOn(conversationListStore, 'getInitialState').mockReturnValue({
    ...conversationListStore.getInitialState(), conversations: [{ ...active, serverId: 'host',
      is_archived: false, last_message_ts: '' }] })
  vi.spyOn(sessionStore, 'getInitialState').mockReturnValue({
    ...sessionStore.getInitialState(), statuses: new Map([['host', status]]) })
  return () => renderToStaticMarkup(<ConversationScreen />)
}

describe('history in the store-bound composer status slot', () => {
  it('an absent usage notice permits the owned failure; pending and success remove it', () => {
    const screen = stageScreen()
    expect(screen()).toContain('Could not load older messages')
    const state = conversationTimelineStore.getInitialState()
    const slice = state.timelines.get('chat')!
    for (const history of [{ status: 'requested' } as const, { status: 'loaded', cursor: 'next', atStart: false } as const]) {
      vi.mocked(conversationTimelineStore.getInitialState).mockReturnValue({ ...state,
        timelines: new Map([['chat', { ...slice, history }]]) })
      expect(screen()).not.toContain('Could not load older messages')
    }
  })

  it.each([
    ['other', 'chat', { type: 'connected' }], ['host', 'other', { type: 'connected' }],
    ['host', 'chat', { type: 'disconnected' }]
  ] as const)('hides failure for held host=%s displayed=%s status=%j', (host, displayed, status) => {
    expect(stageScreen(host, displayed, status)()).not.toContain('Could not load older messages')
  })

  it('preserves recovery, refusal, settings, stopping and usage priority ahead of history', () => {
    const screen = stageScreen('host', 'chat', { type: 'connected' }, {
      latestTurnEnd: { type: 'turnEnd', turnId: 't', stopReason: 'error', isError: true, errorCategory: 'billing_error' },
      refusalOffer: { report: { type: 'modelRefusalFallback', originalModel: 'opus', fallbackModel: 'sonnet',
        scope: 'session', refusalCategory: '', banner: '', truncatedFields: null, droppedFields: null } },
      stoppingBanner: { text: 'Stopping report', truncated: false }
    })
    vi.spyOn(sessionIdStore, 'getInitialState').mockReturnValue({ ...sessionIdStore.getInitialState(), sessionId: 'session' })
    vi.spyOn(runSettingsWriteStore, 'getInitialState').mockReturnValue({ ...runSettingsWriteStore.getInitialState(), error: 'model' })
    vi.spyOn(usageLimitStore, 'getInitialState').mockReturnValue({ ...usageLimitStore.getInitialState(),
      readings: new Map([['chat', { status: 'rejected', limitType: 'five_hour', resetsAt: 0 }]]) })
    const assertOccupant = (copy: string) => {
      const markup = screen()
      expect(markup).toContain(copy)
      expect(markup).not.toContain('Could not load older messages')
    }
    const clear = (field: 'latestTurnEnd' | 'refusalOffer' | 'stoppingBanner') => {
      const state = conversationTimelineStore.getInitialState()
      const slice = state.timelines.get('chat')!
      vi.mocked(conversationTimelineStore.getInitialState).mockReturnValue({ ...state,
        timelines: new Map([['chat', { ...slice, timeline: { ...slice.timeline, [field]: undefined } }]]) })
    }
    assertOccupant('Claude reported a billing error')
    expect(screen()).not.toContain('Switch back')
    clear('latestTurnEnd')
    assertOccupant('Switch back')
    clear('refusalOffer')
    assertOccupant('Could not change the model')
    vi.mocked(runSettingsWriteStore.getInitialState).mockReturnValue({ ...runSettingsWriteStore.getInitialState(), error: null })
    assertOccupant('Stopping report')
    clear('stoppingBanner')
    assertOccupant('Usage limit reached')
    vi.mocked(usageLimitStore.getInitialState).mockReturnValue({ ...usageLimitStore.getInitialState(), readings: new Map() })
    expect(screen()).toContain('Could not load older messages')
  })
})
