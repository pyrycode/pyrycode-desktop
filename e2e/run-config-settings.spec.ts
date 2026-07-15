import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  ScreenSnapshotPayload,
  SessionSettingsUpdatedPayload,
  SessionTransitionPayload,
  SetSessionSettingsPayload
} from '../src/shared/wire/types'

// Fake-stack UI e2e for the RUN-CONFIG SHEET's `set_session_settings` write family (#425, split from
// #421): model / effort / YOLO, none of it covered today. It drives the already-shipped interactive
// controls (#257 made #188's read-only markup live) end-to-end through renderer → IPC → main → Noise
// wire → decode → the spec-local capturing reply factory on the launchPairedApp fixture (#433). Zero
// production code.
//
// ONE test() block, ONE launch (unlike #423's two) — the sheet stays open, all three controls are
// independently operable, and the session persists, so a single continuous drive covers every AC.
//
// TWO setup preconditions launchPairedApp does NOT provide (the load-bearing traps the parent omitted):
//   1. SESSION ID — the operability gate. RunConfigSections builds each control's onChange ONLY when
//      sessionIdStore is non-null; otherwise the controls render #188's inert read-only markup and
//      clicks are no-ops. sessionIdStore is fed by an UNSOLICITED session_transition marker, which
//      launchPairedApp never sends — so the spec pushes one via daemon.pushFrame after launch.
//   2. SNAPSHOT BASELINE — on sheet open RunConfigData fires one request_snapshot for the active
//      conversation (the seeded row landed on at launch); the factory answers it with a seeded
//      screen_snapshot so the baseline (and the value a reject reverts toward) is crisp.
//
// WHY THE CAPTURED OUTBOUND FRAME IS THE LOAD-BEARING PROOF. The view renders NO pending/disabled state
// (it consumes selectEffectiveSettings + selectError only), so a resolved confirm is DOM-indistinguishable
// from a still-pending optimistic overlay — asserting the displayed value alone does not prove the reply
// landed. The send half (AC2's "exactly one … only the changed field") is therefore proven from the
// captured outbound set_session_settings payload (#423/#456 precedent). The REJECT is the one visually
// distinct outcome (the control reverts + a role="alert" line appears), so it carries its own DOM assertion.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM attributes / text / counts
// and captured wire frames only; SESSION_ID / the model-family tokens / effort levels are non-secret routing
// & display literals; the pairing plumbing (synthetic token, fake static key) lives in launchPairedApp and is
// never echoed. No failure diagnostic serialises a token, key, or plaintext; the snapshot `text` is '' and
// never surfaced (#180). `changeId` is a client-minted, IPC-internal correlation key, never on the wire — the
// fake never sees it.

// The renderer → preload → main → Noise → loopback round-trip is fast in-process, so a short headroom over
// Playwright's 5s default suffices for a cold runner (the siblings' value).
const ROUNDTRIP_TIMEOUT_MS = 15_000

// Fixed reply framing — the fakeDaemon convention (no Date.now(), no randomness). The app never dedupes
// replies by envelope id (#434), so one fixed REPLY_ENVELOPE_ID is reused across every reply.
const REPLY_ENVELOPE_ID = 1
const FIXED_TS = '2026-07-07T12:00:00.000Z'

// The session the controls address. Pushed as new_session_id via the session_transition marker, then
// carried by every set_session_settings payload (#425 addressing key). A non-secret routing id.
const SESSION_ID = 'session-425'

// The seeded run-config baseline the snapshot request is answered with. model 'opus' selects the
// 'Opus 4.7' row, effort 'low' the low segment, yolo false the off switch — the crisp AC1 baseline and
// the value a rejected model change reverts toward. conversation_id is documentary (the decoder drops it,
// #316); text '' is dropped at the transport boundary (#180) and never surfaced.
const BASELINE_SNAPSHOT: ScreenSnapshotPayload = {
  conversation_id: SEEDED_ROW.id,
  text: '',
  ts: FIXED_TS,
  model: 'opus',
  effort: 'low',
  yolo: false,
  used_tokens: 50_000,
  window_tokens: 200_000
}

// The two accepted changes and the one rejected change. Models are FAMILY tokens (the control submits
// 'opus'/'sonnet'/'haiku', not a full id); effort is the exact level. Each is distinct from the baseline
// so its settling is observable; the three model families give unique, mutually-non-substring row names.
const HAPPY_MODEL = 'sonnet'
const HAPPY_EFFORT = 'high'
const REJECTED_MODEL = 'haiku'

