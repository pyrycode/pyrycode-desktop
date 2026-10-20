import type { Page } from '@playwright/test'

/** Install before the target so elapsed setup time cannot make pauseAt travel backwards. */
export async function installPausedClock(page: Pick<Page, 'clock'>, instant: Date): Promise<void> {
  await page.clock.install({ time: new Date(instant.getTime() - 86_400_000) })
  await page.clock.pauseAt(instant)
}
