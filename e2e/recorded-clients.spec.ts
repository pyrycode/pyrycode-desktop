import { test as base } from '@playwright/test'
import { test } from './fixtures/clientScenario'

base.describe('claude', () => {
  test.use({ recordingName: 'claude' } as any)
  require('./real-claude.spec')
})

base.describe('claude-attachment', () => {
  test.use({ recordingName: 'claude-attachment' } as any)
  require('./real-claude-attachment.spec')
})

base.describe('claude-codex-channel', () => {
  test.use({ recordingName: 'claude-codex-channel' } as any)
  require('./real-claude-codex-channel.spec')
})

base.describe('claude-effort-default', () => {
  test.use({ recordingName: 'claude-effort-default' } as any)
  require('./real-claude-effort-default.spec')
})

base.describe('claude-interrupt', () => {
  test.use({ recordingName: 'claude-interrupt' } as any)
  require('./real-claude-interrupt.spec')
})

base.describe('claude-mcp', () => {
  test.use({ recordingName: 'claude-mcp' } as any)
  require('./real-claude-mcp.spec')
})

base.describe('claude-model-recall', () => {
  test.use({ recordingName: 'claude-model-recall' } as any)
  require('./real-claude-model-recall.spec')
})

base.describe('claude-new-session', () => {
  test.use({ recordingName: 'claude-new-session' } as any)
  require('./real-claude-new-session.spec')
})

base.describe('claude-permission-modal', () => {
  test.use({ recordingName: 'claude-permission-modal' } as any)
  require('./real-claude-permission-modal.spec')
})

base.describe('claude-permission-mode', () => {
  test.use({ recordingName: 'claude-permission-mode' } as any)
  require('./real-claude-permission-mode.spec')
})

base.describe('claude-phase-reconnect', () => {
  test.use({ recordingName: 'claude-phase-reconnect' } as any)
  require('./real-claude-phase-reconnect.spec')
})

base.describe('claude-question-answer', () => {
  test.use({ recordingName: 'claude-question-answer' } as any)
  require('./real-claude-question-answer.spec')
})

base.describe('claude-question-cancel', () => {
  test.use({ recordingName: 'claude-question-cancel' } as any)
  require('./real-claude-question-cancel.spec')
})

base.describe('claude-queue-delivery', () => {
  test.use({ recordingName: 'claude-queue-delivery' } as any)
  require('./real-claude-queue-delivery.spec')
})

base.describe('claude-queue-drop', () => {
  test.use({ recordingName: 'claude-queue-drop' } as any)
  require('./real-claude-queue-drop.spec')
})

base.describe('claude-queue-send-now', () => {
  test.use({ recordingName: 'claude-queue-send-now' } as any)
  require('./real-claude-queue-send-now.spec')
})

base.describe('claude-system-prompt', () => {
  test.use({ recordingName: 'claude-system-prompt' } as any)
  require('./real-claude-system-prompt.spec')
})

base.describe('claude-thread', () => {
  test.use({ recordingName: 'claude-thread' } as any)
  require('./real-claude-thread.spec')
})

base.describe('daemon-archive-order', () => {
  test.use({ recordingName: 'daemon-archive-order' } as any)
  require('./real-daemon-archive-order.spec')
})

base.describe('daemon-conversation-lifecycle', () => {
  test.use({ recordingName: 'daemon-conversation-lifecycle' } as any)
  require('./real-daemon-conversation-lifecycle.spec')
})

base.describe('daemon-create-channel', () => {
  test.use({ recordingName: 'daemon-create-channel' } as any)
  require('./real-daemon-create-channel.spec')
})

base.describe('daemon-history-on-open', () => {
  test.use({ recordingName: 'daemon-history-on-open' } as any)
  require('./real-daemon-history-on-open.spec')
})

base.describe('daemon-multi-agent', () => {
  test.use({ recordingName: 'daemon-multi-agent' } as any)
  require('./real-daemon-multi-agent.spec')
})

base.describe('daemon-promote', () => {
  test.use({ recordingName: 'daemon-promote' } as any)
  require('./real-daemon-promote.spec')
})

base.describe('daemon-rename', () => {
  test.use({ recordingName: 'daemon-rename' } as any)
  require('./real-daemon-rename.spec')
})

base.describe('daemon-session-settings', () => {
  test.use({ recordingName: 'daemon-session-settings' } as any)
  require('./real-daemon-session-settings.spec')
})