// The mutually-non-substring model row display names (RunConfigSections MODEL_CATALOG) — the unique
// locators for the three model rows, which share `.run-config__model-row`.
const OPUS_ROW = 'Opus 4.7'
const SONNET_ROW = 'Sonnet 4.6'
const HAIKU_ROW = 'Haiku 4.5'

// Spec-local frame builders (the conversationsFrame idiom): each seals one reply envelope via the
// production codec, deterministic id/ts.

// The seeded run-config baseline — answers the one request_snapshot RunConfigData fires on sheet open.
// NO in_reply_to: the `snapshot` arm emits snapshotReceived unconditionally on decode (#180).
function screenSnapshotFrame(base: ScreenSnapshotPayload): Uint8Array {
  return encodeEnvelope({ id: REPLY_ENVELOPE_ID, type: 'screen_snapshot', ts: FIXED_TS, payload: base })
}

// The happy confirm — echoes the request's envelope id → in_reply_to (the conversation_deleted idiom),
// which the main side correlates against pendingSettings to emit the client-minted changeId.
function sessionSettingsUpdatedFrame(sessionId: string, inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings_updated',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: { session_id: sessionId } satisfies SessionSettingsUpdatedPayload
  })
}

// The rejection — a content-free `error` correlated by in_reply_to. The main side reads only
// Envelope.in_reply_to (no ErrorPayload parsed), but decodeEnvelope requires a PRESENT payload → `{}`.
function settingsErrorFrame(inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'error',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: {}
  })
}

// The unsolicited session marker that un-inerts the controls (feeds sessionIdStore via sessionIdBridge).
// reason 'clear' pairs with workspace_cwd null (valid per the enum + nullable contract); prev/new session
// ids are non-empty strings (parseSessionTransitionPayload requires both).
function sessionTransitionFrame(sessionId: string): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_transition',
    ts: FIXED_TS,
    payload: {
      previous_session_id: 'session-424',
      new_session_id: sessionId,
      reason: 'clear',
      occurred_at: FIXED_TS,
      workspace_cwd: null
    } satisfies SessionTransitionPayload
  })
}

/**
 * The spec-local capturing reply factory (the #456 capturingWorkspaceFake shape). The fake daemon runs in
 * the TEST process (via the loopback forwarder), so a spec-held `captured` array written here is directly
 * readable from the test body. Per inbound verb: reuse seedConversationsFrame() so the launch row renders;
 * answer the snapshot request with the seeded baseline; answer set_session_settings with a correlated
 * confirm — except the one scripted `haiku` change, answered with a correlated error (the reject). Every
 * other inbound no-ops ([]) — harmless. Discrimination is value-based (model === REJECTED_MODEL), so the
 * closure is stateless (no counter). The payload cast is on the app's OWN trusted outbound (the fixture
 * posture); the double-decode (capture + delegate) is pure and harmless.
 */
function capturingRunConfigFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[] {
  return (inbound) => {
    const env = decodeEnvelope(inbound)
    captured.push(env)
    switch (env.type) {
      case 'list_conversations':
        return [seedConversationsFrame()]
      case 'request_snapshot':
        return [screenSnapshotFrame(BASELINE_SNAPSHOT)]
      case 'set_session_settings':
        return (env.payload as SetSessionSettingsPayload).model === REJECTED_MODEL
          ? [settingsErrorFrame(env.id)]
          : [sessionSettingsUpdatedFrame(SESSION_ID, env.id)]
      default:
        return []
    }
  }
}

// Count captured set_session_settings frames whose payload deep-equals `expected`. `.toBe(1)` on this
// proves BOTH halves of AC2 at once: send-once (exactly one frame) and only-the-changed-field (a deep
// equal — any extra key, or a wrong value, fails the match, so the count stays 0).
function settingsFramesMatching(captured: Envelope[], expected: SetSessionSettingsPayload): number {
  return captured.filter((e) => e.type === 'set_session_settings' && isDeepStrictEqual(e.payload, expected))
    .length
}

