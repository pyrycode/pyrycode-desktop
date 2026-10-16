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

base.describe('claude-interrupt', () => {
  test.use({ recordingName: 'claude-interrupt' } as any)
  require('./real-claude-interrupt.spec')
})

base.describe('claude-mcp', () => {
  test.use({ recordingName: 'claude-mcp' } as any)
  require('./real-claude-mcp.spec')
})

base.describe('claude-new-session', () => {
  test.use({ recordingName: 'claude-new-session' } as any)
  require('./real-claude-new-session.spec')
})

base.describe('claude-question-answer', () => {
  test.use({ recordingName: 'claude-question-answer' } as any)
  require('./real-claude-question-answer.spec')
})

base.describe('claude-system-prompt', () => {
  test.use({ recordingName: 'claude-system-prompt' } as any)
  require('./real-claude-system-prompt.spec')
})

base.describe('daemon-rename', () => {
  test.use({ recordingName: 'daemon-rename' } as any)
  require('./real-daemon-rename.spec')
})

base.describe('daemon-conversation-lifecycle', () => {
  test.use({ recordingName: 'daemon-conversation-lifecycle' } as any)
  require('./real-daemon-conversation-lifecycle.spec')
})

base.describe('daemon-create-channel', () => {
  test.use({ recordingName: 'daemon-create-channel' } as any)
  require('./real-daemon-create-channel.spec')
})

base.describe('daemon-promote', () => {
  test.use({ recordingName: 'daemon-promote' } as any)
  require('./real-daemon-promote.spec')
})

base.describe('daemon-session-settings', () => {
  test.use({ recordingName: 'daemon-session-settings' } as any)
  require('./real-daemon-session-settings.spec')
})
