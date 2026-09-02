import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
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
// unbroken run, which is the hostile shape: no space to wrap at, so only the stylesheet's max-width plus
// text-overflow can stop it taking the whole line and dragging the panel out of the window.
const HOSTILE_DESCRIPTION = 'x'.repeat(1145)

function command(overrides: Partial<WireSlashCommand> & { name: string }): WireSlashCommand {
  return { argument_hint: '', description: '', aliases: [], truncated_fields: null, ...overrides }
}

// Three ordinary rows plus the hostile one, in claude's published order — `clear` and `compact` share the
// `/c` prefix so the drive can narrow between them, and `model` carries an argument hint (33 of the 51
// measured entries carry none, so both shapes are on screen).
const COMMANDS: WireSlashCommand[] = [
  command({ name: 'clear', description: 'Clear conversation history and free up context' }),
  command({ name: 'compact', description: 'Clear conversation history but keep a summary in context' }),
  command({
    name: 'model',
    argument_hint: '<model>',
    description: 'Set the AI model for Claude Code'
  }),
  command({ name: 'memory', description: HOSTILE_DESCRIPTION })
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

  // Filtered to the two `/c` rows, in claude's published order, each carrying its description (AC2).
  await expect(panel.getByRole('menuitem')).toHaveText([
    '/clearClear conversation history and free up context',
    '/compactClear conversation history but keep a summary in context'
  ])
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

  // --- 6. A hostile 1,145-byte description cannot push the panel out of the window (AC2, AC4). `/m`
  // matches `model` and `memory` (the hostile row) on their names, and `compact` on the `m` inside it —
  // three rows, and #939's two buckets reaching the panel in order: the prefix matches first, in claude's
  // published order, then the contained one. ---
  await page.keyboard.type('/m')
  await expect(panel.getByRole('menuitem')).toHaveCount(3)
  await expect(panel.getByRole('menuitem').first()).toHaveText(
    '/model <model>Set the AI model for Claude Code'
  )
  await expect(panel.getByRole('menuitem').last()).toContainText('/compact')
  const [wideBox, viewportWidth] = await Promise.all([
    panel.boundingBox(),
    page.evaluate(() => window.innerWidth)
  ])
  if (!wideBox) throw new Error('the type-ahead panel is not laid out')
  expect(wideBox.x).toBeGreaterThanOrEqual(0)
  expect(wideBox.x + wideBox.width).toBeLessThanOrEqual(viewportWidth)

  // --- 7. Escape closes and LEAVES THE TYPED TEXT ALONE (AC3) — the draft is the operator's, not the
  // panel's. ---
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(box).toHaveValue('/m')
  // Still nothing sent beyond the one deliberate send in step 5.
  expect(sent).toHaveLength(1)
})
