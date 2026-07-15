import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  DebugBundleChunkPayload,
  Envelope,
  ScreenSnapshotPayload,
  StallPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the three reliability affordances an operator reaches for when a session
// misbehaves — the STALL indicator (#315 transport / #317 render), the "Show daemon screen" SNAPSHOT
// (#316/#180 transport, #323 store, #324 action+display), and the DEBUG-BUNDLE download (#116 reassemble,
// #169 orchestrator, #72 render) — none of it covered today (#428, sibling of #425/#426/#427). All three
// already ship end-to-end, so this is coverage-only: it drives them through renderer → IPC → main → Noise
// wire → decode on the launchPairedApp fixture (#433) and asserts the rendered result. Zero production code.
//
// They are covered together because each exercises a DISTINCT daemon-interaction shape:
//   • Stall          — a pure SERVER PUSH (daemon.pushFrame), no client request.
//   • Screen snapshot — a REQUEST → REPLY (client request_snapshot → daemon screen_snapshot).
//   • Debug bundle    — a CHUNKED REPLY STREAM (client request_debug_bundle → debug_bundle_chunk* → progress).
//
// ONE test() block, ONE launch (the #425/#427 precedent, NOT #423/#426's two-block split): none of the
// three carries one-way-per-launch state — stall self-clears / persists harmlessly, the screen-snapshot
// store is most-recent-wins, the download is re-settable — so a single continuous drive covers every AC
// without tripling the ~60s real-handshake launch cost.
//
// TWO corrected stale premises (carried from the refined spec, same corrections as #426/#427):
//   1. STALL IS A PUSH, not a reply arm. It is delivered via daemon.pushFrame(stallFrame) — an
//      unsolicited server frame — never bundled onto the reply frames of an inbound the app just sent.
//   2. THERE IS NO SAVE-DIALOG. The save path (#117) writes deterministically to app.getPath('downloads')
//      with no dialog to stub, and the fixture isolates --user-data-dir but NOT ~/Downloads. So scripting
//      debug_bundle_done (→ a real archive on disk) is deliberately OUT OF SCOPE: the hermetic assertion
//      floor is the streamed-chunks PROGRESS caption. The "Saved to <path>" tail is the noted residual.
//
// THE SNAPSHOT OVERWRITE TRAP. The screen-snapshot store is global most-recent-wins, and opening the
// Run-config sheet fires RunConfigData's OWN request_snapshot on mount. Defused two ways together: the
// factory answers EVERY request_snapshot with the SAME SNAPSHOT, and the <pre> is asserted BEFORE the
// sheet opens.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text / attributes / class
// locators and captured wire frames only. SEEDED_ROW.id, the snapshot text, and the chunk seq are
// non-secret display/routing literals; the pairing plumbing (synthetic token, fake static key) lives in
// launchPairedApp and is never echoed. No failure diagnostic serialises a token, key, or plaintext.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process, so a short headroom over
// Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// replies by envelope id, so one fixed REPLY_ENVELOPE_ID is reused across every reply (chunks correlate by
// seq, not id).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The screen the daemon answers request_snapshot with. UNLIKE the run-config baseline's `text: ''`, this
// `text` IS surfaced into the <pre> via the #316/#323 screenSnapshotReceived path — a distinctive,
// non-secret single-token literal is the most robust toContainText target. All 8 payload fields present;
// conversation_id / ts / model / effort / yolo / used_tokens / window_tokens are documentary.
const SNAPSHOT: ScreenSnapshotPayload = {
  conversation_id: SEEDED_ROW.id,
  text: 'DAEMON SCREEN 428',
  ts: FIXED_TS,
  model: 'opus',
  effort: 'low',
  yolo: false,
  used_tokens: 50_000,
  window_tokens: 200_000
}

// The number of debug_bundle_chunk frames streamed back. `n >= 2` gives the plural caption; 3 is the clean
// "more than one" default. `debugBundleProgress` fires per accepted chunk, so the caption climbs 0 → 3.
const CHUNK_COUNT = 3

// The client-owned copy each surface renders — asserted verbatim (both use the U+2026 ellipsis, matching
// the source constants). Never daemon strings: the stall frame carries no daemon content, and the progress
// caption is derived client-side from the running chunk count.
const STALL_COPY = 'The turn seems to have stalled…'
const PROGRESS_CAPTION = `Downloading… ${CHUNK_COUNT} chunks received`

// Spec-local frame builders (the conversationsFrame idiom): each seals one reply envelope via the
// production codec, deterministic id/ts.

// The stall onset — a SERVER PUSH (daemon.pushFrame), not a reply arm. conversation_id is set to
// SEEDED_ROW.id for realism; the decoder drops it (→ nullary stallDetected), so it does not gate rendering.
function stallFrame(conversationId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'stall',
    ts: FIXED_TS,
    payload: { conversation_id: conversationId } satisfies StallPayload
  })
}

// The screen snapshot — answers every request_snapshot. NO in_reply_to: the screenSnapshotReceived path
// emits unconditionally on decode (#316), so no correlation is needed.
function screenSnapshotFrame(base: ScreenSnapshotPayload): Uint8Array {
  return encodeEnvelope({ id: REPLY_ENVELOPE_ID, type: 'screen_snapshot', ts: FIXED_TS, payload: base })
}

