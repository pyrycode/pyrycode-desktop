import type { Page } from '@playwright/test'

/** Drive the Chats-tree plus through its confirmation before waiting for a create reply. */
export async function confirmCreateChat(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Create chat', exact: true }).click({ force: true })
  await page.getByRole('dialog', { name: 'Create chat', exact: true })
    .getByRole('button', { name: 'OK', exact: true }).click()
}
