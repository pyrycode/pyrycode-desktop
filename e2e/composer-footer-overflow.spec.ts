import type { Locator, Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ModelListPayload,
  SessionSettingsPayload,
  WireModelOption
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1107 — the input footer's whole-row shrink policy. THIS FILE IS THE WHOLE PROOF:
// vitest runs the `node` environment and every renderer spec is a `renderToStaticMarkup` string, so there
// is no layout, no getBoundingClientRect and no computed style, and an overflowing flex row is
// unobservable in that tier by construction. The change is three CSS declarations, so there is no pure
// function for the static tier to own either.
//
// THE DETECTOR IS WIDTH-BASED, and that is not a preference. `.composer__footer` declares a hard
// `height: 20px`, so its content overflows the row's box rather than growing it: a boundingBox().height
// assertion is structurally unable to redden for this defect, and the row's real symptom is that
// `.paired-shell__pane` (overflow: hidden) CLIPS the tail — the attach button and the end of the reading
// simply vanish off the pane's right edge with no visual sign that they were ever there. scrollWidth
// against clientWidth is what sees that.
//
// THE SEEDS ARE DELIBERATELY LONG, and a short-seeded row would pass this spec unfixed. Every shipped spec
// that reaches this row seeds `seeded-model` / `low` / `default` / 25%, which since #1095 draws as a
// six-character family; the row can fit that even with nothing giving. So this drive publishes a model and
// an effort level long enough to sit AT their own `max-width` bounds, the permission mode whose
// client-owned label is the widest in that control's vocabulary, and a full context window, which is the
// reading's longest possible string (`Context high: 100%`, 18 characters).
//
// THE STANDING RULE IS KEPT: a fake-tier spec may not supply an input production does not produce. The two
// frames here are `session_settings` (the reply to the app's own `request_session_settings`) and
// `model_list` (which the daemon pushes unprovoked). Only the VALUES are this test's.
//
// The longest permission label is only rendered, never submitted. The final keyboard drive opens
// Attach through the real IPC picker path, with the native dialog replaced by a cancelled selection.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads geometry, counts or
// DOM text. SESSION_ID, the published identifiers and the token figures are non-secret display/routing
// literals; the pairing plumbing lives in launchPairedApp and is never echoed. No failure diagnostic
// serialises a token, a key or plaintext.

const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const SESSION_ID = 'session-1107'

// The app's own documented minimum (src/main/index.ts's `minWidth`). The drive narrows TO it rather than
// past it, so unlike e2e/composer-options-clamp.spec.ts nothing is borrowed and nothing is restored: the
// floor this spec measures at is the shipped one, and the assertion at the end proves it stayed that way.
const NARROW_WIDTH_PX = 800
const NARROW_HEIGHT_PX = 600

// The design's item rhythm (Figma 110:3494, five items 20px apart in a 780-wide row) and the ceiling of
// the row's `column-gap`. Asserted at the LAUNCH width, where the fix must be invisible.
const FOOTER_RHYTHM_PX = 20

// One window, filled exactly, so the reading renders its longest string: `Context high: 100%`. The top
// severity step is the one that appends the word, and `used == window` is the only pair that reaches 100.
const WINDOW_TOKENS = 200_000

// The three published strings, each chosen to sit past its own control's client-owned bound.
//
// The model label is a FAMILY since #1095 (ComposerModelMenu's modelFamily): the `claude-` prefix is
// stripped, the leading [A-Za-z]+ run is taken and its first character upper-cased. The trigger reads the
// matched row's `resolved_model` first, so that is the field carrying the long run here — 22 characters,
// which at 12px body-small draws far past .composer__model-label's 120px.
const LONG_RESOLVED_MODEL = 'claude-extraordinarilycapable-5'
const LONG_MODEL_FAMILY = 'Extraordinarilycapable'
// 21 characters against .composer__effort-label's 64px bound. Published as one of the matched row's
// levels, which is what un-inerts the effort trigger and gives it its chevron.
const LONG_EFFORT = 'exceptionallythorough'
// The longest label in PERMISSION_MODE_LABELS, and a mode a real session can be in.
const WIDEST_MODE = 'dontAsk'
const WIDEST_LABEL = 'Approved actions only'

const READING_TEXT = 'Context high: 100%'

// The single published row. Its `value` is what the session's model matches on, so `publishedRowFor` hits
// and the trigger derives from `resolved_model` above; its `effort_levels` is what makes both the model
// and the effort trigger render their OPERABLE arm (label + chevron) rather than the narrower inert one,
// which is the wider rendering and therefore the one worth measuring.
const PUBLISHED_MODEL: WireModelOption = {
  value: 'wide',
  display_name: 'Wide pick',
  resolved_model: LONG_RESOLVED_MODEL,
  effort_levels: [LONG_EFFORT],
  supports_auto_mode: false,
  truncated_fields: null
}

const WORST_CASE_RUN_CONFIG: SessionSettingsPayload = {
  session_id: SESSION_ID,
  model: PUBLISHED_MODEL.value,
  effort: LONG_EFFORT,
  effective_effort: LONG_EFFORT,
  yolo: false,
  permission_mode: WIDEST_MODE,
  used_tokens: WINDOW_TOKENS,
  window_tokens: WINDOW_TOKENS
}

function sessionSettingsFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: WORST_CASE_RUN_CONFIG
  })
}

