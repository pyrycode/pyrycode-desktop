import { expect, type Page } from '@playwright/test'
import { confirmCreateChat } from './confirmCreateChat'

// Controlled content shared by capture, live verification and offline replay.
export const PERMISSION_PROMPT = 'Use the Bash tool to run exactly `touch record-replay-poc-witness.txt`. ' +
  'Do not use another tool. After it completes, reply with exactly POC_PERMISSION_COMPLETE.'
export const PERMISSION_REPLY = 'POC_PERMISSION_COMPLETE'
export const PERMISSION_WITNESS = 'record-replay-poc-witness.txt'

export async function drivePermissionScenario(page: Page, options: {
  allowLabel: () => Promise<string>
  beforeApproval?: () => Promise<void>
  afterApproval?: () => Promise<void>
}): Promise<{ historyRetry: boolean }> {
  await expect(page.locator('.channel-list__row-open').first()).toBeVisible({ timeout: 45_000 })
  await confirmCreateChat(page)
  const send = page.getByRole('button', { name: 'Send', exact: true })
  await expect(send).toBeEnabled({ timeout: 45_000 })
  await page.getByPlaceholder('Message…').fill(PERMISSION_PROMPT)
  await send.click()
  const panel = page.locator('.permission-panel')
  await expect(panel).toBeVisible({ timeout: 120_000 })
  // Known daemon cold-history refusal. Retain the actual Retry action in the recording;
  // this scenario does not certify healthy initial history loading.
  const retry = page.getByRole('button', { name: 'Retry', exact: true })
  const historyRetry = await retry.count() > 0
  if (historyRetry) {
    await retry.click()
    await expect(page.locator('[data-thread-role="user"]').first()).toBeVisible()
  }
  const assistant = page.locator('[data-thread-role="assistant"]').filter({ hasText: PERMISSION_REPLY })
  await expect(assistant).toHaveCount(0)
  await options.beforeApproval?.()
  const choice = panel.getByRole('button', { name: await options.allowLabel(), exact: true })
  await choice.click()
  await expect(panel.getByRole('status')).toHaveText('Activate this choice again to confirm.')
  await expect(assistant).toHaveCount(0)
  await options.beforeApproval?.()
  await choice.click()
  await expect(panel).toHaveCount(0)
  await options.afterApproval?.()
  await expect(assistant.first()).toBeVisible({ timeout: 120_000 })
  await expect(page.locator('.bubble__cursor')).toHaveCount(0, { timeout: 30_000 })
  return { historyRetry }
}
