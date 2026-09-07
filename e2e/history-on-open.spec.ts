import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { Envelope } from '../src/shared/wire/types'
import type {
  HistoryPagePayload,
  MessagePayload,
  RequestHistoryPayload
} from '../src/shared/wire/types'

// #1259 — a conversation opens, asks the daemon for its newest page of history, and DRAWS it, with the
// operator sending nothing. The decision itself (ask / don't ask / settled) is a pure function of the
// conversation's held reading and is unit-tested in `historyPageBridge.test.ts`; what only this tier can
// show is that the ask actually fires from the real activation path in the built app and that the served
// entries reach the thread as rows. `vitest.config.ts` is `environment: 'node'` and every renderer spec
// is a static render with no DOM and nothing to click, so a row click is unreachable there by design.
//
// WHAT MAKES THE FIRST ASSERTION NON-VACUOUS: the text below reaches the window on NO other path. The
// fake answers `send_message` with nothing and this spec never sends one, so there is no optimistic
// echo; it pushes no unsolicited frame; and the seed row carries only a `name` and a `cwd`. A thread
// that draws `REPLAYED_TEXT` drew it from the `history_page` this fake served, or from nowhere.
//
// AC2 IS ASSERTED WITH A BARRIER, NOT A SLEEP. "The second opening does not ask again" is an absence,
// and an absence asserted straight after a click passes before the click's own work has resolved. The
// positive, auto-waiting read ordered in front of it is the `request_session_settings` count: that verb
// DOES fire on every activation (#1166), so it going from one to two is proof the second activation ran
// to the point where a second `request_history` would have been sent. Only then is the history count
// read back — and it is read as an equality, so a duplicate ask fails it rather than being absorbed.
//
// SECRET HYGIENE: the pairing payload is the fixture's business and is never touched here. Every
// assertion reads DOM text or a count of decoded envelope TYPES; no cursor and no payload value is
// interpolated into an assertion message or a test title.

const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

/** The stored operator message the daemon replays. Shares no substring with the seed row's name, so a
 *  locator for it cannot match the sidebar. */
const REPLAYED_TEXT = 'what did we decide about the relay budget'

/** The opaque position the daemon hands back. Asserted NOWHERE — it is stored by the window and read by
 *  nothing until #1260's walk — and present only so the served page is well-formed. */
const NEXT_CURSOR = 'opaque-cursor-value'

/** The operator's own stored message: type `message`, NOT `send_message`. The daemon's third history
 *  producer appends `protocol.TypeMessage` carrying a `MessagePayload`, and `message` is the string the
 *  client's decode matches on. */
function storedMessageEntry(): HistoryPagePayload['entries'][number] {
  return {
    id: 1,
    type: 'message',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      message_id: 'stored-m1',
      role: 'user',
      text: REPLAYED_TEXT
      // A fresh object literal, so it carries an implicit index signature and lands in the entry's
      // opaque `Record<string, unknown>` payload slot without a cast — `satisfies` still holds it to the
      // wire shape field for field.
    } satisfies MessagePayload
  }
}

/** One served page, correlated by `in_reply_to`. It NAMES NO CONVERSATION — `history_page` carries no
 *  `conversation_id`, deliberately, and the window is handed the id it asked with instead. */
function historyPageFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'history_page',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {
      entries: [storedMessageEntry()],
      cursor: NEXT_CURSOR,
      at_start: false
    } satisfies HistoryPagePayload
  })
}

/** The capturing reply factory — value-based discrimination, so the closure stays stateless. */
function capturingFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      case 'request_history':
        return [historyPageFrame(env.id)]
      default:
        return []
    }
  }
}

const historyAsks = (captured: Envelope[]): Envelope[] =>
  captured.filter((e) => e.type === 'request_history')

const ROUNDTRIP_TIMEOUT_MS = 15_000

test('a conversation opens holding its history, and asks for it exactly once (#1259)', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page } = await launchPairedApp({ buildReplyFrames: capturingFake(captured) })

  const userBubble = page.locator('.bubble[data-thread-role="user"]')

  // --- AC1. The fixture's launch clicks the seeded row; nothing else has happened. The replayed
  // message is in the thread because the app asked for it on open and drew the answer. ---
  await expect(userBubble).toHaveCount(1, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(userBubble).toContainText(REPLAYED_TEXT)

  // The ask this client built, read back off the wire: the conversation it opened, the OPENING cursor
  // (empty is the published start position of a walk, not a missing value), and the "you choose" limit.
  expect(historyAsks(captured)).toHaveLength(1)
  expect(historyAsks(captured)[0].payload).toEqual({
    conversation_id: SEEDED_ROW.id,
    cursor: '',
    limit: 0
  } satisfies RequestHistoryPayload)

  // --- AC2. Re-open the conversation that is already open. `requestConversationConfig` fires on every
  // activation, so the run-config ask goes out again — that is the barrier proving this click was
  // processed — while the history ask does not, and the drawn rows are not duplicated. ---
  const configAsksBefore = captured.filter((e) => e.type === 'request_session_settings').length
  await page.locator('.channel-list__row-open').click()
  await expect
    .poll(() => captured.filter((e) => e.type === 'request_session_settings').length, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeGreaterThan(configAsksBefore)

  expect(historyAsks(captured)).toHaveLength(1)
  await expect(userBubble).toHaveCount(1)
})
