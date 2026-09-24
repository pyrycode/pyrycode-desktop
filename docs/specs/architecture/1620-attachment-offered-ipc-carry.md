# #1620 — carry an offered attachment across to the window

## Files read

- `src/main/transport/inboundMessage.ts` → `InboundDaemonMessage` `attachment-offered` arm, `parseAttachmentOfferedPayload` — #1619's fail-closed decode; the arm carries `AttachmentOfferedPayload` and no `FrameTimestamp`.
- `src/shared/wire/types.ts` → `AttachmentOfferedPayload` — the three validated fields and their security notes (filename is claude-authored display text, never logged).
- `src/main/daemonConnection.ts` → the inbound `switch (inbound.kind)` in `createDaemonConnection`, its `resetting` case — the emit shape to mirror. The inner switch has no `assertNever`, which is why #1619's arm is silently dropped today.
- `src/main/emitDaemonEvent.ts` → `bindServerOrigin` — stamps `serverId` on every emit; nothing to change.
- `src/shared/ipc/events.ts` → `BaseDaemonEvent` `resetting` arm, `WithDaemonTs` — where the new arm goes; no `daemonTs` because the frame is live-only.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent`; `modalBridge.ts` → `translateModalEvent`; `questionBridge.ts` → `translateQuestionEvent`; `timelineBridge.ts` → `translateTimelineEvent` — the four `assertNever` switches that need a case.
- `src/renderer/src/store/timelineBridge.ts` → `timelineTargetFor` — has a `default: return null`, so an unowned arm needs no entry there.
- `src/renderer/src/store/conversationActivityBridge.ts` → `translateConversationActivity` — ends in `default: []`, not exhaustive; untouched.
- Commit `196c3dbb` (#1515) — the analogue, the same six production files and five test files.

In-flight overlap: `origin/feature/1544` touches `daemonConnection.ts`, but #1544 is closed and the branch is stale; no dependency.

## Design source

N/A — no UI change. All four bridge cases are no-ops; the thread row is #1621.

## Context

#1619 decodes `attachment_offered` into an inbound arm; `daemonConnection.ts` has no case for it, so the offer is dropped. This slice emits it as a `DaemonEvent` arm and gives the four exhaustive renderer bridges a no-op case each. No ADR warranted.

## Design

New `BaseDaemonEvent` arm in `events.ts`, placed after `resetting`:

```ts
| {
    type: 'attachmentOffered'
    conversationId: string
    attachmentId: string
    filename: string
  }
```

- **No `daemonTs`.** The decode arm has no `FrameTimestamp` and there is no history arm to join against (the `resetting` precedent).
- **Doc comment** carries the security contract forward: `conversationId` is a routing key, `attachmentId` is daemon-minted and passed the UUIDv4 rule but proves nothing about bytes existing and must still go through the path guard in `attachmentPath` before any filesystem use; `filename` is claude-authored display text (≤255 UTF-8 bytes, may contain control/bidi characters) — render only as bounded, escaped text, never an attribute, URL, path, cache key or log field.

`daemonConnection.ts`: new `case 'attachment-offered'` in the inbound switch, emitting a fresh named-field literal `{ type: 'attachmentOffered', conversationId, attachmentId, filename }` copied from `inbound.attachmentOffered` — never a spread. No `invalidateConfigRequests` call (that is reset-specific). Stateless: one event per frame, no dedup.

Bridges — each gets a case returning `null`:

- `translateDaemonEvent` — permanent no-op (not connection status).
- `translateModalEvent` — joins the fall-through no-op group, permanent.
- `translateQuestionEvent` — joins the fall-through no-op group, permanent.
- `translateTimelineEvent` — joins the no-op group, **dormant**: #1621 flips it into a thread item.

Each case comment names why it exists: without it `assertNever` stringifies the whole event, filename included, into an Error message.

## State + concurrency model

No new state, no async work. The emit is synchronous inside the existing inbound handler.

## Error handling

Malformed frames are dropped upstream by `parseAttachmentOfferedPayload` (already covered by #1619's `daemonConnection.test.ts` case). Nothing new can fail here.

## Testing strategy

vitest only; no interaction to drive.

- `daemonConnection.test.ts`, new `describe('… attachment_offered stream (#1620)')`:
  - a well-formed frame → exactly one event, `toEqual` the three fields plus `type`; `stampedEvents` shows the bound `serverId` (build with `serverId: 'paired-host'`).
  - key set pinned with `Object.keys(...).sort()`: no snake keys, no `daemonTs`, a smuggled extra payload key does not cross.
  - a repeated frame emits twice (no dedup).
  - captured diagnostic log contains neither the filename, the attachment id nor the conversation id, while an `inbound-decoded` / `attachment_offered` record exists (not vacuous).
- `daemonEventBridge.test.ts`: `attachmentOffered → null`.
- `modalBridge.test.ts`, `questionBridge.test.ts` (census count 45 → 46), `timelineBridge.test.ts`: the arm added to each "every other arm returns null" table; `timelineBridge.test.ts` also gets a `subscribeTimeline` case asserting same state ref and no items (dormant).
- The "no filename in any error message on the window side" AC is proven by each bridge returning `null` without throwing — the only error path is `assertNever`, which is unreachable once the case exists — and by the event fixture using a distinctive filename.

## Documentation handoff

Pending for the documentation stage: the ticket has no Documentation handoff section; the natural home is the package overview that #1515's docs commit updated (`docs/knowledge/features/` daemon-event-bridge / inbound-message-decode overviews) — note the new arm and its dormant timeline case.

## Open questions

- None. The arm name `attachmentOffered` follows the camelCase convention of every other arm.

## Sizing note

Six production files, one over the five-file line. Kept as one ticket on the refiner's stated grounds: the four bridge cases are forced by `assertNever` the moment the arm exists, so none can ship alone (the floor rule wins). #1515 had the identical shape.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the single untrusted→trusted boundary is `parseAttachmentOfferedPayload` (#1619). This slice copies its already-narrowed fields by name into a fresh literal, so an extra wire key cannot cross IPC (pinned by the `Object.keys` test). The `events.ts` doc comment states that narrowed is not trusted: all three fields remain peer claims.
- [Tokens] No findings — no token, key or credential is touched; the arm carries no secret.
- [File / storage] SHOULD FIX (forward obligation, not this slice) — `attachmentId` and `filename` both look like path material. The arm's doc comment must say the id reaches the filesystem only via `resolveAttachmentPath` and the filename is never a path. No filesystem use happens in this slice.
- [Electron attack surface] No findings — no new IPC channel, no preload change; the event rides the existing one-way `DaemonEvent` channel, main → window only. The window cannot send this shape back.
- [Crypto] No findings — no primitive touched.
- [Network & I/O] No findings — size is bounded upstream (plaintext cap, filename ≤255 UTF-8 bytes); no new socket work.
- [Error messages, logs] Addressed — the emit path is log-free (`emitDaemonEvent`) and the decode log line is content-free; a test pins that neither filename, attachment id nor conversation id reaches the diagnostic log. On the window side, each exhaustive bridge gets an explicit case, so `assertNever` never stringifies the event (filename included) into an Error.
- [Concurrency] No findings — synchronous emit inside the existing handler; no state, no timer, no dedup memo keyed by a daemon-supplied id.
- [Threat model] Hostile daemon: can announce a file for any conversation id, or flood offers. Misattribution is bounded because `conversationId` is a routing key only and no consumer exists yet; flood rendering is #1621's concern (OUT OF SCOPE → #1621). Renderer compromise: gains only display strings it would already see.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-24
