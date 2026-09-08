import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import type { ConversationSummary } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// #1178 — the plus a workspace row shows on hover, and what clicking it creates. Only this tier can
// answer any of it: `vitest.config.ts` sets `environment: 'node'` and every renderer spec is a
// `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup (which tree draws
// the control, its name, its glyph, the wrapper) and everything below is what needs a running window —
// a computed opacity, a hover, a keyboard traversal, a laid-out box, and a real round trip to the fake.
//
// A DEDICATED FILE rather than an addition to `sidebar-row-geometry.spec.ts`, which owns the CHANNEL
// row's own box and scopes itself to it, or to `sidebar-tree-geometry.spec.ts`, which owns the tree's
// placement and takes this ticket's geometry half. Both of those must pass with their existing
// assertions untouched (AC5), so the control's own behaviour gets its own launch.
//
// ⭐ THE SEED'S cwd IS DELIBERATELY NOT THE FAKE'S OWN CREATE DEFAULT, and that is what makes the drive
// non-vacuous. `conversationStateFake` mints a created row at `payload.cwd ?? DEFAULT_CREATED_CWD`, and
// that default is `/fake/workspace` — the path every other fixture seeds. A plus that sent `null` (or
// nothing) would therefore still land its row under a workspace group and still open a thread; only the
// GROUP COUNT tells the two apart. Seeded at another path, a correct plus keeps one group and a broken
// one mints a second. That count is the assertion this file turns on.
//
// SECRET HYGIENE (the sibling specs' posture). Every assertion reads a number, a computed string, or the
// client-owned "Untitled" placeholder. The seed's name and its cwd are never asserted on and never
// printed by a failing locator; the seed cwd is a fixed fake remote path, never resolved locally.

// The drawing's own numbers (Workspace Hover 399:1060, "Icon Edgeless" 399:1065 at right 2, top 6 in a
// 28px row), each a DERIVED consequence of the tokens the rule uses, so a swapped token reddens here.
const GLYPH_PX = 16
const GLYPH_RIGHT_INSET_PX = 2
const ROW_HEIGHT_PX = 28

// `--color-primary` #9dcbfc, the drawn fill. Nothing in the static tier can see a colour at all.
const GLYPH_RGB = 'rgb(157, 203, 252)'

const HIDDEN_OPACITY = '0'
const SHOWN_OPACITY = '1'

// The client-owned placeholder a `name: null` conversation renders (`UNNAMED_LABEL`). Restated here as
// the word an operator reads rather than imported from the code under test — and it is the one text
// assertion this file makes, precisely because it is NOT daemon-derived.
const UNTITLED = 'Untitled'

// The plus's accessible name, likewise the operator's word rather than the screen's constant.
const CREATE_CHAT_NAME = 'Create chat'

// Not `/fake/workspace`. See the seed note in the header — this is the whole non-vacuity guard.
const WORKSPACE_CWD = '/fake/second-brain'

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Sub-pixel tolerance for a device-pixel-ratio-scaled layout, the sibling specs' constant.
const GEOMETRY_TOLERANCE_PX = 1

const seed = (over: Partial<ConversationSummary>): ConversationSummary => ({
  id: 'seed-conversation',
  name: 'Seeded row',
  is_promoted: false,
  is_archived: false,
  cwd: WORKSPACE_CWD,
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: null,
  ...over
})

type Box = { x: number; y: number; width: number; height: number }

const boxOf = async (locator: Locator, role: string): Promise<Box> => {
  const box = await locator.boundingBox()
  if (box === null) throw new Error(`expected a laid-out box for the ${role}`)
  return box
}

const computed = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate((el, prop) => window.getComputedStyle(el).getPropertyValue(prop), property)

const expectAbout = (actual: number, expected: number): void => {
  expect(actual).toBeGreaterThanOrEqual(expected - GEOMETRY_TOLERANCE_PX)
  expect(actual).toBeLessThanOrEqual(expected + GEOMETRY_TOLERANCE_PX)
}

