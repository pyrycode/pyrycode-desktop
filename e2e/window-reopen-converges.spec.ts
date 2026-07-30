import { test, expect } from './fixtures/launchPairedApp'

// The close → dock-reopen round trip (#519). This is the one scenario the ticket's headline criterion
// (AC2) rests on and the one the unit tests structurally cannot reach: `liveWindow.test.ts` drives
// `replayStatus()` directly against a fake, which proves the MODULE but not the DELIVERY — whether the
// replay, fired from `did-finish-load` (index.ts:267), actually lands after the new window's renderer
// has subscribed. That subscription happens in a React passive effect (`useDaemonEventBridge`,
// daemonEventBridge.ts:173-182), so the initial render and the effect flush — two Scheduler macrotasks
// — must both complete before the page `load` task that `did-finish-load` follows. Nothing else in the
// app proves that ordering: the only event emitted at that point today is `connecting`, and losing it
// is harmless because `connected` converges the store a round-trip later. For a REOPENED window on a
// stable connection the replayed status is the only status event that window will ever receive (main
// emits status at exactly daemonConnection.ts:438, :457, :1468), so if the ordering does not hold the
// store sits at `{ type: 'disconnected' }` forever — the exact bug this ticket exists to fix, failing
// silently instead of visibly. Hence a real window lifecycle against the real built app.
//
// It runs under the default `npm run e2e` (the filename does not match the config's `real-*`
// testIgnore) and needs no daemon, credentials, or network: `launchPairedApp` stands up the in-process
// fake relay + fake Noise_IK daemon and drives the REAL pairing UI to a genuinely connected session.
//
// Neither assertion below can pass without the replayed event, which is what keeps this from being a
// vacuous "the window reopened" test — both read a product surface that is gated on the session store
// holding `connected`, in a window whose stores start empty:
//   - the seeded row renders only because `ConversationListData` requests the list on the `connected`
//     RISING EDGE (conversationListBridge.ts:120-133) — there is no request-on-mount path;
//   - Send is enabled only for `connected` (`composerAvailability`, composerSend.ts:97-110 — every
//     other status arm returns `canSend: false`).
// Verified by mutation: with `live.replayStatus()` removed from the load handler, the reopened window
// renders the empty list and the first assertion fails on timeout.
//
// SECRET HYGIENE: every assertion reads DOM visibility / enabled-state only. The pairing plumbing
// (synthetic token, fake static key) lives in the fixture and is never echoed here, and no failure
// diagnostic serialises a token, key, or plaintext.

// The fixture's own 60s budget covers the launch + pairing drive; this spec adds a second window
// lifecycle (close, reopen, a fresh renderer boot, and one more list round trip) on top of it.
const REOPEN_TEST_TIMEOUT_MS = 90_000

// A fresh renderer boot plus the list round trip through the fake, with headroom for a cold runner —
// the same order of magnitude as the fixture's own handshake wait.
const REOPEN_TIMEOUT_MS = 20_000

test('a window reopened after close converges on the live connection', async ({
  launchPairedApp
}) => {
  test.setTimeout(REOPEN_TEST_TIMEOUT_MS)

  const { page, app } = await launchPairedApp()

  // POSITIVE CONTROL. The fixture resolves on the connected thread, so this holds before anything is
  // closed; without it a reopened-window failure could not be distinguished from a launch that was
  // never connected in the first place.
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()

  // Close the only window, as Cmd-W / the red button does. On darwin `window-all-closed` does not quit
  // (index.ts:461-463), so the process — and with it the live Noise session — keeps running. This is
  // the gap in which every captured window reference used to go stale.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.close()
  })
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length))
    .toBe(0)

  // Reopen. macOS emits `activate` on the already-running process when the dock icon is clicked;
  // emitting it here drives the identical handler (index.ts:456-458) through its real
  // `getAllWindows().length === 0` condition into `openWindow()`. What the dock itself contributes is
  // Electron's event delivery, which is not this app's code; everything downstream of the event — the
  // window creation, the attach, the load handler, the replay — is exercised for real.
  const [reopened] = await Promise.all([
    app.waitForEvent('window'),
    app.evaluate(({ app: electronApp }) => {
      electronApp.emit('activate')
    })
  ])

  // AC1 + AC2 in one observation. The paired route enters at the ChannelList, whose rows arrive only
  // from a `list_conversations` request that `ConversationListData` fires on the connected rising edge.
  // In this window's empty store that edge can only come from the replayed `connected`, and the reply
  // can only render if daemon events now reach THIS window rather than the destroyed original.
  await expect(reopened.locator('.channel-list__row-open')).toBeVisible({
    timeout: REOPEN_TIMEOUT_MS
  })

  // The same convergence read at the surface the user actually sees, through a real product
  // navigation (a row click, not a forced route): the composer is live, not "Not connected".
  await reopened.locator('.channel-list__row-open').click()
  await expect(reopened.getByRole('button', { name: 'Send' })).toBeEnabled()
})
