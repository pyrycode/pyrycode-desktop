import { test, expect } from './fixtures/launchPairedApp'
import { MAX_HOST_LABEL_LENGTH } from '../src/shared/ipc/pairing'
import type { Locator } from '@playwright/test'

// Fake-stack UI e2e for THE OPERATOR'S LABEL ON THE SIDEBAR HOST ROW (#834). Only this tier can prove
// AC4: `vitest.config.ts` sets `environment: 'node'`, every renderer spec is a `renderToStaticMarkup`
// string assertion, and there is no DOM and no layout engine to measure an ellipsis or a dot's
// x-coordinate with. The unit tier owns the four-arm collapse, the escaping and the markup contract;
// this spec owns the geometry and the end-to-end population.
//
// One `test`, one launchPairedApp launch, one sequential drive; it runs under the default `npm run e2e`
// (the filename does not match the config's `real-*` testIgnore). The one fixture change it needs — a
// host name typed into the pairing form before Pair — is optional at both seams, so all ten existing
// pairing drives are untouched and the other specs' sidebars keep reading the fallback word.
//
// EXACTLY ONE HOST ROW here, not two. The shared fixture seeds one UNPROMOTED row (SEEDED_ROW), so only
// the Chats tree renders and only its host row exists. "Both trees show the label" is the unit tier's
// claim and is already asserted there (ChannelList.test.tsx, the #710 describe); do not try to re-prove
// it here by seeding a second row — launchPairedApp reaches the thread by clicking a single strict
// `.channel-list__row-open`, so a second clickable seed would strict-violate at launch.
//
// SECRET HYGIENE. The label is not a credential — it is the operator's name for the machine — but the
// field it is typed into sits directly below the pairing-code field and a mis-paste of the payload into
// it is an anticipated mistake (PairingScreen.tsx:306-315 bounds the field for exactly that reason). So
// it gets the payload's treatment: NEVER asserted on by value. Every assertion below reads a NUMBER (a
// character count, a box coordinate, an element count) or a BOOLEAN, so no failure diff can print it.
// That is also why the population proof is a length rather than a `toHaveText`. The pairing plumbing
// (synthetic token, fake static key) lives in launchPairedApp and is never echoed.

// Exactly MAX_HOST_LABEL_LENGTH characters — 8 × 16 — built from the shared constant's own bound rather
// than a restated 128, so a change to the bound moves this label with it. It ends in a NON-whitespace
// character on purpose: the confirm sends the label trimmed (pairingState.ts), so a trailing space would
// quietly store 127 and make the length assertion below wrong for a reason unrelated to the row. Fixed
// literals only — deterministic, no Date.now()/randomness, per the fakeDaemon convention.
//
// Chosen to collide with nothing: no existing locator matches "Pyrybox", the string carries none of the
// suite's `exact: true` accessible names and none of its class tokens, and it contains neither section
// label ("Channels"/"Chats") — which matters because Playwright's `hasText` matches substrings
// case-insensitively.
const HOST_LABEL = 'Pyrybox-'.repeat(MAX_HOST_LABEL_LENGTH / 8)

// #670's shipped sidebar width (Figma Sidebar 103:736, `w-[400px] shrink-0`) — the box AC4 says the
// label must not widen. Pinned here the way paired-shell-navigation.spec.ts pins it.
const SIDEBAR_WIDTH_PX = 400

// The dots' trailing edge sits FLUSH with the row's right edge: `.channel-list__host` carries no right
// padding since the 2026-09-05 inset fix (the design floats the pair inside its px-16, 1px from the
// edge, and 1px has no slot on the scale), and `.channel-list__host-status`'s `margin-left: auto` is
// what puts the pair there — only while the label yields.
const ROW_INSET_PX = 0

// Sub-pixel tolerance for a device-pixel-ratio-scaled layout. One physical pixel of slack, no more —
// enough that a fractional box coordinate cannot flake, far too little to hide a label that has pushed
// the dots off the row's edge.
const GEOMETRY_TOLERANCE_PX = 1

type Box = { x: number; y: number; width: number; height: number }

// `boundingBox()` returns null for a detached or hidden node. Throwing beats `!` and beats a `?? -1`
// sentinel here, because every consumer below does arithmetic on the result and a sentinel would turn a
// missing box into a wrong number. The message names the LOCATOR, never a value.
const boxOf = async (locator: Locator): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error('expected a laid-out box for the host row element')
  return box
}

