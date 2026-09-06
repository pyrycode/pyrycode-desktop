import { test, expect } from './fixtures/launchPairedApp'
import { COMPOSER_REPAIR_BUTTON_COPY } from '../src/renderer/src/screens/conversation/composerSend'

// Fake-stack UI e2e for THE SIDEBAR HOST ROW NAMING ONE SERVER (#1199). Only this tier can prove AC4:
// the claim is that a status arriving for machine B leaves machine A's row alone, which needs two live
// daemons, two real Noise handshakes and a real leg drop. `vitest.config.ts` sets `environment: 'node'`
// and every renderer spec is a `renderToStaticMarkup` string assertion, so the unit tier can only ever
// render the launch frame — it owns the four-arm collapse and the markup contract, and this spec owns
// the two-server sourcing.
//
// It runs under the default `npm run e2e` (the filename does not match the config's `real-*` testIgnore)
// and needs no fixture change: `LaunchControl.hostLabel` types a host name for the FIRST pairing only,
// which is exactly the "server 1 named, server 2 unnamed" shape this ticket has to keep apart, and each
// server already owns its own forwarder, so one `closeClientLeg` drops exactly one machine's leg.
//
// WHY THE DROP IS ON THE **OTHER** SERVER. The row names the FIRST paired server (`serverInfoStore`
// holds them oldest-paired first). Dropping the row's own leg would move the dots under either
// implementation and prove nothing; dropping the sibling's separates them. Against the app-wide
// `selectStatus` / `selectRelayLinkStatus` this row read before #1199 — "the most recently written
// status across every connection" — server B's terminal close IS the most recent write, so the row's
// dots followed it and this spec reddens. That is what makes AC4 a detector rather than a test of code
// this ticket wrote: both keyed cells have been filed by the two bridges in production all along, and
// only the read side moved.
//
// SECRET HYGIENE. The host label is not a credential — it is the operator's name for the machine — but
// the field it is typed into sits directly below the pairing-code field and a mis-paste of the payload
// into it is an anticipated mistake, so it gets the payload's treatment and is NEVER asserted on by
// value: the label check below reads a CHARACTER COUNT, the `host-label-sidebar.spec.ts` posture. Every
// other assertion reads an accessible name built from a client-owned constant, a visibility, or a small
// integer, so no failure diff can print a payload, a token, a key or a relay URL.

// Typed into the first pairing form only. Seven characters, and the fallback word is six, so a length
// comparison alone separates "the row shows the machine's name" from "the row fell back" — which is why
// the value never has to be printed. It carries neither section label ("Channels"/"Chats"), matches no
// existing locator, and shares no substring with either seeded row name, so it cannot widen a
// case-insensitive `hasText` filter anywhere in the suite.
const HOST_LABEL = 'Pyrybox'

// The first server's seeded row, as a spec-local literal rather than a `SEEDED_ROW.name` read:
// `ConversationSummary.name` is `string | null`, and a `!` or a `?? ''` at the `hasText` hole would turn
// a null into either a crash or a filter matching EVERY row — a vacuous selector. It shares no substring
// with the second server's seed, which the fixture chose deliberately for exactly these per-server specs.
const FIRST_ROW_NAME = 'Seeded discussion'

// 4401 ∈ the client's DEFAULT_FATAL_CLOSE_CODES, so the supervised client classifies the close as
// terminal (non-retryable) and arms no re-dial — no reconnect races the assertions below.
const FATAL_CLOSE_CODE = 4401