test('run-config sheet: model / effort / YOLO round-trip with a rejected model change', async ({
  launchPairedApp
}) => {
  const captured: Envelope[] = []
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingRunConfigFake(captured)
  })

  // Precondition 1 — un-inert the controls: push the session_transition marker (App-level sessionIdBridge
  // listens regardless of route, so this can precede sheet-open). Without it the controls stay inert (#259).
  daemon.pushFrame(sessionTransitionFrame(SESSION_ID))

  // Per-control locators. `.run-config__model-row` (3) and `.run-config__effort-segment` (5) are not
  // unique, so scope by display text: model rows by their mutually-non-substring names, effort segments by
  // an ANCHORED regex (bare 'high' is a substring of 'xhigh', so `/^high$/` avoids the false match). The
  // selected-model marker (radio, aria-label="Current model") is scoped WITHIN its row, never by class.
  const modelRow = (name: string) => page.locator('.run-config__model-row', { hasText: name })
  const selectedRadioIn = (name: string) =>
    modelRow(name).locator('[aria-label="Current model"]')
  const effortSegment = (level: string) =>
    page.locator('.run-config__effort-segment', { hasText: new RegExp(`^${level}$`) })
  const yoloSwitch = page.getByRole('switch', { name: 'Auto-accept tool calls' })

  // AC1 — open the sheet from the collapsed status row (mounts RunConfigData → request_snapshot, and
  // RunConfigSections). Then assert operability + baseline (auto-waits over the async session-id + snapshot
  // arrival + re-render): the model rows are operable buttons (role="button" is present ONLY when a session
  // id gates the handler on), the baseline model/effort/yolo are selected, and the switch is operable
  // (no aria-readonly).
  await page.getByRole('button', { name: 'Run configuration' }).click()
  await expect(modelRow(OPUS_ROW)).toHaveAttribute('role', 'button', { timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(selectedRadioIn(OPUS_ROW)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(effortSegment('low')).toHaveAttribute('aria-current', 'true')
  await expect(yoloSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(yoloSwitch).not.toHaveAttribute('aria-readonly', 'true')

  // AC2 — model: click Sonnet. The captured outbound is the send-half proof (exactly one frame carrying
  // ONLY { session_id, model }); the factory returns the confirm automatically. The row then settles on
  // Sonnet and Opus deselects (the optimistic overlay and the landed confirm render the same value — the
  // captured frame, not the display, is what proves the send).
  await modelRow(SONNET_ROW).click()
  await expect
    .poll(() => settingsFramesMatching(captured, { session_id: SESSION_ID, model: HAPPY_MODEL }), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)
  await expect(selectedRadioIn(SONNET_ROW)).toBeVisible()
  await expect(selectedRadioIn(OPUS_ROW)).toHaveCount(0)

  // AC2 — effort: click the high segment (exactly one { session_id, effort } frame).
  await effortSegment('high').click()
  await expect
    .poll(() => settingsFramesMatching(captured, { session_id: SESSION_ID, effort: HAPPY_EFFORT }), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)
  await expect(effortSegment('high')).toHaveAttribute('aria-current', 'true')

  // AC2 — YOLO: toggle the switch (exactly one { session_id, yolo: true } frame — the control submits !yolo).
  await yoloSwitch.click()
  await expect
    .poll(() => settingsFramesMatching(captured, { session_id: SESSION_ID, yolo: true }), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)
  await expect(yoloSwitch).toHaveAttribute('aria-checked', 'true')

  // AC3 — reject: click Haiku. The factory answers this one change with a correlated error, so the
  // optimistic haiku overlay vanishes and the model reverts to the prior value (Sonnet — proving the reject
  // undoes ONLY the rejected change), and the model section's rejection line appears.
  await modelRow(HAIKU_ROW).click()
  await expect
    .poll(() => settingsFramesMatching(captured, { session_id: SESSION_ID, model: REJECTED_MODEL }), {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBe(1)
  await expect(selectedRadioIn(SONNET_ROW)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  await expect(selectedRadioIn(HAIKU_ROW)).toHaveCount(0)
  const errorLine = page.locator('.run-config__error')
  await expect(errorLine).toBeVisible()
  await expect(errorLine).toHaveAttribute('role', 'alert')
  // Field-scoped: the copy names the model, so a mis-wired reject on another field would fail here.
  await expect(errorLine).toContainText('model')

  // AC4 — close via the aria-label="Close" control; the sheet unmounts.
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.locator('.status-sheet__close')).toHaveCount(0)
})
