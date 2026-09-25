# #1638 — decode `background_task_progress` into a typed daemon event

## Files read

- `src/shared/wire/types.ts` → `EnvelopeType`, `BackgroundTaskUpdatedPayload`, `BackgroundTaskStartedPayload` — the wire-type pattern and the doc-comment security note the new payload mirrors.
- `src/main/transport/inboundMessage.ts` → `parseBackgroundTaskUpdatedPayload`, `parseThinkingProgressPayload`, `requireString`, `requireNumber`, `requireStringArrayOrNull`, the `InboundDaemonMessage` union, and the `background_task_updated` arm of `parseInboundMessage` — the decode pattern (narrow before logging, fresh literal, category-only error messages).
- `src/main/daemonConnection.ts` → the `background-task-updated` arm of the inbound switch — the forward pattern (fresh literal copied by name, never a spread; stateless).
- `src/shared/ipc/events.ts` → the `backgroundTaskUpdated` arm of `DaemonEvent` — the event-arm pattern.
- `src/renderer/src/store/daemonEventBridge.ts`, `modalBridge.ts`, `questionBridge.ts`, `timelineBridge.ts` → each ends its `DaemonEvent` switch in `assertNever`, so each needs a no-op case. `backgroundTaskRosterBridge.ts` ends in `default: return null` and needs **no** change (the ticket lists it; the code says otherwise).
- `src/main/transport/inboundMessage.test.ts`, `src/main/daemonConnection.test.ts`, `src/shared/wire/types.test.ts`, the four bridge tests → the #565 test shapes to mirror.
- Daemon authority: pyrycode `docs/protocol-mobile.md` § `background_task_progress`, `internal/protocol/interactive.go` → `BackgroundTaskProgressPayload` (wire order `conversation_id, task_id, description, subagent_type, last_tool_name, total_tokens, tool_uses, duration_ms, truncated_fields`, none `omitempty`), and golden fixture `internal/protocol/testdata/background_task_progress.json`.
- `docs/specs/architecture/1560-background-task-status-summary.md` § Security review — the precedent review for this frame family.

## Design source

N/A — no UI in this slice. Nothing in the window reads the event; #1640 stores and renders it.

## Context

Since pyrycode#2246 the daemon sends a fourth background-task frame that this client drops in `parseInboundMessage`'s `default` arm. This slice decodes it and delivers it to the window as a typed daemon event, following #565's path exactly. The event ships dormant.

**Sizing.** 8 production files (four wire/transport/IPC files plus four one-case bridge arms), over the five-file line. Kept whole on the floor rule: the decode's only consumer is the forward, and the bridge arms are compile-forced by the event arm, so no slice of this is verifiable on its own. Total written work is well under 800 lines.

**Overlaps.** `feature/1544` also touches `src/main/daemonConnection.ts`; it is a different arm, so this change stays additive (a new case after `background-task-updated`).

## Design

**Wire type** (`src/shared/wire/types.ts`): add `'background_task_progress'` to `EnvelopeType` beside its three siblings, and

```ts
export interface BackgroundTaskProgressPayload {
  conversation_id: string
  task_id: string
  description: string        // CURRENT ACTIVITY, not the opening description
  subagent_type: string
  last_tool_name: string
  total_tokens: number
  tool_uses: number
  duration_ms: number
  truncated_fields: string[] | null
}
```

Field-for-field with the daemon. The doc comment states: `description` is the current activity and differs from `background_task_started`'s; counters are cumulative, not monotonic, carried as received; no `summary` / `patch` / `ambient`; and the render-inert security rule (the text can name a file on the operator's host).

**Decode** (`src/main/transport/inboundMessage.ts`): `parseBackgroundTaskProgressPayload(payload: unknown): BackgroundTaskProgressPayload` — `isRecord` guard, five `requireString`, three `requireNumber`, one `requireStringArrayOrNull`, returning a fresh nine-field literal. No range, integer or monotonicity check (the `parseThinkingProgressPayload` house posture: a client-invented bound fail-closes valid traffic, and these counters may restart). No closed-set narrowing of `subagent_type` / `last_tool_name` / `truncated_fields` elements. New union arm `{ kind: 'background-task-progress'; backgroundTaskProgress: BackgroundTaskProgressPayload }`, no `ts`. New `case 'background_task_progress'` in `parseInboundMessage`: narrow first, then one content-free `inbound-decoded` record (static code, byte length, hash).

**Forward** (`src/main/daemonConnection.ts`): new `case 'background-task-progress'` emitting a fresh literal copied by name, snake→camel, stateless:

```ts
{ type: 'backgroundTaskProgress', conversationId, taskId, currentActivity, subagentType,
  lastToolName, totalTokens, toolUses, durationMs, truncatedFields }
```

`currentActivity` is the wire `description` under a distinct name, so no consumer can join it with `backgroundTaskStarted.description`. `truncatedFields: null` preserved.

