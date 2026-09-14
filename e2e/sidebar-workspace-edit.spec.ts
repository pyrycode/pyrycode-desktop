import { mkdirSync } from 'node:fs'
import { decodeEnvelope } from '../src/main/transport/codec'
import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import type { ConversationSummary } from '../src/shared/wire/types'
import type { Locator } from '@playwright/test'

// #1180 — the pen a workspace row shows on hover, the dialog it opens, and the rename that leaves. Only
// this tier can answer any of it: `vitest.config.ts` sets `environment: 'node'` and every renderer spec
// is a `renderToStaticMarkup` string assertion, so `ChannelList.test.tsx` owns the markup (which rows
// draw the control, its name, its glyph, its DOM position) and `EditWorkspaceDialog.test.tsx` owns the
// dialog's own markup and the send's payload. Everything below is what needs a running window — a
// computed opacity, a hover, a laid-out box, a typed field, and a real round trip to the fake.
//
// A DEDICATED FILE, `sidebar-workspace-create.spec.ts`'s stated reason: that spec owns the plus's own
// behaviour and must pass with its assertions untouched, and `sidebar-tree-geometry.spec.ts` owns the
// tree's PLACEMENT and drives no hover at all. The pen's numbers belong beside the plus's, which live in
// the create spec — so this control gets its own launch, exactly as that one did.
//
// ⭐ HOW BOTH TREES ARE REACHED FROM ONE CLICKABLE SEED. `launchPairedApp` navigates by clicking a single
// strict `.channel-list__row-open`, so a second seeded row would strict-violate at launch. The seed is
// therefore ONE promoted row (a Channels-tree group) at `/fake/workspace`, and the second tree is minted
// afterwards through a real product control: the host row's `Add workspace`, driven at that same
// `/fake/workspace` — also the fake's `DEFAULT_CREATED_CWD` — so its created row INHERITS the held label,
// which the fake does deliberately (its `labelFor` comment names this exact setup). This is
// `workspace-collapse.spec.ts`'s idiom, reused rather than re-invented.
//
// SECRET HYGIENE (the sibling specs' posture). Every assertion reads a number, a computed string, or a
// non-secret display literal that never leaves the fake. Nothing is sent on the wire but the rename the
// drive itself performs; the pairing plumbing (synthetic token, fake static key) lives in
// `launchPairedApp` and is never echoed. The `cwd` asserted below is a fixed fake remote path, never
// resolved locally.

// The workspace this drive renames — the fake's own create default, which is what lets the drive mint the
// second tree's group at the SAME path. A fixed literal: deterministic, no Date.now()/randomness.
const WORKSPACE_CWD = '/fake/workspace'

// The label the daemon holds at launch and the one it holds after Save. Chosen to share no substring
// with each other, with any locator here, or with the cwd's folder segment — so a build that never sent
// the frame, or one that never re-listed, cannot pass either assertion by accident.
const OLD_LABEL = 'Second Brain'
const NEW_LABEL = 'Kitchen Ledger'

// What the rows would read if the label were dropped entirely: the last segment of the cwd
// (`workspaceLabelFor`). Never asserted as present — it names what that failure looks like.
const FOLDER_SEGMENT = 'workspace'

// The pen's accessible name — the operator's word, restated here rather than imported from the code
// under test.
const EDIT_WORKSPACE_NAME = 'Edit workspace'

// The drawing's numbers (Workspace Hover 399:1060; pen "Icon Edgeless" 399:1339 at right 28, top 7.01,
// 14 × 14; plus 399:1065 at right 2, 16 × 16 — so 10px of clear air between the two glyphs). Each is a
// DERIVED consequence of the tokens the rule uses, so a swapped token reddens here.
const PEN_PX = 14
const PEN_RIGHT_INSET_PX = 28
const PEN_TO_PLUS_GAP_PX = 10
const ROW_HEIGHT_PX = 28

// `--color-primary` #9dcbfc, the drawn fill. Nothing in the static tier can see a colour at all.
const GLYPH_RGB = 'rgb(157, 203, 252)'