function modelListFrame(): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'model_list',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      models: [PUBLISHED_MODEL],
      dropped_models: 0
    } satisfies ModelListPayload
  })
}

/** Each anchor addressed by the label it holds rather than by `.nth(k)`: an index-addressed row reports
 *  the same position however the row is reordered, so it could never detect the scramble the x-order
 *  assertion below exists to rule out. */
const anchorHolding = (page: Page, child: Locator): Locator =>
  page.locator('.composer__footer .composer-options-anchor', { has: child })

/** How far past its own box the row's content reaches. Zero or less is the fix; the shipped stylesheet
 *  reports a positive number here at both widths this drive measures. A single scalar per checkpoint, so
 *  a poll cannot settle on a frame where one of two reads is stale. */
const footerOverflowPx = (page: Page): Promise<number> =>
  page
    .locator('.composer__footer')
    .evaluate((el) => el.scrollWidth - el.clientWidth)

async function expectAttachmentGeometry(page: Page): Promise<void> {
  const footer = page.locator('.composer__footer')
  await expect(footer.locator(':scope > button')).toHaveCount(1)
  await expect(footer.locator(':scope > button')).toHaveAccessibleName('Attach file')
  expect(await footer.evaluate((el) => {
    const style = getComputedStyle(el)
    return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
  })).toEqual(['4px', '16px', '0px', '12px'])
  const [row, button, glyph] = await Promise.all([
    footer.boundingBox(),
    page.getByRole('button', { name: 'Attach file', exact: true }).boundingBox(),
    page.locator('.composer__attach svg').boundingBox()
  ])
  if (!row || !button || !glyph) throw new Error('the attachment control did not lay out')
  expect(row.height).toBe(20)
  expect(button.width).toBe(24)
  expect(button.height).toBe(16)
  expect(glyph.width).toBe(11)
  expect(glyph.height).toBe(12)
  expect(button.y - row.y).toBeCloseTo(4, 1)
  expect(row.x + row.width - button.x - button.width).toBeCloseTo(16, 1)
  expect(glyph.y - button.y).toBeCloseTo(0, 1)
  expect(button.x + button.width - glyph.x - glyph.width).toBeCloseTo(0, 1)
}

