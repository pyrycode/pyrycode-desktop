import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ConversationSummary,
  ConversationUpdatedPayload,
  Envelope,
  SetSystemPromptPayload,
  SystemPromptPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1078's System prompt section — the first drive of the whole
// `request_system_prompt` / `set_system_prompt` vertical (#1230/#1231/#1249/#1250 built the data path and
// nothing rendered it). It runs renderer → IPC → main → Noise wire → decode → a spec-local fake composed
// over conversationStateFake (#434) on the launchPairedApp fixture (#433). Zero production code.
//
// WHY PLAYWRIGHT AND NOT VITEST. Every assertion below needs a CLICK or a KEYSTROKE: renderer specs are
// `renderToStaticMarkup` in a `node` env with no DOM, so typing, saving and clearing are unreachable
// there. The section's STATES (loading, the tri-state seed, the byte bound, the four refusals, the
// differs notice) are pure and unit-covered in SystemPromptSection.test.tsx; this file drives the
// transitions between them, which is the split the ticket's technical notes prescribe.
//
// SECRET HYGIENE (carried from the sibling suites): every assertion reads DOM text/values and captured
// wire frames only. SEED / SEEDED_PROMPT / TYPED_PROMPT are non-secret display literals; the pairing
// plumbing (synthetic token, fake static key) lives in launchPairedApp and is never echoed. No failure
// diagnostic serialises a token, a key or plaintext.

// In-process loopback round-trips, with headroom for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon / conversationStateFake convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// Exactly ONE clickable seed, so launchPairedApp's strict `.channel-list__row-open` click reaches its
// thread; post-#448 that row-open also records the clicked row as the ACTIVE conversation, which is what
// gives the Channel Info sheet a non-null conversation and therefore a System prompt section at all.
const SEED: ConversationSummary = {
  id: 'prompt-conversation',
  name: 'Prompt discussion',
  is_promoted: false,
  is_archived: false,
  cwd: '/fake/workspace',
  last_message_ts: FIXED_TS,
  last_used_at: FIXED_TS
}

// What the daemon holds. 21 ASCII bytes.
const SEEDED_PROMPT = 'Answer only in haiku.'

// What the operator types. 21 ASCII bytes + one 3-byte U+2693, so its UTF-8 length (24) DIVERGES from its
// code-unit length (22) — the divergence is the point: a `.length` count would render 22 here and the
// section would report "under" on a value main refuses at the true bound (AC3).
const TYPED_PROMPT = 'Speak like a pirate. ⚓'
const TYPED_PROMPT_BYTES = 24

/**
 * Compose over the shared conversationStateFake so this spec both (a) captures every decoded inbound
 * frame in wire order into a spec-owned array — the fake daemon runs in the TEST process via the loopback
 * forwarder, so the array is readable straight from the test body — and (b) answers the two verbs of this
 * vertical, which the shared fake does not know (its `default` arm returns [], sending nothing).
 *
 * `request_system_prompt` is answered with the seeded reading. That reply is REPLY-ONLY and correlated by
 * `in_reply_to`: without it the section would sit in its not-loaded arm forever, offering no save — the
 * correct behaviour, and therefore an undrivable one.
 *
 * `set_system_prompt` is answered with the daemon's own ack shape: a `conversation_updated` record
 * carrying `in_reply_to` (main resolves the write's conversation from that id, never from the record's
 * own `id`). Without the ack the first save would stay in flight and BOTH controls would stay withheld,
 * so the clear step below could never run — the in-flight gate is the section's #1250 two-writes guard
 * and it is doing its job, which is exactly why the fake has to settle the write.
 */
