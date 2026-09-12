import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerErrorSlot, ConversationScreen, ModelRefusalRow } from './ConversationScreen'
import type { ModelRefusalEvent } from '@shared/ipc/events'
import { activeConversationStore } from '../../store/activeConversationStore'
import { conversationTimelineStore, createConversationTimelineStore } from '../../store/conversationTimelineStore'
import { sessionIdStore } from '../../store/sessionIdStore'
import { sessionStore } from '../../store/sessionStore'
import { conversationListStore } from '../../store/conversationListStore'
import { runSettingsWriteStore } from '../../store/runSettingsWriteStore'

afterEach(() => vi.restoreAllMocks())

const refusal: ModelRefusalEvent = { type: 'modelRefusalFallback', originalModel: 'opus', fallbackModel: 'sonnet',
  scope: 'session', refusalCategory: 'inert', banner: '<script>not markup</script>', truncatedFields: null, droppedFields: null }

it.each([{ changeId: 'held' }, { rejected: true }])('renders retained recovery state %j with an empty settings store', write => {
  const timelines = createConversationTimelineStore()
  timelines.getState().dispatchFor('a', { type: 'modelRefusal', refusal, live: true })
  const slice = timelines.getState().timelines.get('a')!
  vi.spyOn(conversationTimelineStore, 'getInitialState').mockReturnValue({
    ...timelines.getState(), timelines: new Map([['a', {
      ...slice, timeline: { ...slice.timeline, refusalOffer: { report: refusal, ...write } }
    }]])
  })
  vi.spyOn(activeConversationStore, 'getInitialState').mockReturnValue({
    ...activeConversationStore.getInitialState(), activeConversation: {
      id: 'a', cwd: '', name: 'A', is_promoted: false, last_used_at: '', workspace_label: null
    }
  })
  vi.spyOn(sessionStore, 'getInitialState').mockReturnValue({
    ...sessionStore.getInitialState(), statuses: new Map([['s', {
      type: 'connected', ack: { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] }
    }]])
  })
  vi.spyOn(conversationListStore, 'getInitialState').mockReturnValue({
    ...conversationListStore.getInitialState(), conversations: [{
      id: 'a', serverId: 's', cwd: '', name: 'A', is_promoted: false, is_archived: false,
      last_message_ts: '', last_used_at: '', workspace_label: null
    }]
  })
  vi.spyOn(sessionIdStore, 'getInitialState').mockReturnValue({
    ...sessionIdStore.getInitialState(), sessionId: 'addressable'
  })
  expect(runSettingsWriteStore.getInitialState().pending.size).toBe(0)
  expect(runSettingsWriteStore.getInitialState().error).toBeNull()
  const html = renderToStaticMarkup(<ConversationScreen />)
  const button = html.match(/<button[^>]*>Switch back<\/button>/)?.[0]
  expect(button).toBeDefined()
  expect(button?.includes('disabled=""')).toBe('changeId' in write)
  expect(html.includes('Could not change the model — try again.')).toBe('rejected' in write)
})

it('renders the collapsed label and an accessible disclosure only for a nonempty banner', () => {
  const html = renderToStaticMarkup(<ModelRefusalRow refusal={refusal} />)
  expect(html).toContain('Refused on opus, continued on sonnet')
  expect(html).toContain('aria-expanded="false"')
  expect(html).not.toContain('not markup')
  const empty = renderToStaticMarkup(<ModelRefusalRow refusal={{ ...refusal, banner: '' }} />)
  expect(empty).not.toContain('<button')
  expect(empty).not.toContain('aria-expanded')
})
it('attributes escaped bounded text to Claude and handles empty model identifiers', () => {
  const html = renderToStaticMarkup(<ModelRefusalRow refusal={{ ...refusal, originalModel: '', fallbackModel: '', banner: refusal.banner + 'x'.repeat(9000) }} defaultExpanded />)
  expect(html).toContain('Refused on unknown model, continued on unknown model')
  expect(html).toContain('Claude:')
  expect(html).toContain('&lt;script&gt;not markup&lt;/script&gt;')
  expect(html).not.toContain('<script>')
  expect(html).not.toContain('x'.repeat(8193))
  const no = { type: 'modelRefusalNoFallback' as const, originalModel: '', banner: '', refusalCategory: '', truncatedFields: null, droppedFields: null }
  expect(renderToStaticMarkup(<ModelRefusalRow refusal={no} />)).toContain('Refused by unknown model')
  expect(renderToStaticMarkup(<ModelRefusalRow refusal={{ ...no, originalModel: 'x'.repeat(1000) }} />)).not.toContain('x'.repeat(257))
})
it('keeps connection errors and stopped-turn recovery above refusal, with usage below', () => {
  const connected = { type: 'connected' as const, ack: { protocol_version: '1', server_id: 's', conn_id: 'c', capabilities: [] } }
  const props = { onRepair: () => {}, notice: <span>usage</span>, refusal: <span>swap</span> }
  expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={connected} />)).toBe('<span>swap</span>')
  expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={connected} recovery={<span>stopped</span>} />)).toBe('<span>stopped</span>')
  expect(renderToStaticMarkup(<ComposerErrorSlot {...props} status={{ type: 'disconnected' }} />)).toBe('')
  const html = renderToStaticMarkup(<ComposerErrorSlot {...props} status={{ type: 'error', error: { code: 'transport', message: 'private', retryable: false } }} />)
  expect(html).toContain('Re-pair')
  expect(html).not.toContain('swap')
  expect(html).not.toContain('private')
})
