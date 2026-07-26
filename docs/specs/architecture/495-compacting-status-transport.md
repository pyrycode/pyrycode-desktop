# #495 — Compaction-status transport: decode the daemon `compacting` frame into a typed event

**Size:** S (no split — see § Scope) · **Security-sensitive:** yes (review at the end) · **Ships dormant:** #496 is the first consumer.

## Design source

N/A — transport-only decode slice with zero rendered surface. The on-thread "Compacting conversation" status is #496, which owns the Figma anchor. Code-review's visual-fidelity check is intentionally skipped for this ticket.

## Files to read first

Read in this order. The first entry is the whole design; the rest are the local idioms it lands in.

| Path | What to extract |
|---|---|
| `git show e08f33d` (PR #494, #492) | **The design, verbatim.** 13 files, 442 insertions, zero code-review findings. This slice is that commit minus the two counter fields (`current` / `total`) and their two `requireNumber` lines. Read it before anything else; everything below is a delta against it. |
| `src/shared/wire/types.ts:55-60` | `EnvelopeType` union — `'stall'` `:57`, `'api_retry'` `:58`. Add `'compacting'` after. |
| `src/shared/wire/types.ts:270-307` | `StallPayload` `:280` (one-field shape) and `ApiRetryPayload` `:301` + its docstring `:285-300`. The new payload's shape sits between them in size; the docstring is the model for tone and for what wire facts get recorded. |
| `src/main/transport/inboundMessage.ts:203-239` | `isRecord` `:206`, `requireString` `:211`, `requireBoolean` `:233`. **Both fields map onto existing helpers — do not add one.** `requireBoolean`'s docstring already states the falling-edge rule: the check is on the TYPE, never truthiness. |
| `src/main/transport/inboundMessage.ts:398-443` | `parseStallPayload` `:408` and `parseApiRetryPayload` `:434`. Clone the latter's structure, drop the two numeric lines. |
| `src/main/transport/inboundMessage.ts:915-941` | The inbound `case 'stall'` `:915` and `case 'api_retry'` `:929`. Note the narrow-**before**-log ordering and the content-free diagnostic field set. |
| `src/main/transport/inboundMessage.ts:183-184` | `InboundDaemonMessage` arms for `stall` / `api-retry`. |
| `src/shared/ipc/events.ts:119-134` | `DaemonEvent` arms `stallDetected` `:121` and `apiRetry` `:134` with its docstring `:122-133`. |
| `src/main/daemonConnection.ts:594-617` | The `stall` emit `:594` and the `api-retry` emit `:602`. **Read the `:599` comment** — this inner switch has no `assertNever`, so the emit is not compile-forced. |
| `src/renderer/src/store/daemonEventBridge.ts:138-143` | The dormant `apiRetry` arm — own `case` + comment + `return null`. Valid clone target. |
| `src/renderer/src/store/modalBridge.ts:84-106` | The fall-through label cluster; `apiRetry` `:95` is its **last label**, directly above the shared comment. Valid clone target. |
| `src/renderer/src/store/timelineBridge.ts:86-149` | ⚠ **Read this one carefully — the ticket body's anchor for this file is stale.** See § The one stale anchor. |
| `src/main/daemonConnection.ts:871` | `capabilities: [CAPABILITY_INTERACTIVE]` — already advertised. No capability work; this is a read-only confirmation. |
| `docs/knowledge/features/inbound-message-decode.md` | The decode seam's existing knowledge doc; useful framing, not a deliverable (documentation phase owns it). |

## Context

When claude auto-compacts it goes silent on the content channel for tens of seconds. The daemon detects this and emits a `compacting` frame on the v2 interactive stream (pyrycode #1074, merged; detector upstream tui-driver #298, closed). It fans the frame out **only to `interactive`-capable clients**, and desktop already advertises `interactive` — so the frame reaches us today and the transport drops it as an unmodeled type. That is why the window still shows a frozen thinking state.

This is the decode half only. It ships the event dormant; #496 renders it. Because the frame is silently dropped today, there is no regression risk in the interim.

**Wire contract** (SSOT re-verified on pyrycode `main`: `internal/protocol/interactive.go:106-115`, `docs/protocol-mobile.md:594-607`, `internal/protocol/testdata/compacting.json`):

- Type string `compacting`; payload `conversation_id` (string) + `active` (bool), both always present, no `omitempty`.
- **Banner-only.** tui-driver streams no compaction progress, so there is no counter, percentage, or elapsed time to carry. Do not invent one.
- **Explicit falling edge**, like `api_retry` and unlike `stall` (#315, onset-only): `active: true` starts, `active: false` finishes. The client clears on the falling edge rather than deriving a self-clear from turn activity.
- A PTY-derived status peer of `stall`: conversation-level, no `turn_id`, and receiving it never opens, closes, or alters a turn (pyrycode `cmd/pyry/interactive_turn_v2_test.go:705`).
- Canonical fixture payload: `{"conversation_id":"c1","active":true}`.

## Scope — why 7 production files is still S

The architect's "≥5 production files → split" gate trips here. It is a **false positive with a measured precedent**, not a rationalization:

- The identical shape shipped as **one commit** (`e08f33d`, 13 files, 442 insertions), first-try green, **zero code-review findings**. This slice is strictly smaller — two fewer fields, two fewer decoder lines, two fewer assertions per test.
- **A split does not resolve the gate.** The only real seam is decoder (`types.ts` + `inboundMessage.ts`) vs event-and-emit (`events.ts`, `daemonConnection.ts`, 3 bridges). That yields a first child shipping *literally unreachable* code — a decoded union arm no caller reads — and a second child of **5 production files**, which trips the same gate again. A gate that both children fail is not measuring this work.
- The three bridge edits are compile-forced: a new `DaemonEvent` arm breaks all three `assertNever` guards, so they cannot land in a separate commit without a red build.
- Substantive edits are three files (`types.ts`, `inboundMessage.ts`, `daemonConnection.ts`); the other four are one added arm or one added label each.

Red lines, counted raw: **0** new files · **~380** total LOC (production + tests) · **1** new exported type (`CompactingPayload`) · **3** compile-forced consumer sites · **5** acceptance criteria · **3** reject branches in the new parser. All clear.

## Design

Seven production files, in dependency order. Each is an additive clone of its `api_retry` peer.

### 1. `src/shared/wire/types.ts`

Add `'compacting'` to `EnvelopeType` after `'api_retry'` (`:58`), and a new payload interface after `ApiRetryPayload`:

```ts
export interface CompactingPayload {
  conversation_id: string
  active: boolean
}
```

Docstring (modelled on `ApiRetryPayload`'s at `:285-300`) must record: the daemon source (pyrycode #1074, detector tui-driver #298); interactive-only fan-out; **banner-only — no counter exists on the wire, do not add one**; explicit falling edge, contrasted against `stall`'s onset-only; conversation-level, so no `turn_id` and no turn-lifecycle effect.

### 2. `src/main/transport/inboundMessage.ts`

- Import `CompactingPayload`.
- Add the union arm after `:184`: `| { kind: 'compacting'; compacting: CompactingPayload }`.
- Add a paragraph to the module docstring describing the `compacting` kind, peer of the `api-retry` paragraph at `:103-112`.
- Add `parseCompactingPayload(payload: unknown): CompactingPayload` immediately after `parseApiRetryPayload` (`:434`). Behaviour: reject a non-record with `WireDecodeError('malformed compacting payload')`, then `requireString(payload, 'conversation_id')` and `requireBoolean(payload, 'active')`, returning a **fresh two-field literal**. No new helper, no range or enum check, no cross-field validation.
- Add `case 'compacting'` to `parseInboundMessage` after `case 'api_retry'` (`:929-941`). Ordering is load-bearing: **narrow first, log second**, so a malformed frame throws and leaves no diagnostic record. The diagnostic reuses the existing content-free field set — `event: 'inbound-decoded'`, `code: 'compacting'`, `bytes: plaintext.length`, `hash: hashPlaintext(plaintext)`. `DiagnosticEvent.code` is an open `string` (`diagnosticLog.ts:43`), so no type widening.

Returning a fresh literal rather than the decoded object is what makes unknown server-added keys tolerated (forward-compat) but not copied through — and prototype-pollution-safe.

### 3. `src/shared/ipc/events.ts`

Add after the `apiRetry` arm (`:134`):

```ts
| { type: 'compacting'; active: boolean }
```

`conversation_id` is **dropped at the emit** — single active conversation, the `turnState` / `stallDetected` / `apiRetry` convention. The docstring must state: what crosses IPC is one bool and nothing else, so no token, key, raw frame, or conversation content can ride an arm with no string field on it; the arm is not deduped (the transport holds no state); it ships dormant until #496.

### 4. `src/main/daemonConnection.ts`

Add `case 'compacting'` to the inner switch after `case 'api-retry'` (`:602-617`), emitting a fresh named-field literal:

```ts
emitDaemonEvent(sink, { type: 'compacting', active: inbound.compacting.active })
```

Never `{ type: 'compacting', ...inbound.compacting }` — the spread would smuggle `conversation_id` across IPC today and any future decoder field tomorrow. Carry over the `:599` warning in the comment: **this switch has no `assertNever`, so a missing or wrong emit compiles silently and the round-trip test is the sole guard.**

### 5–7. The three renderer bridges

All three are dormant no-op arms; #496 promotes whichever it needs. **They do not share an arm shape — clone each file's local idiom, not one shape three times.**

| File | Shape | Where |
|---|---|---|
| `daemonEventBridge.ts` | Own `case` + comment + `return null` | Adjacent to `case 'apiRetry'` `:138-143` |
| `modalBridge.ts` | One added fall-through label + one sentence in the shared comment | After `case 'apiRetry'` `:95` (currently the last label) |
| `timelineBridge.ts` | One added fall-through label + one sentence in the shared comment | After `case 'notificationActivated'` **`:129`** — see below |

In both fall-through clusters: **add a label, never repurpose or replace one.** Replacing silently drops a live arm from an exhaustive switch that still compiles.

### The one stale anchor — `timelineBridge.ts`

The ticket body lists `timelineBridge.ts | case 'apiRetry' :118` as the clone target. **That anchor is stale and following it breaks #493.** #493 merged after the ticket body was written and promoted `apiRetry` from a dormant label to an **owned arm** that returns a `ThreadEvent` — it now sits at `:92-103`, above the dormant cluster, exactly as #317 did to `stallDetected` (`:86-91`).

Current structure:

- `:86-91` — `stallDetected`, **owned** (#317)
- `:92-103` — `apiRetry`, **owned** (#493)
- `:104-129` — dormant fall-through labels, last one `case 'notificationActivated':` at `:129`
- `:130-148` — the shared comment block naming each dormant arm's real consumer
- `:149` — the single `return null`

`case 'compacting':` goes at **`:130`** — after `notificationActivated`, immediately before the comment block — and the comment block gains one sentence naming #496 as its consumer. An `Edit` anchored on `case 'apiRetry':` in this file lands on the owned arm and destroys #493's timeline consumer.

`modalBridge.ts` and `daemonEventBridge.ts` are unaffected: #493 did not touch either, so their `apiRetry` anchors are valid clone targets.

## State + concurrency model

**This leg holds no state, and that is the design.** No dedup, no coalescing, no timers, no last-value memo. The per-frame dispatch is already stateless, so the wire's "a repeated same-edge frame emits its own event" contract comes for free — the risk is a developer *adding* an edge memo as a perceived optimisation, not omitting one. #496 is idempotent on repeats.

No new async tasks, subscriptions, listeners, or teardown paths. The frame arrives on the existing decrypted-message path and dispatches synchronously.

## Error handling

Fail-closed at the decoder, and only at the decoder:

| Input | Result |
|---|---|
| Non-object payload (`null`, array, string, number) | `WireDecodeError('malformed compacting payload')` |
| `conversation_id` missing or not a string | `WireDecodeError('missing required field: conversation_id')` |
| `active` missing or not a boolean (`0`, `'true'`, `null`) | `WireDecodeError('missing required field: active')` |
| `active: false` | **Decodes successfully** — `false` is a value, not an absence. The check is on the type, never truthiness. |
| Unknown server-added key (e.g. a spurious `turn_id`) | Tolerated, not copied through (fresh literal) |
| Well-formed envelope of any other type | Still returns `null` — recognition is additive |
| Oversized frame | Already covered by the frame-level `MAX_PLAINTEXT_BYTES` guard (`:810`) |

Never a partial value. Error messages name the failure **category** only and never interpolate a value — a `conversation_id` is conversation-correlating.

There is no user-facing error surface: the event ships dormant, and a throw is caught by the existing decode-path handling.

## Testing strategy

House convention is test-first — a failing test per criterion, implementation after. Six test files, all cloning their `api_retry` peer.

**`src/shared/wire/types.test.ts`** (clone the block at `:129-161`)
- `'compacting'` is assignable to `EnvelopeType`.
- A `CompactingPayload` literal has exactly the two fields.
- ⚠ **Compile-only RED.** vitest strips type annotations, so these pass at runtime regardless. The red state is `npm run typecheck`, not a failing vitest run. Do not chase a runtime failure here.

**`src/main/transport/inboundMessage.test.ts`** (helper clone `:143-145`, fixture clone `:186-187`, describes at `:1481` / `:1517` / `:1564`, diagnostics at `:2340` / `:2364`)
- A rising-edge `compacting` narrows to `{ kind: 'compacting' }` carrying both fields.
- A falling edge (`active: false`) decodes successfully with `active === false`.
- Each malformed field fails closed, one test per field: missing / wrong-typed `conversation_id`, missing / wrong-typed `active`. Include `active: 0` and `active: 'true'` — the truthiness traps.
- A non-object payload throws.
- An unknown extra key is tolerated and absent from the returned value.
- The diagnostic on the success path carries `code: 'compacting'` plus only `bytes` / `hash` — the `conversation_id` appears nowhere in the record.
- **No diagnostic is logged on the malformed-throw path.**

**`src/main/daemonConnection.test.ts`** (clone `describe` at `:1392`, helper `compactingPlaintext` from `apiRetryPlaintext` `:251`) — the sole guard on the emit, since the inner switch has no `assertNever`. Harness is `drivers[0].emit({ type: 'message', plaintext })` against a `connected()` fixture; there is no `fakeDaemon`.
- A rising edge emits exactly one `{ type: 'compacting', active: true }`.
- A falling edge emits with `active: false`.
- **Two consecutive identical rising-edge frames emit two events** — the no-dedup pin.
- Assert the exact emitted-event array **and** that `Object.keys(event).sort()` is exactly `['active', 'type']`. This key-set assertion is load-bearing: it is what fails if someone writes the `...inbound.compacting` spread, since `conversation_id` is in the decoded payload but not the arm. Keep that field-drop asymmetry or the test stops proving anything.
- A malformed frame emits nothing.

**The three bridge tests** — one added assertion each, in the *dormant* test, not the owned one:
- `daemonEventBridge.test.ts:270` — `compacting` → `null`, both edges.
- `modalBridge.test.ts:150-167` — add `{ type: 'compacting', active: true }` to the `others` array with a one-line comment naming #496.
- `timelineBridge.test.ts:167-233` — add it to the **"every other arm returns null"** describe. ⚠ Not to `:35` ("the two owned arms") and not near `:130` / `:449`, which are #493's owned `apiRetry` tests.

Gate: `npm test` green and `npm run build` clean.

## Completeness check — corrected blast radius

The ticket body says `grep -rl 'apiRetry\|api_retry\|api-retry' src/` returns **13 files, all needing a peer, with an empty skip-list**. That was true when the body was written. **#493 has since merged and it now returns 18.** A reviewer applying the body's version verbatim will report five false gaps.

**In scope — 13 files, every one needs a `compacting` peer:**

`types.ts` · `types.test.ts` · `inboundMessage.ts` · `inboundMessage.test.ts` · `events.ts` · `daemonConnection.ts` · `daemonConnection.test.ts` · `daemonEventBridge.ts` · `daemonEventBridge.test.ts` · `timelineBridge.ts` · `timelineBridge.test.ts` · `modalBridge.ts` · `modalBridge.test.ts`

**Out of scope — 5 files, #493-owned render state, #496's territory. A `compacting` peer here is scope creep, not completeness:**

`src/renderer/src/store/threadTimeline.ts` · `threadTimeline.test.ts` · `src/renderer/src/screens/conversation/ConversationScreen.tsx` · `ConversationScreen.test.tsx` · `conversation.css`

So the skip-list is **not** empty — it is exactly the render surface, which is the same reason #492's reviewer skipped `threadTimeline.ts` as #317-owned. The pattern generalises: each render slice adds its own files to this grep, so the transport slice's in-scope set stays the 13 and the render-owned remainder grows.

## Open questions

- **None blocking.** The wire contract is closed (banner-only, two fields, explicit falling edge), both fields map onto existing helpers, and the clone target shipped with zero review findings.
- Deferred to #496, named here so they are not re-litigated in this slice: whether `compacting` supersedes the generic thinking indicator, and how it composes with an already-showing `stall` or `apiRetry` status. ⚠ #496 must **not** copy #317's `&& !state.stalled` guard widening — `compacting` clears on its own explicit falling edge, never on turn activity. Inverse semantics.
- Whether a future daemon change adds compaction progress. If it does, it is a wire change with a matching daemon peer (ADR 0002) and a new ticket — not a client-side invention.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The untrusted→trusted boundary is one explicit function, `parseCompactingPayload` in `src/main/transport/inboundMessage.ts`, reached only through `parseInboundMessage`'s `case 'compacting'`. Downstream code holds the narrowed `CompactingPayload` / `DaemonEvent` types only; there is no second parse site. The second boundary — main→renderer over IPC — narrows *further*, to a single `boolean`. Both are named types on a discriminated union, so a consumer cannot silently receive raw payload.
- **[Tokens, secrets, credentials]** Not applicable by construction. This path touches no token, key, or credential: it reads two fields off an already-decrypted frame and forwards one bool. Nothing is generated, stored, rotated, or revoked.
- **[File / storage operations]** Not applicable. No filesystem access, no path construction from wire input, no persistence. The decoded value is forwarded and discarded.
- **[Inter-process / Electron attack surface]** No findings. The slice adds one arm to the existing `DaemonEvent` union on the established `emitDaemonEvent` channel — no new `contextBridge` API, no new `ipcMain` handler, no widening of the renderer's capability. The arm carries **one boolean and no string field**, which is the structural guarantee that no content can ride it. The fresh-named-field-literal rule (never `...inbound.compacting`) is what preserves that guarantee against a future decoder field, and is pinned by the round-trip key-set assertion rather than left to review vigilance. Transport, keys, and sockets stay in the main process; unchanged by this slice.
- **[Cryptographic primitives]** Not applicable. Decode runs after Noise decryption on the existing path; no primitive, key, or nonce is selected, derived, reused, or compared here.
- **[Network & I/O]** No findings. No new socket, connection, timeout, or reconnect path. Oversized-frame resistance is inherited from the frame-level `MAX_PLAINTEXT_BYTES` guard (`inboundMessage.ts:810`), which runs **before** payload narrowing. Unlike #492, this payload has no numeric field, so the `requireNumber` / `Infinity` question (`JSON.parse('1e999')` → `Infinity` is reachable past a bare `typeof` check) does not arise at all — there is nothing numeric to bound and no fraction for a consumer to compute. A hostile relay can drop, delay, reorder, or flood these frames; the worst outcome is a stale or flapping status indicator in #496, with no memory growth, since the transport holds no state and allocates nothing per frame.
- **[Error messages, logs, telemetry]** No findings, and one deliberate ordering that must survive implementation. The diagnostic **narrows before it logs**, so a malformed frame throws first and leaves no record — a hostile daemon cannot use a malformed field to write attacker-chosen bytes into the diagnostic log. The logged field set is the existing content-free one (`event` / `code` / `bytes` / `hash`); `conversation_id` and `active` are never logged. `WireDecodeError` messages name the failure category only and never interpolate a value, so a `conversation_id` cannot leak into an error string or a stack trace. No new `DiagnosticEvent` field, so #131's renderer pin is untouched. Two tests pin this: the content-free success path and the no-log throw path.
- **[Concurrency]** No findings. Nothing async is introduced: no task, timer, listener, `AbortController`, or teardown path. The explicit no-state design (no dedup, no coalescing, no memo) means there is no shared mutable state and therefore no check-then-act race across an `await`. A frame arriving during shutdown dispatches or does not; neither leaves partial state.
- **[Threat model alignment]** Addressed. **Hostile daemon response** is the applicable threat and is the one this slice defends: every field is type-checked, a partial value is never returned, unknown keys are dropped rather than copied, and the failure mode is a throw with no side effect and no log. **Malicious relay** is on-path but content-blind; flooding degrades to a flapping indicator (see Network & I/O). **Renderer compromise reaching the transport** is unchanged — this slice moves data outward only, and the outward payload is a single bool. **Token theft from disk** is out of scope: nothing here persists.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-26
