import { describe, expect, it } from 'vitest'
import { NOT_YET_AVAILABLE, readMainProcess } from './mainProcessRead'

// Unit cover for #1502's read tolerance. The race it exists for — Electron transiently losing its
// inspection context while the app stays alive — did not reproduce in three runs of the spec that
// hit it, so acceptance cannot rest on racing it. What CAN be proven deterministically is the
// discrimination itself: which raised error becomes "not yet available" and which one still fails.
// That is the whole of the helper, so driving it here with a stub evaluator covers every branch.
//
// It is a `.test.ts` under e2e/ deliberately, the `daemonCapabilityGate.test.ts` shape: the module
// belongs beside the fixtures that call it, and the suffix is what keeps the two runners apart
// (vitest.config.ts's `include` / playwright.config.ts's `testMatch`).

/** The exact message Playwright raises, as observed on the #1487 verifier run (PR #1501). */
const TRANSIENT = 'electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.'

/** A stub standing in for `ElectronApplication`, recording what it was asked to evaluate. */
function evaluator<T>(outcome: () => T | Promise<T>) {
  const received: unknown[] = []
  return {
    received,
    evaluate: async (read: unknown): Promise<T> => {
      received.push(read)
      return await outcome()
    }
  }
}

describe('readMainProcess', () => {
  it('returns the value a completed read produced', async () => {
    const app = evaluator(() => 1)
    expect(await readMainProcess(app, () => 1)).toBe(1)
  })

  // 0 is the value the confirmed-deletion spec's pre-deletion assertion expects, so a helper that
  // conflated a falsy reading with "nothing read" would make that assertion unprovable.
  it('returns a falsy reading rather than treating it as nothing read', async () => {
    const app = evaluator(() => 0)
    expect(await readMainProcess(app, () => 0)).toBe(0)
  })

  it('reports not-yet-available when the inspection context was destroyed', async () => {
    const app = evaluator<number>(() => {
      throw new Error(TRANSIENT)
    })
    expect(await readMainProcess(app, () => 1)).toBe(NOT_YET_AVAILABLE)
  })

  // Tolerating one message must not become tolerating failure. A read that fails any other way is
  // the app being genuinely broken, and the caller's poll must not wait that out.
  it('rethrows any other error, unchanged and at once', async () => {
    const fatal = new Error('Target page, context or browser has been closed')
    const app = evaluator<number>(() => {
      throw fatal
    })
    await expect(readMainProcess(app, () => 1)).rejects.toBe(fatal)
  })

  it('rethrows a thrown non-Error too', async () => {
    const app = evaluator<number>(() => {
      throw 'context destroyed'
    })
    await expect(readMainProcess(app, () => 1)).rejects.toBe('context destroyed')
  })

  // The transient error is recognised by the message Playwright actually raises, which carries a
  // call-site prefix and a trailing explanation around the part that identifies it.
  it('recognises the transient error inside the surrounding message', async () => {
    const app = evaluator<number>(() => {
      throw new Error('page.evaluate: Execution context was destroyed.')
    })
    expect(await readMainProcess(app, () => 1)).toBe(NOT_YET_AVAILABLE)
  })

  // AC4: a not-yet-available read must satisfy neither of the confirmed-deletion assertions. Both
  // are `.toBe()` against a count, so the sentinel has to be a value no counter can ever equal —
  // and distinct from the two blanks a caller might otherwise read as "no removals yet".
  it('reports a sentinel that satisfies neither counter assertion', () => {
    expect(NOT_YET_AVAILABLE).not.toBe(0)
    expect(NOT_YET_AVAILABLE).not.toBe(1)
    expect(NOT_YET_AVAILABLE).not.toBe(null)
    expect(NOT_YET_AVAILABLE).not.toBe(undefined)
    expect(typeof NOT_YET_AVAILABLE).toBe('symbol')
  })

  // The helper wraps a read; it must not substitute one. Identity, not shape.
  it('evaluates exactly the read it was given, once', async () => {
    const app = evaluator(() => 7)
    const read = () => 7
    await readMainProcess(app, read)
    expect(app.received).toEqual([read])
  })
})
