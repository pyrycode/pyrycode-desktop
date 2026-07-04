import { test, expect } from './fixtures/electronApp'

// Smoke: the whole assembled app boots and its shell renders. This is the single
// assertion the harness ships with — actual UI scenarios (pairing, send, stream)
// are follow-ups that reuse the `page` fixture from ./fixtures/electronApp.
test('the app shell renders in the launched window', async ({ page }) => {
  // `.conversation` is the ConversationScreen root (App.tsx mounts it). The locator
  // auto-waits, absorbing React's async mount after DOMContentLoaded; presence proves
  // the shell rendered in the real launched window.
  await expect(page.locator('.conversation')).toBeVisible()
})
