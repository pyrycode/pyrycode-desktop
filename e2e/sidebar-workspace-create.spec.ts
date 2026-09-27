import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope } from '../src/main/transport/codec'
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
// The seed path differs from the fake daemon's default. A null-cwd request creates a second group;
// a request that mistakenly sends the clicked workspace path leaves one. The fake's held response also
// lets this drive prove that confirmation sends once and navigation waits for the daemon reply.
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

test('the workspace row’s plus reveals on hover and focus, then confirms a daemon-default chat', async ({
  launchPairedApp
}) => {
  // ONE launch, ONE continuous drive (the sibling specs' shape): each launch pays a full handshake, and
  // the ordering below is load-bearing throughout — every absence or unchanged-state assertion sits
  // AFTER a positive, auto-waiting read of the same gesture's own effect.
  //
  // The stateful fake owns the list, so this seed fully replaces the fixture's default one. ONE row, so
  // `launchPairedApp`'s strict `.channel-list__row-open` click still resolves; unpromoted, so it renders
  // under Chats — the only tree that hands a create callback down today.
  const fake = conversationStateFake({ conversations: [seed({})] })
  const creates: ReturnType<typeof decodeEnvelope>[] = []
  let held: Uint8Array[] = []
  const { page, servers } = await launchPairedApp({ buildReplyFrames: (inbound) => {
    const request = decodeEnvelope(inbound)
    const replies = fake(inbound)
    if (request.type === 'create_conversation') {
      creates.push(request)
      held = replies
      return []
    }
    return replies
  } })

  const rows = page.locator('.channel-list__row')
  const head = page.locator('.channel-list__workspace-head')
  const workspaceRow = page.locator('.channel-list__workspace')
  // The CHATS tree's disclosure button — the row that owns the `Create chat` plus. Since #1485 the bare
  // locator above matches both trees' groups and is kept for the COUNTS; every gesture and state read
  // below goes through this one, so it cannot drift onto the Channels mirror.
  const chatsWorkspaceRow = workspaceRow.nth(1)
  // SCOPED TO THIS TREE'S PLUS since #1485. The class is shared by both trees' create controls and the
  // Channels tree now draws a mirror of this workspace, so the bare class is two-match. The accessible
  // NAME is what tells them apart — which is also the discrimination AC3 above reads — so the geometry
  // and opacity below are measured on the `Create chat` plus this spec is about, never on the mirror's.
  const create = page.getByRole('button', { name: CREATE_CHAT_NAME, exact: true })
  const glyph = create.locator('.channel-list__workspace-create-icon')
  const actions = page.locator('.channel-list__actions')

  // --- 1. AC3: the control is in the ACCESSIBILITY TREE at rest — before any hover, and read by role and
  // name rather than by class, which is the half a CSS locator cannot prove. Exactly one: the Chats
  // tree's single group has it and the Channels tree's host row draws no group at all. ---
  await expect(page.getByRole('button', { name: CREATE_CHAT_NAME })).toHaveCount(1)
  await expect(rows).toHaveCount(1)
  // TWO workspace rows since #1485 — the Channels tree mirrors this chat's group as a head row with
  // nothing beneath it. Exactly ONE `Create chat` plus even so: the mirror is a Channels-tree group, so
  // its plus is `Create channel`, which is what keeps this spec's control single-match.
  await expect(workspaceRow).toHaveCount(2)
  await expect(head).toHaveCount(2)

  // --- 2. AC2: nothing shows at rest. The pointer is parked on the actions cluster, not on a row — the
  // fixture's launch click left it over the seeded row, and reading an "at rest" opacity with the pointer
  // still on the row would assert the reveal rather than the base state. ---
  await actions.hover()
  expect(await computed(create, 'opacity')).toBe(HIDDEN_OPACITY)

  // --- 3. AC2: hovering the ROW reveals it, and the reveal is a SCOPE claim as much as a visibility one —
  // hung off the control's own `:hover` it would fire only once the pointer had already arrived at a
  // 20px box it could not see. Hovering the row's LABEL, not the control, is what says that. ---
  // `.nth(1)` is the CHATS tree's label — the row that owns the plus measured here. The Channels
  // mirror renders first since #1485, and hovering it would reveal that group's control, not this one.
  await page.locator('.channel-list__workspace-label').nth(1).hover()
  expect(await computed(create, 'opacity')).toBe(SHOWN_OPACITY)

  // --- 4. AC2: the glyph's drawn rectangle. 16 × 16, its right edge 2px in from the row's right edge,
  // its box vertically centred, in `--color-primary` — read while the control is revealed, since a
  // display-none control would report no box at all and the opacity mechanism is what keeps it laid out.
  // The ROW is the reference box (`.channel-list__workspace-head`, which spans the nest to the content
  // edge), never the window: the inset is the drawing's, measured against the thing it is drawn in. ---
  const headBox = await boxOf(head.nth(1), 'workspace head row')
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
  await chatsWorkspaceRow.focus()
  await actions.hover()
  await page.keyboard.press('Tab')
  await expect(create).toBeFocused()
  expect(await computed(create, 'opacity')).toBe(SHOWN_OPACITY)

  // --- 7. Opening, cancelling and closing are read before any create frame is released. ---
  expect(await chatsWorkspaceRow.getAttribute('aria-expanded')).toBe('true')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Create chat', exact: true })
  await expect(dialog).toBeVisible()
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true })
  const close = dialog.getByRole('button', { name: 'Close dialog' })
  const confirm = dialog.getByRole('button', { name: 'OK', exact: true })
  await expect(cancel).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirm).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.screenshot({ path: '/tmp/builder-1682-create-chat-1280.png', animations: 'disabled' })
  await page.setViewportSize({ width: 800, height: 600 })
  await page.screenshot({ path: '/tmp/builder-1682-create-chat-800.png', animations: 'disabled' })
  expect(creates).toHaveLength(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(create).toBeFocused()
  expect(creates).toHaveLength(0)
  await create.click()
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dialog).toHaveCount(0)
  expect(creates).toHaveLength(0)
  await create.click()
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => creates.length).toBe(1)
  expect(creates[0]).toMatchObject({ type: 'create_conversation',
    payload: { name: null, is_promoted: false, cwd: null } })
  await expect(dialog).toHaveCount(0)
  // The request does not navigate optimistically; release the daemon's held confirmation first.
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText('Seeded row')
  held.forEach(frame => servers[0].daemon.pushFrame(frame))

  await expect(rows).toHaveCount(2, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.channel-list__row-open[aria-current="true"]')).toHaveText(UNTITLED)

  // The fake resolves null to `/fake/workspace`, distinct from the clicked seed path. Both trees mirror
  // the two groups, so a broken send of the clicked path would leave only two workspace heads.
  await expect(workspaceRow).toHaveCount(4)
  await expect(head).toHaveCount(4)

  // AC4's last clause: the plus is a SIBLING of the disclosure button, never a child, so the click never
  // reached the fold's handler.
  expect(await chatsWorkspaceRow.getAttribute('aria-expanded')).toBe('true')
})

