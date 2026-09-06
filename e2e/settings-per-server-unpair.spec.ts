import { test, expect, FIRST_SERVER_ID, SECOND_SERVER_ID } from './fixtures/launchPairedApp'

// Fake-stack UI e2e for the per-server unpair (#1162): each Settings row forgets its OWN server, the
// action asks first, the departed row leaves without a relaunch, and only the LAST server routes to
// the pairing screen. Nothing in this repo can click and renderer specs are static server renders
// (CLAUDE.md), so the confirm and both two-server outcomes can only be proven here. The unit tier
// covers what a prop can express: runUnpairServer's branch matrix and ServerRow's three phases.
//
// THE ASSERTION TRAP THIS SPEC IS BUILT AROUND. The fixture's two ids are 'fake-daemon' and
// 'fake-daemon-2' — the first is a SUBSTRING of the second — and Playwright's `hasText` / `getByText`
// are case-insensitive substring matches. So a text filter for the first id selects BOTH rows, and
// "the first server's row is gone" could pass or fail for reasons unrelated to the feature. Every
// identity assertion below is therefore the ARRAY FORM of `toHaveText` over `.settings__server-row-id`
// — `toHaveText` matches the whole string, and the array pins the count, each row's exact id, and the
// store's order (oldest-paired first) in one read. Rows are addressed for clicking by POSITION, never
// by a text filter. This is `multi-server-launch.spec.ts`'s own assertion, reused deliberately.
//
// WHAT THIS SPEC DELIBERATELY DOES NOT ASSERT: the channel list after the first unpair.
// `clearPairingScopedState` stays whole-app in this slice (scoping it to the departed server is
// #1150), and whether the surviving server's rows come back depends on a session-status re-assertion
// this slice neither owns nor drives. AC3 is worded against the Settings rows and the shell route —
// both of which this slice owns outright — for exactly that reason. Pinning an outcome the app may
// not realize is the #440 discipline.
//
// SECRET HYGIENE, inherited from the fixture: both pasted payloads carry synthetic keys and synthetic
// tokens, and nothing below ever reaches one. Every assertion reads DOM text or a small integer, so a
// failure diff can print a server id (which `serverInfoHandler` already vets as non-secret) or a
// count — never a payload, a token, a key or a relay URL.

test('each Settings row unpairs its own server, and only the last one routes to pairing', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({}, { secondServer: {} })

  await page.getByRole('button', { name: 'Settings' }).click()
  const settings = page.locator('section[aria-label="Settings screen"]')
  await expect(settings).toBeVisible()

  const rows = page.locator('.settings__server-row')
  const ids = page.locator('.settings__server-row-id')
  const pairingBox = page.locator('[aria-label="Pairing code"]')

  // The baseline both later reads are measured against: two rows, in pairing order.
  await expect(ids).toHaveText([FIRST_SERVER_ID, SECOND_SERVER_ID])

  // --- AC2: the action ASKS before it forgets anything. No one-click forget survived the move from
  // #166's two-phase control. ---
  const firstRow = rows.nth(0)
  const secondRow = rows.nth(1)
  await expect(firstRow.getByRole('button', { name: 'Confirm', exact: true })).toHaveCount(0)
  await firstRow.getByRole('button', { name: 'Unpair', exact: true }).click()
  await expect(firstRow.locator('.settings__server-unpair-prompt')).toBeVisible()
  await expect(firstRow.getByRole('button', { name: 'Confirm', exact: true })).toBeVisible()

  // Arming ONE row leaves every other row un-armed — the constraint that makes the confirm per row
  // rather than per screen. The second row has no question of its own and still offers its resting
  // verb, so a second row's Unpair can never be sitting on top of the first row's live confirm.
  await expect(secondRow.locator('.settings__server-unpair-prompt')).toHaveCount(0)
  await expect(secondRow.getByRole('button', { name: 'Unpair', exact: true })).toBeVisible()
  // Still nothing erased while the question stands: both rows are exactly where they were.
  await expect(ids).toHaveText([FIRST_SERVER_ID, SECOND_SERVER_ID])

  // --- AC1 + AC3: confirming forgets THAT row's server and only that one. The departed row leaves on
  // its own — no relaunch, no re-entry into Settings — because the erase is followed by a re-read of
  // the collection, and `ServerInfoData`'s mount fetch is a one-shot that would otherwise never
  // re-run. Count AND identity in one exact-text read: one row, naming the SURVIVOR. ---
  await firstRow.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(ids).toHaveText([SECOND_SERVER_ID])

  // --- AC3's other half: the app stayed in the paired shell. Settings is still up and the app-root
  // pairing surface was never mounted, so forgetting one of two did not throw the operator back to
  // pairing while a server is still paired. ---
  await expect(settings).toBeVisible()
  await expect(pairingBox).toHaveCount(0)

  // --- AC4: unpairing the LAST paired server routes to the pairing screen, as the whole-collection
  // path does. `rows.nth(0)` is the survivor now — addressed by position, so the substring-shared ids
  // cannot select the wrong one. ---
  const lastRow = rows.nth(0)
  await lastRow.getByRole('button', { name: 'Unpair', exact: true }).click()
  await lastRow.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(pairingBox).toBeVisible()
  await expect(settings).toHaveCount(0)
})