test('the sidebar host row shows the operator label, bounded to the sidebar', async ({
  launchPairedApp
}) => {
  // The drive lands on the THREAD, with the sidebar beside it (#670's two-pane shell) — and it got there
  // without ever opening Settings. Every assertion below therefore runs on the sidebar the pairing drive
  // itself landed on, which is AC5's executable proof: the row is populated by the loader mounted in
  // ChannelList, not by a visit to Settings → Connection.
  const { page } = await launchPairedApp({}, { hostLabel: HOST_LABEL })

  // TWO host rows since #1070, from the one paired machine: both sections draw its row whether or not
  // they hold any of its conversations. Every locator below is strict-mode single, so each is scoped to
  // the FIRST row — the Channels tree's, which is the empty section here and therefore the one whose
  // geometry is least entangled with anything under it. The count assertion below is what makes that
  // scoping meaningful rather than an arbitrary pick.
  const hostRows = page.locator('.channel-list__host')
  const hostRow = hostRows.first()
  const hostLabel = page.locator('.channel-list__host-label').first()
  const hostStatus = page.locator('.channel-list__host-status').first()

  // --- 1. The machine's rows, and the label really is the operator's (AC1). The population proof is the
  // label's LENGTH, never its text: the fallback word is six characters, so a row that fell back cannot
  // pass this. It polls because the label arrives on the loader's one-shot invoke settling after
  // ChannelList mounts. ---
  await expect(hostRows).toHaveCount(1)
  const labelLength = async (): Promise<number> => ((await hostLabel.textContent()) ?? '').length
  await expect.poll(labelLength).toBe(MAX_HOST_LABEL_LENGTH)

  // --- 2. AC4, first half: the label ELLIPSIZES rather than widening the sidebar. `scrollWidth >
  // clientWidth` is the direct observable for "the text overflows its own box and is being clipped" —
  // exactly what `overflow: hidden` + `text-overflow: ellipsis` produce, and what a label that had grown
  // its box instead would fail. ---
  const labelOverflows = async (): Promise<boolean> =>
    hostLabel.evaluate((el) => el.scrollWidth > el.clientWidth)
  await expect.poll(labelOverflows).toBe(true)

  const sidebarWidth = async (): Promise<number> =>
    (await page.locator('.paired-shell__sidebar').boundingBox())?.width ?? -1
  await expect.poll(sidebarWidth).toBe(SIDEBAR_WIDTH_PX)

  // --- 3. AC4, second half: both connection dots stay on the row's TRAILING EDGE. This is the assertion
  // that would fail if `.channel-list__host-label` ever picked up `flex: 1 1 auto` from its workspace-row
  // neighbour — the grow would absorb the row's free space and render `margin-left: auto` inert. ---
  const rowBox = await boxOf(hostRow)
  const statusBox = await boxOf(hostStatus)
  const labelBox = await boxOf(hostLabel)

  const trailingGap = rowBox.x + rowBox.width - (statusBox.x + statusBox.width)
  expect(trailingGap).toBeGreaterThanOrEqual(ROW_INSET_PX - GEOMETRY_TOLERANCE_PX)
  expect(trailingGap).toBeLessThanOrEqual(ROW_INSET_PX + GEOMETRY_TOLERANCE_PX)

  // Two dots per row — four across the two rows since #1070 — both inside the pair's box, and the pair
  // does not overlap the clipped label: the label yielded rather than running under them.
  await expect(page.locator('.channel-list__host-dot')).toHaveCount(2)
  await expect(hostRow.locator('.channel-list__host-dot')).toHaveCount(2)
  expect(statusBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width - GEOMETRY_TOLERANCE_PX)

  // --- 4. AC3's one live sink: the row carries NO `title` anywhere. The ellipsis proved in step 2 is
  // precisely what invites `title={label}` ("hover for the rest"), and that is untrusted text in an
  // attribute — the shape CLAUDE.md forbids and #696's review made a MUST FIX. A count-0 locator over
  // the row AND every descendant is stronger than checking two elements, and its failure diff prints a
  // number rather than the attribute's value. ---
  await expect(page.locator('.channel-list__host[title], .channel-list__host [title]')).toHaveCount(0)

  // --- 5. AC5, stated as the negative: the drive never opened Settings, and the Settings screen is not
  // mounted. Together with step 1 this is "the row is populated whenever the sidebar is mounted, with no
  // visit to the Settings screen first." ---
  await expect(page.locator('section[aria-label="Settings screen"]')).toHaveCount(0)
})
