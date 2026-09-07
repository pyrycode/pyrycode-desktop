import type { Locator, Page } from '@playwright/test'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  SlashCommandListPayload,
  TurnStatePayload,
  WireSlashCommand,
  WireTurnState
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1072 — Escape stops the running turn. It is the ONLY tier that can prove any of
// this: the wiring is two event handlers, vitest runs the `node` environment (every renderer spec is a
// renderToStaticMarkup string assertion with no DOM, no effects and no key handlers), and both handlers
// render no attribute at all. `composerSend.test.ts` owns the DECISION's matrix over plain values; this
// owns the four states the operator actually reaches.
//
// A SEPARATE FILE RATHER THAN LEGS ON queued-backlog-interrupt.spec.ts, which is otherwise the natural
// home — it already drives a running turn on this fixture and counts captured `interrupt` frames. Two
// hazards decided against it: that spec's `interruptFrames(captured)` is a RUNNING TOTAL pinned at
// `.toBe(1)`, which a second interrupt falsifies, and its drive ends with the turn back at `idle`, so
// every leg here would first have to re-arm a `thinking`. One more ~60s launch buys both, and a spec whose
// whole subject is one keystroke reads better alone.
//
// ONE test() block, ONE launch, ONE continuous drive — the sibling convention. LEG ORDER IS LOAD-BEARING:
// each leg's premise is established by the leg before it. In particular the mouse Send in leg 1 (the AC3
// mutation check) is ALSO what leaves focus on the send control for leg 2, which is the real-world path
// AC2 names — clicking Send leaves focus on that control, which then becomes the stop control.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text, values, focus and
// counts, plus captured wire frames by `type`. The interrupt payload is bare `{}`; the drafted texts are
// the operator's own display text and no failure diagnostic serialises a token, key or plaintext. The
// pairing plumbing lives in launchPairedApp and is never echoed.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; short headroom over
// Playwright's 5s default for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes pushes
// by envelope id, so one fixed id is reused across every pushed frame.
const PUSH_ENVELOPE_ID = 1
const FIXED_TS = '2026-09-07T12:00:00.000Z'

// The AC3 mutation: a later, unrelated frame from the same renderer→wire path, sent AFTER the idle Escape.
// Observing it is what makes "no interrupt was sent" a measurement rather than a count that was zero all
// along — the Escape's would-be frame travels the same channel and would have had to arrive first.
const MUTATION_TEXT = 'A message that proves the wire is live'

// The draft leg 3 leaves in the box. It carries NO leading slash, so no leg before 4 can open the
// type-ahead by accident, and it is what the "the draft is unchanged afterwards" assertion reads back.
const DRAFT_TEXT = 'half-written thought'

// The type-ahead fragment leg 4 types, and the one command the pushed list holds. `/c` selects `clear`
// alone, so the panel's open/closed state is unambiguous.
const SLASH_FRAGMENT = '/c'

// The panel's client-owned accessible name, ComposerSlashCommandTypeAhead's SLASH_COMMAND_TYPE_AHEAD_LABEL.
// Duplicated as a literal rather than imported, the ~15 `Send` locators' convention: IT IS A LOAD-BEARING
// LOCATOR, and rewording it in the module breaks this spec, which is the point. `exact: true` because
// getByRole matches `name` as a substring by default and this screen carries other panels under the role.
const TYPE_AHEAD_LABEL = 'Slash commands'

// #307's INTERRUPT_LABEL verbatim — the stop variant's aria-label, and the seam that distinguishes the
// composer's ONE control's two variants in markup.
const INTERRUPT_LABEL = 'Stop the running turn'

/** The coarse turn-phase scalar. `thinking` turns the send button into the stop control; `idle` returns it.
 *  TurnPhase has no literal `running` — do not push that value. */
function turnStateFrame(state: WireTurnState): Uint8Array {
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'turn_state',
    ts: FIXED_TS,
    payload: { conversation_id: SEEDED_ROW.id, state } satisfies TurnStatePayload
  })
}

/** One unsolicited `slash_command_list` for the seeded conversation — the store is keyed per conversation,
 *  and list-open records SEEDED_ROW as active, so any other id lands in the store and opens nothing. */
function slashCommandListFrame(): Uint8Array {
  const clear: WireSlashCommand = {
    name: 'clear',
    argument_hint: '',
    description: '',
    aliases: [],
    truncated_fields: null
  }
  return encodeEnvelope({
    id: PUSH_ENVELOPE_ID,
    type: 'slash_command_list',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      commands: [clear],
      dropped_commands: 0
    } satisfies SlashCommandListPayload
  })
}

