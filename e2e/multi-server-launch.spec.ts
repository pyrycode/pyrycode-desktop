import {
  test,
  expect,
  seedConversationsFrame,
  FIRST_SERVER_ID,
  SECOND_SERVER_ID,
  SEEDED_ROW,
  SECOND_SEEDED_ROW
} from './fixtures/launchPairedApp'

// The two-fake-daemon launch (#1091) — the proof that `launchPairedApp`'s opt-in second server stands
// the app up against TWO paired daemons inside ONE launch, so the per-server tickets (#1070 grouping,
// #1150 unpair-scoped clear, #1152 per-server unpair) have a tier to prove themselves in.
//
// WHAT THIS SPEC DELIBERATELY DOES NOT ASSERT: the sidebar's HOST rows. #1070 landed the second one —
// `ChannelList` now draws one `.channel-list__host` per paired machine in each section — and #1199 gave
// each of them its own label and its own two connection dots, off `hostLabelStore` and
// `selectStatusFor` / `selectRelayLinkStatusFor`. Both claims belong to `e2e/host-row-per-server.spec.ts`,
// which rides this same fixture: it counts the four rows, reads their labels, and drops ONE machine's
// client leg to prove the other machine's dots do not follow. This spec stays about the FIXTURE — two
// daemons, two forwarders, two pairings, one launch — and asserts only rows and Settings entries.
//
// SECRET HYGIENE, inherited from the fixture: both pasted payloads carry synthetic keys and synthetic
// tokens only, and nothing below ever reaches one. Every assertion here reads DOM text or a small
// integer, so a failure diff can print a conversation name, a server id (which `serverInfoHandler`
// already vets as non-secret) or a count — never a payload, a token, a key or a relay URL.

// The two seeded rows' display names, as spec-local literals rather than `SEEDED_ROW.name` reads:
// `ConversationSummary.name` is `string | null`, and a `!` or a `?? ''` at the `hasText` hole would
// turn a null into either a crash or a filter that matches EVERY row — a vacuous detector. Coupling to
// the fixture's own constants is restored by the two equality assertions in the first step, which fail
// loudly if either row is ever renamed there.
//
// `hasText` is a case-INSENSITIVE SUBSTRING match, so these three strings deliberately share no
// substring with one another: if one were a fragment of another, a filter for one row would select the
// other's too and every count below would be reading something other than what it names.
const FIRST_ROW_NAME = 'Seeded discussion'
const SECOND_ROW_NAME = 'Server two chat'

// A name only the AC3 step's push can produce, so its appearance cannot be confused with either seed.
const RENAMED_ON_SECOND = 'Renamed by a push'

test('lands paired against two fake daemons, one row and one Settings row per server', async ({
  launchPairedApp
}) => {
  // `{ secondServer: {} }` is the whole opt-in: default daemon options, a second forwarder of its own,
  // and a second pairing driven through Settings → "Pair another server" inside this same launch.
  const { page, servers, daemon, forwarder } = await launchPairedApp({}, { secondServer: {} })

  // --- AC3, the structural half: each server's daemon, forwarder and id, exposed per server. ---
  expect(servers).toHaveLength(2)
  expect(servers.map((server) => server.serverId)).toEqual([FIRST_SERVER_ID, SECOND_SERVER_ID])
  // Distinct OBJECTS, not just distinct ids. One forwarder holds exactly one client leg and one server
  // leg, so a second daemon needs a second forwarder — which is precisely what makes `closeClientLeg`
  // per-server by construction, with nothing in `fakeRelayForwarder.ts` changed.
  expect(servers[0].forwarder).not.toBe(servers[1].forwarder)
  expect(servers[0].daemon).not.toBe(servers[1].daemon)
  // AC4's shape, asserted rather than assumed: the two top-level members the 54 existing importers read
  // still name the FIRST server, so their drives are unchanged by the second one existing.
  expect(daemon).toBe(servers[0].daemon)
  expect(forwarder).toBe(servers[0].forwarder)

  // The coupling the two spec-local name literals above trade away, bought back here.
  expect(SEEDED_ROW.name).toBe(FIRST_ROW_NAME)
  expect(SECOND_SEEDED_ROW.name).toBe(SECOND_ROW_NAME)
  // The ids must differ: `decodeCollection` treats a repeated `server` as a MALFORMED collection, which
  // collapses to the absent outcome — so a collision would read as *unpaired* rather than raising, and
  // every assertion below would fail with no hint of why.
  expect(SECOND_SEEDED_ROW.id).not.toBe(SEEDED_ROW.id)

  // --- AC2: both daemons handshook inside the one launch, and each one's own seeded conversation is
  // its own sidebar row. Two rows is itself the two-handshake proof: the second row can only arrive
  // sealed under the second daemon's post-Split send cipher. ---
  const rows = page.locator('.channel-list__row-open')
  await expect(rows).toHaveCount(2)
  await expect(rows.filter({ hasText: FIRST_ROW_NAME })).toHaveCount(1)
  await expect(rows.filter({ hasText: SECOND_ROW_NAME })).toHaveCount(1)

  // --- AC3, the executable half: script ONE server's replies without touching the other's. Pushing a
  // renamed row through the second daemon alone must move the second server's row and leave the first
  // server's row exactly where it is — the store replaces one server's slot and hands every other slot
  // back by reference. ---
  servers[1].daemon.pushFrame(
    seedConversationsFrame({ ...SECOND_SEEDED_ROW, name: RENAMED_ON_SECOND })
  )
  await expect(rows.filter({ hasText: RENAMED_ON_SECOND })).toHaveCount(1)
  await expect(rows.filter({ hasText: SECOND_ROW_NAME })).toHaveCount(0)
  await expect(rows.filter({ hasText: FIRST_ROW_NAME })).toHaveCount(1)
  await expect(rows).toHaveCount(2)

  // --- AC1: Settings renders one Server row per paired server, carrying the two ids that were pasted.
  // `ServerInfoData` refetches on every Settings mount, so this reads the collection as it stands after
  // BOTH pairings. Asserted LAST, because the settings route replaces the list view. ---
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.locator('section[aria-label="Settings screen"]')).toBeVisible()
  // The array form pins the COUNT and each row's text in store order (oldest-paired first) — so one row,
  // three rows, or the right count in the wrong order all fail. Ids only: `relayUrl` is non-secret too,
  // but it is not needed here and a failure diff would print it.
  await expect(page.locator('.settings__server-row-id')).toHaveText([
    FIRST_SERVER_ID,
    SECOND_SERVER_ID
  ])
})