// The chunk stream — `count` contiguous 0-based debug_bundle_chunk frames, NO trailing debug_bundle_done
// (progress is independent of completion, so the streamed chunks alone drive the caption; a done frame
// would drive a real save into ~/Downloads — out of scope). `data` is arbitrary std-base64, decoded but
// never inspected by the reassembler nor asserted here.
function debugBundleChunkFrames(count: number): Uint8Array[] {
  const frames: Uint8Array[] = []
  for (let seq = 0; seq < count; seq += 1) {
    frames.push(
      encodeEnvelope({
        id: REPLY_ENVELOPE_ID,
        type: 'debug_bundle_chunk',
        ts: FIXED_TS,
        payload: { seq, data: Buffer.from([seq, seq]).toString('base64') } satisfies DebugBundleChunkPayload
      })
    )
  }
  return frames
}

/**
 * The spec-local capturing reply factory (the run-config-settings capturingRunConfigFake shape). The fake
 * daemon runs in the TEST process (via the loopback forwarder), so a spec-held `captured` array written
 * here is directly readable from the test body. Per inbound verb: reuse seedConversationsFrame() so the
 * launch row renders (a scripted buildReplyFrames overrides the fixture default, so this arm owns seeding);
 * answer every request_snapshot with the SAME SNAPSHOT (defeats the overwrite trap); stream the chunk
 * frames for a request_debug_bundle. Every other inbound no-ops ([]) — harmless. Discrimination is
 * stateless (verb-based, no counter). The stall push is NOT here — it is a daemon.pushFrame in the body.
 */
function capturingReliabilityFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      case 'request_snapshot':
        return [screenSnapshotFrame(SNAPSHOT)]
      case 'request_debug_bundle':
        return debugBundleChunkFrames(CHUNK_COUNT)
      default:
        return []
    }
  }
}

// Count captured request_snapshot frames targeting the active conversation — the send-half proof that the
// "Show daemon screen" click put the outbound { conversation_id: SEEDED_ROW.id } on the wire.
function capturedSnapshotRequests(captured: Envelope[]): number {
  return captured.filter(
    (e) => e.type === 'request_snapshot' && isDeepStrictEqual(e.payload, { conversation_id: SEEDED_ROW.id })
  ).length
}

// Count captured request_debug_bundle frames — the send-half proof for the download. request_debug_bundle
// is a BARE control frame: the builder emits a present-empty `{}` payload (decodeEnvelope requires a
// present payload), so the match is against `{}`.
function capturedBundleRequests(captured: Envelope[]): number {
  return captured.filter((e) => e.type === 'request_debug_bundle' && isDeepStrictEqual(e.payload, {})).length
}

test('reliability affordances: stall push, screen snapshot, debug-bundle download', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingReliabilityFake(captured)
  })

  // AC1 — STALL (server push). Push an unsolicited `stall` onto the live session; the transport decodes it
  // to the nullary stallDetected event and the reducer flips `stalled` true → StallIndicator renders. Main
  // thread (no sheet). Nothing in this spec emits timeline turn-activity, and screen_snapshot /
  // debug_bundle_* are not timeline events, so the indicator persists through the later steps.
  daemon.pushFrame(stallFrame(SEEDED_ROW.id))
  await expect(page.locator('.conversation__stall')).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(page.locator('.bubble--stall')).toContainText(STALL_COPY)

  // AC2 — SCREEN SNAPSHOT (request → reply). Click "Show daemon screen" (gated on the same connection read
  // the composer's send-gate uses — connected at launch). The captured request_snapshot proves the outbound
  // { conversation_id: SEEDED_ROW.id } landed; then the reply's `text` renders into the <pre>. Assert BOTH
  // BEFORE opening the sheet (the overwrite trap: RunConfigData fires its own request_snapshot on mount).
  await page.locator('.screen-snapshot__request').click()
  await expect
    .poll(() => capturedSnapshotRequests(captured), { timeout: ROUNDTRIP_TIMEOUT_MS })
    .toBeGreaterThanOrEqual(1)
  await expect(page.locator('.screen-snapshot__screen')).toContainText(SNAPSHOT.text, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })

  // AC3 — DEBUG-BUNDLE download (chunked reply stream). Open the Run-configuration sheet (the "Download"
  // button lives inside it), click it, and let the CHUNK_COUNT chunk frames round-trip. The captured bare
  // request_debug_bundle proves the send; the role="status" caption reads "Downloading… N chunks received"
  // after the streamed chunks drive debugBundleProgress per chunk (no debug_bundle_done needed — the save
  // tail is the out-of-scope residual). Asserting the substring with the FINAL count waits past the
  // transient 0/1/2 captions.
  await page.getByRole('button', { name: 'Run configuration' }).click()
  await page.locator('.log-data__download').click()
  await expect.poll(() => capturedBundleRequests(captured), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  const status = page.locator('.log-data__status')
  await expect(status).toContainText(PROGRESS_CAPTION, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(status).toHaveAttribute('role', 'status')
})
