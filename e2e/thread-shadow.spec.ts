import type { Page } from '@playwright/test'
import { test, expect, seedConversationsFrame, SEEDED_ROW } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  AssistantDeltaPayload,
  SendMessagePayload,
  SessionTransitionPayload,
  ToolUsePayload,
  TurnEndPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for THE SHADOW UNDER EVERY ELEMENT OF THE MESSAGE AREA (Figma "Content" 132:4012 /
// "Message area" 132:3959, the 2026-09-05 shadow fix): the user bubble, the assistant bubble, the tool
// row and the session-reset separator each cast the same drop shadow. Only this tier can prove it:
// vitest runs the `node` environment, every renderer spec is a renderToStaticMarkup string with no
// stylesheet, and the markup here is byte-identical before and after (the shadow is CSS on four existing
// rules, no class added at any call site). Nothing in the unit tier can observe a computed `box-shadow`.
//
// ONE launch, FOUR element kinds. The two bubbles come from a real composer send whose scripted reply is
// one closed assistant turn; the tool row and the separator are server pushes a real daemon emits
// unprovoked (`tool_use` mid-turn, `session_transition` on a /clear), so both go out via
// daemon.pushFrame — thread-scroll-pin.spec.ts's builders, copied.
//
// THE VALUE IS DERIVED, NOT COPIED FROM THE STYLESHEET. The numbers below are the Figma effect's own
// (X 0, Y 4, blur 5, spread 0, black at 20%), and the expected strings are built from them in the
// serialisation Chromium uses for a computed shadow (colour first, then the lengths). So a token swapped
// for the FAB's M3 literal reddens here, and so does a blur read off the design's
// `drop-shadow-[… 2.5px …]` export without doubling it.
//
// SECRET HYGIENE (the siblings' posture): every assertion reads a computed style or a count; the prompt
// text, the tool name and the session ids are non-secret display and routing literals. The pairing
// plumbing lives in launchPairedApp and is never echoed.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process; generous headroom for a
// cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes pushes
// by envelope id, so one fixed id is reused across every frame.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

const PROMPT_TEXT = 'cast a shadow'
const REPLY_TEXT = 'a reply that casts one too'

// --- The one effect on every element of "Message area" 132:3959. The bubbles, the separator and the
// grouped tool rows carry it on their wrapper frame, which the export prints as
// `drop-shadow-[0px_4px_2.5px_rgba(0,0,0,0.2)]`; the single tool rows as
// `shadow-[0px_4px_5px_0px_rgba(0,0,0,0.2)]`. Those are ONE effect: a CSS filter's blur is a standard
// deviation and box-shadow's blur radius is twice that, so the export's 2.5 is this 5. ---
const OFFSET_X_PX = 0
const OFFSET_Y_PX = 4
const BLUR_PX = 5
const SPREAD_PX = 0
const SHADOW_COLOUR = 'rgba(0, 0, 0, 0.2)'

// Chromium serialises a computed box-shadow as `<colour> <x> <y> <blur> <spread>`, and a text-shadow the
// same way without the spread, which text-shadow does not have.
const EXPECTED_BOX_SHADOW = `${SHADOW_COLOUR} ${OFFSET_X_PX}px ${OFFSET_Y_PX}px ${BLUR_PX}px ${SPREAD_PX}px`
const EXPECTED_TEXT_SHADOW = `${SHADOW_COLOUR} ${OFFSET_X_PX}px ${OFFSET_Y_PX}px ${BLUR_PX}px`

// --- Spec-local frame builders (the seedConversationsFrame idiom): each seals one envelope through the
// production codec, deterministic id/ts. ---

const assistantDeltaFrame = (): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'assistant_delta',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: 'turn-1',
      seq: 0,
      text: REPLY_TEXT
    } satisfies AssistantDeltaPayload
  })

const turnEndFrame = (): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'turn_end',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: 'turn-1',
      stop_reason: 'end_turn'
    } satisfies TurnEndPayload
  })

/** A pending tool call -> a `toolCall` item, rendered as `.tool-row`. Left pending on purpose: the shadow
 *  sits on the row in both states, and the pending row is the one whose 50% dimming could be mistaken for
 *  the shadow's absence by eye — the computed value is read regardless of opacity. */
