# Spec #428 — fake e2e: stall indicator, screen snapshot, debug-bundle download

**Ticket:** [#428](https://github.com/pyrycode/pyrycode-desktop/issues/428) · Size **S** · **coverage-only, zero production change** · not security-sensitive · no Figma.

Split from #421 (→ #433 launch fixture + #434 stateful fake). Blockers #433 (`launchPairedApp`) + #434 both closed.

---

## Files to read first

| Path (lines) | What to extract |
|---|---|
| `e2e/run-config-settings.spec.ts` (whole, ~260) | **The clone skeleton.** Capturing `buildReplyFrames` factory over a spec-held `captured: Envelope[]`; spec-local frame builders sealing envelopes via the production `encodeEnvelope`; `daemon.pushFrame(...)` for server pushes; `expect.poll(() => count(...))` for outbound-frame assertions; `ROUNDTRIP_TIMEOUT_MS = 15_000`, `REPLY_ENVELOPE_ID = 1`, `FIXED_TS`. Copy its shape wholesale. |
| `e2e/queued-backlog-interrupt.spec.ts:1-40` (#427) | Sibling three-scenario / one-launch / one-block precedent + its header-comment idiom. |
| `e2e/fixtures/launchPairedApp.ts:60-97, 118-210` | `SEEDED_ROW` (id `'seed-conversation'`), `seedConversationsFrame()` (reuse on the `list_conversations` arm), the `PairedApp { page, app, daemon }` handle. **Launch resolves at "connected, on the thread, SEEDED_ROW is the active conversation, Send enabled".** |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:144-156` | Layout: `StallIndicator` and `ScreenSnapshotControl` are on the **main thread** (no sheet). |
| `…/ConversationScreen.tsx:481-508` | `StallIndicator`: renders `.conversation__stall` > `.bubble.bubble--daemon.bubble--stall`; `STALL_COPY = 'The turn seems to have stalled…'` (U+2026). `isStalled false → null`. |
| `…/ConversationScreen.tsx:592-672` | `ScreenSnapshotView` + `ScreenSnapshotControl`: button `.screen-snapshot__request` ("Show daemon screen"), gated only on `canSend` (connected); `null` snapshot → `.screen-snapshot__empty` ("No screen snapshot yet"); a received snapshot → `<pre className="screen-snapshot__screen">{snapshot.text}</pre>`. `onRequest` fires `requestScreenSnapshot(activeConversationId, …)` → **request targets the active conversation id = SEEDED_ROW.id**. |
| `src/renderer/src/screens/conversation/requestScreenSnapshot.ts` (whole, 49) | Sends `{ type: 'requestSnapshot', payload: { conversation_id } }`; **null id no-ops** (so SEEDED_ROW must be active — the fixture guarantees it). |
| `src/renderer/src/screens/conversation/LogDataSection.tsx` (whole, 88) | Download button `.log-data__download` lives **inside the status sheet** (`sheetOpen`); `disabled={busy}`. Click → `sendCommand({ type: 'requestDebugBundle' })` + optimistic `dispatch({ type: 'requested' })`. Progress caption `.log-data__status` carries `role="status"`. |
| `src/renderer/src/screens/conversation/logDataDownload.ts:116-144` | Exact progress caption: `` `Downloading… ${chunks} chunk${chunks === 1 ? '' : 's'} received` `` (U+2026). `requested` → `{ phase:'downloading', chunks:0 }`; `progress` → running count. |
| `src/shared/wire/types.ts:143-151` | `RequestSnapshotPayload { conversation_id }`. |
| `src/shared/wire/types.ts:192-216` | `ScreenSnapshotPayload` — **8 fields, all required** (`conversation_id, text, ts, model, effort, yolo, used_tokens, window_tokens`). `text` **is** surfaced into the `<pre>` (the #316/#323/#324 `screenSnapshotReceived` path — distinct from the #180 run-config path that drops `text`). |
| `src/shared/wire/types.ts:268-281` | `StallPayload { conversation_id }` only; onset-only; the decoder drops `conversation_id` → nullary `stallDetected` (not a render gate). |
| `src/shared/wire/types.ts:800-813` | `DebugBundleChunkPayload { seq:number; data:string }` — `seq` 0-based contiguous, `data` std-base64. `DebugBundleDonePayload { total }` — **not sent by this spec** (see State model). |
| `src/main/daemonConnection.roundtrip.test.ts:365-383` | `bundleFrames` reference: how a `debug_bundle_chunk` frame is built (`payload: { seq, data: base64Std(slice) }`). Mirror its chunk-building, **omit the trailing `debug_bundle_done`**. |
| `tsconfig.node.json` | Base for the standalone-tsc temp config (Testing strategy). |
| This ticket's refined memory | The two corrected stale premises (stall = push, no save-dialog) + the snapshot overwrite trap. |

---

## Design source

N/A — coverage-only; the spec pins existing, already-shipped UI and changes nothing on screen. The visual-fidelity check is intentionally skipped (the three surfaces were designed at their render tickets #317 / #324 / #72).

---

## Context

The stall indicator, the "Show daemon screen" snapshot, and the debug-bundle download are the three reliability affordances an operator reaches for when a session misbehaves — and none has e2e coverage. All three ship end-to-end today, so this is a **coverage-only** spec: one new tier-1 fake-stack UI e2e on the shared `launchPairedApp` fixture, **zero production files touched**.

The three surfaces exercise three distinct daemon-interaction shapes, which is the reason to cover them together:

- **Stall** — a pure **server push** (`daemon.pushFrame`), no client request.
- **Screen snapshot** — a **request → reply** (client `request_snapshot` → daemon `screen_snapshot`).
- **Debug bundle** — a **chunked reply stream** (client `request_debug_bundle` → daemon `debug_bundle_chunk`* → per-chunk progress).

---

## Design

### One file, one `test()` block, one launch

New spec: **`e2e/stall-snapshot-bundle.spec.ts`**. Clone `run-config-settings.spec.ts` wholesale. A single launch, single `test()` block covers all three scenarios in one continuous drive — none carries one-way-per-launch state (stall self-clears / persists harmlessly; the snapshot store is most-recent-wins; the download stays re-settable), so there is no forced re-launch (avoid tripling the ~60 s real-handshake launch cost — the #427 lesson).

### The capturing reply factory

Mirror `capturingRunConfigFake`: a spec-local `(captured: Envelope[]) => (inbound: Uint8Array) => Uint8Array[]` passed as `buildReplyFrames`. Because the fake daemon runs in the **test process** (loopback forwarder), the spec-held `captured` array is read directly in the test body. Per-verb `switch (env.type)` — decode-and-push then branch:

| Inbound `env.type` | Reply |
|---|---|
| `list_conversations` | `[seedConversationsFrame()]` — so the launch row renders (reuse the fixture export; a scripted `buildReplyFrames` overrides the fixture default, so this arm owns seeding). |
| `request_snapshot` | `[screenSnapshotFrame(SNAPSHOT)]` — **the same `SNAPSHOT` for every** `request_snapshot` (defeats the overwrite trap, below). |
| `request_debug_bundle` | the chunk stream: `debugBundleChunkFrames(CHUNK_COUNT)` — **no** `debug_bundle_done`. |
| `default` | `[]` (harmless no-op). |

Discrimination is stateless (value/verb-based, no counter), exactly like the skeleton.

### Spec-local frame builders (signatures only — the developer writes the bodies)

Each seals one reply envelope via the production `encodeEnvelope`, deterministic `id`/`ts` (no `Date.now()`, no randomness — the fakeDaemon convention):

- `stallFrame(conversationId: string): Uint8Array` — `{ type: 'stall', payload: { conversation_id } satisfies StallPayload }`. Delivered via `daemon.pushFrame` (a **server push**, not a reply arm). Set `conversation_id: SEEDED_ROW.id` for realism (the decoder drops it — not a render gate).
- `screenSnapshotFrame(base: ScreenSnapshotPayload): Uint8Array` — `{ type: 'screen_snapshot', payload: base }`, **no `in_reply_to`** (emits unconditionally on decode). All 8 payload fields present.
- `debugBundleChunkFrames(count: number): Uint8Array[]` — `count` frames of `{ type: 'debug_bundle_chunk', payload: { seq, data } satisfies DebugBundleChunkPayload }`, `seq` 0-based contiguous, `data` valid std-base64 of a few arbitrary bytes (never asserted — decoded but discarded). **No trailing `debug_bundle_done`.**

Constants: reuse `REPLY_ENVELOPE_ID = 1`, `FIXED_TS`, `ROUNDTRIP_TIMEOUT_MS = 15_000` from the skeleton. Add:
- `SNAPSHOT: ScreenSnapshotPayload` — `conversation_id: SEEDED_ROW.id`, **`text: '<distinctive assertable literal>'`** (e.g. `'DAEMON SCREEN 428'`; unlike the run-config baseline's `text: ''`, this text **is** surfaced into the `<pre>` — assert it), plus documentary `ts/model/effort/yolo/used_tokens/window_tokens`.
- `CHUNK_COUNT = 3`.

### Count helper (the outbound-frame proof)

Mirror `settingsFramesMatching`: small predicates over `captured` used inside `expect.poll`, e.g.
- `capturedSnapshotRequests(captured)` → count of `request_snapshot` with `payload` deep-equal `{ conversation_id: SEEDED_ROW.id }`.
- `capturedBundleRequests(captured)` → count of `request_debug_bundle` with `payload` deep-equal `{}` (bare control frame — the builder emits present-empty `{}`; `decodeEnvelope` requires a present payload).

Use `node:util`'s `isDeepStrictEqual` (the skeleton's import).

### Drive order (bullet scenarios — the developer writes the Playwright body)

Assert in this order; the three surfaces are independent stores, so order is for clarity + to satisfy the snapshot overwrite trap:

1. **Stall.** `daemon.pushFrame(stallFrame(SEEDED_ROW.id))`. Assert `.conversation__stall` visible and `.bubble--stall` contains the client copy `'The turn seems to have stalled…'`. (No sheet; main thread. Nothing in this spec emits timeline turn-activity, so the indicator persists through the later steps.)
2. **Screen snapshot.** Click `.screen-snapshot__request` ("Show daemon screen"). `expect.poll(capturedSnapshotRequests).toBeGreaterThanOrEqual(1)` (proves the outbound `request_snapshot { conversation_id: SEEDED_ROW.id }` landed), **then** assert `page.locator('.screen-snapshot__screen')` (the `<pre>`) `toContainText(SNAPSHOT.text)`. Do this **before** opening the sheet.
3. **Debug-bundle download.** Open the Run-configuration sheet: `page.getByRole('button', { name: 'Run configuration' }).click()` (mirrors the skeleton). Click `.log-data__download`. `expect.poll(capturedBundleRequests).toBe(1)` (the bare `request_debug_bundle`), then assert `page.locator('.log-data__status')` `toContainText('Downloading… 3 chunks received')` — the `role="status"` caption after `CHUNK_COUNT` chunks round-trip. (Optionally `expect(...).toHaveAttribute('role', 'status')`.)

No sheet-close / teardown step is needed for any AC — the fixture's LIFO teardown handles app close.

---

## State + concurrency model

- **Server push (stall).** `daemon.pushFrame(stallFrame)` sends an unsolicited frame on the live Noise session → transport decodes `stall` → nullary `stallDetected` daemon event → `timelineBridge` → `reduceTimeline` sets `stalled: true` → `StallIndicator` renders. Onset-only: the reducer self-clears `stalled` on the **next timeline turn-activity** (`assistant_delta` / `turn_state` / `turn_end` / `userText` / `sessionBoundary`). This spec emits none of those, and `screen_snapshot` / `debug_bundle_*` are **not** timeline events, so the indicator stays up throughout — assert it first, once, and it persists.
- **Request → reply (snapshot).** The button's `requestSnapshot` command → main `connection.requestSnapshot` → wire `request_snapshot`. One `request_snapshot` reply emits **both** `snapshotReceived` (#180 run-config store, drops `text`) **and** `screenSnapshotReceived` (#316/#323 screen-snapshot store, keeps `text`). The `<pre>` reads the latter. **Overwrite trap:** the screen-snapshot store is a **global most-recent-wins** store, and opening the Run-config sheet fires the sheet's **own** `request_snapshot` (`RunConfigData` on mount). Defused two ways together: (a) answer **every** `request_snapshot` with the same `SNAPSHOT`, and (b) assert the `<pre>` **before** opening the sheet.
- **Chunked reply stream (debug bundle).** `requestDebugBundle` command → main `debugBundleDownload` orchestrator arms the transport reassembler **then** sends `request_debug_bundle` (arm-before-send is synchronous, so the chunk frames the fake returns can never outrun the reassembler — no race). `bundleReassembler` emits **per-accepted-chunk** `progress(chunksReceived)` → `debugBundleProgress` daemon event → `LogDataSection`'s reducer → the caption. Progress is independent of completion, so **`debug_bundle_done` is not required** to drive the caption — the spec stops at the streamed-chunks state.
- **No session-id precondition.** Unlike the run-config controls (#425), neither the snapshot button (gated only on `connected`) nor the download button (daemon-global, no session addressing) needs `sessionIdStore` — so **do not** push a `session_transition` marker. Simpler than the skeleton.

---

## Error handling

Coverage-only; no new failure modes. The hermetic floor is the streamed-chunks progress caption — no disk write.

**Deliberately out of scope (the residual, noted per the ticket): the terminal "Saved to `<path>`" state.** Scripting `debug_bundle_done` would drive `saveDebugBundle` (#117) to write a real `.tar.gz` **deterministically to `app.getPath('downloads')`** — there is **no** save-dialog to stub (the pre-split "stub `dialog.showSaveDialog`" premise is false), and the fixture isolates `--user-data-dir` but **not** the downloads directory, so a completed save leaks an archive into the developer's `~/Downloads`. Leaving the save tail uncovered is intentional; do **not** add a downloads-isolation seam for it.

---

## Testing strategy

- **Run:** `npm run e2e` (builds, then Playwright) must be green. The new spec is one more file under `e2e/`, picked up automatically.
- **Assertions are DOM text / attributes / class locators + captured wire frames only** — the fixture's secret-hygiene posture (no token / key / plaintext in any diagnostic). `SEEDED_ROW.id`, the snapshot `text`, and the chunk `seq` are non-secret display/routing literals.
- **Auto-wait discipline:** use `expect.poll` on the `captured` count helpers for the outbound-frame proofs and `expect(locator).toContainText(...)` (with `ROUNDTRIP_TIMEOUT_MS` where the round-trip is in flight) for the rendered assertions — never a fixed sleep. The progress caption climbs `0 → 3`; asserting the substring `'3 chunks received'` waits for the final count (a transient `'0 chunks received'` does not contain it, so the poll doesn't settle early).
- **Standalone typecheck (e2e is not covered by either project tsconfig — [[e2e-not-typechecked-by-project-config]]):** add a temp tsconfig (the #426/#427 idiom — **not committed**, created in the scratchpad or a repo-temp path and discarded after) that `extends "./tsconfig.node.json"`, sets `"composite": false`, and `"include": ["e2e/stall-snapshot-bundle.spec.ts"]`; run `npx tsc --noEmit -p <temp>` and confirm 0 errors. This catches wire-type drift in the frame builders that Playwright's runtime would miss.

### Coverage table

| AC | Proof |
|---|---|
| Stall renders | `.conversation__stall` / `.bubble--stall` visible + copy `'The turn seems to have stalled…'` after `daemon.pushFrame(stallFrame)`. |
| Snapshot send + render | captured `request_snapshot { conversation_id: SEEDED_ROW.id }` (poll ≥ 1) **and** `.screen-snapshot__screen` `<pre>` contains `SNAPSHOT.text`. |
| Debug-bundle send + progress | captured bare `request_debug_bundle` (poll == 1) **and** `.log-data__status` (`role="status"`) reads `'Downloading… 3 chunks received'`. |
| `npm run e2e` green | full suite passes. |

---

## Open questions

None blocking. Two implementation choices left to the developer, both low-risk:

- **`CHUNK_COUNT` value** — 3 is a clean "more than one, plural caption" default; any `n ≥ 2` works (assert the matching `'… n chunks received'`).
- **`SNAPSHOT.text` literal** — any distinctive, non-secret string; a single-token literal (`'DAEMON SCREEN 428'`) is the most robust `toContainText` target. A multi-line terminal-ish string also works (the `<pre>` preserves whitespace) but buys nothing for the assertion.
