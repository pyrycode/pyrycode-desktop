import { describe, it, expect, vi } from 'vitest'
import {
  createBundleReassembler,
  type BundleConsumer,
  type BundleFailReason
} from './bundleReassembler'

// The reassembler is a pure, crypto-free accumulator — no codec, no Noise, no IPC. A shared spy
// consumer records the single terminal (complete XOR fail) and the per-chunk progress ticks. Bytes
// are built inline; the assertions pin the ordered concatenation.
function makeConsumer(): {
  consumer: BundleConsumer
  completed: Uint8Array[]
  failed: BundleFailReason[]
  progress: number[]
} {
  const completed: Uint8Array[] = []
  const failed: BundleFailReason[] = []
  const progress: number[] = []
  return {
    completed,
    failed,
    progress,
    consumer: {
      complete: (bytes) => completed.push(bytes),
      fail: (reason) => failed.push(reason),
      progress: (n) => progress.push(n)
    }
  }
}

/** Turn a byte-list into a Uint8Array chunk. */
const chunk = (...values: number[]): Uint8Array => new Uint8Array(values)

describe('createBundleReassembler — happy path', () => {
  it('concatenates ordered chunks into the exact streamed bytes on done', () => {
    const { consumer, completed, failed, progress } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(1, 2, 3))
    r.chunk(1, chunk(4, 5))
    r.chunk(2, chunk(6))
    r.done(3)

    expect(failed).toEqual([])
    expect(completed).toHaveLength(1)
    expect([...completed[0]]).toEqual([1, 2, 3, 4, 5, 6])
    // progress ticks once per accepted chunk with the ascending running count.
    expect(progress).toEqual([1, 2, 3])
  })

  it('completes a one-chunk stream', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(9, 9))
    r.done(1)

    expect(failed).toEqual([])
    expect([...completed[0]]).toEqual([9, 9])
  })

  it('completes an empty bundle (zero chunks, done{total:0}) with a zero-length archive', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.done(0)

    expect(failed).toEqual([])
    expect(completed).toHaveLength(1)
    expect(completed[0]).toHaveLength(0)
  })
})

describe('createBundleReassembler — seq integrity (AC3)', () => {
  it('fails on a gap (0 then 2)', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(1))
    r.chunk(2, chunk(3))

    expect(failed).toEqual(['seq-mismatch'])
    expect(completed).toEqual([])
  })

  it('fails on a reorder (1 then 0)', () => {
    const { consumer, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(1, chunk(1))

    expect(failed).toEqual(['seq-mismatch'])
  })

  it('fails on a duplicate (0 then 0)', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(1))
    r.chunk(0, chunk(1))

    expect(failed).toEqual(['seq-mismatch'])
    expect(completed).toEqual([])
  })
})

describe('createBundleReassembler — total integrity (AC3)', () => {
  it('fails when done.total exceeds the count received (truncation)', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(1))
    r.chunk(1, chunk(2))
    r.done(3)

    expect(failed).toEqual(['total-mismatch'])
    expect(completed).toEqual([])
  })

  it('fails when done.total is below the count received', () => {
    const { consumer, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(1))
    r.chunk(1, chunk(2))
    r.done(1)

    expect(failed).toEqual(['total-mismatch'])
  })
})

describe('createBundleReassembler — external fail reasons (AC3, AC4)', () => {
  it('fails on a daemon-error mid-stream, completing nothing', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(1))
    r.fail('daemon-error')

    expect(failed).toEqual(['daemon-error'])
    expect(completed).toEqual([])
  })

  it('fails on connection-lost mid-stream', () => {
    const { consumer, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(1))
    r.fail('connection-lost')

    expect(failed).toEqual(['connection-lost'])
  })
})

describe('createBundleReassembler — terminal-once', () => {
  it('ignores every frame after a successful complete', () => {
    const { consumer, completed, failed, progress } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(1))
    r.done(1)
    // Post-terminal stray frames — all inert.
    r.chunk(1, chunk(2))
    r.done(2)
    r.fail('connection-lost')

    expect(completed).toHaveLength(1)
    expect(failed).toEqual([])
    expect(progress).toEqual([1]) // no progress after settle
  })

  it('ignores every frame after a fail', () => {
    const { consumer, completed, failed } = makeConsumer()
    const r = createBundleReassembler(consumer)

    r.fail('daemon-error')
    r.chunk(0, chunk(1))
    r.done(0)
    r.fail('connection-lost')

    expect(failed).toEqual(['daemon-error']) // exactly one terminal
    expect(completed).toEqual([])
  })
})

describe('createBundleReassembler — optional progress + never logs', () => {
  it('works without a progress callback', () => {
    const completed: Uint8Array[] = []
    const consumer: BundleConsumer = { complete: (b) => completed.push(b), fail: () => {} }
    const r = createBundleReassembler(consumer)

    r.chunk(0, chunk(7))
    r.done(1)

    expect([...completed[0]]).toEqual([7])
  })

  it('never writes to the console', () => {
    const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const
    const spies = methods.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    try {
      const { consumer } = makeConsumer()
      const r = createBundleReassembler(consumer)
      r.chunk(0, chunk(1))
      r.chunk(2, chunk(2)) // a failing path too
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
    }
  })
})
