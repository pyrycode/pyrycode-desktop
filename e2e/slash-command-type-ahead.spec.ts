import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import { COMPOSER_OPTIONS_WINDOW_MARGIN_PX } from '../src/renderer/src/screens/conversation/composerOptionsPlacement'
import type {
  SendMessagePayload,
  SlashCommandListPayload,
  WireSlashCommand
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the slash-command type-ahead (#940) — AC5, and the whole family's first proof that
// a published command list reaches a pixel. It drives the entire client path on the launchPairedApp
// fixture: pushed frame → Noise → decode (#936) → IPC arm (#937) → bridge → store (#954) → decisions
// (#939) → panel, then does the one thing the unit tiers structurally cannot — type into the box, arrow,
// complete, send and dismiss.
//
// WHY IT HAS TO BE PLAYWRIGHT. vitest runs the `node` environment (vitest.config.ts) — every renderer test
// is a renderToStaticMarkup string assertion with no DOM, no effects and no key handlers.
// ComposerSlashCommandTypeAhead.test.tsx pins the rows' markup, the escaping and the closed state; only a
// real window can prove that typing a slash OPENS the panel, that an arrow moves the highlight, that Enter
// completes WITHOUT sending, that the next Enter sends, and that Escape leaves the draft alone.
//
// THE LIST IS A SERVER PUSH. The daemon publishes the menu unsolicited from its `initialize` reply —
// nothing the client sends provokes it — so it goes out through daemon.pushFrame rather than through
// buildReplyFrames, which only answers outbound envelopes (the tool-row / permission-modal convention).
//
// ONE test() block, ONE launch, ONE continuous drive — the paired-shell-navigation shape: each launch pays
// a full handshake and no step here mutates persistent state.
//
// SECRET HYGIENE (the sibling specs' rule, carried verbatim): every assertion reads DOM text, roles,
// geometry and counts, plus the decoded outbound's `text` — which is a slash command the operator just
// completed, not a secret. The pairing plumbing lives in launchPairedApp and is never echoed.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; short headroom over
// Playwright's 5s default for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed framing — the fakeDaemon convention (no Date.now(), no randomness).
const PUSH_ENVELOPE_ID = 1
const FIXED_TS = '2026-09-02T12:00:00.000Z'

// The panel's client-owned accessible name, ComposerSlashCommandTypeAhead's SLASH_COMMAND_TYPE_AHEAD_LABEL.
// Duplicated as a literal rather than imported, the ~15 `Send` locators' convention: IT IS A LOAD-BEARING
// LOCATOR, and rewording it in the module breaks this spec, which is the point. `exact: true` for
// composer-actions.spec.ts's reason — getByRole matches `name` as a substring by default, and this screen
// carries two other panels under the same role.
const TYPE_AHEAD_LABEL = 'Slash commands'

// The longest description measured across the capture's 51 entries is 1,145 bytes. Reproduced here as one
// unbroken run, the hostile shape — no space to wrap at. Since #934's decision it is a NEGATIVE probe: the
// panel does not render descriptions at all, so a string this size must reach no pixel and no measurement.
const HOSTILE_DESCRIPTION = 'x'.repeat(1145)

// A NAME long enough to exceed the window-relative width bound at the launch width, which is what makes
// step 8's geometry assertion non-vacuous: every real command name here draws well under 200px, so a panel
// of them would sit inside the bound however wrong the bound was. `name` is workspace-authored and the
// daemon bounds it without sanitizing it, so this is a reachable row and not a constructed one.
const HOSTILE_NAME = 'x'.repeat(400)

function command(overrides: Partial<WireSlashCommand> & { name: string }): WireSlashCommand {
  return { argument_hint: '', description: '', aliases: [], truncated_fields: null, ...overrides }
}

// Claude's published order, and every name below is chosen so the drive's three fragments select exactly
// what each step names: `clear` and `compact` share the `/c` prefix so step 3 can narrow between them,
// `model` carries an argument hint (33 of the 51 measured entries carry none, so both shapes are on
// screen), and `memory` carries the hostile description.
//
// THE TEN FILLER ROWS ARE THE CAP'S FIXTURE — 15 rows for a bare `/`, against a panel that shows 10. Their
// names contain no `c`, no `m` and no `x`, so not one of them can match `/c`, `/cl`, `/m` or `/x`: every
// count this spec asserts is decided by the four rows above plus the hostile-name row, and adding filler
// changed none of them.
const FILLER_NAMES = ['one', 'two', 'three', 'four', 'five', 'zero', 'seven', 'eight', 'nine', 'ten']

const COMMANDS: WireSlashCommand[] = [
  command({ name: 'clear', description: 'Clear conversation history and free up context' }),
  command({ name: 'compact', description: 'Clear conversation history but keep a summary in context' }),
  command({
    name: 'model',
    argument_hint: '<model>',
    description: 'Set the AI model for Claude Code'
  }),
  command({ name: 'memory', description: HOSTILE_DESCRIPTION }),
  command({ name: HOSTILE_NAME }),
  ...FILLER_NAMES.map((name) => command({ name }))
]

/** One unsolicited `slash_command_list` frame for the seeded conversation. Sealed via the production
 *  encoder, so the decode this exercises is the shipped one. */
function slashCommandListFrame(): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'slash_command_list',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      commands: COMMANDS,
      dropped_commands: 0
    } satisfies SlashCommandListPayload
  })
}

