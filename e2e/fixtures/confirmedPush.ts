// A pushed event that survives a transient loss of Electron's inspection context (#1569).
//
// A push is `app.evaluate` around `webContents.send`. When Playwright raises `Execution context was
// destroyed` from it, nobody knows whether the send happened. mainProcessRead.ts tolerates that on
// READS by asking again; a push cannot be asked again blindly, because a replayed event is a second
// event. An upload `completed` is the sharp case: `reducePendingAttachments` appends every one with
// no dedup by id, so a second delivery is a second pending tile and the message carries the
// attachment twice.
//
// So the push is sent again ONLY after the renderer has been watched for long enough to say it does
// not have it. IPC delivery takes milliseconds, so a two-second window that shows nothing is taken as
// "not delivered". At most two sends: a context that is lost twice with nothing arriving fails at
// about four seconds rather than waiting out the test timeout.
//
// The cause of the context loss is undiagnosed, as it was for #1502.

import { isTransientContextLoss } from './mainProcessRead'

export interface ConfirmedPushOptions {
  /** How long to watch for the pushed event's effect after a context loss. */
  confirmWithinMs?: number
  pollIntervalMs?: number
}

const MAX_SENDS = 2

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Send `push()`, and on the transient context loss send it once more only if `delivered()` has not
 * turned true within `confirmWithinMs`. Any other error — from the push or from the delivery read —
 * rethrows unchanged and at once.
 *
 * `delivered` is the caller's observation of the renderer, stated as an absolute expectation (e.g.
 * "the strip holds n tiles") rather than a before/after difference, which a previous push's
 * late-rendering effect could satisfy.
 */
export async function pushConfirmingDelivery(
  push: () => Promise<void>,
  delivered: () => Promise<boolean>,
  { confirmWithinMs = 2_000, pollIntervalMs = 100 }: ConfirmedPushOptions = {}
): Promise<void> {
  for (let sends = 1; ; sends++) {
    try {
      await push()
      return
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
    }
    if (await seenWithin(delivered, confirmWithinMs, pollIntervalMs)) return
    if (sends === MAX_SENDS) {
      throw new Error(
        `pushed event not delivered: the inspection context was lost on all ${MAX_SENDS} sends ` +
          `and the renderer showed nothing within ${confirmWithinMs}ms of either`
      )
    }
  }
}

/** Poll `delivered` until it is true or `withinMs` has passed. A transient loss on the read itself
 *  counts as "not seen yet"; any other error rethrows. */
async function seenWithin(
  delivered: () => Promise<boolean>,
  withinMs: number,
  pollIntervalMs: number
): Promise<boolean> {
  const deadline = Date.now() + withinMs
  for (;;) {
    try {
      if (await delivered()) return true
    } catch (error) {
      if (!isTransientContextLoss(error)) throw error
    }
    if (Date.now() >= deadline) return false
    await sleep(pollIntervalMs)
  }
}
