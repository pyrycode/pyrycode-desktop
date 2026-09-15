import { test, expect } from './fixtures/launchPairedApp'
import { conversationStateFake } from './fixtures/conversationStateFake'
import { mintChatInWorkspace } from './fixtures/mintChatRow'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  ConversationUpdatedPayload,
  Envelope,
  RequestSystemPromptPayload,
  SetSystemPromptPayload,
  SystemPromptPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for #1477's Channel system prompt field in the Edit channel modal. It runs renderer
// → IPC → main → Noise wire → decode → a spec-local fake composed over conversationStateFake (#434) on
// the launchPairedApp fixture (#433). Zero production code.
//
// WHY PLAYWRIGHT AND NOT VITEST. Every assertion below needs a CLICK or a KEYSTROKE: renderer specs are
// `renderToStaticMarkup` in a `node` env with no DOM, so opening the modal, typing and saving are
// unreachable there. The view's STATES (the reading arm, the seeded arm, the byte bound, the never-
// withheld OK) and the whole write RULE are pure and unit-covered in `EditChannelDialog.test.tsx`; this
// file drives the transitions between them, which is the split this repo's test boundaries prescribe.
//
// WHY THE FAKE WITHHOLDS EVERY REPLY. `request_system_prompt` is REPLY-ONLY and correlated by
// `in_reply_to`, and main resolves each reply's conversation from ITS OWN correlation map — never from a
// field the daemon supplies. So a wrong-conversation reply cannot be forged by editing a payload; it has
// to be a real reply to a real outstanding ask for a DIFFERENT conversation. Withholding every answer and
// delivering them by `pushFrame`, one named ask at a time, is what puts that in the spec's hands.
//
// SECRET HYGIENE (carried from the sibling suites): every assertion reads DOM values and captured wire
// frames only. The prompt literals are non-secret display text; the pairing plumbing (synthetic token,
// fake static key) lives in launchPairedApp and is never echoed. No failure diagnostic serialises a
// token, a key or plaintext.

// In-process loopback round-trips, with headroom for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon / conversationStateFake convention (no Date.now(), no randomness).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// conversationStateFake's default seed: the one PROMOTED row, so it carries the Channels-tree pen that
// opens this modal — and the only one, so `.channel-list__rename` stays unambiguous under Playwright's
// strict mode even after the chat minted below joins the list.
const CHANNEL_ID = 'seed-conversation'
const CHANNEL_NAME = 'Seeded channel'
const CHANNEL_CWD = '/fake/workspace'

// The unnamed, NON-promoted chat `mintChatInWorkspace` creates. It exists for one reason: it becomes the
// open conversation, so its activation ask gives this spec a second conversation whose reply the modal
// must refuse. It draws no pen of its own.
const OTHER_ID = 'created-1'

// What the daemon holds for the channel, and what another conversation holds. The two share no substring,
// so an assertion for one cannot pass on the other.
const STORED_PROMPT = 'Answer only in haiku.'
const OTHER_PROMPT = 'Reply like a ship manifest.'
const TYPED_PROMPT = 'Speak like a pirate. ⚓'

/** One recorded `request_system_prompt`: which conversation it named, and the envelope to answer. */
type Ask = { conversationId: string; envelopeId: number }

/**
 * Compose over the shared conversationStateFake so this spec both captures every decoded inbound frame in
 * wire order — the fake daemon runs in the TEST process via the loopback forwarder, so the arrays are
 * readable straight from the test body — and takes over the two verbs of this vertical, which the shared
 * fake does not know (its default arm returns [], answering neither).
 *
 * `request_system_prompt` is RECORDED AND WITHHELD, per the header. `set_system_prompt` is answered with
 * the daemon's own ack shape: a `conversation_updated` record carrying `in_reply_to`, which is how main
 * resolves the write's conversation. The ack settles the in-flight marker in `systemPromptWriteStore`;
 * this modal never waits on it, but leaving writes stranded would be an unfaithful daemon.
 */
