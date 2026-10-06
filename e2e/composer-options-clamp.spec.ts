import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { capturePairedApp } from './fixtures/capturePairedApp'
import { COMPOSER_OPTIONS_LABEL_INSET_PX, COMPOSER_OPTIONS_WINDOW_MARGIN_PX } from '../src/renderer/src/screens/conversation/composerOptionsPlacement'

// Fake-stack UI e2e for the shared options panel's RIGHT-EDGE CLAMP (#847) — the measuring half of the
// feature #839 shipped dormant. It is the WHOLE proof: vitest runs the `node` environment
// (vitest.config.ts:27), so there is no layout, no getBoundingClientRect and no effects, and not one line
// of the wiring is executable there. The arithmetic itself is already pinned at legal widths by
// composerOptionsPlacement.test.ts and is deliberately NOT re-proved here.
//
// WHAT THIS SPEC PROVES IS THE WIRING: that three measured values reach composerOptionsShiftPx, that the
// result reaches --composer-options-shift WITH A UNIT (a bare number invalidates the whole `left`
// declaration at computed-value time and drops the panel to its static position at the anchor's content
// edge — 12px RIGHT of resting, i.e. further into the overflow, which the narrowed checkpoint catches by
// construction), and that a `resize` re-runs it in BOTH directions.
//
// ⭐ WHY THE RIG DRIVES THE WINDOW BELOW ITS SHIPPED FLOOR, and why that is honest. The footer holds
// exactly one control (ComposerActionsMenu) and it is the leftmost; the sidebar is `flex: 0 0 400px` and
// never shrinks (pairedShell.css:43), so the anchor's left edge is x≈468 at EVERY window width, and the
// panel's longest label puts its resting right edge near 586 — over 200px inside the 800px narrowest
// window the app permits. No shipped consumer can overflow at a size a user can reach; #682 and #683 are
// the tickets that put controls further right and both are parked behind daemon work. So the overflow is
// built here: the 800px minimum is LIFTED for the drive and RESTORED at the end. That is sound because
// the clamp is geometry-independent — it does not care WHY the panel overflows — and because the shipped
// constraint is borrowed, not changed (src/main/index.ts:44 stands).
//
// ONE test() block, ONE launch, ONE continuous drive — paired-shell-navigation.spec.ts's shape, since
// each launch pays a full handshake and no step here mutates persistent or session state.
//
// Its own file rather than an addition to composer-actions.spec.ts: the clamp is the SHARED container's
// property and Actions is merely the only host that exists today, so this is the file #682 and #683
// extend when their menus land further right.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads geometry, roles and
// accessible names only. Nothing serialises a token, a key or plaintext; the pairing plumbing lives in
// launchPairedApp and is never echoed.

// The trigger's client-owned label, ComposerActionsMenu's COMPOSER_ACTIONS_LABEL, and the locators built
// on it — composer-actions.spec.ts:34-47 verbatim, `exact: true` included. EXACT IS LOAD-BEARING:
// getByRole's `name` matches as a case-insensitive SUBSTRING by default, and the thread overflow trigger
// one region up is labelled `More actions`, so a non-exact `Actions` resolves to two buttons and fails
// Playwright's strict mode.
const ACTIONS_LABEL = 'Actions'
const actionsTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: ACTIONS_LABEL, exact: true })
const actionsPanel = (page: Page): Locator =>
  page.getByRole('menu', { name: ACTIONS_LABEL, exact: true })

// The width the drive narrows to. 520 leaves the chat pane 60px and puts the window's right edge ~66px
// inside the panel's resting right edge — a real overflow with headroom on both sides of the derivation.
// The assertions below are written against the MEASURED innerWidth and anchor rect rather than against
// these literals, so a drift in the panel's longest label shows up as a clean failure rather than a
// silent pass.
const NARROW_WIDTH_PX = 520
// Widened back to 900, not to the 1100 launch width: the drive only ever narrows relative to launch, so
// a small CI display's work area cannot clamp the setSize and fail for a reason that has nothing to do
// with the clamp (paired-shell-navigation.spec.ts:34-38's reasoning).
const WIDE_WIDTH_PX = 900
// A floor low enough for both targets, installed only for this drive. A small positive width rather than
// 0, whose meaning varies by platform.
const LIFTED_MIN_WIDTH_PX = 200

/**
 * A geometry delta as a whole number of pixels, with NEGATIVE ZERO NORMALISED TO ZERO.
 *
 * The rounding absorbs the sub-pixel drift between `offsetWidth`'s integer and the rect's fraction; the
 * normalisation is what makes the result assertable. `expect.poll(…).toBe(0)` compares with `Object.is`,
 * under which `Object.is(-0, 0)` is FALSE — and `Math.round` of any tiny NEGATIVE fraction returns `-0`,
 * which is exactly what a correctly clamped panel produces. Without this, the checkpoint that measured
 * perfectly is the one that never settles. Measured against a real run, not guessed.
 */
