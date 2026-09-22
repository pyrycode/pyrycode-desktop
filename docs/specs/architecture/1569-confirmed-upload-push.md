# #1569 — confirm delivery before resending an upload push in attachment-image-open

## Files read

- `e2e/attachment-image-open.spec.ts` → the spec-local `pushCompleted` closure and its three call sites (two pushes before the first send, one before the second). The only file whose pushes this ticket guards.
- `e2e/fixtures/mainProcessRead.ts` → `readMainProcess`, the private `TRANSIENT_CONTEXT_LOSS` message fragment, and the module header's rule that control actions are never replayed. The recogniser is reused rather than restated; the header gains a pointer to the one sanctioned resend.
- `e2e/fixtures/mainProcessRead.test.ts` → the stub-evaluator vitest shape the new cover follows.
- `src/renderer/src/screens/conversation/ComposerAttach.tsx` → `reducePendingAttachments` (appends every `completed`, no dedup by id, so a blind replay doubles a tile) and `PendingAttachments`, which renders one `.composer__attachment-slot` per pending attachment. That class is the delivery signal.
- `docs/knowledge/features/e2e-harness.md` § "Tolerating a transient inspection-context loss on reads" — the documented read-only rule this ticket adds a control-action counterpart to.

## Design source

N/A — test harness only, nothing UI-visible changes.

## Context

`pushCompleted` is `app.evaluate` → `webContents.send` of an `AttachmentUploadEvent`. When the evaluate raises Playwright's `Execution context was destroyed`, the send may or may not have happened (observed once on the #1565 verifier run). A blind retry is wrong: a second `completed` adds a second pending tile and the message carries the attachment twice. So the push is resent only after the renderer has been seen *not* to have it. The cause of the context loss stays undiagnosed and out of scope. No ADR needed; the harness overview records the rule (documentation handoff below).

## Design

New module `e2e/fixtures/confirmedPush.ts`:

```ts
export interface ConfirmedPushOptions {
  confirmWithinMs?: number  // default 2_000 — how long to watch for the tile after a context loss
  pollIntervalMs?: number   // default 100
}
export async function pushConfirmingDelivery(
  push: () => Promise<void>,
  delivered: () => Promise<boolean>,
  options?: ConfirmedPushOptions
): Promise<void>
```

Behaviour, at most two sends:

1. `push()`. Resolves → done (a clean push is sent once and `delivered` is never consulted).
2. Rejects with anything that is not the transient context loss → rethrow unchanged, at once.
3. Transient → poll `delivered()` for up to `confirmWithinMs`. True at any poll → done, no resend. A transient error raised by the `delivered()` read itself counts as "not seen yet"; any other error from it rethrows.
4. Not seen → `push()` exactly once more. Resolves → done. Non-transient → rethrow. Transient again → watch once more; seen → done, not seen → throw a descriptive error naming the two sends. That bounds a dead or permanently context-less app at about 2 × 2 s rather than the test timeout.

`mainProcessRead.ts` exports `isTransientContextLoss(error: unknown): boolean` (the existing `instanceof Error && message.includes(...)` check lifted out of `readMainProcess`, which then calls it). One recogniser, one message constant.

The spec's `pushCompleted(event, tilesAfter)` wraps the existing evaluate in `pushConfirmingDelivery`, with `delivered = async () => (await pendingTiles.count()) >= tilesAfter` where `pendingTiles = page.locator('.composer__attachment-slot')`. The caller states the count because the strip holds *n* tiles after the *n*th push since the last send; a helper that read a "before" count itself could mistake the previous push's late-rendering tile for this one's. Call sites become `(PICTURE, 1)`, `(DOCUMENT, 2)`, `(LIAR, 1)`.

## State + concurrency model

Sequential awaits only; the poll is a `setTimeout` sleep loop bounded by `confirmWithinMs`. No floating promises.

## Error handling

Covered in Design: non-transient errors from either `push` or `delivered` rethrow unchanged; a double context loss with no tile throws after two sends.

## Testing strategy

`e2e/fixtures/confirmedPush.test.ts` (vitest; the `mainProcessRead.test.ts` shape, stubs, tiny real-time windows):

- a clean push is sent once and `delivered` is not consulted;
- a context loss followed by a seen tile is not sent again;
- a tile that shows up on a later poll inside the window is not sent again;
- a context loss with no tile is sent exactly once more;
- any other error rethrows the same object with one send and no `delivered` read;
- a second context loss with still no tile rejects after exactly two sends.

The live spec is re-run once with `npx playwright test e2e/attachment-image-open.spec.ts` after `npm run build`; the race itself does not reproduce on demand.

## Documentation handoff (pending — documentation stage)

`docs/knowledge/features/e2e-harness.md` § "Tolerating a transient inspection-context loss on reads" currently says pushed events are never replayed. Record the control-action counterpart: a pushed event may be sent a second time only after the renderer has been seen not to receive it (`pushConfirmingDelivery` in `e2e/fixtures/confirmedPush.ts`, delivery observed as the composer's pending-tile count), and why a blind replay of an upload `completed` doubles the attachment (`reducePendingAttachments` appends with no dedup by id).

## Open questions

None.