test('the workspace row’s plus hides at rest, shows on hover and on focus, and starts a chat in that workspace', async ({
  launchPairedApp
}) => {
  // ONE launch, ONE continuous drive (the sibling specs' shape): each launch pays a full handshake, and
  // the ordering below is load-bearing throughout — every absence or unchanged-state assertion sits
  // AFTER a positive, auto-waiting read of the same gesture's own effect.
  //
  // The stateful fake owns the list, so this seed fully replaces the fixture's default one. ONE row, so
  // `launchPairedApp`'s strict `.channel-list__row-open` click still resolves; unpromoted, so it renders
  // under Chats — the only tree that hands a create callback down today.
  const buildReplyFrames = conversationStateFake({ conversations: [seed({})] })
  const { page } = await launchPairedApp({ buildReplyFrames })

  const rows = page.locator('.channel-list__row')
  const head = page.locator('.channel-list__workspace-head')
  const workspaceRow = page.locator('.channel-list__workspace')
  const create = page.locator('.channel-list__workspace-create')
  const glyph = page.locator('.channel-list__workspace-create-icon')
  const actions = page.locator('.channel-list__actions')

  // --- 1. AC3: the control is in the ACCESSIBILITY TREE at rest — before any hover, and read by role and
  // name rather than by class, which is the half a CSS locator cannot prove. Exactly one: the Chats
  // tree's single group has it and the Channels tree's host row draws no group at all. ---
  await expect(page.getByRole('button', { name: CREATE_CHAT_NAME })).toHaveCount(1)
  await expect(rows).toHaveCount(1)
  await expect(workspaceRow).toHaveCount(1)
  await expect(head).toHaveCount(1)

  // --- 2. AC2: nothing shows at rest. The pointer is parked on the actions cluster, not on a row — the
  // fixture's launch click left it over the seeded row, and reading an "at rest" opacity with the pointer
  // still on the row would assert the reveal rather than the base state. ---
  await actions.hover()
  expect(await computed(create, 'opacity')).toBe(HIDDEN_OPACITY)

  // --- 3. AC2: hovering the ROW reveals it, and the reveal is a SCOPE claim as much as a visibility one —
  // hung off the control's own `:hover` it would fire only once the pointer had already arrived at a
  // 20px box it could not see. Hovering the row's LABEL, not the control, is what says that. ---
  await page.locator('.channel-list__workspace-label').hover()
  expect(await computed(create, 'opacity')).toBe(SHOWN_OPACITY)

  // --- 4. AC2: the glyph's drawn rectangle. 16 × 16, its right edge 2px in from the row's right edge,
  // its box vertically centred, in `--color-primary` — read while the control is revealed, since a
  // display-none control would report no box at all and the opacity mechanism is what keeps it laid out.
  // The ROW is the reference box (`.channel-list__workspace-head`, which spans the nest to the content
  // edge), never the window: the inset is the drawing's, measured against the thing it is drawn in. ---
  const headBox = await boxOf(head, 'workspace head row')
  const glyphBox = await boxOf(glyph, 'create glyph')
  expectAbout(glyphBox.width, GLYPH_PX)
  expectAbout(glyphBox.height, GLYPH_PX)
  expectAbout(headBox.x + headBox.width - (glyphBox.x + glyphBox.width), GLYPH_RIGHT_INSET_PX)
  expectAbout(glyphBox.y + glyphBox.height / 2, headBox.y + headBox.height / 2)
  expect(await computed(create, 'color')).toBe(GLYPH_RGB)

  // --- 5. AC2: the row is still 28 tall with the plus shown. The control is out of the flex flow, so it
  // cannot size the row — which is exactly why this is worth asserting: the failure it detects is a
  // control laid out IN the line, where a 20px box over a 20px label line would push the derived 28 to
  // 28 and hide itself. Read on the head row, whose height is the button's. ---
  expectAbout(headBox.height, ROW_HEIGHT_PX)

  // --- 6. AC3: keyboard focus reveals it too, so Tab reaches it. The pointer goes back to the actions
  // cluster FIRST, so what is read below is the focus rule and not a leftover hover. Focus is moved by a
  // real Tab press from the disclosure button rather than by a bare `.focus()`: `:focus-visible` is a
  // keyboard-MODALITY heuristic, and a programmatic focus after a pointer interaction does not satisfy
  // it — such a test would read Chromium's mood rather than the rule. ---
  await workspaceRow.focus()
  await actions.hover()
  await page.keyboard.press('Tab')
  await expect(create).toBeFocused()
  expect(await computed(create, 'opacity')).toBe(SHOWN_OPACITY)

  // --- 7. AC4: clicking the plus creates a chat IN THIS WORKSPACE. The fold's state is captured before
  // the click so the "did not change" claim below compares against a value read from the same run. ---
  expect(await workspaceRow.getAttribute('aria-expanded')).toBe('true')
  await create.click()

  // THE POSITIVE, AUTO-WAITING READ COMES FIRST. Everything after it is an unchanged-state assertion,
  // and each of those would pass before the round trip even resolved if it led (the #1123 rule): the
  // group count is 1 at launch and `aria-expanded` is already "true".
  await expect(rows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })
  // ...and the created thread opened, which is the other half of AC4. The new chat is minted with
  // `name: null`, so the open row is the one showing the client's own placeholder — the fill moved off
  // the seeded row exactly as it does after the FAB.
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(UNTITLED)

  // ⭐ THE `cwd` ASSERTION, AND THE ONLY ONE THAT CAN SEE IT. Both rows are in ONE group, so the create
  // carried this group's key rather than `null` — which the fake would have resolved to its own
  // `/fake/workspace` default, minting a SECOND group. Row count and thread-opening are both blind to
  // that difference; this count is not.
  await expect(workspaceRow).toHaveCount(1)
  await expect(head).toHaveCount(1)

  // AC4's last clause: the plus is a SIBLING of the disclosure button, never a child, so the click never
  // reached the fold's handler.
  expect(await workspaceRow.getAttribute('aria-expanded')).toBe('true')
})
