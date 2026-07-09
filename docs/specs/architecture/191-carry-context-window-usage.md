# Spec — Carry context-window usage (`used_tokens` / `window_tokens`) on `screen_snapshot` (#191)

Transport slice of the context-window usage feature (split from #182). Extends
the #180 snapshot decode path (PR #185, commit `915b1be`) to also carry two
always-present numeric usage figures — `used_tokens` and `window_tokens` — onto
the typed `snapshotReceived` event. No UI: the sheet section that draws the "N%
used" gauge is the render sibling **#192** (blocked on this + #188), out of scope
here. This ticket does not normalize or interpret the values (`window_tokens == 0`
is the daemon's "seam unwired" signal); it carries them faithfully as values.

## Files to read first

The change is four additive production edits along the existing `screen_snapshot`
path, plus a mechanical test-literal cascade. Read these in order:

- `src/shared/wire/types.ts:119-138` — `ScreenSnapshotPayload` interface + its doc
  comment. **Edit site 1:** append the two `number` fields after `yolo`, matching
  the existing always-present, no-`omitempty` discipline.
- `src/main/transport/inboundMessage.ts:90-97` — the `requireNumber` helper (the
  fail-closed narrower to reuse; already used for the bundle payloads' `seq` /
  `total`). No change here — just confirm the signature.
- `src/main/transport/inboundMessage.ts:171-191` — `parseScreenSnapshotPayload` +
  its doc comment. **Edit site 2:** add two `requireNumber` calls and include the
  two fields in the returned object. Update the "six known fields" comment to eight.
- `src/main/daemonConnection.ts:257-268` — the `case 'snapshot'` event
  construction (the content-minimisation seam). **Edit site 3:** add the two
  figures beside `model` / `effort` / `yolo`; `text` / `ts` / `conversation_id`
  stay dropped here.
- `src/shared/ipc/events.ts:29-59` — the `DaemonEvent` union + its block comment.
  **Edit site 4:** extend the `snapshotReceived` arm (line 59) with the two
  numeric fields. Still a dedicated minimal shape — NOT a reuse of
  `ScreenSnapshotPayload`, so `text` cannot leak. Update the comment's
  "`snapshotReceived` (#180) carries only the three session-settings fields"
  sentence to say five (model/effort/yolo + the two usage ints).
- `src/renderer/src/store/daemonEventBridge.ts:53` and
  `src/renderer/src/screens/conversation/runConfigSnapshot.ts:27` — the two
  renderer consumers of the arm. Read only to CONFIRM they need **no production
  change**: the bridge's `case 'snapshotReceived': return null` reads no fields,
  and `toRunConfigSnapshot` copies only `model` / `effort` / `yolo` explicitly
  (extending the run-config store to hold usage is **#192's** job). Do not touch
  either file's production body.
- Daemon wire contract (source of truth — do not drift, CLAUDE.md): pyrycode
  `internal/protocol/snapshot.go` (spec #857, merged 2026-07-09) appends
  `UsedTokens int json:"used_tokens"` and `WindowTokens int json:"window_tokens"`
  after `YOLO`, both no-`omitempty`. Semantics: `used_tokens` = current context
  size on the latest usage-bearing transcript entry (input + cache-read +
  cache-creation + output), **NOT a running total** (a post-compaction snapshot
  reports a smaller figure); `window_tokens` = context-window size (200000 for
  current models), `0` = seam unwired. The desktop decodes by field name, so wire
  order is irrelevant to the parser; the interface mirrors the daemon for no-drift
  review only.

### Test-literal cascade — the AC5 regression guard (enumerate before editing)

Adding two **required** fields to the `snapshotReceived` union arm is a
compile/assert break at every literal that CONSTRUCTS or asserts one, and every
`ScreenSnapshotPayload` wire fixture gains the two ints. This is mechanical and
in-scope — it is the AC5 regression guard, not a separable migration. Two central
`SNAPSHOT` fixtures absorb the wire-side cascade via `{ ...SNAPSHOT }` spread;
update those first, then the explicit event literals.

**A. Central wire fixtures (spread-based — update these first, derivatives follow):**
- `src/main/daemonConnection.test.ts:892` — `const SNAPSHOT: ScreenSnapshotPayload`
  (spread by lines 952 / 967 / 983 — those need no edit once the base gains the ints).
- `src/main/transport/inboundMessage.test.ts:52` — `const SNAPSHOT` (spread by all
  `{ ...SNAPSHOT }` derivatives at 184 / 192 / 207-211 / 221-223 / 241 / 426 / 444).
- `src/main/daemonConnection.roundtrip.test.ts:518-532` — the `snapshotFrame(...)`
  helper's inline payload (not spread — one edit covers both round-trip tests).

**B. Explicit `snapshotReceived` event literals — each gains the two ints (AC5):**
- `src/main/daemonConnection.test.ts:956` and `:971` (two decode asserts).
- `src/main/daemonConnection.roundtrip.test.ts:561` and `:585` (two round-trip asserts).
- `src/renderer/src/store/daemonEventBridge.test.ts:105` (translate input).
- `src/renderer/src/screens/conversation/logDataDownload.test.ts:72` (event input).
- `src/renderer/src/screens/conversation/runConfigSnapshot.test.ts:23`, `:28-33`,
  `:93`, `:112`, `:113` (five `snapshotReceived` inputs — `const event` and
  `bridge.emit(...)`).

**C. Do NOT touch — these stay three fields (AC5: "assert the old three fields
verbatim"):** the `toRunConfigSnapshot(...)` OUTPUT assertions at
`runConfigSnapshot.test.ts:24` and `:34`, and the `RunConfigData`-mapped
expectations. `toRunConfigSnapshot` deliberately maps only model/effort/yolo; its
output shape is #192's concern. Only the `snapshotReceived` *inputs* gain ints.

## Context

The daemon's `screen_snapshot` reply now carries two additional always-present
fields — `used_tokens` and `window_tokens` (pyrycode #857, merged 2026-07-09) —
alongside the existing `conversation_id / text / ts / model / effort / yolo`. The
desktop already fetches model/effort/yolo through this one snapshot request (#180,
PR #185). This ticket extends that same decode path to also carry the two usage
figures onto the `snapshotReceived` event, so the Run configuration sheet (#192)
can render a real "N% used" gauge instead of a placeholder.

## Design source

N/A — transport data path, no UI surface. The gauge's visual design lands in #192.

## Scope & size (auditable)

Sized **S**, atomic, **not split.** Honest counts:

- **4 production files, all purely additive** — `types.ts`, `inboundMessage.ts`,
  `daemonConnection.ts`, `events.ts` (under the ≥5-file self-check line). ~8
  production LOC total; 0 new exported types (extends one interface + one union
  arm); **zero production consumer cascade** — the two renderer consumers compile
  unchanged (verified: no production code reads `used_tokens` / `window_tokens`).
- **~11 `snapshotReceived` event literals + 3 central wire fixtures + new AC2/AC3
  decode scenarios** ≈ 15-20 mechanical two-int appends, ~70-90 LOC total.

The ~11-literal count sits above the 10-edit-site red line, so here is the
explicit non-split justification (per the size-check discipline — stated, not
rationalized away):

- **The cascade is test-fixture-only, not a production signature cascade.** Unlike
  the #29 / #75 interface-rename shape, no production call site changes — the
  literals are value assertions of one shape at enumerated lines, and every edit
  is a fixed `, used_tokens: N, window_tokens: M` append. This spec enumerates all
  of them (§ "Test-literal cascade" above), so the developer has zero exploration
  cost.
- **It is genuinely atomic — no buildable split exists.** Adding two required
  fields to a discriminated-union arm breaks every construct site simultaneously;
  there is no compiling intermediate. The only way to stage it (make the fields
  optional first) is forbidden by AC1/AC2 ("both always-present, no optionality",
  "never silently defaulted") AND would still hit the identical ~11-literal
  cascade in the follow-up — strictly worse. The Strangler-Fig pattern does not
  apply because there are no production consumers to migrate.
- **The wire cascade collapses.** The two central `SNAPSHOT` fixtures feed most
  wire-side derivatives by spread, so the *distinct* edits are ~15, several
  one-liners.

## Design

Four additive edits along the existing `screen_snapshot` spine — no new file, no
new type, no new state.

### 1. Wire types — `src/shared/wire/types.ts` (additive)

Append the two fields to `ScreenSnapshotPayload`, field-for-field with the daemon
struct (contract sketch — see the daemon-struct doc comment already in the file):

```ts
export interface ScreenSnapshotPayload {
  // …existing conversation_id, text, ts, model, effort, yolo…
  used_tokens: number    // current context size on the latest usage-bearing entry; NOT a running total
  window_tokens: number  // context-window size (200000 today); 0 = usage seam unwired
}
```

Both always-present, no `?`. Extend the interface's doc-comment wire-order note to
list the two new fields after `yolo`.

### 2. Inbound decode — `src/main/transport/inboundMessage.ts` (additive)

In `parseScreenSnapshotPayload`, add two `requireNumber(payload, 'used_tokens')` /
`requireNumber(payload, 'window_tokens')` calls (the same helper as the bundle
`seq` / `total`), and include both in the returned object. `requireNumber`
fail-closes exactly as needed: a missing field or a non-number throws
`WireDecodeError` (AC2); a `0` is a valid number, decoded as the value `0`, never
treated as absent (AC3). Update the "Returns only the six known fields" doc
comment to eight. No change to the size guard, the diagnostic log call (still the
content-free `{event, code, bytes, hash}` set — no new field), or the `switch`
routing.

### 3. Event construction — `src/main/daemonConnection.ts` (additive)

In `onDriverEvent`'s `case 'snapshot'`, add the two figures beside the existing
three when building the emitted event:

```ts
emitDaemonEvent(sink, {
  type: 'snapshotReceived',
  model: inbound.snapshot.model,
  effort: inbound.snapshot.effort,
  yolo: inbound.snapshot.yolo,
  used_tokens: inbound.snapshot.used_tokens,
  window_tokens: inbound.snapshot.window_tokens
})
```

**This stays the content-minimisation seam** — `text` / `ts` / `conversation_id`
are decoded but still dropped here; only the settings + the two usage ints cross
to the renderer. The two new fields are non-secret integers (see Security review).

### 4. Event surface — `src/shared/ipc/events.ts` (additive)

Extend the `snapshotReceived` arm of `DaemonEvent`:

```ts
| { type: 'snapshotReceived'; model: string; effort: string; yolo: boolean
    ; used_tokens: number; window_tokens: number }
```

Still a **dedicated minimal shape**, deliberately NOT reusing
`ScreenSnapshotPayload` (which carries `text`). Maps to no `SessionAction`. Update
the union's block comment where it enumerates the `snapshotReceived` fields.

### Data flow (unchanged from #180 except the two carried ints)

```
daemon → screen_snapshot frame → onDriverEvent 'message' → parseInboundMessage
      → {kind:'snapshot', snapshot}  [now with used_tokens/window_tokens]
      → emitDaemonEvent {type:'snapshotReceived', model, effort, yolo,
                         used_tokens, window_tokens}   [text/ts/conv_id dropped here]
      → DAEMON_EVENT_CHANNEL → window (#192 draws the gauge)
```

## State + concurrency model

- **No new state.** No reassembler, consumer, timer, or pending-request map. The
  two fields ride the existing single request→reply→emit path (recognised by
  `envelope.type`). Nothing to cancel, nothing to strand on teardown. Envelope-id
  and correlation behaviour are unchanged from #180.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| `screen_snapshot` missing `used_tokens` or `window_tokens` | `parseScreenSnapshotPayload` (`requireNumber`) | throws `WireDecodeError` → dropped at `onDriverEvent`'s catch; no event (AC2, fail-closed) |
| `used_tokens` / `window_tokens` present but non-number (string/null/bool) | `requireNumber` | throws — treated as malformed, never a partial value (AC2) |
| `used_tokens: 0` / `window_tokens: 0` | `requireNumber` | accepted as the value `0` (a valid number, distinct from absent — AC3) |
| All existing model/effort/yolo failure modes | unchanged | as #180 — regression-guarded, no behaviour drift (AC5) |

All decode error messages remain category-only — no field value interpolated
(mirrors `parseMessagePayload`; the two ints are non-secret but the discipline is
uniform).

## Testing strategy

`npm test` (vitest), `npm run typecheck`, `npm run build` (salvage/QA gate). The
bulk is the mechanical AC5 cascade (§ "Test-literal cascade") plus a small set of
new scenarios for the two fields. Write scenarios, not full test bodies:

- **`inboundMessage.test.ts` (extend)** — reuse the existing fail-closed pattern:
  - add `used_tokens` and `window_tokens` to the central `SNAPSHOT` fixture (:52);
  - add each of `{ ...SNAPSHOT, used_tokens: undefined }`,
    `{ ...SNAPSHOT, window_tokens: undefined }` to the missing-field reject list
    (the :207-211 style block) — asserts each throws `WireDecodeError` (AC2);
  - add a non-number reject case for each field (e.g. `used_tokens: '5'`,
    `window_tokens: null`) — throws (AC2);
  - add a `{ ...SNAPSHOT, used_tokens: 0, window_tokens: 0 }` accept case — decodes
    to `{ kind: 'snapshot', snapshot }` carrying `0`/`0` (AC3);
  - the existing happy/defaults/forward-compat tests auto-carry the ints via the
    spread fixture (update the "all six fields" title to eight — cosmetic).
- **`daemonConnection.test.ts` (extend)** — the two existing snapshot decode tests
  (:949, :964) now assert `used_tokens`/`window_tokens` on the emitted
  `snapshotReceived` (via the updated `SNAPSHOT` fixture + the two explicit event
  literals at :956 / :971). Add the `0`/`0` value passthrough to the defaults test
  or a sibling — assert the emitted event carries `0`/`0`, not a dropped/defaulted
  field. Keep the existing content-minimisation asserts (`text` / `conv-1` never
  in `JSON.stringify(events)`) — they still hold (AC4-parity for #180).
- **`daemonConnection.roundtrip.test.ts` (extend, AC5 E2E)** — the `snapshotFrame`
  helper (:518) gains the two ints on its crafted payload; the two round-trip
  asserts (:561, :585) gain them on the expected `snapshotReceived`. Confirm the
  `SECRET_SCREEN` never-appears assertion still passes (the two ints are not
  secret and do not carry `text`).
- **Renderer consumer regression (AC5)** — after adding the ints to the
  `snapshotReceived` inputs in `daemonEventBridge.test.ts` / `runConfigSnapshot.test.ts`
  / `logDataDownload.test.ts`, the `toRunConfigSnapshot` OUTPUT assertions and the
  translate-to-`null` behaviour must be **unchanged** — this is the guard that
  the render store stays a three-field shape until #192.

## Out of scope

- **Rendering the gauge / normalizing `window_tokens == 0`** — #192 (blocked on
  this + #188). This ticket carries `window_tokens` faithfully as a value; it does
  not interpret the `0` seam-unwired signal or compute a percentage.
- **Extending the #187 run-config store to hold usage** — #192. `toRunConfigSnapshot`
  and `runConfigStore` stay three-field here.
- **Daemon `error` reply → "usage unavailable" event** — inherited from #180's
  out-of-scope (needs `in_reply_to` correlation the transport lacks; evidence-based).

## Open questions

- **None.** The path, the helper, the seam, and the content-minimisation
  discipline are all established by #180 (PR #185); this is a faithful two-field
  extension with the wire contract fixed by pyrycode #857.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the only boundary this touches is the
  established daemon→parsed seam at `parseScreenSnapshotPayload`
  (`src/main/transport/inboundMessage.ts:180`). The two new fields cross it
  fail-closed via `requireNumber` (`:90`, `typeof !== 'number'` throws
  `WireDecodeError`); downstream holds typed `number`s. No boundary is invented or
  moved — same single-function seam as #180, extended by two of the same
  discipline. The renderer→main command boundary is untouched (this ticket adds no
  command; the two fields ride only the outbound event).
- **[Tokens / secrets]** No findings — the two fields are integers reflecting the
  session's context-window occupancy (a *token count*, not a token/credential).
  No key, credential, or secret is introduced, stored, or compared. `used_tokens`
  is coarse non-secret runtime state the daemon deliberately surfaces for display,
  the same class as model/effort/yolo.
- **[File / storage]** N/A — no filesystem or storage operation. Request→reply→emit
  in memory; the two ints are never persisted, cached, or written.
- **[Electron attack surface]** No findings — **no new IPC channel, no new
  preload / `contextBridge` API.** The two fields ride the existing generic
  `DAEMON_EVENT_CHANNEL` (main→renderer). The renderer gains two read-only
  integers, no new capability. **Content minimisation preserved:** `text` / `ts` /
  `conversation_id` are still dropped at the `daemonConnection` `case 'snapshot'`
  seam; the two ints are added to the dedicated minimal `snapshotReceived` shape
  (still NOT a reuse of `ScreenSnapshotPayload`), so `text` still cannot ride the
  event. SHOULD-FIX guardrail for code-review (inherited from #180): confirm the
  emitted event carries only model/effort/yolo + the two ints, never `text` — a
  naive "reuse the wire type" would leak it to the renderer/DevTools. The spec
  designs the drop in; this is a guardrail, not a defect.
- **[Cryptographic primitives]** N/A — rides the established Noise session
  unchanged. No new handshake, key, nonce, or comparison; the `screen_snapshot`
  frame is decrypted by the existing session, and the two fields are read from the
  already-decrypted, already-narrowed payload.
- **[Network & I/O]** No findings — no new socket, timeout, or reconnect path. The
  inbound reply stays bounded by the existing `MAX_PLAINTEXT_BYTES` guard at the
  top of `parseInboundMessage`; two extra integer fields add negligible bytes and
  cannot amplify. `requireNumber` accepts any finite JS number, and JSON.parse
  cannot yield `NaN`/`Infinity` (they arrive as `null`, which `requireNumber`
  rejects) — so no NaN/Infinity slips through. A hostile daemon flooding
  `screen_snapshot` frames is the same inherited exposure as #180 (inside the
  authenticated session), not introduced here.
- **[Error messages, logs, telemetry]** No findings — `requireNumber`'s
  fail-closed message interpolates only the field NAME (`used_tokens` /
  `window_tokens`), never the value; category-only, matching `requireString`. The
  snapshot diagnostic reuses the existing content-free `{event, code, bytes, hash}`
  field set — **no new `DiagnosticEvent` field**, so the #131 renderer
  main-process pin is untouched and the two values are never logged.
- **[Concurrency]** No findings — no new async task, timer, listener, or
  reassembler slot. The `case 'snapshot'` emit is synchronous; the two fields are
  read off the already-narrowed payload with no shared-state access, no
  check-then-act, nothing to cancel or strand on teardown.
- **[Threat model alignment]** No findings.
  - *Hostile / compromised relay:* content-blind and cannot forge an in-session
    frame (lacks the Noise keys); can only drop/delay/reorder the reply → no event,
    no hang (fire-and-forget). Unchanged from #180.
  - *Hostile daemon response:* a `screen_snapshot` missing either field, or
    carrying a non-number, fails closed (`requireNumber` throws → dropped at
    `onDriverEvent`'s catch → no event). A daemon that lies with an absurd or
    negative token count is a display-integrity concern, not a transport
    compromise — the value is authenticated (only the real daemon can emit an
    in-session frame) and bounded (an 8-byte float); the worst case is a wrong
    gauge. See OUT OF SCOPE.
  - *Renderer compromise reaching transport:* process isolation unchanged; the
    renderer gains two read-only integers, never keys, token, or socket.
- **[OUT OF SCOPE]** Display-sanity clamping of nonsensical usage figures (negative
  `used_tokens`, `window_tokens > used_tokens` inversions, `used > window`
  overflow, percentage > 100) belongs to the render slice **#192**, which owns the
  gauge and must clamp for display. This ticket carries `window_tokens == 0`
  (seam-unwired) and all other values faithfully by design (AC), so the transport
  performs no interpretation. Not a security hole — an authenticated, bounded value
  producing at worst a wrong display, handled where it is displayed.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-09