function capturingFake(captured: Envelope[], asks: Ask[]): (inbound: Uint8Array) => Uint8Array[] {
  const stateFake = conversationStateFake()
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    if (env.type === 'request_system_prompt') {
      asks.push({
        conversationId: (env.payload as RequestSystemPromptPayload).conversation_id,
        envelopeId: env.id
      })
      return []
    }
    if (env.type === 'set_system_prompt') {
      return [
        encodeEnvelope({
          id: REPLY_ENVELOPE_ID,
          type: 'conversation_updated',
          ts: FIXED_TS,
          in_reply_to: env.id,
          payload: {
            id: CHANNEL_ID,
            is_promoted: true,
            name: CHANNEL_NAME,
            cwd: CHANNEL_CWD,
            last_used_at: FIXED_TS,
            workspace_label: null
          } satisfies ConversationUpdatedPayload
        })
      ]
    }
    return stateFake(inbound)
  }
}

/** A `system_prompt` reply answering one recorded ask. `undefined` is the wire's absent-prompt state. */
function systemPromptFrame(ask: Ask, prompt: string | undefined): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'system_prompt',
    ts: FIXED_TS,
    in_reply_to: ask.envelopeId,
    payload: {
      system_prompt: prompt,
      session_prompt_status: 'matches'
    } satisfies SystemPromptPayload
  })
}

/** Every `set_system_prompt` payload the fake received, in wire order. */
function writes(captured: Envelope[]): SetSystemPromptPayload[] {
  return captured
    .filter((e) => e.type === 'set_system_prompt')
    .map((e) => e.payload as SetSystemPromptPayload)
}

/** Every conversation-mutating verb the fake received, in wire order — so ORDER and ABSENCE are provable. */
function mutations(captured: Envelope[]): string[] {
  return captured
    .map((e) => e.type)
    .filter((t) => t === 'rename_conversation' || t === 'set_system_prompt')
}

