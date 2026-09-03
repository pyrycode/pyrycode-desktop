import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type { DebugBundleChunkPayload, Envelope, StallPayload } from '../src/shared/wire/types'

// Fake-stack UI e2e for the two reliability affordances an operator reaches for when a session
// misbehaves — the STALL indicator (#315 transport / #317 render) and the DEBUG-BUNDLE download
// (#116 reassemble, #169 orchestrator, #72 render) — none of it covered today (#428, sibling of
// #425/#426/#427). Both already ship end-to-end, so this is coverage-only: it drives them through
// renderer → IPC → main → Noise wire → decode on the launchPairedApp fixture (#433) and asserts the
// rendered result. Zero production code.
//
// They are covered together because each exercises a DISTINCT daemon-interaction shape:
//   • Stall        — a pure SERVER PUSH (daemon.pushFrame), no client request.
//   • Debug bundle — a CHUNKED REPLY STREAM (client request_debug_bundle → debug_bundle_chunk* → progress).
//
// ONE test() block, ONE launch (the #425/#427 precedent, NOT #423/#426's two-block split): neither
// carries one-way-per-launch state — stall self-clears / persists harmlessly, the download is
// re-settable — so a single continuous drive covers every AC without doubling the ~60s real-handshake
// launch cost.
//
// TWO corrected stale premises (carried from the refined spec, same corrections as #426/#427):
//   1. STALL IS A PUSH, not a reply arm. It is delivered via daemon.pushFrame(stallFrame) — an
//      unsolicited server frame — never bundled onto the reply frames of an inbound the app just sent.
//   2. THERE IS NO SAVE-DIALOG. The save path (#117) writes deterministically to app.getPath('downloads')
//      with no dialog to stub, and the fixture isolates --user-data-dir but NOT ~/Downloads. So scripting
//      debug_bundle_done (→ a real archive on disk) is deliberately OUT OF SCOPE: the hermetic assertion
//      floor is the streamed-chunks PROGRESS caption. The "Saved to <path>" tail is the noted residual.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM text / attributes / class
// locators and captured wire frames only. SEEDED_ROW.id and the chunk seq are non-secret display/routing
// literals; the pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is never
// echoed. No failure diagnostic serialises a token, key, or plaintext.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process, so a short headroom over
// Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// replies by envelope id, so one fixed REPLY_ENVELOPE_ID is reused across every reply (chunks correlate by
// seq, not id).
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

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
// SEEDED_ROW.id for realism; the timeline bridge drops it (#732), so it does not gate rendering.
function stallFrame(conversationId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'stall',
    ts: FIXED_TS,
    payload: { conversation_id: conversationId } satisfies StallPayload
  })
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
 * stream the chunk frames for a request_debug_bundle. Every other inbound no-ops ([]) — harmless.
 * Discrimination is stateless (verb-based, no counter). The stall push is NOT here — it is a
 * daemon.pushFrame in the body.
 */
function capturingReliabilityFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      case 'request_debug_bundle':
        return debugBundleChunkFrames(CHUNK_COUNT)
      default:
        return []
    }
  }
}

// Count captured request_debug_bundle frames — the send-half proof for the download. request_debug_bundle
// is a BARE control frame: the builder emits a present-empty `{}` payload (decodeEnvelope requires a
// present payload), so the match is against `{}`.
function capturedBundleRequests(captured: Envelope[]): number {
  return captured.filter((e) => e.type === 'request_debug_bundle' && isDeepStrictEqual(e.payload, {})).length
}

test('reliability affordances: stall push, debug-bundle download', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingReliabilityFake(captured)
  })

  // AC1 — STALL (server push). Push an unsolicited `stall` onto the live session; the transport decodes
  // it to a stallDetected event, the reducer flips `stalled` true → the composer status row's label reads
  // the stall copy. Main thread (no sheet). Nothing in this spec emits timeline turn-activity, and
  // debug_bundle_* are not timeline events, so the status persists through the later step.
  //
  // #967 re-pointed this off `.conversation__stall` / `.bubble--stall`: the stall no longer has a bubble
  // of its own in the message region, it is one of the four states the row's single label carries.
  // EXACT text, not a substring — the row's label element is shared by all four states now, so
  // `toBeVisible` on it would pass on a row showing "Thinking…" and prove nothing. The launch is idle
  // with no folded status live, so nothing else can be occupying the slot when this resolves.
  daemon.pushFrame(stallFrame(SEEDED_ROW.id))
  const statusLabel = page.locator('.conversation__thinking')
  await expect(statusLabel).toHaveText(STALL_COPY, { timeout: ROUNDTRIP_TIMEOUT_MS })
  // The stall keeps reading as a problem: it is the one state that takes the error-colour modifier.
  await expect(statusLabel).toHaveClass(/composer-status__label--stalled/)

  // AC2 — DEBUG-BUNDLE download (chunked reply stream). Open the Run-configuration sheet from the thread
  // overflow menu (the "Download" button lives inside it), click it, and let the CHUNK_COUNT chunk frames
  // round-trip. The captured bare
  // request_debug_bundle proves the send; the role="status" caption reads "Downloading… N chunks received"
  // after the streamed chunks drive debugBundleProgress per chunk (no debug_bundle_done needed — the save
  // tail is the out-of-scope residual). Asserting the substring with the FINAL count waits past the
  // transient 0/1/2 captions.
  // #962 retired the collapsed status row, so the sheet opens from the thread's overflow menu now.
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Run configuration' }).click()
  await page.locator('.log-data__download').click()
  await expect.poll(() => capturedBundleRequests(captured), { timeout: ROUNDTRIP_TIMEOUT_MS }).toBe(1)
  const status = page.locator('.log-data__status')
  await expect(status).toContainText(PROGRESS_CAPTION, { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(status).toHaveAttribute('role', 'status')
})
