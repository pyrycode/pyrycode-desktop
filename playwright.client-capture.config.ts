import { defineConfig } from '@playwright/test'
process.env.PYRY_CLIENT_MODE = 'capture'
export default defineConfig({
  testDir: './e2e', testMatch: ['real-claude.spec.ts', 'real-claude-attachment.spec.ts', 'real-claude-interrupt.spec.ts', 'real-claude-mcp.spec.ts', 'real-claude-new-session.spec.ts', 'real-claude-question-answer.spec.ts', 'real-claude-system-prompt.spec.ts', 'real-daemon-rename.spec.ts', 'real-daemon-conversation-lifecycle.spec.ts', 'real-daemon-create-channel.spec.ts', 'real-daemon-promote.spec.ts', 'real-daemon-session-settings.spec.ts'],
  globalSetup: './e2e/fixtures/runDisplay.ts', workers: 1, retries: 0, forbidOnly: true,
  reporter: [['list'], ['./e2e/reporters/zeroExecutedGate.ts']], timeout: 300_000
})
