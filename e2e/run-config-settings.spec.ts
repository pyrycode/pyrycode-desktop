import { isDeepStrictEqual } from 'node:util'
import { test, expect, SEEDED_ROW, seedConversationsFrame } from './fixtures/launchPairedApp'
import { decodeEnvelope, encodeEnvelope } from '../src/main/transport/codec'
import type {
  Envelope,
  ModelListPayload,
  SessionSettingsPayload,
  SessionSettingsUpdatedPayload,
  SetSessionSettingsPayload,
  WireModelOption
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
// ONE setup precondition, and it is a REPLY to a frame the app itself sent (#491): on sheet open
// RunConfigData fires one bare request_session_settings, and the factory answers it with the seeded
// run configuration. That reply carries BOTH the baseline values and the session id the controls
// need, so there is nothing left for the spec to manufacture.
//
// It used to carry a second precondition, and that precondition WAS the bug. The operability gate
// needs a session id; the only source was an UNSOLICITED session_transition marker; launchPairedApp
// never sends one, because the real daemon never sends one either — it fires that marker on a clear
// or an idle eviction, never on session creation. So this spec pushed one by hand and passed, while
// the product was permanently inert against a real daemon. Same shape as save-as-channel, which
// passed every fake test and had never worked because the daemon had no handler at all. Twice now.
//
// STANDING RULE, adopted here and STILL IN FORCE: a fake-tier spec may not supply an input production
// does not produce. If a precondition needs a manufactured push, that is a bug report, not a fixture.
//
// #975 BINDS THE `daemon` HANDLE THIS SPEC USED TO LEAVE DELIBERATELY UNBOUND, and that is a change
// worth reading rather than skimming. The unbound handle was a STRUCTURAL enforcement of the rule
// above — with no handle there was no way to inject anything — and the model rows are now built from a
// frame that only ever arrives unsolicited, so the rows cannot be exercised without one. The rule is
// not weakened: `model_list` IS an input production produces. The daemon publishes it, unprovoked,
// from the conversation's `initialize` reply — the same reply `slash_command_list` rides, whose spec
// (e2e/slash-command-type-ahead.spec.ts) pushes it exactly this way. What was a structural guard is
// now a stated one: the ONLY frame this spec pushes is that model list, and any future push must be
// justified against the rule the same way, in this comment.
//
// WHY THE CAPTURED OUTBOUND FRAME IS THE LOAD-BEARING PROOF. The view renders NO pending/disabled state
// (it consumes selectEffectiveSettings + selectError only), so a resolved confirm is DOM-indistinguishable
// from a still-pending optimistic overlay — asserting the displayed value alone does not prove the reply
// landed. The send half (AC2's "exactly one … only the changed field") is therefore proven from the
// captured outbound set_session_settings payload (#423/#456 precedent). The REJECT is the one visually
// distinct outcome (the control reverts + a role="alert" line appears), so it carries its own DOM assertion.
//
// SECRET HYGIENE (carried verbatim from the siblings): every assertion reads DOM attributes / text / counts
// and captured wire frames only; SESSION_ID / the published model values and labels / effort levels are
// non-secret routing
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

// The session the controls address. Carried on the session_settings reply, then echoed by every
// set_session_settings payload (#425 addressing key). A non-secret routing id.
const SESSION_ID = 'session-425'

// The seeded run configuration the read request is answered with. Since #975 the model is a PUBLISHED
// value and selection is exact equality, so the baseline is `opus[1m]` verbatim — the first pushed
// row's own value — which selects the OPUS_ROW row. effort 'low' selects the low segment, yolo false
// the off switch: the crisp AC1 baseline and the value a rejected model change reverts toward.
// session_id is the same non-secret routing id the write half then echoes, and carrying it here is the
// whole point: it is what un-inerts the controls.
const BASELINE_RUN_CONFIG: SessionSettingsPayload = {
  session_id: SESSION_ID,
  model: 'opus[1m]',
  effort: 'low',
  yolo: false,
  used_tokens: 50_000,
  window_tokens: 200_000
}

// The two accepted changes and the one rejected change. Since #975 a model is a PUBLISHED `value` —
// the argument the picked row carries, sent back verbatim — rather than a catalog family token; effort
// is still the exact level. Each is distinct from the baseline so its settling is observable.
const HAPPY_MODEL = 'sonnet'
const HAPPY_EFFORT = 'high'
const REJECTED_MODEL = 'haiku'

// #975 — the published rows the sheet renders, pushed as an unsolicited model_list frame below. The
// display names are the row locators (rows share `.run-config__model-row`), so they are chosen
// MUTUALLY NON-SUBSTRING, and none of them contains 'Current model' — the page-wide selection-marker
// count depends on that. The values cover the measured shapes: a bare alias, another bare alias, and a
// bracketed variant that is emphatically not parseable. `resolved_model` differs from `value` on every
// row, which is what makes the second-line assertion a claim about the right field.
// #976 — each row publishes its OWN effort levels, and the three sets are deliberately different: the
// baseline row carries the five measured levels, the row the spec switches TO carries a shorter subset
// (so the model→effort dependency is observable rather than inferred), and the rejected row carries
// none — the live-measured Haiku shape. Both `low` (the baseline) and `high` (the change) are in the
// first two sets, which is what keeps the shipped effort round-trip below meaningful.
const OPUS_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const SONNET_LEVELS = ['low', 'high']

const MODEL_ROWS: WireModelOption[] = [
  {
    value: 'opus[1m]',
    display_name: 'Wide context',
    resolved_model: 'claude-opus-5',
    effort_levels: OPUS_LEVELS,
    supports_auto_mode: true,
    truncated_fields: null
  },
  {
    value: HAPPY_MODEL,
    display_name: 'Balanced pick',
    resolved_model: 'claude-sonnet-5',
    effort_levels: SONNET_LEVELS,
    supports_auto_mode: true,
    truncated_fields: null
  },
  {
    value: REJECTED_MODEL,
    display_name: 'Quick tier',
    resolved_model: 'claude-haiku-4-5-20251001',
    effort_levels: [],
    supports_auto_mode: false,
    truncated_fields: null
  }
]

const OPUS_ROW = 'Wide context'
const SONNET_ROW = 'Balanced pick'
const HAIKU_ROW = 'Quick tier'

// Spec-local frame builders (the conversationsFrame idiom): each seals one reply envelope via the
// production codec, deterministic id/ts.

// The seeded run configuration — answers the one bare request_session_settings RunConfigData fires on
// sheet open. Correlated by in_reply_to, matching the real daemon's reply.
function sessionSettingsFrame(base: SessionSettingsPayload, inReplyTo: number): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'session_settings',
    ts: FIXED_TS,
    in_reply_to: inReplyTo,
    payload: base
  })
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