/**
 * A daemon script that CAPTURES the decoded outbound instead of answering it — composer-actions.spec.ts's
 * helper verbatim, because the proof this ticket needs is a NEGATIVE one: after Enter completes a row,
 * `sent` must still be empty. A bubble-absence assertion alone would pass for a broken echo.
 *
 * A factory rather than a module-level array, so no test can see another's captures.
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

const panelOf = (page: Page): Locator =>
  page.getByRole('menu', { name: TYPE_AHEAD_LABEL, exact: true })

/** The row wearing the highlight — `aria-current`, which this control uses for it because DOM focus never
 *  leaves the message box and the shipped :focus-visible outline therefore never paints. */
const highlightedRow = (panel: Locator): Locator => panel.locator('[aria-current="true"]')

test('typing a slash opens the published menu; Enter completes, a second Enter sends (AC1-AC5)', async ({
  launchPairedApp
}) => {
  const { sent, buildReplyFrames } = captureOutbound()
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })
  const box = page.getByPlaceholder('Message…')
  const panel = panelOf(page)

  // --- 1. Before any frame, a slash opens NOTHING: `null` from the store is a normal, permanent state
  // under best-effort delivery, and a command typed by hand must still behave exactly as it does today. ---
  await box.click()
  await page.keyboard.type('/c')
  await expect(panel).toBeHidden()

  // --- 2. The menu arrives unsolicited. The panel opens on the text ALREADY in the box, with no further
  // keystroke: the rows are a function of the text and the list, not of an event. ---
  daemon.pushFrame(slashCommandListFrame())
  await expect(panel).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // Filtered to the two `/c` rows, in claude's published order (AC1) — and `toHaveText` is EXACT, so it is
  // also the proof that a row is the name and nothing else: both of these commands carry a description in
  // the pushed frame, and neither description is on screen (AC2, #934's decision).
  await expect(panel.getByRole('menuitem')).toHaveText(['/clear', '/compact'])
  // The panel opens ABOVE the message box and against its left edge (AC1). The 12px is the shipped inset
  // .composer-options negates so a row's label lines up; asserted as an inequality, not a literal, so this
  // spec pins the RELATIONSHIP and composerOptionsPlacement.test.ts keeps the number.
  const boxBox = await box.boundingBox()
  const panelBox = await panel.boundingBox()
  if (!boxBox || !panelBox) throw new Error('the composer is not laid out')
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(boxBox.y + 1)
  expect(Math.abs(panelBox.x - boxBox.x)).toBeLessThanOrEqual(16)

  // --- 3. Narrowing (AC1). One more character and only `/clear` survives; the highlight is back on the
  // first row, which is where an edit always puts it. ---
  await page.keyboard.type('l')
  await expect(panel.getByRole('menuitem')).toHaveCount(1)
  await expect(highlightedRow(panel)).toContainText('/clear')

  // --- 4. Back to two rows, then ArrowDown moves the highlight and Enter COMPLETES WITHOUT SENDING
  // (AC3). ---
  await page.keyboard.press('Backspace')
  await expect(panel.getByRole('menuitem')).toHaveCount(2)
  await page.keyboard.press('ArrowDown')
  await expect(highlightedRow(panel)).toContainText('/compact')

  await page.keyboard.press('Enter')
  // The completion is in the box — the canonical name with its leading slash, and no trailing space,
  // because this row's argument hint is empty.
  await expect(box).toHaveValue('/compact')
  // …and the panel closed on the pick rather than re-matching its own completion.
  await expect(panel).toBeHidden()
  // THE NEGATIVE HALF, and the reason this spec captures outbounds at all: nothing was sent. Read after
  // the box assertion above, which is downstream of the same keystroke, so this is not a race with itself.
  expect(sent).toHaveLength(0)
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveCount(0)

  // --- 5. The SECOND Enter sends, through the composer's unchanged path (AC3). ---
  await page.keyboard.press('Enter')
  await expect(page.locator('.bubble[data-thread-role="user"]')).toHaveText('/compact', {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect.poll(() => sent.length, { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  expect(sent[0].text).toBe('/compact')
  await expect(box).toHaveValue('')

  // --- 6. A hostile 1,145-byte description reaches no pixel (AC2). `/m` matches `model` and `memory` (the
  // row carrying it) on their names, and `compact` on the `m` inside it — three rows, and #939's two
  // buckets reaching the panel in order: the prefix matches first, in claude's published order, then the
  // contained one. The exact `toHaveText` is the assertion: the hostile row draws as its bare name. ---
  await page.keyboard.type('/m')
  await expect(panel.getByRole('menuitem')).toHaveText(['/model <model>', '/memory', '/compact'])

  // --- 7. Escape closes and LEAVES THE TYPED TEXT ALONE (AC3) — the draft is the operator's, not the
  // panel's. ---
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(box).toHaveValue('/m')
  // Still nothing sent beyond the one deliberate send in step 5.
  expect(sent).toHaveLength(1)

  // --- 8. THE CAP AND THE BOUND (AC4), against the whole published list. One Backspace leaves a bare `/`,
  // which is an edit — so it re-opens the panel Escape dismissed — and matches every row. ---
  await page.keyboard.press('Backspace')
  await expect(box).toHaveValue('/')
  await expect(panel.getByRole('menuitem')).toHaveCount(COMMANDS.length)

  // The height caps at TEN rows and the rest is reached by scrolling — 10 × the row's 28px, plus the
  // panel's own 2px bands, since a bounding box is the border box. Both halves asserted: a panel that
  // merely stopped at the cap without scrolling would have lost the other five rows, which is the failure
  // this criterion is about. The exact equality is what catches an off-by-one row in either direction, and
  // it caught one — the stylesheet's max-height bounds the CONTENT box, so capping at 284 there left a
  // sliver of the eleventh row on screen.
  const fullBox = await panel.boundingBox()
  if (!fullBox) throw new Error('the type-ahead panel is not laid out')
  expect(Math.round(fullBox.height)).toBe(10 * 28 + 4)
  expect(await panel.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true)

  // And the width stops COMPOSER_OPTIONS_WINDOW_MARGIN_PX clear of the window's right edge. The hostile
  // 400-character name draws far wider than any window, so the panel is at its bound and this pins the
  // bound itself rather than the incidental width of a short list — the assertion is an equality against
  // the measured innerWidth, not a `<=` that a narrow panel would satisfy for free. `composerOptions-
  // MaxWidthPx` keeps the arithmetic; this proves it reaches the panel.
  const viewportWidth = await page.evaluate(() => window.innerWidth)
  expect(Math.round(fullBox.x + fullBox.width)).toBe(viewportWidth - COMPOSER_OPTIONS_WINDOW_MARGIN_PX)
  // Anchored at the message box's left edge throughout: the bound caps the width, it never moves the panel.
  const finalBoxBox = await box.boundingBox()
  if (!finalBoxBox) throw new Error('the composer is not laid out')
  expect(Math.abs(fullBox.x - finalBoxBox.x)).toBeLessThanOrEqual(16)
})
