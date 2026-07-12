# Spec: Surface the screen-snapshot rendered `text` via a `screenSnapshotReceived` event (#316)

**Size:** XS · **Security-sensitive:** yes · Split from #147 · Blocks the display slice #318

## Context

`request_snapshot` → `screen_snapshot` is already fully wired (#180): the outbound request, the
fail-closed inbound decode (`parseScreenSnapshotPayload`, which decodes **all eight**
`ScreenSnapshotPayload` fields including `text` + `ts`), and the run-config event `snapshotReceived`
(carrying model / effort / yolo + the two usage ints #191) all exist and are unchanged.

The `screen_snapshot` frame ALSO carries `text` — the rendered daemon screen — which #180
deliberately **decoded but dropped** at the IPC seam (`daemonConnection.ts` `case 'snapshot'`),
keeping the rendered text out of the web layer because no consumer needed it yet. #180 flagged
surfacing `text` as "a separate live-screen-view feature, later ticket." **This is that ticket** (the
data-path half of #147). The display slice **#318** (already blocked-by this ticket) is the first
consumer.

This slice emits a **new dedicated** `screenSnapshotReceived` `DaemonEvent` carrying only `text` +
`ts`, emitted **alongside** the unchanged `snapshotReceived` (the Status Sheet #187/#188 still needs
the run-config fields from the same frame). It ships **dormant**: all three exhaustive renderer
bridges no-op the new arm; #318 is the first real consumer.

**This is a deliberate, security-reviewed widening** of what daemon content crosses IPC — it
reverses the exact `text`-drop #180's security review defended. The operator-confirmed ADR-025
decision is that the desktop/mobile live view *is* the rendered screen text ("Text only, never raw
bytes"), and the daemon renders it to **plain text inside the tui-driver seal** before it ever hits
the wire. Surfacing `text` is therefore the sanctioned design, not a leak. The security review
(§ Security review) walks the widening explicitly.

**No wire-type change.** `text` and `ts` are already decoded by `parseScreenSnapshotPayload`; this
slice only adds the emit + the new event arm + the three bridge no-ops.

## Files to read first

Codegraph is not initialized in this repo (`mcp__codegraph__*` errors here) — this list was built
from direct Read/grep. Every edit mirrors an existing `snapshotReceived` (#180) / `stallDetected`
(#315) counterpart; read those before editing.

| Path (with lines) | What to extract |
|---|---|
| `src/shared/wire/types.ts:183-207` | `ScreenSnapshotPayload` — the decoded shape; `text` and `ts` are both `string`, always-present (no `omitempty`); `ts` is RFC3339. **No change here** — confirms the fields already exist. |
| `src/main/transport/inboundMessage.ts:296-319` | `parseScreenSnapshotPayload` — already decodes `text` + `ts` (required-present, fail-closed). **No change** — confirms nothing to add on the decode side. |
| `src/main/transport/inboundMessage.ts:744-758` | `case 'screen_snapshot'` narrow-before-log block — the content-free diagnostic (`event`/`code: 'screen_snapshot'`/`bytes`/`hash`, no decoded field). **Stays unchanged** (AC3 — `text` never logged). |
| `src/main/daemonConnection.ts:414-428` | `case 'snapshot'` — the existing `snapshotReceived` emit (5 fields, `text`/`ts`/`conversation_id` dropped). This is the **one emit seam**: leave the existing emit exactly as-is, add the new emit right after it. |
| `src/main/daemonConnection.ts:429-441` | `case 'assistant-delta'` — the fresh-literal, named-field emit idiom that carries `text` deliberately ("the boundary defended upstream is the fail-closed decode, not this internal channel"). The new emit follows this exact posture. |
| `src/shared/ipc/events.ts:42-80` | `DaemonEvent` union header + the `snapshotReceived` arm (73-80). Add the new arm right after it; mirror the doc-comment discipline (which fields cross, "no token/key/raw frame", untrusted-text-render-as-plain-text warning for #318). |
| `src/renderer/src/store/daemonEventBridge.ts:53-57, 108-110` | `case 'snapshotReceived': return null` + the `assertNever` default — add a sibling `case 'screenSnapshotReceived': return null`. |
| `src/renderer/src/store/timelineBridge.ts:85-118` | the null fall-through cluster (94 `snapshotReceived`) + `assertNever` — add `case 'screenSnapshotReceived':` to the cluster. |
| `src/renderer/src/store/modalBridge.ts:61-92` | the null fall-through cluster (70 `snapshotReceived`) + `assertNever` — add `case 'screenSnapshotReceived':` to the cluster. |
| `src/main/daemonConnection.test.ts:1024-1147` | the `requestSnapshot` round-trip describe + `snapshotPlaintext` helper + `SNAPSHOT` fixture (note `text: 'secret rendered screen'`, `ts: '2026-07-08T00:00:00Z'`). The decode test (1085-1105) is the exact clone target — extend it to assert **both** events. |
| `src/main/daemonConnection.roundtrip.test.ts:508-591` | the end-to-end `screen_snapshot round-trip` describe (real handshake, `snapshotFrame`). Extend to assert both events emit (AC5). |
| `src/renderer/src/store/daemonEventBridge.test.ts:103-110, 250-252` | the per-arm `snapshotReceived → null` and `stallDetected → null` tests — clone one for `screenSnapshotReceived`. |
| `src/renderer/src/store/timelineBridge.test.ts:144-192` / `modalBridge.test.ts:96-147` | the "inverse filter — every other arm returns null" `others` array (with `snapshotReceived` + `stallDetected` entries) — add a `screenSnapshotReceived` entry to each. |
| `docs/specs/architecture/315-stall-signal-transport.md` | the sibling DaemonEvent-arm spec (bridges-atomic sizing, no-op bridge pattern) — this spec is its near-twin, with the opposite security posture (this one carries `text`). |

## Scope note (why this ships as one XS despite touching 5 production files)

The commit-time ≥5-production-file self-check trips here (5 `.ts` files modified), but this is the
documented **DaemonEvent-arm, bridges-atomic** shape where that gate is *structurally
unsatisfiable*, not a hidden-blowup false negative:

- A new `DaemonEvent` arm (`events.ts`) **compile-forces** a case in all three exhaustive bridges
  (`daemonEventBridge`, `timelineBridge`, `modalBridge`) via their `assertNever` guard. Those cases
  CANNOT land in a separate commit — omitting any one fails `npm run build` (the QA/salvage gate).
  The three bridges are atomic with the arm.
- Unlike a transport ticket, there is **no new wire type and no new decode to peel off** — both
  landed in #180. The only production content is one arm + one emit line + three forced no-op cases.
- Every attempted split either produces a dead-code sub-leaf (an arm with no emit, or an emit with
  no arm — neither compiles/tests) **or** leaves the arm-bearing child still at 5 files. No genuine
  seam exists — today's PO re-refinement reached the same conclusion ("NO seam to split; xs holds,
  bridges-atomic").

**Precedent:** sibling #315 (stall transport) shipped this identical shape (7 production files) as
one ticket. #241 (create_conversation) adjudicated the exact ≥5-file conflict → one `s`. #180 / #214
/ #229 all shipped DaemonEvent-arm additions as single tickets.

Every §1 red line is clear: **0 new files**, **~15 production LOC** (arm + emit + 3 one-line cases,
well under 600 total), **1 new arm**, **4 consumer sites** (1 emit + 3 forced no-op bridges), **5
ACs**, **0 new reject branches** (no decode added — the fail-closed decode is #180's, unchanged).
This is a mechanical mirror of #315 with an exact template; the developer's turn budget is
comfortable.

## Design

Five touch-points. No new files; all edits are additive to existing modules. The wire decode is
**untouched** (already done in #180).

### 1. Typed event — `src/shared/ipc/events.ts`

Add the arm to `DaemonEvent`, immediately after `snapshotReceived` (contract, not implementation):

```ts
| { type: 'screenSnapshotReceived'; text: string; ts: string }
```

- **`text`** is the rendered daemon screen (the wire `ScreenSnapshotPayload.text`). **`ts`** is the
  wire `ScreenSnapshotPayload.ts` (RFC3339 string) — keep the wire name `ts` (a single lowercase
  token, matching how the sibling `snapshotReceived` arm keeps `used_tokens` / `window_tokens`
  rather than gratuitously renaming), and the ticket AC names it `ts`.
- Doc-comment it like `assistantDelta` (the arm that also carries `text` deliberately across IPC):
  this arm carries **only** `text` + `ts` — no token, key, raw frame, `conversation_id`, or run-config
  field (those ride `snapshotReceived`). Note the **deliberate widening**: it reverses #180's
  `text`-drop; the boundary defended upstream is the fail-closed decode, not this internal channel.
  Carry the standard untrusted-text warning for #318: `text` is UNTRUSTED daemon-relayed content — the
  render slice **#318** must render it as **plain text, NEVER HTML** (no `innerHTML` /
  `dangerouslySetInnerHTML`), mirroring the identical warning on `conversationCreated` /
  `sessionTransition` / `queueState`. This slice has no DOM sink; the constraint is inherited for #318.
- Update the union header doc-comment (events.ts:42-61): the current text asserts "the sensitive
  rendered-screen `text` can never ride this channel." That statement is now scoped to
  `snapshotReceived` specifically — reword to: `text` never rides `snapshotReceived` (the run-config
  arm), and crosses only on the dedicated `screenSnapshotReceived` arm (#316), where it is the render
  payload for the live-screen view (#318).

### 2. Emit — `src/main/daemonConnection.ts` `case 'snapshot'`

Leave the existing `snapshotReceived` emit **exactly as-is** (5 fields, unchanged — AC2). Add a
**second** `emitDaemonEvent` call immediately after it, before the `return`, as a **fresh literal
with named fields** (never a spread of `inbound.snapshot`):

```ts
emitDaemonEvent(sink, { type: 'screenSnapshotReceived', text: inbound.snapshot.text, ts: inbound.snapshot.ts })
```

- The fresh, named-field literal is the deterministic net (the `assistant-delta` / `session-transition`
  idiom): it bounds the new event to **exactly** `text` + `ts`. `conversation_id`, `model`, `effort`,
  `yolo`, `used_tokens`, `window_tokens` do NOT ride this event — a future decoder that grew a field
  cannot smuggle it across (AC1/AC3).
- Both emits fire on **every** `screen_snapshot` frame: `snapshotReceived` (run-config, for the Status
  Sheet) and `screenSnapshotReceived` (rendered text, for #318). Two events, one frame.
- Update the `case 'snapshot'` comment (414-419): today it says `text`/`ts`/`conversation_id` are
  "decoded but DROPPED here." Reword to: `conversation_id` is dropped (no consumer); the run-config
  fields ride `snapshotReceived`; `text` + `ts` ride the dedicated `screenSnapshotReceived` (#316 — the
  live-screen data path), never folded into `snapshotReceived`.
- **No new diagnostic log call.** The content-free `screen_snapshot` diagnostic stays in
  `inboundMessage.ts` (unchanged); this emit adds no log, so `text` is never written to a sink (AC3).

### 3–5. Exhaustive bridge no-ops (compile-forced)

Each of `daemonEventBridge.ts`, `timelineBridge.ts`, `modalBridge.ts` switches exhaustively over
`DaemonEvent` with an `assertNever` default; the new arm is a compile error in all three until each
gets a case:

- `daemonEventBridge.ts` — add `case 'screenSnapshotReceived': return null` beside `snapshotReceived`
  (line 53-57); comment: consumed by the display slice (#318, not yet built), not the session store.
- `timelineBridge.ts` — add `case 'screenSnapshotReceived':` to the existing null fall-through cluster
  (beside `snapshotReceived`, line 94).
- `modalBridge.ts` — add `case 'screenSnapshotReceived':` to the existing null fall-through cluster
  (beside `snapshotReceived`, line 70).

No behavior — the first consumer is #318. This is the `snapshotReceived`-was-a-no-op-until-#187 /
`stallDetected`-is-a-no-op-until-#317 precedent.

## State + concurrency model

None introduced. This slice is a pure emit leg on top of the existing #180 decode: no store slice, no
async task, no subscription, no timer, no correlation memory. The `screenSnapshotReceived` event
flows through the existing `parseInboundMessage → daemonConnection dispatch → emitDaemonEvent → IPC →
bridges` path already built for `snapshotReceived`. The two emits in `case 'snapshot'` are
synchronous and independent (separate consumers, separate renderer subscribers).

## Error handling

| Layer | Failure | Result |
|---|---|---|
| decode | malformed / oversized `screen_snapshot` | **Unchanged from #180** — `parseScreenSnapshotPayload` fail-closes (throws `WireDecodeError`); the oversized frame is capped by the frame-level `MAX_PLAINTEXT_BYTES` guard upstream; the connection's existing catch drops the frame → **neither** event emits, no throw. This slice adds no new failure mode: a malformed frame that would have dropped `snapshotReceived` also drops `screenSnapshotReceived` (both gated by the one decode). |
| emit | — | The emit is a fresh nullish-safe literal reading two already-validated `string` fields; nothing can throw. |
| UI surface | — | None this slice; the arm ships dormant. Rendering the text (and any XSS-safe plain-text discipline) is #318. |

## Testing strategy

Test-first (house convention), `npm test` (vitest), `npm run typecheck` for the compile-guard arms,
`npm run build` as the QA gate. Scenarios (developer writes them in the project idiom — do not
pre-write test bodies):

**`src/main/daemonConnection.test.ts`** (extend the existing `requestSnapshot` decode test at
1085-1105, reusing the `SNAPSHOT` fixture whose `text: 'secret rendered screen'` / `ts:
'2026-07-08T00:00:00Z'`):
- Feeding one `screen_snapshot` frame emits **both** events: exactly one `snapshotReceived` (the
  existing 5-field assertion, **unchanged**) **and** exactly one `{ type: 'screenSnapshotReceived',
  text: 'secret rendered screen', ts: '2026-07-08T00:00:00Z' }`.
- **`text` reaches only `screenSnapshotReceived`, never `snapshotReceived`** (AC2): the
  `snapshotReceived` event has no `text` / `ts` field; assert the existing
  `not.toContain('secret rendered screen')` against the `snapshotReceived` event specifically (it
  now appears on `screenSnapshotReceived`, so the old blanket `JSON.stringify(events).not.toContain`
  must be narrowed to the `snapshotReceived` object). `conversation_id` (`'conv-1'`) still appears on
  **neither** event (dropped from both).
- The empty-value case (`text: ''`) decodes through as the value `''`, not dropped (mirror the
  `snapshotReceived` empty-defaults test) — confirms `text` is carried as a required present value.

**`src/main/daemonConnection.roundtrip.test.ts`** (AC5 — extend the end-to-end
`screen_snapshot round-trip` describe at 508-591, which drives the real handshake): one crafted
`screen_snapshot` reply emits **both** `snapshotReceived` and `screenSnapshotReceived`; `text`
reaches `screenSnapshotReceived` and is absent from `snapshotReceived`. Extend `snapshotFrame` to
set a distinctive `text` so the assertion can prove the crossing.

**Bridge no-op coverage** (one-line additions to existing tests, not new files):
- `daemonEventBridge.test.ts` — add a `screenSnapshotReceived → null` per-arm `.toBeNull()` test
  (clone the `snapshotReceived → null` test at 103-110).
- `timelineBridge.test.ts` / `modalBridge.test.ts` — add `{ type: 'screenSnapshotReceived', text:
  '…', ts: '…' }` to each `others` array asserting `.toBeNull()`.

## Open questions

- **`ts` naming.** Kept as the wire name `ts` per the AC and the `snapshotReceived`-keeps-snake
  precedent, rather than renaming to `occurredAt` (as `sessionTransition` did for `occurred_at`). If
  #318 or code-review prefers `occurredAt` for cross-arm consistency, it is a trivial rename confined
  to this arm + its emit + its tests — but the AC names `ts`, so this spec keeps `ts`. Not blocking.
- No other open questions. The wire shape is fully specified (#180), the decode is unchanged, and the
  emit mirrors the vetted `assistant-delta` fresh-literal posture exactly.

## Security review

**Verdict:** PASS

This slice **deliberately widens** what daemon content crosses the main→renderer IPC boundary: it
surfaces `text` (the rendered daemon screen), reversing the exact `text`-drop #180's security review
defended. The review below treats the widening adversarially and finds it sanctioned, minimal, and
correctly bounded.

**Why the widening is acceptable (the core question):**

1. **It is the operator-confirmed feature, not a regression.** ADR-025 defines the desktop/mobile as
   a full remote head whose live view *is* the serialized screen snapshot — "Text only, never raw
   bytes." The daemon renders the live screen to **plain text inside the tui-driver seal** (the
   substrate-guard) *before* it hits the wire; `text` is already the intended, safe representation.
   #180 dropped `text` only because no consumer existed yet (content-minimisation: "don't cross what
   you don't need"), and explicitly named surfacing it as "a separate later ticket" — this one. The
   minimisation principle no longer applies to `text` now that #318 needs it.
2. **`text` is not a secret.** It is the same class of untrusted daemon *display* content as
   `assistantDelta.text` (#199/#203), `toolUse.inputSummary`, `modalShown.prompt`, and
   `conversationCreated.name`/`cwd` — all of which already cross IPC deliberately. It carries no
   token, key, raw frame, Noise material, or credential. The events.ts `assistantDelta` doc-comment
   states the governing principle: "the boundary defended upstream is the fail-closed decode, not
   this internal channel."

**Findings:**

- **[Trust boundaries]** No finding. One explicit boundary: `parseScreenSnapshotPayload` (the
  fail-closed decoder, **unchanged** from #180) validates `text`/`ts` as required-present strings
  before they reach the emit. The emit is a **fresh named-field literal** (`{ text: inbound.snapshot.text,
  ts: inbound.snapshot.ts }`), never a spread of the decoded payload — so the widening is bounded to
  **exactly** `text` + `ts`. `conversation_id`, `model`, `effort`, `yolo`, and the two usage ints do
  NOT ride this arm; a future decoder that grew a field cannot smuggle it across. The pre-existing
  `parseScreenSnapshotPayload` returns a fresh 8-field literal (not a spread), so a hostile
  `__proto__`/`constructor` key can't pollute — prototype-pollution-safe by construction.
- **[Isolation of the widening]** No finding. `text` rides a **new dedicated** `screenSnapshotReceived`
  arm, never folded into `snapshotReceived`. Consequences: (a) the Status Sheet's `snapshotReceived`
  consumer (#187/#188) is byte-for-byte untouched — no accidental widening of an existing path; (b)
  the entire content-widening is a single, auditable diff (one arm + one emit line); (c) a reviewer
  can grep exactly one event type to audit every place `text` flows.
- **[Tokens, secrets]** N/A. No token/secret/credential handling. Any secret that *claude itself*
  rendered onto its screen is the desktop user's **own session content**, surfaced to the user's
  **own paired device** over the **encrypted Noise channel** — the intended remote-head behavior
  (ADR-025), not a third-party exposure. Keys/tokens stay main-side (CLAUDE.md); none rides this arm.
- **[Error messages, logs, telemetry]** No finding (AC3). The existing `screen_snapshot` inbound
  diagnostic (`inboundMessage.ts:751-756`) stays content-free (`event`/`code`/`bytes`/`hash`) and is
  **unchanged**; the new emit adds **no** log call. So `text` is never written to any sink — a crash
  reporter capturing the emit path leaks no daemon content. Thrown `WireDecodeError` messages (decode
  side, unchanged) name the failure category only, never interpolating `text`.
- **[Electron attack surface]** No finding. No new `BrowserWindow`, `webPreferences`, `contextBridge`
  API, or `ipcMain` channel. The event rides the existing `emitDaemonEvent` → typed-IPC path; the
  renderer receives only a `{ text, ts }` literal. Transport/decode/keys stay in the main process.
- **[Downstream XSS deferral]** No finding *for this slice* (no DOM sink — ships dormant). The
  residual risk — a hostile daemon crafting `text` with markup — is correctly deferred to **#318**,
  which MUST render `text` as **plain text, never HTML** (no `innerHTML` / `dangerouslySetInnerHTML`),
  the documented convention for every untrusted-text arm. The arm's doc-comment (§Design 1) carries
  this constraint forward so #318's developer and code-review inherit it.
- **[Cryptographic primitives / Network & I/O / Concurrency / File / storage]** N/A. No RNG, keys,
  nonces, sockets, filesystem, cache, timer, async task, or shared mutable state introduced. The
  decode + double-emit is synchronous within the existing inbound dispatch; oversized frames are
  capped upstream by `MAX_PLAINTEXT_BYTES` (unchanged).
- **[Threat model alignment]** Addressed. **Hostile daemon:** can send arbitrary `text` — but
  displaying the rendered claude screen is the feature's purpose; the defenses are fail-closed decode
  (unchanged), plain-text render at #318 (no injection), and content-free logging (no sink leak); a
  hostile daemon cannot escalate beyond "display arbitrary text." **Compromised relay:** content-blind
  (sees only Noise ciphertext) — cannot read or forge `text` without breaking the handshake; a frame
  flood decodes to bounded stateless emits. **Compromised renderer:** gains `text` (which #318 will
  render for it anyway) but no token/key/secret — it learns nothing beyond the live-screen feature it
  already has. OUT OF SCOPE — the display/rendering and its plain-text discipline are #318 (named).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
