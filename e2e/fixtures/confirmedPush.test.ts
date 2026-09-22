import { describe, expect, it } from 'vitest'
import { pushConfirmingDelivery } from './confirmedPush'

// Unit cover for #1569's confirmed resend. The race it exists for — `app.evaluate` raising
// `Execution context was destroyed` around a `webContents.send` — does not reproduce on demand, so
// acceptance rests on the decision itself: when a push counts as delivered, when it is sent once
// more, and when it fails. Stubs drive every branch; the windows are shrunk so real timers stay fast.

/** The exact message Playwright raised on the #1565 verifier run (PR #1568). */
const TRANSIENT = 'electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.'

const FAST = { confirmWithinMs: 40, pollIntervalMs: 5 }

/** A push stub that plays `outcomes` in order — `'ok'` resolves, anything else is thrown — and counts sends. */
function pusher(...outcomes: unknown[]) {
  const stub = {
    sends: 0,
    push: async (): Promise<void> => {
      const outcome = outcomes[stub.sends]
      stub.sends++
      if (outcome !== 'ok') throw outcome
    }
  }
  return stub
}

/** A delivery probe that answers `answers` in order (repeating the last) and counts reads. */
function probe(...answers: boolean[]) {
  const stub = {
    reads: 0,
    delivered: async (): Promise<boolean> => {
      const answer = answers[Math.min(stub.reads, answers.length - 1)] ?? false
      stub.reads++
      return answer
    }
  }
  return stub
}

describe('pushConfirmingDelivery', () => {
  it('sends a clean push once and never asks whether it arrived', async () => {
    const app = pusher('ok')
    const tiles = probe(false)
    await pushConfirmingDelivery(app.push, tiles.delivered, FAST)
    expect(app.sends).toBe(1)
    expect(tiles.reads).toBe(0)
  })

  // The case a blind retry gets wrong: the send happened before the context went, so a second one
  // would add a second pending tile and the message would carry the attachment twice.
  it('does not send again when the tile shows after a context loss', async () => {
    const app = pusher(new Error(TRANSIENT))
    const tiles = probe(true)
    await pushConfirmingDelivery(app.push, tiles.delivered, FAST)
    expect(app.sends).toBe(1)
  })

  it('does not send again when the tile shows on a later poll inside the window', async () => {
    const app = pusher(new Error(TRANSIENT))
    const tiles = probe(false, false, true)
    await pushConfirmingDelivery(app.push, tiles.delivered, FAST)
    expect(app.sends).toBe(1)
    expect(tiles.reads).toBe(3)
  })

  it('sends exactly once more when a context loss leaves no tile', async () => {
    const app = pusher(new Error(TRANSIENT), 'ok')
    const tiles = probe(false)
    await pushConfirmingDelivery(app.push, tiles.delivered, FAST)
    expect(app.sends).toBe(2)
  })

  // Tolerating one message must not become tolerating failure.
  it('rethrows any other error unchanged, after one send and no delivery read', async () => {
    const fatal = new Error('Target page, context or browser has been closed')
    const app = pusher(fatal)
    const tiles = probe(true)
    await expect(pushConfirmingDelivery(app.push, tiles.delivered, FAST)).rejects.toBe(fatal)
    expect(app.sends).toBe(1)
    expect(tiles.reads).toBe(0)
  })

  it('rethrows an error raised by the delivery read itself', async () => {
    const fatal = new Error('Target page, context or browser has been closed')
    const app = pusher(new Error(TRANSIENT))
    await expect(
      pushConfirmingDelivery(
        app.push,
        async () => {
          throw fatal
        },
        FAST
      )
    ).rejects.toBe(fatal)
    expect(app.sends).toBe(1)
  })

  // The bound on an app that never comes back: two sends, two watch windows, then a failure — not a
  // wait for the test timeout.
  it('fails after exactly two sends when the context is lost twice and no tile ever shows', async () => {
    const app = pusher(new Error(TRANSIENT), new Error(TRANSIENT), 'ok')
    const tiles = probe(false)
    await expect(pushConfirmingDelivery(app.push, tiles.delivered, FAST)).rejects.toThrow(/2 sends/)
    expect(app.sends).toBe(2)
  })
})