const wholePixels = (delta: number): number => {
  const rounded = Math.round(delta)
  // `=== 0` is true for both zeroes; the literal returned is the positive one.
  return rounded === 0 ? 0 : rounded
}

test('the options panel fits the pane and restores its width on resize', async ({
  launchPairedApp
}) => {
  const { page, app } = await launchPairedApp()

  // AC4 rides on this line being ordinary: the clamp is driven through the UNMODIFIED ComposerActionsMenu,
  // which passes no placement prop and knows nothing about the correction. It is the shared container's.
  await actionsTrigger(page).click()
  const panel = actionsPanel(page)
  await expect(panel).toBeVisible()

  // The anchor is ComposerOptionsMenu's own private wrapper; it has no role, so it is located by its class
  // — the `.channel-list__row-open` / `.paired-shell__sidebar` idiom of the sibling specs.
  //
  // SCOPED TO THE ACTIONS TRIGGER, and #988 is why. This locator used to be bare, resting on "exactly one
  // exists (the footer's single control)". The footer's model menu renders a second anchor whenever a
  // model list has arrived, so that invariant is now CONDITIONAL — this spec pushes no model_list, so the
  // model control renders its inert arm and the bare locator would still resolve one, by accident of what
  // this launch happens to seed. `has:` pins it to the anchor whose trigger is the one being measured,
  // which is what the measurements below have always meant. Nothing else in this spec changes.
  const anchor = page.locator('.composer-options-anchor', { has: actionsTrigger(page) })

  // A missing box is a node not yet attached or laid out. NaN as the sentinel rather than the siblings'
  // `-1`: every checkpoint below expects 0, and -1 is a plausible real sub-pixel value here, while NaN can
  // never equal 0 — so the poll keeps retrying instead of settling on a mid-layout frame or throwing.
  const restingOffset = async (): Promise<number> => {
    const [panelBox, anchorBox] = await Promise.all([panel.boundingBox(), anchor.boundingBox()])
    if (!panelBox || !anchorBox) return Number.NaN
    // How far the panel sits from where it rests with a shift of 0. ONE scalar per checkpoint: polling two
    // bounds separately would let the second settle on a stale frame. The failure message still reports the
    // real pixel gap.
    return wholePixels(panelBox.x - (anchorBox.x - COMPOSER_OPTIONS_LABEL_INSET_PX))
  }
  // The panel's overhang past the window's right edge. Compared against the PAGE's own innerWidth, never
  // against the number passed to setSize — that is the OUTER size, and the difference is platform chrome.
  const overhangPastWindow = async (): Promise<number> => {
    const [panelBox, viewportWidth] = await Promise.all([
      panel.boundingBox(),
      page.locator('.conversation__input-chrome').evaluate(el => el.getBoundingClientRect().right)
    ])
    if (!panelBox) return Number.NaN
    return wholePixels(panelBox.x + panelBox.width - viewportWidth)
  }

  // --- 1. At the 1100 launch width the panel fits, so it is NOT moved (AC2). Its left edge sits exactly
  // COMPOSER_OPTIONS_LABEL_INSET_PX left of the anchor's — #839's resting position, a shift of 0. ---
  await expect.poll(restingOffset).toBe(0)
  const restingWidth = (await panel.boundingBox())?.width
  if (restingWidth === undefined) throw new Error('Missing open menu geometry')

  // --- 2. Lift the shipped 800px floor and narrow past it. The panel stays open throughout: nothing here
  // generates a mousedown, and `src/` holds no other resize listener that could remount the screen. ---
  const [startMinWidth, startMinHeight] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getMinimumSize()
  )
  const [, startHeight] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getSize()
  )
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setMinimumSize(size.width, size.height),
    { width: LIFTED_MIN_WIDTH_PX, height: startMinHeight }
  )
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width: NARROW_WIDTH_PX, height: startHeight }
  )

  // A narrow pane bounds the menu width, then shifts it to retain the safety margin.
  // Both deltas prove the bound and placement are active, rather than a clipped panel.
  await expect.poll(overhangPastWindow).toBe(-COMPOSER_OPTIONS_WINDOW_MARGIN_PX)
  expect(await restingOffset()).toBeLessThan(0)
  expect((await panel.boundingBox())?.width).toBeLessThan(restingWidth)

  // --- 4. Widen again and the shift is RELEASED — the panel returns to its resting position (AC3's
  // second direction, the one a one-way drive would miss). ---
  await app.evaluate(
    ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(size.width, size.height),
    { width: WIDE_WIDTH_PX, height: startHeight }
  )
  await expect.poll(restingOffset).toBe(0)
  await expect.poll(async () => (await panel.boundingBox())?.width).toBe(restingWidth)

  // --- 5. Restore the floor this spec only borrowed. Each test launches its own app, so a mid-drive
  // failure strands nothing; the restore is intent, made explicit. ---
  await app.evaluate(
    ({ BrowserWindow }, size) =>
      BrowserWindow.getAllWindows()[0].setMinimumSize(size.width, size.height),
    { width: startMinWidth, height: startMinHeight }
  )
})