function capturingSystemPromptFake(
  seed: ConversationSummary,
  captured: Envelope[]
): (inbound: Uint8Array) => Uint8Array[] {
  const stateFake = conversationStateFake({ conversations: [seed] })
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    if (env.type === 'request_system_prompt') {
      return [
        encodeEnvelope({
          id: REPLY_ENVELOPE_ID,
          type: 'system_prompt',
          ts: FIXED_TS,
          in_reply_to: env.id,
          // `differs` so AC4's notice is driven live: the running session was started with something
          // else, and New session is what applies the stored value.
          payload: {
            system_prompt: SEEDED_PROMPT,
            session_prompt_status: 'differs'
          } satisfies SystemPromptPayload
        })
      ]
    }
    if (env.type === 'set_system_prompt') {
      return [
        encodeEnvelope({
          id: REPLY_ENVELOPE_ID,
          type: 'conversation_updated',
          ts: FIXED_TS,
          in_reply_to: env.id,
          payload: {
            id: seed.id,
            is_promoted: seed.is_promoted,
            name: seed.name,
            cwd: seed.cwd,
            last_used_at: seed.last_used_at
          } satisfies ConversationUpdatedPayload
        })
      ]
    }
    return stateFake(inbound)
  }
}

/** Every `set_system_prompt` payload the fake received, in wire order. */
function writes(captured: Envelope[]): SetSystemPromptPayload[] {
  return captured
    .filter((e) => e.type === 'set_system_prompt')
    .map((e) => e.payload as SetSystemPromptPayload)
}

test('the section reads, edits, saves and clears a channel system prompt', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page } = await launchPairedApp({
    buildReplyFrames: capturingSystemPromptFake(SEED, captured)
  })

  // The ask fires on ACTIVATION (PairedShell's requestConversationConfig), not on sheet open, so the
  // reading has already landed by the time the sheet mounts. Assert the frame went out: the section's
  // not-loaded arm is indistinguishable from a section that simply never asked, and this pins which.
  await expect
    .poll(() => captured.some((e) => e.type === 'request_system_prompt'), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(true)

  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Channel info' }).click()

  // AC1: the stored prompt is what the editor shows — not a placeholder, not an empty box.
  const editor = page.locator('.system-prompt__input')
  await expect(editor).toHaveValue(SEEDED_PROMPT, { timeout: ROUNDTRIP_TIMEOUT_MS })

  // AC4: `differs` says the running session was started with something else and names New session.
  await expect(page.locator('.system-prompt__session')).toContainText('New session')

  // AC3: the count is live and counts UTF-8 BYTES. 24 for a 22-code-unit string.
  await editor.fill(TYPED_PROMPT)
  await expect(page.locator('.system-prompt__count')).toHaveText(`${TYPED_PROMPT_BYTES} / 8192 bytes`)

  // AC2, first half: Save sends the typed text through submitSystemPrompt, VERBATIM.
  await page.locator('.system-prompt__save').click()
  await expect
    .poll(() => writes(captured), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([{ conversation_id: SEED.id, system_prompt: TYPED_PROMPT }])

  // The ack settled the write: the outcome line reports it and both controls came back. Waiting on the
  // ENABLED state (not a bare timeout) is also the sync point the clear step needs — a click on a
  // disabled control is dropped, which would leave the closing assertion below waiting on nothing.
  await expect(page.locator('.system-prompt__write')).toContainText('Saved')
  const clear = page.locator('.system-prompt__clear')
  await expect(clear).toBeEnabled()

  // AC2, second half: Clear sends `null` — the third state of the tri-state, and the one a truthiness
  // read anywhere on this path would make unreachable. A SECOND write, distinct from the first in the
  // one field that matters, so this cannot pass on the frame the save already produced.
  await clear.click()
  await expect
    .poll(() => writes(captured), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([
      { conversation_id: SEED.id, system_prompt: TYPED_PROMPT },
      { conversation_id: SEED.id, system_prompt: null }
    ])

  // The cleared box is empty, and it stayed an EDITOR rather than reverting to the daemon's seed — the
  // clear is a display effect over the draft, not an optimistic stored value (#1250's rule).
  await expect(editor).toHaveValue('')
})
