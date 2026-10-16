import type { Locator, Page } from '@playwright/test'

type AttemptWindow = typeof window & { __connectedMenuAttempt?: {
  generation: number; activated: boolean; stop: () => void
} }

/** Reopen only after an observed connection change, never after a menu action was dispatched. */
export async function chooseConnectedMenuItem(page: Page, trigger: Locator, menuName: string,
  itemName: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout
  await page.evaluate(name => {
    const state = { generation: 0, activated: false, stop: () => {} }
    const off = window.pyry.onDaemonEvent(event => {
      if (['connected', 'connecting', 'disconnected', 'failed'].includes(event.type)) state.generation++
    })
    const clicked = (event: MouseEvent) => {
      const item = event.target instanceof Element ? event.target.closest('[role="menuitem"]') : null
      if (item?.closest('[role="menu"]')?.getAttribute('aria-label') === name) state.activated = true
    }
    document.addEventListener('click', clicked, true)
    state.stop = () => { off(); document.removeEventListener('click', clicked, true) }
    ;(window as AttemptWindow).__connectedMenuAttempt = state
  }, menuName)
  const state = () => page.evaluate(() => {
    const { generation, activated } = (window as AttemptWindow).__connectedMenuAttempt!
    return { generation, activated }
  })
  const remaining = () => Math.max(1, deadline - Date.now())
  try {
    for (;;) {
      const before = await state()
      try {
        const menu = page.getByRole('menu', { name: menuName, exact: true })
        if (!await menu.isVisible()) await trigger.click({ timeout: remaining() })
        await menu.getByRole('menuitem', { name: itemName, exact: true }).click({ timeout: Math.min(1500, remaining()) })
        return
      } catch (error) {
        const after = await state()
        if (after.activated || after.generation === before.generation || Date.now() >= deadline) throw error
      }
    }
  } finally {
    await page.evaluate(() => {
      ;(window as AttemptWindow).__connectedMenuAttempt?.stop()
      delete (window as AttemptWindow).__connectedMenuAttempt
    }).catch(() => {})
  }
}
