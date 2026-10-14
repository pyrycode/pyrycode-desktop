import { expect, it } from 'vitest'
import type { DaemonEvent } from '@shared/ipc/events'
import type { SessionStateFamily } from '@shared/wire/types'
import { translateDaemonEvent } from './daemonEventBridge'
import { translateTimelineEvent } from './timelineBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'

const families: SessionStateFamily[] = [
  'modal_shown', 'question_shown', 'turn_state', 'stall', 'api_retry', 'compacting',
  'thinking_progress', 'tool_progress', 'background_task_progress', 'resetting',
  'rate_limited', 'context_usage', 'model_announced', 'session_facts', 'session_settings',
  'mcp_status', 'slash_command_list', 'model_list', 'reply_suggestion', 'session_error'
]
it.each(families)('legacy translators ignore %s clears without producing store actions', family => {
  const event: DaemonEvent = { type: 'sessionStateCleared', family,
    envelopeSessionId: null, inReplyTo: 7, correlation: { id: 8, ts: 'stamp', session_id: null, in_reply_to: 7 } }
  const conversationIdsFor = () => { throw new Error('clear must not resolve conversation identity') }
  expect(translateDaemonEvent(event)).toBeNull()
  expect(translateTimelineEvent(event)).toBeNull()
  expect(translateModalEvent(event, conversationIdsFor)).toBeNull()
  expect(translateQuestionEvent(event)).toBeNull()
})
