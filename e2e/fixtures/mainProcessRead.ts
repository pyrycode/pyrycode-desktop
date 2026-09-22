// A main-process read that survives a transient loss of Electron's inspection context (#1502).
//
// Playwright raises `Execution context was destroyed, most likely because of a navigation.` from
// `app.evaluate` even when the app is demonstrably alive — the `launch-fate` attachment on the
// observed failure reported `runningAtOutcome: true`, `exitCode: 0` and no teardown failures. Off
// CI `retries` is 0, so one such read turns a green branch red with no `flaky` line to mark it.
//
// ONLY COUNT READS MAY RETRY. CONTROL ACTIONS MUST NEVER BE REPLAYED. A retried mutation is a
// second mutation: re-running the `app.evaluate` that wraps an ipcMain handler would wrap the
// wrapper, and re-running a click or a pushed frame would double the thing under test. Nothing in
// the type system enforces that — the rule is the enforcement, exactly as in `readAuthentication`
// (#1380, e2e/pairing-authentication.spec.ts), the first site to hit this and the reason this
// module exists rather than a third private copy. The one sanctioned resend of a pushed event is
// `pushConfirmingDelivery` in confirmedPush.ts (#1569), which sends again only after the renderer
// has been seen NOT to have received it — never blindly.
//
// Bounding the retry stays the CALLER's job, and visible at the call site: pass
// `{ timeout: 5_000 }` to the `expect.poll` that consumes this, so a genuinely dead app fails
// inside five seconds instead of waiting out the test timeout.

/** The part of Playwright's message that identifies the transient loss, surrounded by a call-site
 *  prefix and a trailing explanation that both vary. */
const TRANSIENT_CONTEXT_LOSS = 'Execution context was destroyed'

/**
 * Stands for "this read did not complete, because the inspection context was transiently gone".
 *
 * A distinct sentinel rather than #1380's `null`: this module is shared, and a future caller reading
 * a nullable value must still be able to tell a real `null` from a lost context. It is also a value
 * no counter can equal, which is what makes a tolerated read satisfy no assertion about the count.
 */
export const NOT_YET_AVAILABLE = Symbol('main-process read: inspection context not yet available')

/**
 * The single `ElectronApplication` method this helper uses. Narrow on purpose: a stub satisfies it,
 * so the whole wrapper — value, tolerated, fatal — is coverable under vitest without launching
 * Electron, which matters because the race itself does not reproduce on demand.
 */
type MainProcessEvaluator<T> = {
  evaluate(read: (electron: typeof import('electron')) => T | Promise<T>): Promise<T>
}

/**
 * Read `read()` in the app's main process. Returns what it produced, or `NOT_YET_AVAILABLE` when
 * Playwright reported the transient context loss, so an `expect.poll` caller polls again.
 *
 * Every other failure rethrows unchanged and at once — including a thrown non-`Error`, which is not
 * evidence of a transient loss and so takes the fatal path. Tolerating one message must not become
 * tolerating failure.
 */
export async function readMainProcess<T>(
  app: MainProcessEvaluator<T>,
  read: (electron: typeof import('electron')) => T | Promise<T>
): Promise<T | typeof NOT_YET_AVAILABLE> {
  try {
    return await app.evaluate(read)
  } catch (error) {
    if (isTransientContextLoss(error)) return NOT_YET_AVAILABLE
    throw error
  }
}

/** Whether `error` is Playwright's transient inspection-context loss. A thrown non-`Error` never is. */
export function isTransientContextLoss(error: unknown): boolean {
  return error instanceof Error && error.message.includes(TRANSIENT_CONTEXT_LOSS)
}
