import { test, expect } from './fixtures/launchPairedApp'

// The first UI-level e2e scenario (#93): drive the *built* app's main-process transport at a
// controllable target — the in-process fake relay forwarder (#90) + fake Noise_IK responder daemon
// (#91) — through the REAL pairing screen, and assert the window advances through the ChannelList
// (#140's paired entry) into the conversation thread with Send enabled. No live relay, no real `pyry`
// daemon, repeatable, run by `npm run e2e`.
//
// The launch + two isPackaged-gated dev flags (#97 loopback ws:// relay, #99 keychain-free secret
// backend) + isolated `--user-data-dir` + the paste→Pair→Confirm→seed-row-click→Send-enabled drive
// now all live in the shared `launchPairedApp` fixture (#433). This scenario asserts the milestone
// end-state the fixture reaches; the fixture's default reply seeds the one-row list, so no per-spec
// reply scripting is needed.
test('pair through the window against the fake target and reach the conversation screen', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp()

  // The fixture's drive already proved the pairing-screen → connected-thread transition (fingerprint
  // card → Confirm → seeded row click → Send-enabled). Assert the milestone end-state: on the
  // conversation thread with Send enabled — the one DOM-observable proof the Noise_IK handshake
  // completed (`.conversation` alone would pass even if the handshake later failed).
  await expect(page.locator('.conversation')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled()
})