**Event arm** (`src/shared/ipc/events.ts`): the `DaemonEvent` arm with those ten fields, `truncatedFields: readonly string[] | null`, placed after `backgroundTaskUpdated`.

**Bridges**: `case 'backgroundTaskProgress':` added beside `backgroundTaskUpdated` in `daemonEventBridge`, `modalBridge`, `questionBridge` and `timelineBridge`, returning `null`. Typecheck names any other exhaustive switch.

## State + concurrency model

None. Pure decode and a stateless emit; no store, no async work, no timers. No join against earlier task frames and no accumulation of the counters.

## Error handling

Any missing or mistyped field (including a counter sent as a JSON string, or an omitted `truncated_fields`) throws `WireDecodeError` from the narrower before logging; the existing inbound error path drops the frame and no event is emitted, exactly as for `background_task_updated`. Error messages name the field constant only, never a value.

## Testing strategy

Vitest, RED first:

- `inboundMessage.test.ts`: the daemon's golden fixture decodes verbatim to the new kind; `truncated_fields: null` stays `null` and a list stays a list; zero counters are carried as `0`; a decreasing reading between two frames is carried as received; extra keys are not copied through; fail-closed for each missing field, for a string-typed counter, for a non-string string field, for `truncated_fields` non-array / bad element, and for a non-object payload; the `inbound-decoded` log record carries `code: 'background_task_progress'` and none of the planted field values; a malformed frame leaves no log record; the history lane skips a stored `background_task_progress`.
- `daemonConnection.test.ts`: one frame emits exactly one `backgroundTaskProgress` event with the ten keys and the values mapped (`currentActivity` from `description`, no `description` key); `truncatedFields: null` kept; a smuggled key does not cross; a malformed frame emits nothing and does not throw.
- `types.test.ts`: the envelope literal and the payload shape type-check.
- Bridge tests (`daemonEventBridge`, `modalBridge`, `questionBridge`, `timelineBridge`): the event maps to `null`.

No Playwright spec: nothing is rendered.

## Open questions

- Event-field name for the current activity: `currentActivity` chosen (the daemon doc's own phrase). Resolved.

## Documentation handoff

Pending for the documentation stage: the ticket has no Documentation handoff section. The package overview that documents the background-task frames should gain the fourth frame and the `description` → `currentActivity` rename.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the single untrusted→trusted boundary for this frame is `parseBackgroundTaskProgressPayload`, reached only through `parseInboundMessage` after its `MAX_PLAINTEXT_BYTES` guard. Every field is narrowed by type there and nowhere else; the forward copies from the narrowed payload by name, never a spread, so an unknown key cannot ride across IPC (pinned by the smuggled-key test).
- [Trust boundaries] SHOULD FIX (Phase B, verifier checks) — `description` / `currentActivity`, `subagent_type` and `last_tool_name` are model- and tool-authored text, and the current activity can name a file on the operator's host. The declaration comments on `BackgroundTaskProgressPayload` and the `backgroundTaskProgress` arm must state they are inert display text only: never `innerHTML` / `dangerouslySetInnerHTML`, an attribute, a URL, a filename, a path, a cache key or a log, never parsed and never executed.
- [Trust boundaries] No findings — the rename to `currentActivity` removes the one confusion the daemon names (joining the current activity with the opening command line under one key).
- [Tokens, secrets] No findings — no credential is carried; no token, key or raw frame is added to any path.
- [File / storage] No findings — nothing is written to disk; no field is used as a path, filename or lookup key, which the comment in the SHOULD FIX above pins for the future consumer.
- [Electron attack surface] No findings — no new IPC channel, no preload change, no `webPreferences` change. The existing daemon-event channel carries one more arm, main → renderer only.
- [Crypto] No findings — the Noise session and codec are untouched.
- [Network & I/O] No findings — size is bounded by the existing frame guard and the relay socket's `maxPayload`; the daemon caps every string at construction. No per-field cap is added on purpose (a client-invented cap fail-closes a valid frame). The frames are rate-bounded upstream; a hostile daemon flooding them costs only emits, since the forward holds no state that grows.
- [Logs] No findings, pinned by test — the `inbound-decoded` record is `code` + byte length + hash; the log test plants distinctive field values and asserts none appears. The counters are not logged either (a side-channel on the operator's work, the `thinking_progress` posture). `WireDecodeError` messages name the field constant only.
- [Concurrency] No findings — pure decode and a stateless emit; no async work, timers or listeners.
- [Threat model: hostile daemon] No findings — a malformed frame rejects whole before logging; a negative, non-integer or decreasing counter is carried as a number, which is the daemon's documented contract ("not guaranteed monotonic"). How a consumer formats such a value defensively is #1640's concern.
- [Threat model: rendering] OUT OF SCOPE — the render path, and bounding the displayed text, belong to #1640.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-25
