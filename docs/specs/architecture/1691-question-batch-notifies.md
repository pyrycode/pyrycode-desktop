# #1691 — a question batch raises a notification

## Files read

- `src/renderer/src/store/pushNotifyBridge.ts` → `notifyKindForEvent`, `subscribePushNotify` — the filter and the gated send path this change extends.
- `src/renderer/src/store/pushNotifyBridge.test.ts` → the `fakeBridge` fixture and the #514 / #1593 / #1597 / #1607 suites the new cases sit beside.
- `src/shared/ipc/events.ts` → the `questionShown` arm: `conversationId`, `questionBatchId`, `questions`.
- `src/main/fireNotification.ts` → the copy table: `prompt` already reads "Waiting for your response.", so no main-side change.

## Design source

Figma: N/A — the operating system draws the notification; there is no in-app surface.

## Change

`notifyKindForEvent` gains a `questionShown → 'prompt'` case. In `subscribePushNotify`, the closure-local `announcedModalIds` set becomes one `announced` set of namespaced keys: `modal:<modalId>` for a `modalShown`, `batch:<questionBatchId>` for a `questionShown` (mobile's `batch:` key in `HostConversationSource`), `null` for `turnEnd`. The prefix is what keeps a batch whose id equals an already-announced modal's id from being suppressed. Every other property of the #514 dedup carries over unchanged: check before the toggle, record only after the send, never pruned, dies with the subscription. The re-narrowing guard admits `questionShown` too, so the batch takes the same toggle gate, mute gate, name lookup and click token (all keyed by the event's own `serverId` and `conversationId`). Nothing of the batch — neither the id nor the questions — rides the payload. The header and doc comments that say "two arms" are updated to three. Turn-end and modal behaviour is untouched.

## Testing strategy

New vitest cases in `pushNotifyBridge.test.ts`:

- `notifyKindForEvent(questionShown)` is `'prompt'`.
- A batch with the toggle on sends one `{ kind: 'prompt', name, token }` built from the event's own origin, with no batch field (id, question text) in the payload.
- The same batch re-sent sends nothing more; a new batch id does.
- Toggle off, or muted, sends and mints nothing; a batch dropped that way is not recorded, so a later re-send notifies.
- A batch whose `questionBatchId` equals an announced modal's `modalId` still notifies once, and vice versa; the existing turn-end and modal cases stay green unchanged.

The click-opens-conversation half is the existing #1597 token path; the test asserts the minted target is the batch's `{ serverId, conversationId }`. The unfocused-window gate is main's, unchanged.

## Documentation handoff

None named by the ticket. Pending for the documentation stage: the push-notify package overview should list `questionShown` among the notify arms.