test('composer footer: the row compresses instead of overflowing at the 800px minimum (AC1-AC3)', async ({
  launchPairedApp
}) => {
  const { page, app, daemon } = await launchPairedApp({
    buildReplyFrames: (inbound) => {
      const env = decodeEnvelope(inbound)
      switch (env.type) {
        case 'list_conversations':
          return [seedConversationsFrame()]
        case 'request_session_settings':
          return [sessionSettingsFrame(env.id)]
        default:
          return []
      }
    }
  })

  const footer = page.locator('.composer__footer')
  const reading = page.locator('.composer__context')
  const modelLabel = page.locator('.composer__model-label')
  const effortLabel = page.locator('.composer__effort-label')
  const permissionLabel = page.locator('.composer__permission-label')
  const attach = page.locator('.composer__attach')

  // --- 1. Prime the row. Nothing PUSHES a run-config snapshot — `session_settings` is reply-only — but
  // since #1166 opening a conversation asks for one, and launchPairedApp navigates by clicking the seeded
  // row, so the reply to that on-open request is what mounts the four controls that read it. The
  // `model_list` is a separate unsolicited push and is what turns the model and effort triggers from their
  // inert arms into their operable, chevron-bearing ones. ---
  daemon.pushFrame(modelListFrame())

  // THE POSITIVE GATE for everything below. Both fit assertions are assertions of ABSENCE — a row holding
  // nothing satisfies them perfectly — so the worst-case content is pinned FIRST, by text rather than by
  // geometry: textContent is what the element holds, unaffected by any truncation the stylesheet applies,
  // so these four reads prove the seeds landed without pre-judging how the row draws them.
  await expect(reading).toHaveText(READING_TEXT, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(modelLabel).toHaveText(LONG_MODEL_FAMILY, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(effortLabel).toHaveText(LONG_EFFORT)
  await expect(permissionLabel).toHaveText(WIDEST_LABEL)
  // All four triggers operable, so the row is measured in its widest rendering.
  await expect(page.locator('.composer__footer .composer-options-anchor')).toHaveCount(4)

  const actionsAnchor = anchorHolding(page, page.getByRole('button', { name: 'Actions', exact: true }))
  const permissionAnchor = anchorHolding(page, permissionLabel)
  const modelAnchor = anchorHolding(page, modelLabel)
  const effortAnchor = anchorHolding(page, effortLabel)

  // --- 2. At the 1100 launch width the design's rhythm is UNTOUCHED. The row's gap is capped at the
  // drawing's 20px, and the cap is reached well above this width, so the fix is a no-op everywhere the row
  // was not already broken. This is also the assertion that fails loudly rather than quietly if a
  // percentage `column-gap` resolved to zero instead of against the row's content box. ---
  const [actionsBox, permissionBox] = await Promise.all([
    actionsAnchor.boundingBox(),
    permissionAnchor.boundingBox()
  ])
  if (!actionsBox || !permissionBox) throw new Error('the footer row did not lay out')
  expect(permissionBox.x - (actionsBox.x + actionsBox.width)).toBeCloseTo(FOOTER_RHYTHM_PX, 0)

  // And the row already fits at the launch width, where the worst-case content is over the box too. Every
  // geometry read polls: layout settles a frame after the content does.
  await expect.poll(() => footerOverflowPx(page)).toBeLessThanOrEqual(0)

  await expectAttachmentGeometry(page)
  const evidenceDir = join(tmpdir(), 'builder-1727')
  await mkdir(evidenceDir, { recursive: true })
  // Compare the actual footer at the Figma node's 785px logical width.
  const currentFooterWidth = (await footer.boundingBox())!.width
  await app.evaluate(({ BrowserWindow }, delta) => {
    const window = BrowserWindow.getAllWindows()[0]
    const [width, height] = window.getSize()
    window.setSize(width + delta, height)
  }, Math.round(785 - currentFooterWidth))
  await expect.poll(async () => (await footer.boundingBox())?.width).toBe(785)
  await expectAttachmentGeometry(page)
  await footer.screenshot({ path: join(evidenceDir, 'footer-785.png'), animations: 'disabled' })
  await page.screenshot({ path: join(evidenceDir, 'app-design-width.png'), animations: 'disabled' })

  // --- 3. Narrow to the app's own minimum. 800 is AT the shipped floor, so `setMinimumSize` is never
  // called and there is nothing to restore — a mid-drive failure leaves the window's constraint exactly as
  // it shipped. ---
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width: NARROW_WIDTH_PX, height: NARROW_HEIGHT_PX }
  )

  await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(NARROW_WIDTH_PX)

  // --- 4. AC1. The row's content is inside its box at the documented minimum window. ---
  await expect.poll(() => footerOverflowPx(page)).toBeLessThanOrEqual(0)

  // It fits by COMPRESSING, not because the seeds turned out to be short: both bounded labels are
  // genuinely truncated here, which is what an ellipsized flex item reports.
  expect(
    await modelLabel.evaluate((el) => el.scrollWidth > el.clientWidth)
  ).toBe(true)
  expect(
    await effortLabel.evaluate((el) => el.scrollWidth > el.clientWidth)
  ).toBe(true)

  // AC2's "all six occupants still render" read at the level the row actually fails at: a CONTROL whose
  // own content does not fit inside it is a control whose chevron has been clipped off the end, which is
  // what the Actions trigger did before its word was wrapped in an ellipsizing <span> — a bare text node
  // is an anonymous flex item, it cannot shrink, and .composer__footer-button's clip takes the glyph
  // instead. Read on every trigger, not just that one: it is the row-wide statement that compressing a
  // control never costs it a part of itself.
  for (const anchor of [actionsAnchor, permissionAnchor, modelAnchor, effortAnchor]) {
    expect(
      await anchor
        .locator('.composer__footer-button')
        .evaluate((el) => el.scrollWidth - el.clientWidth)
    ).toBeLessThanOrEqual(0)
  }

  // --- 5. AC2. All six occupants still render, in the Figma's order (Actions · mode · model · effort ·
  // reading · attach) — as GEOMETRY rather than as DOM order, since the row's order is a visual contract
  // and a flex `order` or a re-parent would leave the markup's order intact. ---
  const boxes = await Promise.all(
    [actionsAnchor, permissionAnchor, modelAnchor, effortAnchor, reading, attach].map((item) =>
      item.boundingBox()
    )
  )
  const lefts = boxes.map((box) => box?.x)
  expect(lefts.every((x) => typeof x === 'number')).toBe(true)
  for (let i = 1; i < lefts.length; i += 1) {
    expect(lefts[i]).toBeGreaterThan(lefts[i - 1] as number)
  }

  // The row still holds its hard height at the narrow width — it compressed, it did not wrap or grow.
  expect((await footer.boundingBox())?.height).toBe(20)
  await expectAttachmentGeometry(page)

  // Every inline setting remains reachable by keyboard at the supported minimum.
  const controls = [actionsAnchor, permissionAnchor, modelAnchor, effortAnchor].map((anchor) =>
    anchor.locator('button').first()
  )
  for (let index = 0; index < controls.length; index += 1) {
    if (index === 0) await controls[index].focus()
    else await page.keyboard.press('Tab')
    await expect(controls[index]).toBeFocused()
    expect((await controls[index].boundingBox())!.width).toBeGreaterThan(0)
  }
  await page.keyboard.press('Tab') // context breakdown
  await page.keyboard.press('Tab') // sole trailing control: Attach
  await expect(attach).toBeFocused()

  await app.evaluate(({ dialog }) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => {
        ;(globalThis as unknown as { footerPickerOpened: boolean }).footerPickerOpened = true
        return { canceled: true, filePaths: [] }
      }
    })
  })
  await page.keyboard.press('Enter')
  await expect.poll(() =>
    app.evaluate(() =>
      (globalThis as unknown as { footerPickerOpened?: boolean }).footerPickerOpened
    )
  ).toBe(true)

  // And the shipped 800px floor is unchanged: this drive fits the row to the window rather than the window
  // to the row. A future edit that starts borrowing the minimum the way composer-options-clamp.spec.ts
  // does would redden here.
  const [minWidth] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMinimumSize()
  )
  expect(minWidth).toBe(NARROW_WIDTH_PX)
  await expect(page.getByRole('button', { name: WIDEST_LABEL, exact: true })).toBeVisible()
  await page.screenshot({ path: join(evidenceDir, 'app-800.png'), animations: 'disabled' })
  await footer.screenshot({ path: join(evidenceDir, 'footer-800.png'), animations: 'disabled' })
})
