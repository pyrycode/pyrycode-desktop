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
// #1196 GAVE THE CHANNEL LIST BACK TO THIS SPEC, and the paragraph that used to stand here — "what this
// spec deliberately does not assert: the channel list after the first unpair" — is retired rather than
// softened. It was right while `clearPairingScopedState` stayed whole-app and the per-server path
// reached no clear at all, and its stated reason (the surviving rows "depend on a session-status
// re-assertion this slice neither owns nor drives") turned out to be answering the wrong question: no
// slot of the surviving server's is ever dropped, so nothing of its has to come back. The residue was
// the DEPARTED machine's, and #1196 drops it at the source.
//
// ASSERT AGAINST THE WHOLE SIDEBAR, NEVER ONE SUBTREE. Since #1070 the list is drawn one subtree per
// paired machine from `serverInfoStore` — which the unpair already refreshes — so the departed machine's
// HOST ROW leaves with or without the fix, while its conversation rows, still stamped with a server no
// longer on that list, fall into `groupByServer`'s `unattributed` bucket and render LAST under no host
// row at all. A departed row that survives the fix therefore still renders; it only moves. An assertion
// scoped to the departed machine's subtree would pass vacuously the moment its host row went, so every
// row read below is over the APP-WIDE `.channel-list__title` set.
//
// AC2 (every departed conversation's retained thread is dropped, not only the open one) is NOT asserted
// here and that is deliberate: the fake tier seeds one row per server and no thread rows at all, so
// there is nothing on screen whose absence could distinguish the fix from its absence.
// `clearServerScopedState.test.ts` drives it directly, over a departed set of three with a different one
// on screen — the case an id-gated exit cannot reach.
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

  // --- #1196 AC1 + AC3: the departed machine's conversation rows are gone from the WHOLE sidebar, and
  // the survivor's are exactly where they were. Read back on the Channel List, which `.settings__back`
  // reaches because `nextPairedRoute`'s `back` is absolute to `list`. ---
  await page.locator('.settings__back').click()
  const titles = page.locator('.channel-list__title')
  // The array form, so the count, each row's exact text and their order are one read. `toHaveText`
  // matches the WHOLE string, unlike the substring-matching `hasText` this file's header warns about.
  await expect(titles).toHaveText(['Server two chat'])
  // AC3's first half. The fixture opens the FIRST server's seeded row as its connected gate, so the
  // conversation on screen at launch belongs to the machine just forgotten; `aria-current` is how an
  // open row marks itself. Coupled to the row read above by construction — a row that is gone cannot
  // be current — and asserted anyway, because it is the only on-screen trace of the active-conversation
  // clear that the row drop does not already state.
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveCount(0)

  // NO FURTHER INTERACTION BEFORE THE READS ABOVE, and that is a fixture constraint rather than a
  // preference: BOTH fake servers are started with the same default `buildReply: () =>
  // seedConversationsFrame()`, which answers ANY request with a one-row `conversations` frame built from
  // SEEDED_ROW. The second server's own row reaches the app only through `pushFrame`. So any click that
  // sends a command — opening a conversation fires `requestSessionSettings` and `requestModelList` —
  // draws a reply that overwrites the SURVIVING server's slot with the DEPARTED row's name, and the
  // sidebar reads 'Seeded discussion' again with nothing wrong in the app. Measured here: an earlier
  // draft re-opened the survivor's row at this point and read exactly that.
  //
  // So AC3's second half (a chat belonging to a still-paired server stays open, thread intact) is the
  // unit tier's, in `clearServerScopedState.test.ts` — which drives it directly, with the open
  // conversation belonging to a server that is NOT the one departing.

  // --- AC4: unpairing the LAST paired server routes to the pairing screen, as the whole-collection
  // path does. `rows.nth(0)` is the survivor now — addressed by position, so the substring-shared ids
  // cannot select the wrong one. ---
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(settings).toBeVisible()
  const lastRow = rows.nth(0)
  await lastRow.getByRole('button', { name: 'Unpair', exact: true }).click()
  await lastRow.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(pairingBox).toBeVisible()
  await expect(settings).toHaveCount(0)
})
