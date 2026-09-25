# #1647 — later-poll confirmed-push test stops depending on wall-clock time

## Files read

- `e2e/fixtures/confirmedPush.test.ts` → the `does not send again when the tile shows on a later poll inside the window` case and the shared `FAST` options — the only thing that changes.
- `e2e/fixtures/confirmedPush.ts` → `pushConfirmingDelivery`, `seenWithin` — the deadline check that a slow poll sleep can trip. Unchanged.

## Design source

N/A — test-only change, nothing UI-visible.

## Change

The later-poll test passes its own options, `{ confirmWithinMs: 10_000, pollIntervalMs: 5 }`, instead of `FAST` (`confirmWithinMs: 40`). With `FAST`, the two 5 ms sleeps in `seenWithin` can overrun the 40 ms deadline under a loaded full suite; `seenWithin` then returns false before the third read, `pushConfirmingDelivery` sends again, and the one-outcome `pusher` stub throws `undefined` (the "Unknown Error: undefined" seen on PR #1646). The window is only an upper bound, paid when delivery never shows: here the probe turns true on its third read, so the test still finishes in two poll intervals. The other six tests do not depend on elapsed time — their probes answer the same value on every read — and keep `FAST`. `confirmedPush.ts` is unchanged. Fake timers were rejected per the ticket: they need clock machinery for no gain.

## Testing strategy

The test's existing assertions (one send, three reads) stay as they are and remain the proof. `npx vitest run e2e/fixtures/confirmedPush.test.ts` passes 7 of 7. The load condition itself cannot be reproduced on demand; the change removes the dependency rather than shortening the odds.

## Documentation handoff

None — the ticket names no documentation requirement.
