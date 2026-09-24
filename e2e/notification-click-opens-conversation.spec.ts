import { test, expect, SEEDED_ROW, SECOND_SEEDED_ROW } from './fixtures/launchPairedApp'
import { encodeEnvelope } from '../src/main/transport/codec'
import { DAEMON_EVENT_CHANNEL } from '../src/shared/ipc/events'
import type { ElectronApplication, Page } from '@playwright/test'

// Fake-stack e2e for THE NOTIFICATION CLICK OPENING ITS OWN CONVERSATION (#1597). The unit tier pins the
// token guard, the minting map and the row lookup; `src/main/index.ts` has no test file, so its `notify`
// arm echoing the token on the click is what this spec buys. Two fake hosts, so "on whichever paired
// host B lives" is observed rather than inferred.
//
// The OS notification itself is replaced in the main process: `show()` records the instance instead of
// raising it, and the window reports unfocused so fireNotification's focus gate lets it through. A click
// is the recorded instance's own `click` event, the one Electron emits.

type Recorder = typeof globalThis & { raisedNotifications: { emit: (event: string) => boolean }[] }

const turnEnd = (conversationId: string): Uint8Array =>
  encodeEnvelope({
    id: 1,
    type: 'turn_end',
    ts: '2026-09-24T00:00:00Z',
    payload: { conversation_id: conversationId, turn_id: `turn-${conversationId}`, stop_reason: 'end_turn' }
  })

const raisedCount = (app: ElectronApplication) => () =>
  app.evaluate(() => (globalThis as Recorder).raisedNotifications.length)

const click = (app: ElectronApplication, index: number) =>
  app.evaluate((_electron, i) => { (globalThis as Recorder).raisedNotifications[i].emit('click') }, index)

const openRow = (page: Page) => page.locator('.channel-list__row-open[aria-current="true"]')

test('clicking a notification opens the conversation that raised it, on its own host', async ({ launchPairedApp }) => {
  const { page, app, servers } = await launchPairedApp(undefined, { secondServer: {} })
  await expect(page.locator('.channel-list__row')).toHaveCount(2)

  await app.evaluate(({ BrowserWindow, Notification }) => {
    const recorder = globalThis as Recorder
    recorder.raisedNotifications = []
    Notification.prototype.show = function (this: Recorder['raisedNotifications'][number]) {
      recorder.raisedNotifications.push(this)
    }
    BrowserWindow.getAllWindows()[0].isFocused = () => false
  })

  // A is open; each host finishes a turn, B's first.
  await page.locator('.channel-list__row', { hasText: SEEDED_ROW.name ?? '' }).locator('.channel-list__row-open').click()
  await expect(openRow(page)).toContainText(SEEDED_ROW.name ?? '')
  servers[1].daemon.pushFrame(turnEnd(SECOND_SEEDED_ROW.id))
  await expect.poll(raisedCount(app)).toBe(1)
  servers[0].daemon.pushFrame(turnEnd(SEEDED_ROW.id))
  await expect.poll(raisedCount(app)).toBe(2)

  // AC1: B's notification, clicked while A is open, opens B on the second host.
  await click(app, 0)
  await expect(openRow(page)).toContainText(SECOND_SEEDED_ROW.name ?? '')
  await expect(page.locator('.conversation')).toBeVisible()

  // AC2: the older notification still opens its own conversation, not the most recent one's.
  await click(app, 1)
  await expect(openRow(page)).toContainText(SEEDED_ROW.name ?? '')
  await click(app, 0)
  await expect(openRow(page)).toContainText(SECOND_SEEDED_ROW.name ?? '')

  // AC3: an unknown token, and none at all, show the active conversation as before.
  for (const event of [{ type: 'notificationActivated', token: 'never-minted' }, { type: 'notificationActivated' }]) {
    await app.evaluate(({ BrowserWindow }, [channel, payload]) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel as string, payload)
    }, [DAEMON_EVENT_CHANNEL, event] as const)
    await expect(openRow(page)).toContainText(SECOND_SEEDED_ROW.name ?? '')
  }
  await expect(page.locator('.conversation')).toBeVisible()
})