test('the Create chat dialog keeps the clicked host when hosts share a workspace path', async ({ launchPairedApp }) => {
  const capture = (id: string) => {
    const fake = conversationStateFake({ conversations: [seed({ id })] })
    const creates: ReturnType<typeof decodeEnvelope>[] = []
    return { creates, reply: (inbound: Uint8Array): Uint8Array[] => {
      const request = decodeEnvelope(inbound)
      const frames = fake(inbound)
      if (request.type === 'create_conversation') {
        creates.push(request)
        return []
      }
      return frames
    } }
  }
  const first = capture('host-one-seed')
  const second = capture('host-two-seed')
  const { page } = await launchPairedApp({ buildReplyFrames: first.reply },
    { secondServer: { buildReplyFrames: second.reply } })
  const plus = page.getByRole('button', { name: 'Create chat', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Create chat', exact: true })
  await expect(plus).toHaveCount(2)
  await plus.nth(0).click()
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => first.creates.length).toBe(1)
  expect(second.creates).toHaveLength(0)
  expect(first.creates[0]).toMatchObject({ type: 'create_conversation',
    payload: { is_promoted: false, name: null, cwd: null } })
  await plus.nth(1).click()
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect.poll(() => second.creates.length).toBe(1)
  expect(first.creates).toHaveLength(1)
  expect(second.creates[0]).toMatchObject({ type: 'create_conversation',
    payload: { is_promoted: false, name: null, cwd: null } })
})
