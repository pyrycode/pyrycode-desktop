import { it, expect } from 'vitest'
import { translateDaemonEvent } from './daemonEventBridge'
import { translateModalEvent } from './modalBridge'
import { translateQuestionEvent } from './questionBridge'
import { translateTimelineEvent } from './timelineBridge'
import type { DaemonEvent } from '@shared/ipc/events'

it('exhaustive event consumers ignore host prompts without exposing their content', () => {
  const received: DaemonEvent = { type: 'hostSystemPromptReceived', requestId: 'r', operation: 'read', systemPrompt: 'never expose in an exception', defaultSystemPrompt: 'default' }
  const failed: DaemonEvent = { type: 'hostSystemPromptFailed', requestId: 'r', operation: 'write' }
  for (const event of [received, failed]) {
    expect(translateDaemonEvent(event)).toBeNull()
    expect(translateModalEvent(event, () => new Set())).toBeNull()
    expect(translateQuestionEvent(event)).toBeNull()
    expect(translateTimelineEvent(event)).toBeNull()
  }
})