const toolUseFrame = (): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'tool_use',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      turn_id: 'turn-tool',
      tool_use_id: 'tool-use-shadow',
      name: 'read_file',
      input_summary: 'src/main/index.ts'
    } satisfies ToolUsePayload
  })

/** A `/clear` boundary -> a `sessionBoundary` item, rendered as `.session-delimiter`. `workspace_cwd` is
 *  literal null for `clear`, per the wire contract; there is no conversation_id on this payload. */
const sessionTransitionFrame = (): Uint8Array =>
  encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_transition',
    ts: FIXED_TS,
    payload: {
      previous_session_id: 'session-shadow-a',
      new_session_id: 'session-shadow-b',
      reason: 'clear',
      occurred_at: FIXED_TS,
      workspace_cwd: null
    } satisfies SessionTransitionPayload
  })

/**
 * `send_message` -> one closed assistant turn; every other inbound (the auto-fired `list_conversations`)
 * -> the shared one-row seed, since a scripted buildReplyFrames overrides the fixture's default arm. The
 * #448 guard, carried from the siblings: the reply goes out only for the OPENED row's id.
 */
const buildReplyFrames = (inbound: Uint8Array): Uint8Array[] => {
  const envelope = decodeEnvelope(inbound)
  switch (envelope.type) {
    case 'send_message': {
      const payload = envelope.payload as SendMessagePayload
      if (payload.conversation_id !== SEEDED_ROW.id) return []
      return [assistantDeltaFrame(), turnEndFrame()]
    }
    default:
      return [seedConversationsFrame()]
  }
}

/** Every match's computed box-shadow, in DOM order, so a count mismatch fails as loudly as a value. */
const boxShadowsOf = (page: Page, selector: string): Promise<string[]> =>
  page.locator(selector).evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow))

const textShadowsOf = (page: Page, selector: string): Promise<string[]> =>
  page.locator(selector).evaluateAll((els) => els.map((el) => getComputedStyle(el).textShadow))

test('every element of the message area casts the design shadow: both bubbles, the tool row and the separator', async ({
  launchPairedApp
}) => {
  const { page, daemon } = await launchPairedApp({ buildReplyFrames })

  const userBubble = '.bubble[data-thread-role="user"]'
  const assistantBubble = '.bubble[data-thread-role="assistant"]'

  // The two bubbles, through a real send: the optimistic user echo and the scripted assistant reply.
  await page.getByPlaceholder('Message…').fill(PROMPT_TEXT)
  await page.getByRole('button', { name: 'Send' }).click()
  await expect(page.locator(userBubble)).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator(assistantBubble)).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // The tool row and the separator, pushed unprovoked as a daemon would.
  daemon.pushFrame(toolUseFrame())
  await expect(page.locator('.tool-row')).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  daemon.pushFrame(sessionTransitionFrame())
  await expect(page.locator('.session-delimiter')).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // --- 1. The bubbles and the tool row are filled boxes, so the shadow is the box's own. ---
  expect(await boxShadowsOf(page, userBubble)).toEqual([EXPECTED_BOX_SHADOW])
  expect(await boxShadowsOf(page, assistantBubble)).toEqual([EXPECTED_BOX_SHADOW])
  expect(await boxShadowsOf(page, '.tool-row')).toEqual([EXPECTED_BOX_SHADOW])

  // --- 2. The separator has no fill. The design puts the effect on the row's frame, and Figma shadows what
  // a fill-less frame paints: the two hairlines and the label. So the row itself draws NO box shadow — one
  // there would paint a rectangle under 16px of empty thread — and each painted part carries the same
  // shadow in its own form: the hairlines as a box shadow (a 1px band's box IS its painted shape), the
  // label as a text shadow, which takes the same lengths minus the spread it has no slot for. ---
  expect(await boxShadowsOf(page, '.session-delimiter')).toEqual(['none'])
  expect(await boxShadowsOf(page, '.session-delimiter__rule')).toEqual([EXPECTED_BOX_SHADOW, EXPECTED_BOX_SHADOW])
  expect(await textShadowsOf(page, '.session-delimiter__title')).toEqual([EXPECTED_TEXT_SHADOW])
})