test('the host row reports the server it names, and the other machine dropping does not move it', async ({
  launchPairedApp
}) => {
  // `hostLabel` and `secondServer` are BOTH `LaunchControl` — the second argument. The fixture's options
  // object is daemon-reply knobs only, and an extra property there is dropped silently with no gate red:
  // nothing typechecks `e2e/`, so a misplaced `hostLabel` leaves the pairing form's host-name field empty
  // while every assertion that does not read the label still passes.
  const { page, servers } = await launchPairedApp({}, { hostLabel: HOST_LABEL, secondServer: {} })
  const [, serverB] = servers

  // With a second server opted in the fixture finishes on the LIST, so the list→thread step is this
  // spec's own (the unpair-repair two-server drive's shape). Filtering by row name is safe where
  // filtering by server id is not: the two seeded names share no substring.
  //
  // Reaching the thread is what puts the composer on screen BESIDE the sidebar, and that is the whole
  // point of the navigation here: the composer's Re-pair control still reads the APP-WIDE session
  // status, so this one window holds both a surface that must move on server B's drop and a surface
  // that must not. The contrast is the assertion.
  await page.locator('.channel-list__row-open').filter({ hasText: FIRST_ROW_NAME }).click()
  await expect(page.locator('.conversation')).toBeVisible()

  // Exactly ONE host row: both seeds are unpromoted, so only the Chats tree renders. Asserted rather
  // than assumed, because every locator below is strict-mode single and a second row would fail them
  // for a reason that has nothing to do with what they are testing. (#1070 is what makes this two.)
  const hostRow = page.locator('.channel-list__host')
  await expect(hostRow).toHaveCount(1)

  // The BASELINE, taken while both machines are live. Asserted to be a CONNECTED leg rather than merely
  // recorded: if the row were already reporting an outage here, the "did not move" assertion below would
  // hold vacuously for a row that never had anything to lose.
  const dots = hostRow.locator('.channel-list__host-dot')
  await expect(dots).toHaveCount(2)
  await expect(dots.first()).toHaveAttribute('aria-label', 'Pyrycode Connected')
  // BOTH legs pinned, not just the daemon one. The relay dot's keyed slot fills only because
  // `connectionRegistry.build` binds the whole per-connection sink through `bindServerOrigin`, so
  // `relayLinkChanged` carries the origin stamp; pinning the live category here is what proves the
  // per-server relay read resolved rather than sitting at its "Relay Unknown" launch value — otherwise
  // the relay half of the comparison below would be two silent servers agreeing on nothing.
  await expect(dots.nth(1)).toHaveAttribute('aria-label', 'Relay Connected')
  const baseline = await dots.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label'))
  )

  // Server B's leg only. Its forwarder is its own, so server A's connection is untouched and stays live
  // and handshaken throughout.
  serverB.forwarder.closeClientLeg(FATAL_CLOSE_CODE)

  // THE POSITIVE READ, ORDERED FIRST. A closing "the dots did not move" assertion on its own passes
  // before the drop's async work has resolved — it would be reading the pre-drop render and calling it a
  // result. This auto-waiting read is the proof that the close reached the renderer, and it is
  // unreachable from the state being asserted against: the Re-pair button appears on the app-wide
  // session cell, which server B's terminal close writes, and it lives in the composer rather than in
  // the sidebar.
  await expect(page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })).toBeVisible()

  // AC4 — and only now. The app-wide surface has moved in this same window; the row naming server A has
  // not. Both dots, so a regression on either leg reddens: the daemon leg is the one server B's close
  // writes, and the relay leg is its twin through `selectRelayLinkStatusFor`.
  expect(
    await dots.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  ).toEqual(baseline)
})

// AC3's two-server half: server 1 was named at pairing and server 2 was not, so the row naming server 1
// has to show server 1's name rather than the app-wide "most recently stored" answer — which, with an
// unnamed machine paired second, is nothing at all.
//
// This test is its own detector, and history is the mutation check: it was written with `hostLabel`
// passed in the FIRST argument, where the fixture drops it silently, and it failed — the row fell back
// to the six-character generic word because no name had been typed into any pairing form. Moving the
// option to `LaunchControl` is the only change, and it passes. The length comparison is what separates
// the two outcomes without printing either.
test('the host row shows the label stored for the machine it names', async ({
  launchPairedApp
}) => {
  const { page } = await launchPairedApp({}, { hostLabel: HOST_LABEL, secondServer: {} })

  await page.locator('.channel-list__row-open').filter({ hasText: FIRST_ROW_NAME }).click()
  await expect(page.locator('.conversation')).toBeVisible()

  // Server 1 was named at pairing and server 2 was not, so this separates the two: a row reading the
  // app-wide "most recently stored" answer shows the fallback word, because server 2 paired second and
  // stored nothing. Read as a length, never as the value — six characters is the fallback, seven is the
  // machine's name, so the comparison never has to print it.
  await expect
    .poll(async () =>
      (await page.locator('.channel-list__host-label').innerText()).trim().length
    )
    .toBe(HOST_LABEL.length)
})