for (const size of [{ width: 1280, height: 800 }, { width: 800, height: 600 }]) {
  test(`long footer model labels stay readable and selectable at ${size.width} with zoom`, async ({ launchPairedApp }) => {
    const labels = [
      'Synthetic extended model display name with a wide context window and detailed reasoning',
      'SyntheticUnbrokenModelDisplayNameWithExtendedContextAndDetailedReasoningCapabilities'
    ]
    const models = labels.map((display_name, index) => ({
      value: `1733-${index}`, display_name, resolved_model: `1733-${index}`,
      effort_levels: [], supports_auto_mode: false, truncated_fields: null
    }))
    const selections: unknown[] = []
    const frame = (type: Parameters<typeof encodeEnvelope>[0]['type'], payload: unknown, in_reply_to?: number) =>
      encodeEnvelope({ id: 1733, type, ts: '2026-10-06T00:00:00Z', payload, in_reply_to })
    const { page, app, daemon } = await launchPairedApp({ buildReplyFrames: bytes => {
      const env = decodeEnvelope(bytes)
      if (env.type === 'list_conversations') return [seedConversationsFrame()]
      if (env.type === 'request_session_settings') return [frame('session_settings', {
        session_id: 'long-label-session', model: models[0].value, effort: 'low', effective_effort: 'low',
        yolo: false, permission_mode: 'default', used_tokens: 0, window_tokens: 200000
      }, env.id)]
      if (env.type === 'set_session_settings') {
        selections.push(env.payload)
        return [frame('session_settings_updated', { session_id: 'long-label-session' }, env.id)]
      }
      return []
    } })
    daemon.pushFrame(frame('model_list', { conversation_id: SEEDED_ROW.id, models, dropped_models: 0 }))
    await app.evaluate(({ BrowserWindow }, dimensions) =>
      BrowserWindow.getAllWindows()[0].setSize(dimensions.width, dimensions.height), size)
    const trigger = page.locator('.composer__model')
    const panel = page.getByRole('menu', { name: 'Model', exact: true })
    for (const zoom of [1, 1.25]) {
      await app.evaluate(({ BrowserWindow }, factor) =>
        BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(factor), zoom)
      await trigger.click()
      await expect(panel).toBeVisible()
      const geometry = await panel.evaluate(node => {
        const pane = node.closest('.conversation__input-chrome')!.getBoundingClientRect()
        const panel = node.getBoundingClientRect()
        const rows = [...node.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(row => {
          const box = row.getBoundingClientRect()
          const range = document.createRange()
          range.selectNodeContents(row)
          const lines = [...range.getClientRects()]
          return { height: box.height, contained: lines.every(line =>
            line.left >= box.left && line.right <= box.right && line.top >= box.top && line.bottom <= box.bottom),
            lines: lines.length, bottomLine: { x: lines.at(-1)!.left + 2, y: lines.at(-1)!.bottom - 2 } }
        })
        return { insidePane: panel.left > pane.left && panel.right < pane.right && panel.top >= 0, rows }
      })
      expect(geometry.insidePane).toBe(true)
      for (const row of geometry.rows) {
        expect(row.contained).toBe(true)
        if (size.width === 800) {
          expect(row.lines).toBeGreaterThan(1)
          expect(row.height).toBeGreaterThan(28)
        }
      }
      const first = panel.getByRole('menuitem', { name: labels[0], exact: true })
      await expect(first).toBeFocused()
      await page.keyboard.press('ArrowDown')
      const last = panel.getByRole('menuitem', { name: labels[1], exact: true })
      await expect(last).toBeFocused()
      expect(await last.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid')
      // Visible overflow would cut off the row's keyboard focus outline at its panel edge.
      expect(await panel.evaluate(node => getComputedStyle(node).overflow)).toBe('visible')
      await capturePairedApp(app, page, `/tmp/builder-1733/long-model-${size.width}-${zoom}.png`)
      await page.keyboard.press('Enter')
      await expect(panel).toHaveCount(0)
      await expect.poll(() => selections.at(-1)).toEqual({ session_id: 'long-label-session', model: models[1].value })
      await expect(trigger).toBeFocused()
      await trigger.click()
      // Click the final wrapped line, proving the visible label belongs to the selectable row.
      await page.mouse.click(geometry.rows[0].bottomLine.x, geometry.rows[0].bottomLine.y)
      await expect(panel).toHaveCount(0)
      await expect.poll(() => selections.at(-1)).toEqual({ session_id: 'long-label-session', model: models[0].value })
      await expect(trigger).toBeFocused()
    }
    expect(selections).toHaveLength(4)
  })
}
