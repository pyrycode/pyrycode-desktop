# #1560 — carry a background task's `status` and `summary` to the window

## Files read

- `src/shared/wire/types.ts` → `BackgroundTaskUpdatedPayload` — the four-field mirror this ticket widens to six; its docblock names `task_id` / `patch` as the frame's `truncated_fields` vocabulary and says "all always present".
- `src/main/transport/inboundMessage.ts` → `parseBackgroundTaskUpdatedPayload` — the narrower; `requireString` (fail-closed on an omitted key) and `optionalString` (absent → `undefined`, non-string → throw) are the two helpers in play. The `ParsedInbound` kind docblock and the `case 'background_task_updated'` log arm (byte length + hash only) also live here.
- `src/main/daemonConnection.ts` → the `case 'background-task-updated'` arm of the inbound switch — the one production emit site, a fresh named-field literal (never a spread); its comment counts FOUR fields.
- `src/shared/ipc/events.ts` → the `backgroundTaskUpdated` member of `BaseDaemonEvent` — the IPC arm; its comment counts FOUR fields.
- `src/renderer/src/store/backgroundTaskRosterBridge.ts` → `translateBackgroundTaskUpdated` — builds its own named-field `BackgroundTaskUpdatedSnapshot`, so it is unaffected; the modal / question / timeline / daemonEvent bridges no-op the arm. No production renderer file changes.
- Tests that construct the payload or the arm: `src/shared/wire/types.test.ts` (the #565 describe), `src/main/transport/inboundMessage.test.ts` (`BACKGROUND_TASK_UPDATED`, the #565 recognition / fail-closed / diagnostic-log describes), `src/main/daemonConnection.test.ts` (the `background_task_updated stream (#565)` describe), and eleven typed `backgroundTaskUpdated` literals across `modalBridge.test.ts`, `daemonEventBridge.test.ts`, `timelineBridge.test.ts`, `backgroundTaskRosterBridge.test.ts` (four literals plus the `taskUpdated` helper), `questionBridge.test.ts`.
- Daemon `internal/protocol/testdata/background_task_updated.json` and `background_task_updated_terminal.json` (pyrycode `43a52426`) — the two golden frames, wire order `conversation_id, task_id, patch, status, summary, truncated_fields`.
- Daemon `docs/protocol-mobile.md` § `background_task_updated` — `status` is an open string (only `completed` observed), `summary` is model-authored free text capped at construction, `truncated_fields` may now name `status` / `summary`; render-never-execute covers both.
- Analogue `84bc408b` (#1548) — one field carried across these same four production files; same test shapes (decode `it.each`, emit round-trip, diagnostic-log secret pin).

## Design source

N/A — no UI-visible change. The ticket carries no `## Figma` section; the fields ship dormant and no renderer file renders them.

## Context

The daemon (pyrycode#2245, 2026-09-10) fills `status` and `summary` on a terminal `background_task_updated` frame. A non-empty `status` is the only finish signal the family has. This client decodes only four of the six fields, so everything downstream is blind to a finish (#1561's "1 task running" pill, #1246's missing Finished group). This slice carries both fields as far as the window's IPC arm and stops: no store, no bridge, no view.

No ADR needed: the tolerant-omission rule below is a per-field decode choice, recorded in the narrower's docblock.

In-flight overlap check: `origin/feature/1544` touches `daemonConnection.ts` / `daemonConnection.test.ts`, but #1544 is closed and its PR #1553 was squash-merged 2026-09-20 (its `confirmedRunConfig.ts` is on `main`). A stale branch, not in-flight work — no block.

## Design

### Wire type — `BackgroundTaskUpdatedPayload`

Six fields in daemon wire order:

```ts
export interface BackgroundTaskUpdatedPayload {
  conversation_id: string
  task_id: string
  patch: string
  status: string    // terminal state claude reported; '' on a mid-life frame; OPEN string
  summary: string   // claude's account of the task; '' on a mid-life frame; untrusted free text
  truncated_fields: string[] | null
}
```

Both new fields are plain `string` (never optional on the decoded type): the narrower resolves absence to `''`, so a consumer never sees `undefined`. Docblock corrections: "FOUR fields, not six" → the frame's six (sibling's six are a different six); the mid-life / terminal disjoint-halves rule; `truncated_fields` vocabulary becomes `task_id` / `patch` / `status` / `summary`; the SECURITY note extends to `summary` (may carry a literal command line — render inert, never log, never an HTML sink / attribute / URL / path / cache key); `status` is never narrowed to a union.

### Narrower — `parseBackgroundTaskUpdatedPayload`

- `patch`, ids, `truncated_fields` unchanged (fail closed on omission).
- `status = optionalString(payload, 'status') ?? ''`, same for `summary`. An omitted key reads as `''`; a present non-string (including `null`) throws `WireDecodeError('malformed optional field: <name>')` via `optionalString`, rejecting the whole frame before the log call.
- Returns a fresh six-field literal; unknown keys still dropped.
- Docblock records why omission is tolerated here while `patch` fails closed: a pre-2026-09-10 daemon omits both keys (an observed condition on this pipeline), failing closed would drop `patch` with the frame, and `''` is already the in-domain value every mid-life frame carries — absence and emptiness mean the same thing for these two fields.
- No per-field length check: the daemon caps `summary` (`maxTaskSummary`) and reports cuts in `truncated_fields`; the frame-level `MAX_PLAINTEXT_BYTES` guard is the client bound.
- The log arm is unchanged (byte length + hash only); its comment names `status` / `summary` as never logged.

### Emit — `daemonConnection.ts` arm

Adds `status: inbound.backgroundTaskUpdated.status` and `summary: inbound.backgroundTaskUpdated.summary` to the named-field literal, between `patch` and `truncatedFields`. Comment "all FOUR fields" → six; notes both cross verbatim, `''` included, and nothing here branches on `status`.

### IPC arm — `events.ts`

```ts
| {
    type: 'backgroundTaskUpdated'
    conversationId: string
    taskId: string
    patch: string
    status: string
    summary: string
    truncatedFields: readonly string[] | null
  }
```

Required strings, matching what the narrower produces. Comment updated: six fields; `status: ''` = still running (mid-life frame), non-empty = the task ended, open string (a consumer must handle an unseen token); `summary` untrusted display text, render inert, never logged. Still dormant in every bridge.

### Renderer fixture upkeep

Each of the eleven typed `backgroundTaskUpdated` literals gains `status: ''` and `summary: ''` (the `taskUpdated` helper in `backgroundTaskRosterBridge.test.ts` sets them in its returned literal). No assertion changes: `translateBackgroundTaskUpdated` still returns its four-field snapshot.

## State + concurrency model

None added. The decode is a pure function; the emit arm stays stateless (no join, no memory). No store slice, no async task, no subscription changes.

## Error handling

- Present non-string `status` / `summary` → `WireDecodeError` from `optionalString` → `parseInboundMessage` throws before logging → the connection's existing catch drops the frame (no event, no log, no throw).
- Omitted `status` / `summary` → `''`, frame decodes, `patch` intact.
- Error messages name the field constant only, never a value.

## Testing strategy

All vitest (node). No Playwright spec: nothing renders.

`inboundMessage.test.ts`:
- `BACKGROUND_TASK_UPDATED` updated to the daemon's current mid-life fixture verbatim (`status: ''`, `summary: ''`); docblock says so.
- New `BACKGROUND_TASK_UPDATED_TERMINAL` = the terminal golden frame verbatim. AC1: it decodes to `status: 'completed'`, `summary: 'cat /tmp/pyry-fifo'`, `patch: ''`, `truncated_fields: null`; the mid-life frame decodes to its `patch` with both new fields `''`.
- AC2: omitting `status`, `summary`, or both still decodes, the missing field read as `''`, `patch` intact.
- AC2: `status` / `summary` each set to `42`, `null`, `true`, `{}`, `['x']` → `WireDecodeError`, no log line.
- AC4: an unseen status token (`'  future-state <x>  '`, `'failed'`) and a `summary` with markup metacharacters decode verbatim.
- Existing "all four fields" / "exactly the four known fields" tests retitled to six; the `truncated_fields` pair test gains `status` / `summary` names.
- Diagnostic log: the content-free test also plants a secret `status` and `summary` and asserts neither appears in the record.

`daemonConnection.test.ts`:
- `UPDATED` gains `status: ''`, `summary: ''`; the whole-object emit assertion includes them; the key-set test becomes seven keys.
- AC3: the terminal frame emits `status: 'completed'`, the summary verbatim, `patch: ''`; the mid-life frame emits both as `''`.
- AC4: an unseen `status` token crosses unchanged.
- An old-daemon frame (both keys omitted) still emits, with `''` for each.
- A non-string `status` drops the frame without emitting or throwing.

`types.test.ts`: the #565 literals gain the two fields; a new pin that the terminal-shaped payload (`patch: ''`, `status: 'completed'`, a command-line `summary`) and an arbitrary `status` string assign to the type.

Renderer bridge tests: fixture upkeep only; run the five files to prove they stay green.

## Open questions

- Should `optionalString`'s message category (`malformed optional field:`) be reused, or should a new helper be written? Plan: reuse — it is exactly absent → `undefined`, present-non-string → throw, and `?? ''` sits at the call site. Resolve in Phase B if the helper's docblock argues otherwise.

## Documentation handoff

The ticket names no documentation requirement. Pending for the documentation stage, if it chooses: fold the six-field shape and the tolerant-omission rule into `docs/knowledge/features/inbound-message-decode*.md` (the #565 entries), `daemon-connection*.md` (the `backgroundTaskUpdated{…}` arm list), and `background-task-roster-store.md` (the #565 data-path line).

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the single untrusted→trusted boundary for this frame is `parseBackgroundTaskUpdatedPayload`, reached only through `parseInboundMessage` after its `MAX_PLAINTEXT_BYTES` guard. The new fields are narrowed by type there (`optionalString`) and nowhere else; the emit arm copies from the already-narrowed payload by name, never a spread, so an unknown key cannot ride through. The renderer receives plain strings and no bridge reads them in this slice.
- [Trust boundaries] SHOULD FIX (Phase B, verifier checks) — `summary` is model-authored free text that can be a literal command line. The declaration comments on `BackgroundTaskUpdatedPayload` and the IPC arm must state it is inert display text only: never `innerHTML` / `dangerouslySetInnerHTML`, an attribute, a URL, a filename, a cache key, a log, and never executed or re-shelled. Same for `status`.
- [Tokens, secrets] No findings — neither field is a credential; no token, key or raw frame is added to any path.
- [File / storage] No findings — nothing is written to disk; neither field is used as a path, filename or lookup key.
- [Electron attack surface] No findings — no new IPC channel, no preload change, no `webPreferences` change. The existing daemon-event channel carries two more strings, main → renderer only; nothing flows renderer → main.
- [Crypto] No findings — the Noise session and codec are untouched.
- [Network & I/O] No findings — size is bounded by the existing frame-level guard and the relay socket's `maxPayload`; the daemon caps `summary` at construction. No per-field cap is added on purpose (a client-invented cap would fail-close a valid frame).
- [Logs] No findings, pinned by test — the `inbound-decoded` record stays `code` + byte length + hash; the diagnostic-log test plants secret `status` / `summary` values and asserts neither appears. `WireDecodeError` messages name the field constant only.
- [Concurrency] No findings — pure decode and a stateless emit; no new async work, timers or listeners.
- [Threat model: hostile daemon] No findings — a malformed `status` / `summary` (non-string, null, object, array) rejects the whole frame before logging; an omitted one reads as `''`, which is the value a mid-life frame already carries, so omission cannot forge a finish (a finish needs a non-empty string). An unseen `status` token is carried, not interpreted — no consumer branches on it in this slice, and the arm comment tells the future consumer (#1561) to handle unseen values.
- [Threat model: forged finish] OUT OF SCOPE — `status` is claude's claim, not the daemon's detection (daemon doc). Whether a consumer trusts it to hide a still-running task is #1561's decision.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-22