// #975 — the published model list, and the ONE unsolicited push this spec makes. Sealed with the
// production encoder, keyed to the seeded conversation the app opens, so the decode this exercises is
// the shipped one. `dropped_models: 0` states a complete list; the truncation surfaces are proven at
// the unit tier, where a frame reporting a cut can be constructed directly.
function modelListFrame(): Uint8Array {
  return encodeEnvelope({
    id: REPLY_ENVELOPE_ID,
    type: 'model_list',
    ts: FIXED_TS,
    payload: {
      conversation_id: SEEDED_ROW.id,
      models: MODEL_ROWS,
      dropped_models: 0
    } satisfies ModelListPayload
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
      case 'request_session_settings':
        return [sessionSettingsFrame(BASELINE_RUN_CONFIG, env.id)]
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
  // #975 binds `daemon` — see the header. It is used for exactly ONE push, the unsolicited model_list
  // frame the daemon publishes from the conversation's initialize reply; every other byte the app
  // receives is still a reply to a frame the app itself sent.
  const { page, daemon } = await launchPairedApp({
    buildReplyFrames: capturingRunConfigFake(captured)
  })

  // Per-control locators. `.run-config__model-row` (3, since #975 one per PUBLISHED row) and
  // `.run-config__effort-segment` (one per level the SELECTED row publishes since #976, so the count
  // CHANGES with the model) are not unique, so scope by display text: model rows by their
  // mutually-non-substring names — DAEMON-AUTHORED since #975, which is exactly what this spec now
  // proves reaches a pixel — effort segments by an ANCHORED regex (bare 'high' is a substring of
  // 'xhigh', so `/^high$/` avoids the false match; #976 makes that pair a published one rather than a
  // client-owned one, so the rationale is needed more, not less). The selected-model marker (radio,
  // aria-label="Current model") is scoped WITHIN its row, never by class.
  const modelRow = (name: string) => page.locator('.run-config__model-row', { hasText: name })
  const selectedRadioIn = (name: string) =>
    modelRow(name).locator('[aria-label="Current model"]')
  const effortSegment = (level: string) =>
    page.locator('.run-config__effort-segment', { hasText: new RegExp(`^${level}$`) })
  const yoloSwitch = page.getByRole('switch', { name: 'Auto-accept tool calls' })

  // AC1 — open the sheet from the thread's overflow menu (mounts RunConfigData → request_session_settings,
  // and RunConfigSections). Then assert operability + baseline (auto-waits over the async session-id +
  // snapshot arrival + re-render): the model rows are operable buttons (role="button" is present ONLY when
  // a session id gates the handler on), the baseline model/effort/yolo are selected, and the switch is
  // operable (no aria-readonly).
  //
  // #962 retired the collapsed status row this used to click, so the open is now the two-step overflow
  // path (the conversation-create-rename.spec.ts idiom). The trigger is present because launchPairedApp
  // reaches the thread through the paired shell, which is what wires `onBack` and mounts the menu.
  await page.locator('.conversation__overflow-trigger').click()
  await page.getByRole('menuitem', { name: 'Run configuration' }).click()

  // #975 AC5, end to end and in the only order that proves it: BEFORE the frame arrives the section
  // says the list is not yet known and renders NO row. That is the not-yet-known reading, and a sheet
  // that showed a stale menu or an empty control here would fail this pair.
  await expect(page.locator('.run-config__model-unknown')).toBeVisible({
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(page.locator('.run-config__model-row')).toHaveCount(0)

  // #976 AC3, in the same only-order-that-proves-it: with no list yet no row is matched, so the Effort
  // section offers NO segment and states the session's current effort as text instead. A five-segment
  // strip here would be the deleted hardcoded vocabulary surviving. The text also waits out the
  // session_settings reply, so the baseline is real rather than assumed.
  await expect(page.locator('.run-config__effort-current')).toHaveText(BASELINE_RUN_CONFIG.effort, {
    timeout: ROUNDTRIP_TIMEOUT_MS
  })
  await expect(page.locator('.run-config__effort-segment')).toHaveCount(0)

  // The list arrives unsolicited — the daemon publishes it from the conversation's initialize reply,
  // so nothing the client sends provokes it. This is the one push this spec makes.
  daemon.pushFrame(modelListFrame())

  // THE BUG, STATED AS AN ASSERTION. role="button" is present ONLY when a session id gated the
  // handler on. On the parent commit this times out: the app asked for a screen snapshot, that reply
  // carries no session id, and the spec no longer manufactures one -- so the controls render inert
  // read-only markup and every click below is a no-op. This is desktop#491 exactly.
  await expect(modelRow(OPUS_ROW)).toHaveAttribute('role', 'button', { timeout: ROUNDTRIP_TIMEOUT_MS })

  // #975 AC1/AC4 — one row per published entry, in the daemon's published order, labelled with the
  // entry's display name, each second line carrying the concrete identifier that entry's value
  // resolves to. toHaveText is EXACT and ordered, so this is also the proof that no client-owned model
  // name survives: a leftover catalog row would change both counts.
  await expect(page.locator('.run-config__model-name')).toHaveText(
    MODEL_ROWS.map((row) => row.display_name)
  )
  await expect(page.locator('.run-config__model-descriptor')).toHaveText(
    MODEL_ROWS.map((row) => row.resolved_model)
  )
  await expect(page.locator('.run-config__model-unknown')).toHaveCount(0)

  // Positive proof of the SOURCE of that id: a bare read request went out, and its reply is the only
  // thing the app could have learned a session id from. Combined with the unbound `daemon` handle above,
  // this pins that the controls are operable because the DAEMON told them so, not because the spec did.
  //
  // At-least-one rather than exactly-one since #810: the read now also fires on the connected edge and at
  // each turn end, so the count is no longer fixed. The proof this assertion carries is unchanged — it
  // rests on the unbound handle plus the capturing fake being the only source of a `session_settings`
  // frame, not on the count being 1.
  await expect
    .poll(() => captured.filter((e) => e.type === 'request_session_settings').length, {
      timeout: ROUNDTRIP_TIMEOUT_MS
    })
    .toBeGreaterThanOrEqual(1)
  await expect(selectedRadioIn(OPUS_ROW)).toBeVisible({ timeout: ROUNDTRIP_TIMEOUT_MS })
  // #976 AC1 — the segments are exactly the levels the SELECTED row published, in the daemon's order.
  // toHaveText is exact and ordered, so this is also the proof that no client-owned level survives
  // beside them, and the current-effort line is gone now that a row was matched.
  await expect(page.locator('.run-config__effort-segment')).toHaveText(OPUS_LEVELS)
  await expect(page.locator('.run-config__effort-current')).toHaveCount(0)
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

  // #976 AC1, THE TRANSITION THIS WHOLE SPEC EXISTS FOR and the one a static render cannot make: the
  // model changed, so the segments became the NEW row's published set — shorter and different. A
  // section still offering the previous row's five would pass every unit assertion and fail here.
  await expect(page.locator('.run-config__effort-segment')).toHaveText(SONNET_LEVELS)

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
