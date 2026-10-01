import type { Page } from '@playwright/test'

/** Create an unnamed chat on the paired host using its daemon-default folder. */
export async function mintChatInWorkspace(page: Page, _cwd: string): Promise<void> {
  await page.getByRole('button', { name: 'Create chat', exact: true }).first().click()
  await page.getByRole('dialog', { name: 'Create chat', exact: true })
    .getByRole('button', { name: 'OK', exact: true }).click()
}