test('the Edit channel modal reads, seeds, writes and clears a channel system prompt', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const asks: Ask[] = []
  const { page, daemon } = await launchPairedApp({ buildReplyFrames: capturingFake(captured, asks) })

  // Mint the second conversation and let it take the open slot. Its activation ask is what gives the
  // wrong-conversation step below a REAL reply for a conversation this modal is not editing.
  await mintChatInWorkspace(page, CHANNEL_CWD)
  await expect.poll(() => asks.some((a) => a.conversationId === OTHER_ID), {
    timeout: ROUNDTRIP_TIMEOUT_MS
  }).toBe(true)

  const dialog = page.getByRole('dialog', { name: 'Edit channel', exact: true })
  const nameField = page.locator('.edit-channel__input')
  const promptField = page.locator('.edit-channel__textarea')
  const ok = dialog.getByRole('button', { name: 'OK', exact: true })
  const pen = page.locator('.channel-list__rename')

  // --- AC1: the ask goes out ON OPEN, naming the row's own id.
  const asksForChannelBefore = asks.filter((a) => a.conversationId === CHANNEL_ID).length
  await pen.click()
  await expect(dialog).toBeVisible()
  await expect
    .poll(() => asks.filter((a) => a.conversationId === CHANNEL_ID).length, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeGreaterThan(asksForChannelBefore)

  // AC1: until the reply arrives the box is not editable and the reading line says so. AC2's headline
  // rides along here: OK is NOT withheld on the read — a dialog whose only exit went dead on open reads
  // as broken, and at this tier the reply only ever arrives because this spec pushes it.
  await expect(promptField).toBeDisabled()
  await expect(page.locator('.edit-channel__reading')).toBeVisible()
  await expect(ok).toBeEnabled()

  // --- AC3: a reply for ANOTHER CONVERSATION seeds nothing. A real reply to a real outstanding ask, so
  // main emits a genuine `systemPromptReceived` naming `created-1` while this modal is open on the
  // channel. Without the renderer's attribution gate the box would seed with the wrong text here — and,
  // because the first matching reply wins, would then IGNORE the right one at the next step.
  const otherAsk = asks.find((a) => a.conversationId === OTHER_ID)
  expect(otherAsk).toBeDefined()
  if (otherAsk !== undefined) daemon.pushFrame(systemPromptFrame(otherAsk, OTHER_PROMPT))
  await expect(promptField).toBeDisabled()
  await expect(promptField).toHaveValue('')

  // --- AC1: the channel's own reply seeds the box VERBATIM and opens it for editing.
  const channelAsk = asks.filter((a) => a.conversationId === CHANNEL_ID).at(-1)
  expect(channelAsk).toBeDefined()
  if (channelAsk !== undefined) daemon.pushFrame(systemPromptFrame(channelAsk, STORED_PROMPT))
  await expect(promptField).toHaveValue(STORED_PROMPT, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(promptField).toBeEnabled()
  await expect(page.locator('.edit-channel__reading')).toHaveCount(0)
  // The wrong reply did not land on the way past, in either direction.
  await expect(promptField).not.toHaveValue(OTHER_PROMPT)

  // --- AC2: an untouched box sends NOTHING, and #1476's rename is untouched by this ticket — an
  // untouched name sends nothing either. Both no-sends proven together, because OK dismissing on a
  // double no-op is exactly the case a gate on the read would have broken.
  await ok.click()
  await expect(dialog).toHaveCount(0)
  expect(mutations(captured)).toEqual([])

  // --- AC2: a REOPEN starts from a FRESH ASK rather than the abandoned draft. The container is mounted
  // per open, so the box is back in its reading arm with nothing in it.
  const asksBeforeReopen = asks.filter((a) => a.conversationId === CHANNEL_ID).length
  await pen.click()
  await expect(promptField).toBeDisabled()
  await expect(promptField).toHaveValue('')
  await expect
    .poll(() => asks.filter((a) => a.conversationId === CHANNEL_ID).length, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeGreaterThan(asksBeforeReopen)

  // --- AC2, the PROMPT-ONLY write: the box differs, the name does not, so exactly one verb goes out and
  // it carries the typed text verbatim.
  const reopened = asks.filter((a) => a.conversationId === CHANNEL_ID).at(-1)
  expect(reopened).toBeDefined()
  if (reopened !== undefined) daemon.pushFrame(systemPromptFrame(reopened, STORED_PROMPT))
  await expect(promptField).toHaveValue(STORED_PROMPT, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await promptField.fill(TYPED_PROMPT)
  await ok.click()
  await expect
    .poll(() => writes(captured), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([{ conversation_id: CHANNEL_ID, system_prompt: TYPED_PROMPT }])
  expect(mutations(captured)).toEqual(['set_system_prompt'])

  // --- AC2, BOTH TOGETHER: a changed name and an emptied box send both verbs off one OK — the rename on
  // its own comparison, the clear as `null`, the third state of the tri-state and the one a truthiness
  // read anywhere on this path would make unreachable.
  await pen.click()
  const third = asks.filter((a) => a.conversationId === CHANNEL_ID).at(-1)
  expect(third).toBeDefined()
  if (third !== undefined) daemon.pushFrame(systemPromptFrame(third, STORED_PROMPT))
  await expect(promptField).toHaveValue(STORED_PROMPT, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await nameField.fill('Renamed channel')
  await promptField.fill('')
  await ok.click()
  await expect
    .poll(() => writes(captured), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([
      { conversation_id: CHANNEL_ID, system_prompt: TYPED_PROMPT },
      { conversation_id: CHANNEL_ID, system_prompt: null }
    ])
  expect(mutations(captured)).toEqual(['set_system_prompt', 'set_system_prompt', 'rename_conversation'])

  // --- AC2's last no-send: a modal whose reading NEVER ARRIVED sends nothing whatever it shows, while
  // the rename beside it still fires on its own comparison. The reply for this open is simply never
  // pushed, which is the relay-withholds-the-frame case the reading gate exists for.
  await pen.click()
  await expect(promptField).toBeDisabled()
  await nameField.fill('Renamed again')
  await ok.click()
  await expect(dialog).toHaveCount(0)
  await expect
    .poll(() => mutations(captured), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toEqual([
      'set_system_prompt',
      'set_system_prompt',
      'rename_conversation',
      'rename_conversation'
    ])
})