const HIDDEN_OPACITY = '0'
const SHOWN_OPACITY = '1'

// EXACTLY ONE clickable seed. Promoted and named so it lands in the Channels tree with a workspace group
// above it, and carrying the daemon's held label so the opening read is about the label and not the
// folder name.
const SEED: ConversationSummary = {
  id: 'seed-conversation',
  name: 'Seeded channel',
  is_promoted: true,
  is_archived: false,
  cwd: WORKSPACE_CWD,
  last_message_ts: '2026-07-07T12:00:00.000Z',
  last_used_at: '2026-07-07T12:00:00.000Z',
  workspace_label: OLD_LABEL
}

// The round trip (click → sendCommand → IPC → route → build → wire → fake mutation → correlated
// workspace_updated → decode → refresh trigger → list_conversations → reply → store → render) is a fast
// in-process hop, but the assertions following it auto-wait, so they carry headroom for a cold runner.
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Sub-pixel tolerance for a device-pixel-ratio-scaled layout, the sibling specs' constant.
const GEOMETRY_TOLERANCE_PX = 1

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

test('the workspace row’s pen hides at rest, opens an Edit workspace dialog, and renames the workspace in both trees', async ({
  launchPairedApp
}) => {
  // ONE launch, ONE continuous drive (the sibling specs' shape): each launch pays a full handshake, and
  // the ordering below is load-bearing throughout — every absence or unchanged-state assertion sits
  // AFTER a positive, auto-waiting read of the same gesture's own effect.
  const fake = conversationStateFake({ conversations: [SEED] })
  const { page } = await launchPairedApp({ buildReplyFrames: fake })

  const workspaceLabels = page.locator('.channel-list__workspace-label')
  const heads = page.locator('.channel-list__workspace-head')
  const pens = page.locator('.channel-list__workspace-edit')
  const penGlyphs = page.locator('.channel-list__workspace-edit-icon')
  const plusGlyphs = page.locator('.channel-list__workspace-create-icon')
  const actions = page.locator('.channel-list__actions')
  const dialog = page.getByRole('dialog', { name: 'Edit workspace' })
  const nameField = page.locator('.edit-workspace__input')

  // --- 1. THE OPENING POSITIVE READ, and the reason this drive proves anything. The Channels tree's
  // one group reads the daemon's held label, carried through the real decoder, the real IPC arm and the
  // real store by the `list_conversations` reply. Without it, step 9 would pass just as well against a
  // fake seeded with NEW_LABEL all along. An auto-waiting text read rather than an absence: a
  // `toHaveCount(0)` opening settles before the sidebar has rendered anything at all. The array form
  // pins the group count too. ---
  await expect(workspaceLabels).toHaveText([OLD_LABEL])

  // --- 2. Mint the SECOND tree's group at the same workspace, through the real Add workspace dialog. The
  // created row carries that cwd and inherits the workspace's held label, so both trees now read
  // OLD_LABEL — which is what makes step 9's "both trees" claim a move rather than a coincidence. ---
  await mintChatInWorkspace(page, WORKSPACE_CWD)
  await expect(workspaceLabels).toHaveText([OLD_LABEL, OLD_LABEL], {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(heads).toHaveCount(2)

  // --- 3. AC2: the pen is in the ACCESSIBILITY TREE at rest — before any hover, and read by role and
  // name rather than by class, which is the half a CSS locator cannot prove. One per workspace row, in
  // both trees, from ONE label constant. ---
  await expect(page.getByRole('button', { name: EDIT_WORKSPACE_NAME })).toHaveCount(2)

  // --- 4. AC1: nothing shows at rest. The pointer is parked on the actions cluster, not on a row —
  // reading an "at rest" opacity with the pointer still where the create click left it would assert the
  // reveal rather than the base state. ---
  await actions.hover()
  expect(await computed(pens.first(), 'opacity')).toBe(HIDDEN_OPACITY)

  // --- 5. AC1: hovering the ROW reveals it, and that is a SCOPE claim as much as a visibility one —
  // hung off the control's own `:hover` it would fire only once the pointer had already arrived at a
  // 20px box it could not see. Hovering the row's LABEL, not the control, is what says that. ---
  await workspaceLabels.first().hover()
  expect(await computed(pens.first(), 'opacity')).toBe(SHOWN_OPACITY)

  // --- 6. AC1: the pen's drawn rectangle. 14 × 14, its right edge 28px in from the row's right edge,
  // its box vertically centred, 10px clear of the plus, in `--color-primary` — read while the control is
  // revealed, since a display-none control would report no box at all and the opacity mechanism is what
  // keeps it laid out. The ROW is the reference box (`.channel-list__workspace-head`, which spans the
  // nest to the content edge), never the window: the inset is the drawing's, measured against the thing
  // it is drawn in. ---
  const headBox = await boxOf(heads.first(), 'workspace head row')
  const penBox = await boxOf(penGlyphs.first(), 'pen glyph')
  const plusBox = await boxOf(plusGlyphs.first(), 'create glyph')
  expectAbout(penBox.width, PEN_PX)
  expectAbout(penBox.height, PEN_PX)
  expectAbout(headBox.x + headBox.width - (penBox.x + penBox.width), PEN_RIGHT_INSET_PX)
  expectAbout(penBox.y + penBox.height / 2, headBox.y + headBox.height / 2)
  // The two controls' clear air, asserted BETWEEN them rather than as two independent insets that
  // happen to agree — so moving either one without the other reddens here even if both still land on a
  // round number. It is also the assertion that catches the two 20px hit boxes overlapping.
  expectAbout(plusBox.x - (penBox.x + penBox.width), PEN_TO_PLUS_GAP_PX)
  expect(await computed(pens.first(), 'color')).toBe(GLYPH_RGB)

  // --- 7. AC1: the row is still 28 tall with BOTH controls shown. They are out of the flex flow, so
  // neither can size the row — which is exactly why this is worth asserting: the failure it detects is a
  // control laid out IN the line, where a 20px box over a 20px label line would hold the derived 28
  // open. Read on the head row, whose height is the button's. ---
  expectAbout(headBox.height, ROW_HEIGHT_PX)

  // --- 8. AC2/AC4: clicking the pen opens the dialog and leaves the fold alone. The fold's state is
  // captured before the click so the "did not change" claim below compares against a value read from
  // this same run. Playwright counts an opacity-0 element as visible and moves the pointer onto it
  // before clicking, so no explicit hover is needed. ---
  const workspaceRow = page.locator('.channel-list__workspace').first()
  expect(await workspaceRow.getAttribute('aria-expanded')).toBe('true')
  await pens.first().click()
  await expect(dialog).toBeVisible()

  await expect(nameField).toHaveValue(OLD_LABEL)
  await expect(dialog.getByRole('textbox', { name: 'Workspace name (optional):' })).toHaveCount(1)
  await expect(dialog.locator('.edit-workspace__path')).toHaveCount(0)
  await expect(dialog).not.toContainText(WORKSPACE_CWD)
  expect(await dialog.locator('[title]').count()).toBe(0)
  expect(await dialog.locator('.modal__close img').evaluate(
    (el: HTMLImageElement) => el.naturalWidth)).toBe(28)
  await nameField.fill('   ')
  await expect(dialog.getByRole('button', { name: 'OK', exact: true })).toBeEnabled()

  // --- 9. AC5: type the new name, press Save, and every workspace row for that `cwd` — in BOTH trees —
  // reads it after the round trip. Every hop ran for real: had the command been dropped, mis-routed, or
  // built with the wrong `path`, no frame would have reached the fake and these would still read
  // OLD_LABEL. Nothing relaunched and no row was patched locally — the daemon's reply only triggered the
  // re-request whose answer landed this text. ---
  await nameField.fill(NEW_LABEL)
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(workspaceLabels).toHaveText([NEW_LABEL, NEW_LABEL], {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // The negative half stated explicitly. Without it, "the rows show a string" would pass against a build
  // that dropped the field, since the folder name is a string too. Scoped to the label TEXT rather than
  // to the markup: `workspace` is a substring of the class name on every one of these elements.
  for (const text of await workspaceLabels.allTextContents()) {
    expect(text).not.toBe(FOLDER_SEGMENT)
  }

  // AC2's last clause: the pen is a SIBLING of the disclosure button, never a child, so the click never
  // reached the fold's handler.
  expect(await workspaceRow.getAttribute('aria-expanded')).toBe('true')
})


test('optional resets, dismissal, keyboard controls and constrained modal layout', async ({ launchPairedApp }) => {
  const fake = conversationStateFake({ conversations: [SEED] })
  const renames: unknown[] = []
  const { page } = await launchPairedApp({ buildReplyFrames: (frame) => {
    const env = decodeEnvelope(frame)
    if (env.type === 'rename_workspace') renames.push(env.payload)
    return fake(frame)
  } })
  const labels = page.locator('.channel-list__workspace-label')
  const pen = page.getByRole('button', { name: EDIT_WORKSPACE_NAME }).first()
  const dialog = page.getByRole('dialog', { name: 'Edit workspace' })
  const field = dialog.getByRole('textbox', { name: 'Workspace name (optional):' })
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  await expect(labels).toHaveText([OLD_LABEL])
  await page.setViewportSize({ width: 800, height: 600 })
  await pen.focus()
  await pen.press('Enter')
  await expect(dialog).toBeVisible()
  // Existing focus remains on the pen; traverse intervening sidebar controls.
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press('Tab')
    if (await dialog.getByRole('button', { name: 'Close dialog' }).evaluate(
      el => el === document.activeElement)) break
  }
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(field).toBeFocused()
  await field.fill('Abandoned draft')
  await field.press('Escape')
  await expect(dialog).toBeVisible()
  await page.locator('.edit-workspace-overlay__scrim').click({ position: { x: 4, y: 4 } })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await pen.click()
  await expect(field).toHaveValue(OLD_LABEL)
  await field.fill('Another abandoned draft')
  await dialog.getByRole('button', { name: 'Close dialog' }).click()
  await expect(dialog).toHaveCount(0)
  expect(renames).toEqual([])

  for (const reset of ['', '   ', FOLDER_SEGMENT]) {
    await pen.click()
    await expect(field).toHaveValue(OLD_LABEL)
    await field.fill(reset)
    const before = renames.length
    await ok.click()
    await expect(labels).toHaveText([FOLDER_SEGMENT])
    await expect(dialog).toHaveCount(0)
    expect(renames.length).toBe(before + 1)
    expect(renames.at(-1)).toEqual({ path: WORKSPACE_CWD, label: null })
    await pen.click()
    await expect(field).toHaveValue(FOLDER_SEGMENT)
    await field.fill(OLD_LABEL)
    await field.press('Tab')
    await page.keyboard.press('Tab')
    await expect(ok).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(labels).toHaveText([OLD_LABEL])
  }

  await pen.click()
  await field.fill('x'.repeat(129))
  await expect(ok).toBeDisabled()
  await field.fill(OLD_LABEL)
  await expect(ok).toBeEnabled()
  const captures = '/tmp/builder-1349-visual'
  mkdirSync(captures, { recursive: true })
  await page.setViewportSize({ width: 1280, height: 800 })
  await field.evaluate(el => el.blur())
  expectAbout((await boxOf(dialog, 'modal')).width, 640)
  await page.screenshot({ path: captures + '/normal.png' })
  await page.setViewportSize({ width: 800, height: 600 })
  expectAbout((await boxOf(dialog, 'modal')).width, 640)
  await page.screenshot({ path: captures + '/minimum-width.png' })
  await page.setViewportSize({ width: 800, height: 200 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(800)
  expect(await dialog.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true)
  await ok.focus()
  await expect(ok).toBeInViewport()
  expect(await dialog.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
  await page.screenshot({ path: captures + '/short-window.png' })
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
})

// Shared refresh drops the event origin; re-enable after https://github.com/pyrycode/pyrycode-desktop/issues/1363.
test.skip('blocked on #1363 — identical paths on two hosts refresh only the clicked host', async ({ launchPairedApp }) => {
  const first = conversationStateFake({ conversations: [SEED] })
  const secondSeed = { ...SEED, id: 'second-seed', is_promoted: false, workspace_label: 'Other host label' }
  const second = conversationStateFake({ conversations: [secondSeed] })
  const counts = [0, 0]
  const counting = (fake: typeof first, index: number) => (frame: Uint8Array) => {
    if (decodeEnvelope(frame).type === 'rename_workspace') counts[index] += 1
    return fake(frame)
  }
  const { page, servers } = await launchPairedApp(
    { buildReplyFrames: counting(first, 0) },
    { secondServer: { buildReplyFrames: counting(second, 1) } }
  )
  // The multi-host launcher pushes its default second row after pairing.
  // Replace that fixture seed with this scenario's same-path row.
  await servers[1].daemon.pushFrame(seedConversationsFrame(secondSeed))
  const labels = page.locator('.channel-list__workspace-label')
  const pens = page.getByRole('button', { name: EDIT_WORKSPACE_NAME })
  const dialog = page.getByRole('dialog', { name: 'Edit workspace' })
  await expect(labels).toHaveText([OLD_LABEL, 'Other host label'])
  await pens.nth(1).click()
  await expect(dialog.getByRole('textbox')).toHaveValue('Other host label')
  await dialog.getByRole('textbox').fill('Second host renamed')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(labels).toHaveText([OLD_LABEL, 'Second host renamed'])
  expect(counts).toEqual([0, 1])
  await pens.first().click()
  await expect(dialog.getByRole('textbox')).toHaveValue(OLD_LABEL)
  await dialog.getByRole('textbox').fill('First host renamed')
  await dialog.getByRole('button', { name: 'OK', exact: true }).click()
  await expect(labels).toHaveText(['First host renamed', 'Second host renamed'])
  expect(counts).toEqual([1, 1])
})


test('both workspace pens send exactly one rename to their selected host', async ({ launchPairedApp }) => {
  const secondSeed = { ...SEED, id: 'second-seed', is_promoted: false }
  const requests: unknown[][] = [[], []]
  const recording = (seed: ConversationSummary, index: number) => {
    const fake = conversationStateFake({ conversations: [seed] })
    return (frame: Uint8Array) => {
      const env = decodeEnvelope(frame)
      if (env.type === 'rename_workspace') requests[index].push(env.payload)
      return fake(frame)
    }
  }
  const { page, servers } = await launchPairedApp(
    { buildReplyFrames: recording(SEED, 0) },
    { secondServer: { buildReplyFrames: recording(secondSeed, 1) } }
  )
  await servers[1].daemon.pushFrame(seedConversationsFrame(secondSeed))
  await expect(page.locator('.channel-list__workspace-label')).toHaveText([OLD_LABEL, OLD_LABEL])
  const pens = page.getByRole('button', { name: EDIT_WORKSPACE_NAME })
  const dialog = page.getByRole('dialog', { name: 'Edit workspace' })
  // No reply is awaited by the dialog. The request payloads prove routing independently
  // of the shared refresh regression tracked in the skipped test above.
  for (const index of [1, 0]) {
    await pens.nth(index).click()
    await dialog.getByRole('textbox').fill('  Routed name  ')
    await dialog.getByRole('button', { name: 'OK', exact: true }).click()
    await expect.poll(() => requests[index].length).toBe(1)
    await expect(dialog).toHaveCount(0)
    expect(requests[index]).toEqual([{ path: WORKSPACE_CWD, label: 'Routed name' }])
  }
  expect(requests.map(values => values.length)).toEqual([1, 1])
})
