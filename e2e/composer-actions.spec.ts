import type { Locator, Page } from '@playwright/test'
import { test, expect, seedConversationsFrame } from './fixtures/launchPairedApp'
import { bubbleTextExactly } from './fixtures/bubbleText'
import { decodeEnvelope } from '../src/main/transport/codec'
import type { SendMessagePayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for the composer's Actions menu (#680) — and THE IN-APP INTERACTION PROOF #840
// DEFERRED HERE. The shared options panel shipped dormant across #838 (surface), #839 (placement) and
// #840 (opening, keyboard, dismissal); this ticket is its first live mount, so this is the first spec
// that can open it at all.
//
// WHY IT HAS TO BE PLAYWRIGHT. vitest runs the `node` environment (vitest.config.ts) — every renderer
// test is a renderToStaticMarkup string assertion with no DOM, no effects and no click handlers. The
// static tier pins the trigger's presence, the entries' order and the panel's three unmarked rows
// (ComposerActionsMenu.test.tsx); only a real window can prove the panel OPENS, that picking a row sends
// its command, that Escape and an outside click dismiss it, and that focus comes back to the button.
//
// AC4 IS DELIBERATELY NOT DRIVEN HERE, and that is a decision rather than an omission. Reaching a
// disconnected composer in the fake tier means tearing down the fake daemon mid-spec, which no existing
// spec does; building that drive is a larger piece of fixture work than this ticket's whole feature. AC4
// is covered instead by (a) the structure — `Composer` has ONE `sendText` whose first line is the
// `canSend` gate and no second entry point, and the menu holds no `canSend` prop that could drift from
// it — and (b) the container smoke's disconnected render, which pins that the trigger is present and
// ENABLED in exactly that state (ConversationScreen.test.tsx).
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles,
// focus and counts, plus the decoded outbound's `text` field — which is a client-owned slash command,
// not a secret. No failure diagnostic serialises a token, a key or plaintext; the pairing plumbing lives
// in launchPairedApp and is never echoed.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; short headroom over
// Playwright's 5s default for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// The trigger's client-owned label, ComposerActionsMenu's COMPOSER_ACTIONS_LABEL. Duplicated as a
// literal rather than imported, the ~15 `Send` locators' convention: THIS STRING AND THE THREE ROW
// LABELS BELOW ARE LOAD-BEARING LOCATORS — rewording one in ComposerActionsMenu.tsx breaks this spec,
// which is the point.
const ACTIONS_LABEL = 'Actions'
// #1218 appended a FOURTH row, and it is the one entry here that is not a slash command: picking it
// dispatches a `new_session` control frame rather than message text, so this spec's captures never see
// it. Its own drive is e2e/composer-new-session.spec.ts. It is listed here because `toHaveText` below
// asserts the panel's rows exactly, which is what makes a row appearing or vanishing fail loudly.
const ROW_LABELS = [
  'Reset session',
  'Compact session',
  'Knowledge capture',
  'New session (restarts claude)'
]

// EXACT IS LOAD-BEARING, not defensive tidiness. getByRole's `name` matches as a case-insensitive
// SUBSTRING by default, and the thread overflow trigger one region up is labelled `More actions` — so a
// non-exact `Actions` resolves to two buttons and fails Playwright's strict mode. Measured, not guessed.
const actionsTrigger = (page: Page): Locator =>
  page.getByRole('button', { name: ACTIONS_LABEL, exact: true })
const actionsPanel = (page: Page): Locator =>
  page.getByRole('menu', { name: ACTIONS_LABEL, exact: true })

/**
 * A daemon script that CAPTURES the decoded outbound instead of answering it. `buildReplyFrames` runs in
 * the test process, so the payload can be pushed into a test-local array before returning frames — and
 * that captured payload is AC2's real proof: it shows the command travelling as an ordinary
 * `send_message`'s `text`, not as some new command type or IPC arm.
 *
 * A factory rather than a module-level array, so no test can see another's captures.
 *
 * `send_message` → `[]`: no daemon reply is needed, because the optimistic echo is what AC3 asks about.
 * Every other inbound (the auto-fired `list_conversations`, plus any later non-send frame) → the shared
 * one-row seed. A scripted `buildReplyFrames` overrides the fixture's default `buildReply`, so this spec
 * owns seeding its own default arm. The `as` cast is the send-and-stream.spec.ts idiom: the `case`
 * already narrowed the envelope type, and this is a test.
 */
function captureOutbound(): {
  sent: SendMessagePayload[]
  buildReplyFrames: (inbound: Uint8Array) => Uint8Array[]
} {
  const sent: SendMessagePayload[] = []
  return {
    sent,
    buildReplyFrames: (inbound: Uint8Array): Uint8Array[] => {
      const envelope = decodeEnvelope(inbound)
      switch (envelope.type) {
        case 'send_message':
          sent.push(envelope.payload as SendMessagePayload)
          return []
        default:
          return [seedConversationsFrame()]
      }
    }
  }
}

test('picking Reset session sends /clear as an ordinary message (AC1, AC2, AC3)', async ({
  launchPairedApp
}) => {
  const { sent, buildReplyFrames } = captureOutbound()
  const { page } = await launchPairedApp({ buildReplyFrames })

  // --- Open (AC1). The trigger's accessible name is its visible text; the chevron is aria-hidden, so it
  // is exactly `Actions`. The panel shares that name under a different ROLE, which is how both stay
  // unambiguously addressable. ---
  await actionsTrigger(page).click()
  const panel = actionsPanel(page)
  await expect(panel).toBeVisible()
  // Exactly these entries, in the design's order — the mapping's visible half.
  await expect(panel.getByRole('menuitem')).toHaveText(ROW_LABELS)

  // --- Pick (AC2, AC3). ---
  await panel.getByRole('menuitem', { name: ROW_LABELS[0] }).click()
  await expect(panel).toBeHidden()

  // The command lands in the thread as a USER message, exactly as a typed one does — the same optimistic
  // `userText` echo the send button produces (`.bubble[data-thread-role="user"]`). It follows the thread
  // down through the same `onMessageSent()` notify, whose behaviour thread-scroll-pin.spec.ts owns.
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveText(
    bubbleTextExactly('/clear'),
    { timeout: ROUNDTRIP_TIMEOUT_MS }
  )

  // BOTH the bubble AND the outbound: the bubble alone would pass if the echo were painted without
  // anything being sent. One `send_message`, whose text is the command verbatim — no new command type.
  await expect.poll(() => sent.length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(sent[0].text).toBe('/clear')
})

test('picking Compact session sends /compact — the mapping is per row (AC2)', async ({
  launchPairedApp
}) => {
  const { sent, buildReplyFrames } = captureOutbound()
  const { page } = await launchPairedApp({ buildReplyFrames })

  await actionsTrigger(page).click()
  await actionsPanel(page).getByRole('menuitem', { name: ROW_LABELS[1] }).click()

  // A second entry carrying its own command is enough to prove the mapping is per-row rather than
  // hardcoded to the first one; a third adds no information.
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveText(
    bubbleTextExactly('/compact'),
    { timeout: ROUNDTRIP_TIMEOUT_MS }
  )
  await expect.poll(() => sent.length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(sent[0].text).toBe('/compact')
})

test('Escape dismisses the panel and returns focus to the Actions button (AC1)', async ({
  launchPairedApp
}) => {
  const { sent, buildReplyFrames } = captureOutbound()
  const { page } = await launchPairedApp({ buildReplyFrames })

  const actions = actionsTrigger(page)
  await actions.click()
  const panel = actionsPanel(page)
  await expect(panel).toBeVisible()

  // Escape is pressed with focus on the first ROW (ComposerOptionsMenu moves it there on open), so this
  // also proves the anchor's single keydown handler sees a keystroke that started inside the panel.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(actions).toBeFocused()

  // Dismissing is not picking: nothing went out.
  expect(sent).toHaveLength(0)
})

test('an outside click dismisses the panel (AC1)', async ({ launchPairedApp }) => {
  const { sent, buildReplyFrames } = captureOutbound()
  const { page } = await launchPairedApp({ buildReplyFrames })

  await actionsTrigger(page).click()
  const panel = actionsPanel(page)
  await expect(panel).toBeVisible()

  // The message thread — inert copy, and genuinely outside the anchor: it carries no control of its own,
  // so the click can only read as an outside click. (It used to be justified as avoiding the header row,
  // whose only control was Unpair; #1061 deleted that row.) Focus is deliberately NOT asserted back on
  // the trigger here: on this one path
  // close()'s focus() runs BEFORE the browser's own mousedown focus action, so focus ends where the user
  // clicked — the documented, correct outcome at ComposerOptionsPanel.tsx:230-232.
  await page.locator('.conversation__empty-copy').click()
  await expect(panel).toBeHidden()
  expect(sent).toHaveLength(0)
})
