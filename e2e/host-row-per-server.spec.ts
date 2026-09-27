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

// The length of `HOST_ROW_FALLBACK_LABEL` — the client-owned word a machine with no stored name shows.
// Its LENGTH rather than the word, so this file compares lengths throughout and no assertion diff can
// print a label at all. Six and seven differ, which is the whole mechanism; a rename of that constant to
// another six-character word leaves this correct, and to a seven-character one reddens it loudly here
// rather than silently anywhere else.
const FALLBACK_LABEL_LENGTH = 6

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
  // Reaching A's thread puts its composer beside the sidebar. Both now read A's own connection
  // status, so B's drop must leave A's composer usable as well as its host dots connected.
  await page.locator('.channel-list__row-open').filter({ hasText: FIRST_ROW_NAME }).click()
  await expect(page.locator('.conversation')).toBeVisible()

  // Each paired machine has one row, ordered by the saved host list.
  const hostRows = page.locator('.channel-list__host')
  await expect(hostRows).toHaveCount(2)

  // POSITION IS THE ONLY HANDLE, and deliberately so: the server id reaches no attribute, class name or
  // text on this row (`HostRow`'s ban list), so there is nothing to filter on. Document order is the
  // paired-server list's order — oldest-paired first.
  const dotsOf = (index: number) => hostRows.nth(index).locator('.channel-list__host-dot')
  const labelsOf = (index: number): Promise<(string | null)[]> =>
    dotsOf(index).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label')))
  const rowA = 0
  const rowB = 1

  // The BASELINE, taken while both machines are live. Machine A's legs are asserted CONNECTED rather than
  // merely recorded: if its row were already reporting an outage here, the "did not move" assertion below
  // would hold vacuously for a row that never had anything to lose.
  await expect(dotsOf(rowA)).toHaveCount(2)
  await expect(dotsOf(rowA).first()).toHaveAttribute('aria-label', 'Pyrycode Connected')
  // BOTH legs pinned, not just the daemon one. The relay dot's keyed slot fills only because
  // `connectionRegistry.build` binds the whole per-connection sink through `bindServerOrigin`, so
  // `relayLinkChanged` carries the origin stamp; pinning the live category here is what proves the
  // per-server relay read resolved rather than sitting at its "Relay Unknown" launch value — otherwise
  // the relay half of the comparison below would be two silent servers agreeing on nothing.
  await expect(dotsOf(rowA).nth(1)).toHaveAttribute('aria-label', 'Relay Connected')
  const baselineA = await labelsOf(rowA)
  const baselineB = await labelsOf(rowB)

  // Server B's leg only. Its forwarder is its own, so server A's connection is untouched and stays live
  // and handshaken throughout.
  serverB.forwarder.closeClientLeg(FATAL_CLOSE_CODE)

  // THE POSITIVE READ, ORDERED FIRST, and it is on the row under test's OWN sibling. A closing "the dots
  // did not move" assertion on its own passes before the drop's async work has resolved — it would be
  // reading the pre-drop render and calling it a result. Machine B's dots changing IS the drop's own
  // effect, it auto-waits, and it is unreachable from the state being asserted against, which is machine
  // A's dots holding still.
  await expect.poll(() => labelsOf(rowB)).not.toEqual(baselineB)

  // Wait for B's daemon state too: a relay-dot change alone can precede the terminal failure.
  await expect(dotsOf(rowB).first()).toHaveAttribute('aria-label', 'Pyrycode Offline')
  // A's composer stays usable after B settles, with no connection error or repair flow taking over.
  const input = page.getByPlaceholder('Message…')
  await expect(input).toBeEditable()
  await input.fill('Draft for the connected host')
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: COMPOSER_REPAIR_BUTTON_COPY, exact: true })).toHaveCount(0)
  await expect(page.locator('.composer-status__error')).toHaveCount(0)
  // Nothing is saved locally for this chat, which since #1447 draws no notice at all — so the band is
  // empty of everything, and another host's failure adding a connection warning is what would fill it.
  // Safely anchored: the composer assertions above have already waited for this screen to mount.
  await expect(page.locator('.conversation__banner')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Repair pairing', exact: true })).toHaveCount(0)

  // AC3 — and only now. B's dots have changed; the row naming server A has not.
  // Both dots, so a regression on either leg reddens: the daemon leg is the one server B's close writes,
  // and the relay leg is its twin through `selectRelayLinkStatusFor`.
  expect(await labelsOf(rowA)).toEqual(baselineA)
})

// AC3's naming half: server 1 was named at pairing and server 2 was not, so the two rows must READ
// DIFFERENTLY — machine 1's showing its stored name, machine 2's falling back to the generic word,
// because nothing was ever stored for it.
//
// This test is its own detector, and history is the mutation check: it was written with `hostLabel`
// passed in the FIRST argument, where the fixture drops it silently, and it failed — every row fell back
// to the generic word because no name had been typed into any pairing form. Moving the option to
// `LaunchControl` is the only change, and it passes. The length comparison is what separates the two
// outcomes without printing either.
test('each host row shows the label stored for the machine IT names', async ({ launchPairedApp }) => {
  const { page } = await launchPairedApp({}, { hostLabel: HOST_LABEL, secondServer: {} })

  await page.locator('.channel-list__row-open').filter({ hasText: FIRST_ROW_NAME }).click()
  await expect(page.locator('.conversation')).toBeVisible()

  // Read as LENGTHS, never as values — the fallback word is six characters and the typed name is seven,
  // so the whole comparison lands without printing either, which is the treatment the host-name field
  // gets throughout (it sits directly below the pairing-code field, and a mis-pasted payload into it is
  // an anticipated mistake).
  //
  // The ARRAY FORM pins the count at two, each row's answer, and saved host order. A row
  // reading the app-wide "most recently stored" answer would show the fallback everywhere (server 2
  // paired second and stored nothing), and a tree that named every row after the first machine would show
  // the typed length everywhere; both fail here, in opposite directions.
  await expect
    .poll(async () =>
      page
        .locator('.channel-list__host-label')
        .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? '').trim().length))
    )
    .toEqual([HOST_LABEL.length, FALLBACK_LABEL_LENGTH])
})