/**
 * The spec-local capturing fake (the capturingQueueInterruptFake shape). The fake daemon runs in the TEST
 * process via the loopback forwarder, so a spec-held `captured` array is directly readable from the body.
 * Only list_conversations needs a reply; send_message and interrupt are captured for the send-half proof
 * and need none — nothing here depends on a reply to either.
 */
function capturingEscapeFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      default:
        return []
    }
  }
}

/**
 * A RUNNING TOTAL of captured `interrupt` frames, and every assertion below names the total it expects at
 * that point rather than a bare 1. The interrupt payload is bare `{}` (no ids to match), so this matches by
 * `type` only and never by a payload deep-equal.
 */
function interruptFrames(captured: Envelope[]): number {
  return captured.filter((e) => e.type === 'interrupt').length
}

const panelOf = (page: Page): Locator =>
  page.getByRole('menu', { name: TYPE_AHEAD_LABEL, exact: true })

test('Escape stops the running turn from the message box and from the stop control (AC1-AC4)', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingEscapeFake(captured) })

  const box = page.getByPlaceholder('Message…')
  const sendButton = page.getByRole('button', { name: 'Send' })
  const stopButton = page.getByRole('button', { name: INTERRUPT_LABEL })
  const panel = panelOf(page)

  // --- 1. AC3: Escape at idle sends nothing, and the zero is a MEASUREMENT. ---
  // Launch leaves `phase` idle, so the control is the send variant and no turn is running.
  await expect(sendButton).toBeVisible()
  await expect(stopButton).toHaveCount(0)

  await box.click()
  await page.keyboard.press('Escape')

  // The mutation: a later, unrelated frame down the SAME renderer→wire path, dispatched after the Escape.
  // Polling it to arrival is what gives the Escape's would-be interrupt every chance to land first — a
  // bare count read here would have been zero all along and would pass with the whole feature deleted.
  // The click is also leg 2's premise: it is the mouse-send path, and it leaves focus on this control.
  await box.fill(MUTATION_TEXT)
  await sendButton.click()
  await expect
    .poll(() => captured.filter((e) => e.type === 'send_message').length, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)
  // Only NOW is the zero worth anything.
  expect(interruptFrames(captured)).toBe(0)
  // Escape raised no error and changed nothing on screen: the composer is still there, still idle, and the
  // draft the send cleared is cleared because the send cleared it.
  await expect(sendButton).toBeVisible()
  await expect(box).toHaveValue('')

  // --- 2. AC2: focus on the stop control — the common path, and the one the message box never sees. ---
  // Chromium focused the send button on the click above; nothing in the composer moves focus back. The
  // turn now starts, and that same button BECOMES the stop control: React patches the <button> in place
  // rather than remounting, so the focus survives the flip.
  daemon.pushFrame(turnStateFrame('thinking'))
  await expect(stopButton).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  // THE PREMISE, ASSERTED BEFORE THE KEYSTROKE. Without this line a focus that had silently gone to <body>
  // would make the next Escape a document-level pass for the wrong reason instead of a red.
  await expect(stopButton).toBeFocused()

  await page.keyboard.press('Escape')
  await expect.poll(() => interruptFrames(captured), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  // Non-optimistic: the control retracts only on the daemon's turn_state{idle}, never on the interrupt.
  await expect(stopButton).toBeVisible()

  // --- 3. AC1: caret in the message box, turn still running. One Escape, one bare interrupt frame. ---
  await box.click()
  await page.keyboard.type(DRAFT_TEXT)
  await page.keyboard.press('Escape')
  await expect.poll(() => interruptFrames(captured), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(2)
  // The draft is untouched — Escape stops the turn, it does not clear, submit or blur the box.
  await expect(box).toHaveValue(DRAFT_TEXT)

  // --- 4. AC4: the type-ahead is open over the running turn. One Escape does ONE thing. ---
  daemon.pushFrame(slashCommandListFrame())
  await box.fill(SLASH_FRAGMENT)
  await expect(panel).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })

  // The first Escape belongs to the panel, which already sees the keystroke first and reports that it
  // consumed it. The panel-hidden assertion is a POSITIVE, auto-waiting read downstream of this very
  // keystroke, so the count read after it is not a race with itself.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  expect(interruptFrames(captured)).toBe(2)
  // …and the dismissal left the typed text alone, so the second Escape is pressed in the same box state.
  await expect(box).toHaveValue(SLASH_FRAGMENT)

  // The second meets a closed panel, is not consumed, and reaches the composer's own handler.
  await page.keyboard.press('Escape')
  await expect.poll(() => interruptFrames(captured), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(3)
  await expect(box).toHaveValue(SLASH_FRAGMENT)
})
