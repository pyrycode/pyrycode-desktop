# 425 — fake e2e: run-config sheet (model, effort, YOLO)

**Ticket:** [#425](https://github.com/pyrycode/pyrycode-desktop/issues/425) · Size **S** · sibling of #423 / #451 / #452 / #456 (the #421/#422 fake-e2e family)
**Labels:** `enhancement`, `size:s` — **not** `security-sensitive`, no `## Figma` section.

Test-only: one new Playwright e2e spec, **zero production code**. It rides the two merged fixtures
(`launchPairedApp` #433 / `conversationStateFake` #434 — though this spec does not need the stateful list
fake; see Design) and asserts existing UI (#188 read-only markup made interactive by #257). No new attack
surface (assertions read DOM attributes/text/counts + the app's own captured outbound wire frames), no new
UI — so neither a security-review pass nor a Design source section applies.

## Design source

N/A — drives already-shipped UI (#257 interactive run-config controls, Figma node 20-100 subtree), no visual
change, no Figma reference (per the ticket body: "Not UI-visible").

---

## Files to read first

Read the sibling demonstrators first — this spec is the same shape (seed → `launchPairedApp` passthrough →
open a sheet → drive controls → assert), with a **spec-local capturing reply factory** (#456's shape) and one
extra load-bearing setup step (a pushed `session_transition`) that no sibling needs.

- `e2e/workspace-picker.spec.ts` (whole) — **the capturing-fake pattern to clone.** `capturingWorkspaceFake`
  decodes each inbound, pushes it to a spec-owned `captured: Envelope[]`, answers a spec-local verb, delegates
  the rest; the test polls `captured` for the outbound payload. This spec's factory is the same idea over
  `set_session_settings`. Also: `ROUNDTRIP_TIMEOUT_MS`, the `expect.poll(() => captured.filter(...))` idiom,
  and the secret-hygiene header to carry verbatim.
- `e2e/save-as-channel-promote.spec.ts:71-100` — the `promoteFake` compose-over shape (spec-local reply
  factory, single consumer → **not** a fixture change). This spec's factory is spec-local for the same reason.
- `e2e/fixtures/launchPairedApp.ts:60-83, 118-200` — `SEEDED_ROW` (the `is_promoted:false` clickable row the
  drive lands on; its `id` is the active conversation the snapshot request targets), `seedConversationsFrame()`
  (**reuse on the `list_conversations` arm** so the launch row renders), the `buildReplyFrames` override
  contract, and the `PairedApp` handle `{ page, app, daemon }`. **Load-bearing:** the fake daemon runs
  in-process, so a spec-held `captured` array written inside `buildReplyFrames` is readable from the test body.
- `src/renderer/src/screens/conversation/RunConfigSections.tsx:117-245, 321-352` — **the operability gate + all
  selectors.** `onChange` (hence every control's `role="button"` / operable switch) is built **only when
  `sessionId !== null`** (334); absent → #188's inert markup (no `role`, `aria-readonly` switch), clicks are
  no-ops. Model rows `.run-config__model-row` (`role="button"`) with selected radio `aria-label="Current model"`
  (149-153); effort segments `.run-config__effort-segment` (`role="button"`) selected via `aria-current="true"`
  (193); YOLO `role="switch"` `aria-label="Auto-accept tool calls"` `aria-checked` (230-238, operable variant
  drops `aria-readonly`); rejection line `.run-config__error` `role="alert"` (68-74, rendered under the rejected
  field's section only). Model row display names: `Opus 4.7` / `Sonnet 4.6` / `Haiku 4.5` (36-38, mutually
  non-substring). The control submits the model **family token** (`'opus'`/`'sonnet'`/`'haiku'`, line 144), the
  effort **exact level** (196), and `!yolo` (237).
- `src/renderer/src/screens/conversation/RunConfigData.tsx` (whole) — mounted **only while the sheet is open**;
  fires **one** `requestSnapshot { conversation_id: <active conversation id> }` per open (32-37) and subscribes
  `snapshotReceived` into `runConfigStore`. This is the sole trigger of `request_snapshot` in the drive (the
  live-screen `requestScreenSnapshot` is click-driven, never auto-fired) — so the reply factory's snapshot arm
  answers exactly this.
- `src/renderer/src/store/sessionIdBridge.ts` + `sessionIdStore.ts` — `SessionIdData` is **App-level
  always-listening**; a `sessionTransition` daemon event writes `event.newSessionId` into `sessionIdStore`. This
  is why a **pushed** `session_transition` (not tied to the sheet) un-inerts the controls, and why the push can
  precede sheet-open. `sessionId` starts `null` (controls inert until the push lands).
- `src/renderer/src/store/runSettingsWriteStore.ts:97-199` — the write reducer + `selectEffectiveSettings`
  (**pending overlay > confirmed override > snapshot base**). Read to understand the reject rollback (delete the
  pending marker → effective falls through) and the **observability limit**: `pending` and `confirmed` render to
  the *same* value, so a landed confirm is DOM-indistinguishable from a still-pending overlay (see Design →
  Observability). The view consumes `selectEffectiveSettings` + `selectError` only; `selectPendingFields` (205)
  is unused by the view — there is no pending/disabled DOM state.
- `src/renderer/src/store/runSettingsWriteBridge.ts:80-109` — `submitSettingsChange` builds the outbound
  command `{ type: 'setSessionSettings', payload: { session_id, <changed field only> }, changeId }` and sends it
  **once** per change. `buildSettingsPayload` (80-91) proves only the changed field rides the payload (the
  AC2 "only the changed field" contract the captured frame verifies).
- `src/main/daemonConnection.ts:493-541, 620-641, 1288-1314` — the correlation the fake feeds. Outbound
  `set_session_settings` is sent under a unique per-request envelope id; `pendingSettings: Map<envelopeId,
  changeId>` records it (1308). A `session_settings_updated` (620-641) or `error`/`daemon-error` (493-541)
  reply is correlated by `Envelope.in_reply_to` echoing that envelope id → emits `sessionSettingsUpdated` /
  `sessionSettingsRejected` carrying the client's `changeId`. **The fake only needs to echo `env.id` →
  `in_reply_to`** (the `conversation_deleted` idiom); it never sees the `changeId`.
- `src/shared/wire/types.ts:40-100, 167-213, 291-314` — exact wire shapes (do NOT drift): `Envelope`
  (`in_reply_to?: number` at the envelope level, 98), `SetSessionSettingsPayload` (the outbound the factory
  captures), `SessionSettingsUpdatedPayload { session_id }`, `ScreenSnapshotPayload` (all 8 fields required, no
  omitempty), `WireSessionTransitionReason = 'clear' | 'idle_evict' | 'workspace_change'`,
  `SessionTransitionPayload` (all 5 fields required). Import the codec + wire types by **relative** path from
  `e2e/` (`../src/...`) — `@shared` is not available to e2e.
- `src/main/transport/inboundMessage.ts:1079-1095` + `parseSessionTransitionPayload` (~420) — the two
  hand-built frames must decode: `error` reads only `Envelope.in_reply_to` (content-free) but **`decodeEnvelope`
  requires a present `payload`** → emit `payload: {}`; `session_transition` requires non-empty `previous/new
  session_id` + `occurred_at` strings, a `reason` in the closed enum, and `workspace_cwd: string | null`.

**Lessons / environment (not code — grep/Read won't surface these):** e2e is **not** typechecked by any project
tsconfig ([[e2e-not-typechecked-by-project-config]]) — run a standalone `tsc` pass over the new spec, don't
rely on `npm run typecheck`; a fresh worktree needs `npm install`; run the binary via
`./node_modules/.bin/playwright`, never `npx`; the wire codec home is `src/main/transport/codec`
([[wire-codec-home-is-main-transport]]); "no payload" control frames must emit `payload: {}` or
`decodeEnvelope` throws.

---

## Context

The run-config sheet's three interactive controls (#257 — model row / effort segment / YOLO switch) each send a
`set_session_settings` for the current session and hold an **optimistic** value until a correlated
`session_settings_updated` (echoing the request `id` → `in_reply_to`) confirms it, or a correlated `error`
reverts it and surfaces a field-scoped rejection line. The main side owns the correlation
(`pendingSettings: Map<envelopeId, changeId>`); the renderer holds the optimistic/confirm/reject state
(`runSettingsWriteStore`). No e2e exercises this against a real, id-echoing reply — unit tests against
always-answering fakes never distinguish the confirm/reject arms by correlation.

**The parent premise is stale (confirmed).** `conversationStateFake` (#434) answers only the seven
conversation-list verbs; `set_session_settings`, `request_snapshot`, and `session_transition` fall to its
`default` (no reply). This spec therefore scripts its **own** `buildReplyFrames` (the #423/#456 spec-local
factory idiom) and does not use `conversationStateFake` at all — the launch needs only a one-row
`conversations` reply, which `seedConversationsFrame()` already provides.

**Two setup preconditions `launchPairedApp` does not provide** (the load-bearing traps the parent omitted):

1. **Session id — the operability gate.** `RunConfigSections` builds each control's `onChange` **only when
   `sessionIdStore` is non-null**; otherwise the controls render #188's inert read-only markup and clicks are
   no-ops. The store is fed by `sessionIdBridge` from an **unsolicited** `session_transition` marker.
   `launchPairedApp` reaches "connected, on the thread, Send enabled" but never establishes a session id — so
   the spec must **`daemon.pushFrame(...)`** a sealed `session_transition` after launch to un-inert the controls.
2. **Snapshot baseline.** On sheet open `RunConfigData` fires one `requestSnapshot { conversation_id }` for the
   active conversation (the seeded row landed on at launch). The reply factory answers it with a seeded
   `screen_snapshot` so the baseline (model/effort/yolo) the controls start from — and the value a reject
   reverts *toward* — is crisp; absent it, the base falls to `'' / '' / false`.

---

## Design

One new spec, `e2e/run-config-settings.spec.ts` (filename does **not** match the `real-*` `testIgnore`, so it
runs under `npm run e2e`). **One `test()` block, one launch** — unlike #423's two blocks (forced by one-way
promotion + strict-single-row), the run-config sheet stays open, all three controls are independently operable,
and the session persists, so a single continuous drive covers every AC. Deterministic fixed literals only (the
fakeDaemon convention — no `Date.now()`, no randomness).

### Literals (contract, fixed values the developer copies)

```
SESSION_ID          = 'session-425'          // pushed as new_session_id; the session_id every payload carries
FIXED_TS            = '2026-07-07T12:00:00.000Z'
REPLY_ENVELOPE_ID   = 1                        // reply envelope id; app never dedupes replies by id (#434)
ROUNDTRIP_TIMEOUT_MS = 15_000                  // sibling headroom over Playwright's 5s default
BASELINE_SNAPSHOT: ScreenSnapshotPayload =
  { conversation_id: SEEDED_ROW.id, text: '', ts: FIXED_TS,
    model: 'opus', effort: 'low', yolo: false, used_tokens: 50_000, window_tokens: 200_000 }
HAPPY_MODEL    = 'sonnet'   // family token; row 'Sonnet 4.6' — distinct from baseline 'opus' row
HAPPY_EFFORT   = 'high'     // exact level; distinct from baseline 'low'
REJECTED_MODEL = 'haiku'    // family token; row 'Haiku 4.5' — the factory's reject discriminator
```

`SEEDED_ROW` is imported from `launchPairedApp`. `BASELINE_SNAPSHOT.conversation_id` is documentary — the
decoder drops it (no consumer), so it need not match the request; setting it to `SEEDED_ROW.id` keeps it
honest. `text: ''` is dropped at the transport boundary (#180), never surfaced.

### The spec-local capturing reply factory (composition seam — the developer writes the body)

```
function capturingRunConfigFake(captured: Envelope[]): (inbound: Uint8Array) => Uint8Array[]
```

Behavior (contract, not implementation — ~20 lines, the `capturingWorkspaceFake` shape):
- Return `(inbound) => { const env = decodeEnvelope(inbound); captured.push(env); … }`.
- `list_conversations` → `[seedConversationsFrame()]` (renders the launch row; reuse the `launchPairedApp`
  export — do not re-declare the row).
- `request_snapshot` → `[screenSnapshotFrame(BASELINE_SNAPSHOT)]` (seeds the baseline; **no `in_reply_to`** —
  the `snapshot` arm emits `snapshotReceived` unconditionally on decode, #180).
- `set_session_settings` → discriminate on the captured payload:
  - `(env.payload as SetSessionSettingsPayload).model === REJECTED_MODEL` → `[settingsErrorFrame(env.id)]`
    (the one scripted rejection).
  - otherwise → `[sessionSettingsUpdatedFrame(SESSION_ID, env.id)]` (the happy confirm; `in_reply_to: env.id`).
- default → `[]` (no reply; harmless for any unmodeled inbound).

Trusted input (the app's own outbound) → per-verb cast, no fail-closed narrowing (the fixture posture). The
double-decode (capture + delegate) is pure and harmless (the #456 note).

### Spec-local frame builders (signatures + one-line behavior; mirror `conversationsFrame`)

- `screenSnapshotFrame(base: ScreenSnapshotPayload): Uint8Array` — `encodeEnvelope({ id: REPLY_ENVELOPE_ID,
  type: 'screen_snapshot', ts: FIXED_TS, payload: base })`.
- `sessionSettingsUpdatedFrame(sessionId: string, inReplyTo: number): Uint8Array` — envelope
  `type: 'session_settings_updated'`, `in_reply_to: inReplyTo`, `payload: { session_id: sessionId } satisfies
  SessionSettingsUpdatedPayload`.
- `settingsErrorFrame(inReplyTo: number): Uint8Array` — envelope `type: 'error'`, `in_reply_to: inReplyTo`,
  **`payload: {}`** (content-free; `decodeEnvelope` requires a present payload).
- `sessionTransitionFrame(sessionId: string): Uint8Array` — envelope `type: 'session_transition'` (no
  `in_reply_to`), `payload: { previous_session_id: 'session-424', new_session_id: sessionId, reason: 'clear',
  occurred_at: FIXED_TS, workspace_cwd: null } satisfies SessionTransitionPayload`. `reason: 'clear'` pairs with
  `workspace_cwd: null` (valid per the enum + nullable contract).

### The drive (one block; stages map to the ACs)

1. **Launch + un-inert.** `const { page, daemon } = await launchPairedApp({ buildReplyFrames:
   capturingRunConfigFake(captured) })` (lands on `SEEDED_ROW`'s empty thread). Then
   `daemon.pushFrame(sessionTransitionFrame(SESSION_ID))` to feed `sessionIdStore` (App-level listener — no
   sheet needed yet).
2. **Open + AC1 (operable baseline).** Click `.status-row` (`role="button"`, opens the sheet → mounts
   `RunConfigData` + `RunConfigSections`). Assert operability + baseline (auto-waits over the async session-id
   arrival + snapshot arrival + re-render): the `Opus 4.7` model row carries `role="button"` **and** its radio
   shows `aria-label="Current model"`; the `low` effort segment has `aria-current="true"`; the switch has
   `aria-checked="false"` **and no** `aria-readonly`.
3. **AC2 — model.** Click the `Sonnet 4.6` row. `expect.poll` the captured `set_session_settings` payloads
   contain **exactly one** equal to `{ session_id: SESSION_ID, model: HAPPY_MODEL }` (proves send-once + only
   the changed field). The factory returns the confirm automatically. Assert the `Sonnet 4.6` row now shows
   `aria-label="Current model"` (and `Opus 4.7` no longer does).
4. **AC2 — effort.** Click the `high` segment. `expect.poll` for exactly one captured payload equal to
   `{ session_id: SESSION_ID, effort: HAPPY_EFFORT }`. Assert the `high` segment has `aria-current="true"`.
5. **AC2 — YOLO.** Click the switch. `expect.poll` for exactly one captured payload equal to
   `{ session_id: SESSION_ID, yolo: true }`. Assert the switch has `aria-checked="true"`.
6. **AC3 — reject.** Click the `Haiku 4.5` row. `expect.poll` for a captured payload equal to
   `{ session_id: SESSION_ID, model: REJECTED_MODEL }`. The factory returns the `error`. Assert the **revert +
   rejection line**: the model selection returns to `Sonnet 4.6` (`aria-label="Current model"`), the
   `Haiku 4.5` row is **not** selected (`aria-label="Current model"` count 0 within it), **and**
   `.run-config__error` (`role="alert"`) is visible under the Model section.
7. **AC4 — close.** Click `.status-sheet__close` (`aria-label="Close"`). Assert the sheet is gone (e.g.
   `.status-sheet__close` count 0, or the Model header no longer visible).

### Why the captured outbound frame is the load-bearing proof (Observability)

The view renders **no** pending/disabled state (it consumes `selectEffectiveSettings` + `selectError` only). A
resolved confirm and a still-pending optimistic overlay compose to the **same** displayed value, so asserting
the control's displayed value alone does **not** prove the reply landed. The proof of the send half (AC2's
"sends exactly one … carrying only the changed field") is therefore the **captured outbound
`set_session_settings` payload** — deep-equal to `{ session_id, <field>: <value> }` (extra keys fail the equal;
the omitempty presence contract, built main-side in `setSessionSettingsEnvelope.ts`, is verified against the
real wire frame) and appearing exactly once (no duplicate send per click). The **reject** is the one
DOM-distinct outcome (the optimistic `haiku` overlay vanishes → the model reverts, and the alert line appears),
so it carries its own DOM assertion.

**Rejected: the ticket's optional "stronger confirm-proof."** Chaining a rejected change whose revert target is
a prior *confirmed* value does **not** distinguish a landed confirm from a lingering optimistic overlay: after
the reject deletes only its own `changeId`'s pending marker, `selectEffectiveSettings` falls to `confirmed`
*or* to any still-pending same-field entry — both render the identical value. So the model reverting to
`Sonnet 4.6` (rather than baseline `Opus 4.7`) proves the reject undoes **only the rejected change**, not that
the earlier confirm committed. The confirm reply is still pushed (it exercises the full decode + correlation
round-trip and matches real daemon behavior), but the confirm-commit is not independently DOM-observable — an
accepted limitation, not a gap this spec can close.

---

## State + concurrency model

- **No production state change.** All new code is under `e2e/`; the spec owns one `captured: Envelope[]` and the
  reply factory closure.
- **Two independent preconditions, two stores.** The pushed `session_transition` lands in the App-level
  `sessionIdStore` (gates control operability); the `request_snapshot` reply lands in the sheet-scoped
  `runConfigStore` (the baseline). Neither depends on the other; the drive's AC1 assertion auto-waits over both.
- **Capture channel.** The fake daemon runs in the test process (in-process forwarder), so `buildReplyFrames`
  writes `captured` synchronously as each outbound frame is decrypted. Frames traverse renderer → preload →
  main → Noise → loopback before reaching the fake, so a captured frame appears *after* the click resolves —
  assert with `expect.poll(() => captured.filter(...))`, `ROUNDTRIP_TIMEOUT_MS` headroom (never a bare
  `expect`).
- **Confirm/reject are per-send, not pushed.** The happy confirm and the reject `error` are returned by
  `buildReplyFrames` **in response to** each `set_session_settings`; the only explicit `pushFrame` is the
  initial `session_transition`. Discrimination is value-based (`model === REJECTED_MODEL`) → stateless, no
  counter in the closure (the fake convention).
- **One-shot snapshot.** `RunConfigData` guards its request to fire once per open; the drive opens the sheet
  once, so exactly one `request_snapshot` is captured. (The live-screen `requestScreenSnapshot` is click-driven
  and never fires here.)
- **Teardown** is owned entirely by `launchPairedApp` (LIFO: app → daemon → forwarder → `rm(userDataDir)`),
  firing on pass and fail. This spec adds nothing.

---

## Error handling / failure modes

- **Controls stay inert** → the `role="button"` / operability assertion (step 2) times out with a clear signal,
  pinning the session-id precondition (a regression that stops `session_transition` from feeding
  `sessionIdStore`, or a control that stops keying operability off session-id presence, fails here rather than
  as a downstream mystery).
- **Snapshot never arrives** → the baseline assertion (`Opus 4.7` selected / `low` current / switch off) times
  out; a control showing the `'' / '' / false` fallback surfaces as expected-vs-actual.
- **Reject arm mis-wired** → if the factory answered the `haiku` change with a confirm (or no reply), the model
  would settle on (or hang at) `Haiku 4.5` and `.run-config__error` would never appear — the step-6 assertion
  times out. If it rejected a *happy* change, that control's revert + a spurious alert would fail its step.
- **Frame won't decode** → a malformed `session_transition` (empty id, bad `reason`) or `error` (missing
  `payload`) throws in the main-side decoder at setup; caught early by the operability/round-trip timeout.
  Follow the exact wire shapes (Files to read first → `types.ts` / `inboundMessage.ts`).
- **Selector ambiguity** — `.run-config__model-row` (3 rows) and `.run-config__effort-segment` (5) are not
  unique; target model rows by their display-name text (`Opus 4.7` / `Sonnet 4.6` / `Haiku 4.5`, mutually
  non-substring) and effort segments by their level text; scope the `aria-label="Current model"` /
  `aria-current` assertions *within* the intended row/segment, never by class alone.
- **Secret hygiene** (carry the sibling header verbatim): every assertion reads DOM attributes/text/counts and
  captured wire frames only; `SESSION_ID` / the model-family tokens / effort levels are non-secret routing/
  display literals; the pairing plumbing (synthetic token, fake static key) lives in `launchPairedApp` and is
  never echoed; no failure diagnostic serializes a token, key, or plaintext; the snapshot `text` is `''` and
  never surfaced (#180). `changeId` is a client-minted IPC-internal correlation key, never on the wire — the
  fake never sees it.

---

## Testing strategy

The spec **is** the test — one end-to-end drive against the fake stack (renderer → IPC → main → Noise wire →
decode → render), covering all five ACs in one launch.

- **Runs under `npm run e2e`** (`npm run build && playwright test`; `build` is the salvage/QA gate). The
  filename `run-config-settings.spec.ts` does not match the `real-*` `testIgnore` (AC5).
- **No unit tests, zero production code.** The correlation (#261/#269), the store reducer (#256), the control
  gate (#257/#259), and the envelope builder's presence contract (#263) are already unit-covered; this spec
  proves the round-trip those units cannot (a real, id-echoing reply distinguishing confirm from reject).
- **e2e is outside every tsconfig** — the spec must compile under Playwright's own TS handling (relative
  imports, no `@shared`); run a standalone `tsc` pass over the new file (do not rely on `npm run typecheck`).

Scenarios (bullets — the developer writes them in Playwright idiom): see Design → The drive, steps 1–7. Each
`set_session_settings` assertion is `expect.poll(() => captured.filter(e => e.type === 'set_session_settings'
&& deepEqual(e.payload, EXPECTED))).toHaveLength(1)` (proves only-the-changed-field via the equal + send-once
via the length); each DOM assertion is scoped within its row/segment and auto-waits the round-trip.

---

## Open questions

- **One block vs. per-AC blocks** — resolved: one continuous block (the sheet + session persist; no one-way
  constraint). Revisit only if a mid-drive failure's diagnostics prove too coarse; the stage comments keep each
  AC locatable.
- **Reject field choice** — resolved: model (3 distinct families give a crisp baseline/prior/rejected three-way
  and unique row-name locators). Effort (5 segments) is an equally valid alternative; YOLO (boolean) is weaker
  (only two states). Developer may swap to effort without changing the mechanism.
- **Confirm-commit observability** — resolved (documented): not DOM-provable (pending ≡ confirmed in
  `selectEffectiveSettings`); the captured outbound frame is the send-half proof and the pushed confirm
  exercises the correlation round-trip. If a future ticket adds a pending/disabled DOM surface
  (`selectPendingFields` is already built but unused by the view), tighten this to assert the pending→settled
  transition directly.
