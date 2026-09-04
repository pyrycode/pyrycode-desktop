import { describe, it, expect, vi } from 'vitest'
import {
  createAttachmentImageSources,
  type AttachmentImageSourceDeps,
  type AttachmentImageSourceOutcome
} from './attachmentImageSource'
import {
  MAX_RETRIEVAL_IDENTIFIER_LENGTH,
  type AttachmentRetrievalEvent
} from '@shared/ipc/attachmentRetrieval'
import type { AttachmentBytesEvent } from '@shared/ipc/attachmentBytes'

// #1044 — the two-leg path from an attachment record to a URL an `<img>` can point at. The whole reason
// this lives in a module rather than inside a component is `downloadAttachment`'s: `vitest.config.ts`
// sets `environment: 'node'`, so the renderer tier is `renderToStaticMarkup` with no DOM and no effects,
// and a path reachable only from a `useEffect` would be unprovable here. The drawing is #1045's.
//
// ⭐ WHY THE FETCH COMES FIRST. `src/main/attachmentBytes.ts` reads one directory whose SOLE writer is
// the retrieval leg, and the upload leg keeps no local copy — so a single `requestAttachmentBytes` for
// an attachment this window uploaded answers `unavailable` on every machine, forever. Every test below
// that reaches bytes therefore asserts the read happened AFTER a `completed` retrieval terminal, never
// merely that it happened.
//
// ⭐ THE TWO LEGS ANSWER A REPEAT ASK DIFFERENTLY, and the fakes model both. Retrieval is COALESCED in
// main (`if (inFlight.has(attachmentId)) return`) and its terminal is pushed once on the asking window's
// webContents, so every live listener runs — which is why `push` here reaches them all rather than
// pairing one event to one ask. Bytes is NOT coalesced. A spec that generalised across the two would be
// wrong about one of them.
//
// The fakes stand in for the seven seams. Nothing here imports React, `window.pyry` or Electron.

const ATTACHMENT_ID = 'att-1'
const CONVERSATION_ID = 'conv-7'
/** A PNG signature, so a spec reading these bytes back is unmistakable. Nothing here sniffs them. */
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** Every recorded interaction in one ordered log, so ORDER is assertable and not just occurrence. */
interface Recorder {
  deps: AttachmentImageSourceDeps
  calls: string[]
  fetches: unknown[]
  reads: unknown[]
  blobs: Blob[]
  minted: string[]
  revoked: string[]
  /** Deliver to every listener still subscribed, the way `webContents.send` reaches them all. */
  pushRetrieval: (event: AttachmentRetrievalEvent) => void
  pushBytes: (event: AttachmentBytesEvent) => void
  liveRetrievalListeners: () => number
  liveBytesListeners: () => number
}

function recorder(conversationId: string | null = CONVERSATION_ID): Recorder {
  const calls: string[] = []
  const fetches: unknown[] = []
  const reads: unknown[] = []
  const blobs: Blob[] = []
  const minted: string[] = []
  const revoked: string[] = []
  const retrievalListeners = new Set<(event: AttachmentRetrievalEvent) => void>()
  const bytesListeners = new Set<(event: AttachmentBytesEvent) => void>()

  return {
    calls,
    fetches,
    reads,
    blobs,
    minted,
    revoked,
    pushRetrieval: (event) => {
      for (const listener of [...retrievalListeners]) listener(event)
    },
    pushBytes: (event) => {
      for (const listener of [...bytesListeners]) listener(event)
    },
    liveRetrievalListeners: () => retrievalListeners.size,
    liveBytesListeners: () => bytesListeners.size,
    deps: {
      getOpenConversationId: () => conversationId,
      requestAttachment: (request) => {
        calls.push('fetch')
        fetches.push(request)
      },
      onAttachmentRetrievalEvent: (listener) => {
        calls.push('subscribe:retrieval')
        retrievalListeners.add(listener)
        return () => {
          calls.push('unsubscribe:retrieval')
          retrievalListeners.delete(listener)
        }
      },
      requestAttachmentBytes: (request) => {
        calls.push('read')
        reads.push(request)
      },
      onAttachmentBytesEvent: (listener) => {
        calls.push('subscribe:bytes')
        bytesListeners.add(listener)
        return () => {
          calls.push('unsubscribe:bytes')
          bytesListeners.delete(listener)
        }
      },
      createObjectUrl: (blob) => {
        calls.push('mint')
        blobs.push(blob)
        const url = `blob:nodedata:minted-${minted.length}`
        minted.push(url)
        return url
      },
      revokeObjectUrl: (url) => {
        calls.push('revoke')
        revoked.push(url)
      }
    }
  }
}

/** One caller: its collected terminals and the release handle it was given. */
function ask(
  r: Recorder,
  sources: ReturnType<typeof createAttachmentImageSources>,
  attachmentId: string = ATTACHMENT_ID
): { outcomes: AttachmentImageSourceOutcome[]; release: () => void } {
  const outcomes: AttachmentImageSourceOutcome[] = []
  const release = sources.request(attachmentId, (outcome) => outcomes.push(outcome))
  return { outcomes, release }
}

/** Drive one cold ask all the way to `ready`. */
function settleReady(
  r: Recorder,
  sources: ReturnType<typeof createAttachmentImageSources>,
  attachmentId: string = ATTACHMENT_ID
): { outcomes: AttachmentImageSourceOutcome[]; release: () => void } {
  const caller = ask(r, sources, attachmentId)
  r.pushRetrieval({ type: 'completed', attachmentId })
  r.pushBytes({ type: 'delivered', attachmentId, bytes: BYTES })
  return caller
}

describe('attachmentImageSource — one ask, two legs, one terminal (#1044 AC1)', () => {
  it('fetches first, reads second, and answers a minted URL', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const caller = ask(r, sources)

    // Leg one only, so far. The bytes are NOT on this machine until the fetch lands: reading first would
    // answer `unavailable` on every machine forever while passing a test that asserted "the identifier
    // reached the bytes channel".
    expect(r.calls).toEqual(['subscribe:retrieval', 'fetch'])
    expect(r.reads).toEqual([])
    expect(caller.outcomes).toEqual([])

    r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })
    expect(r.reads).toEqual([{ attachmentId: ATTACHMENT_ID }])
    expect(caller.outcomes).toEqual([])

    r.pushBytes({ type: 'delivered', attachmentId: ATTACHMENT_ID, bytes: BYTES })

    expect(caller.outcomes).toEqual([{ type: 'ready', url: r.minted[0] }])
    expect(r.minted).toHaveLength(1)
    // The whole slice as an ordering. A `mint` before `fetch` is the dead control the ticket describes.
    expect(r.calls).toEqual([
      'subscribe:retrieval',
      'fetch',
      'unsubscribe:retrieval',
      'subscribe:bytes',
      'read',
      'unsubscribe:bytes',
      'mint'
    ])
  })

  it('SUBSCRIBES BEFORE IT ASKS, on both legs', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    ask(r, sources)
    r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })

    // Load-bearing rather than stylistic. `busy` and `not-connected` are decided synchronously inside
    // main's receiver, so the reverse order is a race by construction.
    expect(r.calls.indexOf('subscribe:retrieval')).toBeLessThan(r.calls.indexOf('fetch'))
    expect(r.calls.indexOf('subscribe:bytes')).toBeLessThan(r.calls.indexOf('read'))
  })

  it('puts the conversation and the attachment on the fetch, and ONLY the attachment on the read', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    settleReady(r, sources)

    // Exact-object assertions, not field reads: nothing this record carries now or later may reach
    // either ask by accident, and a smuggled `path` or `filename` has to redden something.
    expect(r.fetches).toEqual([
      { conversationId: CONVERSATION_ID, attachmentId: ATTACHMENT_ID }
    ])
    expect(r.reads).toEqual([{ attachmentId: ATTACHMENT_ID }])
  })

  it('builds the Blob from the delivered bytes and gives it NO media type', async () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    settleReady(r, sources)

    expect(r.blobs).toHaveLength(1)
    expect(new Uint8Array(await r.blobs[0].arrayBuffer())).toEqual(BYTES)
    // ⭐ The slice's own narrow question, answered and pinned. Nothing here knows the type: the channel
    // carries none, the retrieval leg discarded name and type on purpose, and `matchImageSignature`
    // lives in src/main where the renderer must not reach. Guessing one from an untrusted filename would
    // be a second imageness decision, which is #1045's call and not this module's.
    expect(r.blobs[0].type).toBe('')
  })

  it('mints a URL that carries no part of the identifier', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const caller = settleReady(r, sources, 'secret-storage-handle')
    const outcome = caller.outcomes[0]

    // `attachmentId` is a host-side storage handle with no display value, and it must not be
    // representable in anything this module hands out. `URL.createObjectURL` mints a random UUID, so
    // this holds in production too — asserted here so a "helpful" keyed URL scheme would redden.
    expect(outcome.type).toBe('ready')
    expect(JSON.stringify(outcome)).not.toContain('secret-storage-handle')
  })
})

describe('attachmentImageSource — every failure is one terminal of closed literals (#1044 AC2)', () => {
  it('answers a retrieval failure with its own literal and never reads bytes', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    // The four the retrieval leg can answer with nothing on this machine to show for it. `not-found` is
    // the host's ONE code for every no-bytes case, deliberately, so two answers cannot turn the verb
    // into a path-existence oracle — nothing here presents a reason implying more than that.
    for (const reason of ['busy', 'not-connected', 'not-found', 'timed-out'] as const) {
      const r = recorder()
      const sources = createAttachmentImageSources(r.deps)
      const caller = ask(r, sources)

      r.pushRetrieval({ type: 'failed', attachmentId: ATTACHMENT_ID, reason })

      expect(caller.outcomes).toEqual([{ type: 'failed', reason }])
      expect(r.calls).not.toContain('read')
      expect(r.minted).toEqual([])
      expect(r.liveRetrievalListeners()).toBe(0)
      expect(r.liveBytesListeners()).toBe(0)
    }
    logged.mockRestore()
  })

  it('answers a bytes failure with its own literal, after a completed fetch', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    for (const reason of ['refused', 'unavailable', 'busy'] as const) {
      const r = recorder()
      const sources = createAttachmentImageSources(r.deps)
      const caller = ask(r, sources)

      r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })
      r.pushBytes({ type: 'failed', attachmentId: ATTACHMENT_ID, reason })

      expect(caller.outcomes).toEqual([{ type: 'failed', reason }])
      expect(r.minted).toEqual([])
      expect(r.liveBytesListeners()).toBe(0)
    }
    logged.mockRestore()
  })

  it('reaches exactly ONE terminal even when the channel keeps pushing', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)
    const caller = ask(r, sources)

    r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })
    r.pushBytes({ type: 'delivered', attachmentId: ATTACHMENT_ID, bytes: BYTES })
    // A repeat cannot arrive through a torn-down listener; pushing anyway proves the teardown is what
    // stops it rather than main's own once-per-ask promise, which this module must not lean on.
    r.pushBytes({ type: 'delivered', attachmentId: ATTACHMENT_ID, bytes: BYTES })
    r.pushRetrieval({ type: 'failed', attachmentId: ATTACHMENT_ID, reason: 'timed-out' })

    expect(caller.outcomes).toHaveLength(1)
    expect(r.minted).toHaveLength(1)
    logged.mockRestore()
  })

  it('leaks nothing into a log line: a static name and a closed-set literal, and never the URL', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    ask(r, sources, 'att-secret')
    r.pushRetrieval({ type: 'completed', attachmentId: 'att-secret' })
    r.pushBytes({ type: 'failed', attachmentId: 'att-secret', reason: 'unavailable' })

    const everyArgument = logged.mock.calls.flat().join(' ')
    expect(everyArgument).toContain('unavailable')
    expect(everyArgument).not.toContain('att-secret')
    // A `blob:` URL is a capability handle to the user's file content within this origin. It belongs in
    // exactly one place — an `<img>` src — and never in a log line, an attribute or a cache key.
    expect(everyArgument).not.toContain('blob:')
    logged.mockRestore()
  })
})

describe('attachmentImageSource — the URL lives exactly as long as its holders (#1044 AC3)', () => {
  it('revokes on the last release and not before', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const first = settleReady(r, sources)
    // A second ask for a URL that is already live touches NO seam at all: no fetch, no read, no mint.
    const before = [...r.calls]
    const second = ask(r, sources)

    expect(r.calls).toEqual(before)
    expect(second.outcomes).toEqual([{ type: 'ready', url: r.minted[0] }])
    expect(r.minted).toHaveLength(1)

    first.release()
    // AC3's "not released while a holder still has it" — the second caller is still drawing it.
    expect(r.revoked).toEqual([])

    second.release()
    expect(r.revoked).toEqual([r.minted[0]])
  })

  it('is idempotent: a double release cannot revoke a URL another holder still has', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const first = settleReady(r, sources)
    const second = ask(r, sources)

    first.release()
    first.release()
    first.release()

    // Without the idempotence flag the count goes past zero and the LAST holder's release finds a
    // negative count, or a later join revokes a URL that is still on screen.
    expect(r.revoked).toEqual([])
    second.release()
    expect(r.revoked).toEqual([r.minted[0]])
  })

  it('releases a URL for good: a later ask fetches again rather than handing back a revoked one', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    settleReady(r, sources).release()
    expect(r.revoked).toEqual([r.minted[0]])

    const again = settleReady(r, sources)

    expect(r.minted).toHaveLength(2)
    expect(again.outcomes).toEqual([{ type: 'ready', url: r.minted[1] }])
  })

  it('mints nothing when the caller released before the terminal', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const caller = ask(r, sources)
    caller.release()

    // The listener is gone, so the ask in flight main-side answers into nothing. Neither leg offers a
    // cancel and inventing one is out of scope; what matters is that no URL is minted for a caller that
    // will never release it.
    expect(r.liveRetrievalListeners()).toBe(0)
    r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })
    r.pushBytes({ type: 'delivered', attachmentId: ATTACHMENT_ID, bytes: BYTES })

    expect(caller.outcomes).toEqual([])
    expect(r.minted).toEqual([])
    expect(r.calls).not.toContain('read')
  })

  it('mints nothing when the caller released BETWEEN the two legs', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const caller = ask(r, sources)
    r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })
    expect(r.liveBytesListeners()).toBe(1)

    caller.release()
    expect(r.liveBytesListeners()).toBe(0)

    r.pushBytes({ type: 'delivered', attachmentId: ATTACHMENT_ID, bytes: BYTES })
    expect(caller.outcomes).toEqual([])
    expect(r.minted).toEqual([])
  })

  it('revokes for a caller that releases synchronously from inside its own callback', () => {
    // ⭐ The security pass's ordering finding. A React effect that unmounts in the same commit releases
    // from inside the callback. If the ask recorded what it holds AFTER invoking the callback, this
    // release would decrement nothing and the URL would have a holder count of one and no holder — alive
    // for the life of the window, holding the file's bytes with it.
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    let release: () => void = () => {}
    release = sources.request(ATTACHMENT_ID, () => release())
    r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })
    r.pushBytes({ type: 'delivered', attachmentId: ATTACHMENT_ID, bytes: BYTES })

    expect(r.minted).toHaveLength(1)
    expect(r.revoked).toEqual([r.minted[0]])
  })

  it('releasing a failed ask revokes nothing and throws nothing', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const caller = ask(r, sources)
    r.pushRetrieval({ type: 'failed', attachmentId: ATTACHMENT_ID, reason: 'not-found' })
    caller.release()

    expect(r.revoked).toEqual([])
    logged.mockRestore()
  })
})

describe('attachmentImageSource — two callers, one attachment (#1044 AC4)', () => {
  it('settles both from the SINGLE retrieval event main coalesces them into', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const first = ask(r, sources)
    const second = ask(r, sources)

    // Both asks reach main; main's `inFlight` map makes the second a TOTAL no-op and the live
    // retrieval's terminal — pushed once on this window's webContents — answers both.
    expect(r.fetches).toHaveLength(2)
    expect(r.liveRetrievalListeners()).toBe(2)

    r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })
    expect(r.liveRetrievalListeners()).toBe(0)
    // The bytes leg is the opposite: NOT coalesced, so both asks are live reads.
    expect(r.reads).toHaveLength(2)

    r.pushBytes({ type: 'delivered', attachmentId: ATTACHMENT_ID, bytes: BYTES })

    expect(first.outcomes).toEqual([{ type: 'ready', url: r.minted[0] }])
    expect(second.outcomes).toEqual([{ type: 'ready', url: r.minted[0] }])
    // AC3's "asking twice does not leave a second URL alive", through the concurrent path: the second
    // handler takes the join branch rather than minting again.
    expect(r.minted).toHaveLength(1)

    first.release()
    expect(r.revoked).toEqual([])
    second.release()
    expect(r.revoked).toEqual([r.minted[0]])
  })

  it('gives both callers the same terminal when a retrieval failure answers both', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const first = ask(r, sources)
    const second = ask(r, sources)
    r.pushRetrieval({ type: 'failed', attachmentId: ATTACHMENT_ID, reason: 'busy' })

    expect(first.outcomes).toEqual([{ type: 'failed', reason: 'busy' }])
    expect(second.outcomes).toEqual([{ type: 'failed', reason: 'busy' }])
    logged.mockRestore()
  })
})

describe('attachmentImageSource — correlation and independence', () => {
  it('ignores a terminal naming a DIFFERENT attachment and keeps waiting for its own', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)
    const caller = ask(r, sources)

    r.pushRetrieval({ type: 'completed', attachmentId: 'someone-elses-attachment' })
    expect(r.liveRetrievalListeners()).toBe(1)
    expect(r.calls).not.toContain('read')

    r.pushRetrieval({ type: 'completed', attachmentId: ATTACHMENT_ID })
    r.pushBytes({ type: 'delivered', attachmentId: 'someone-elses-attachment', bytes: BYTES })
    expect(r.liveBytesListeners()).toBe(1)
    expect(r.minted).toEqual([])

    r.pushBytes({ type: 'delivered', attachmentId: ATTACHMENT_ID, bytes: BYTES })
    expect(caller.outcomes).toEqual([{ type: 'ready', url: r.minted[0] }])
  })

  it('runs two attachments independently, settling out of order', () => {
    const r = recorder()
    const sources = createAttachmentImageSources(r.deps)

    const first = ask(r, sources, 'att-a')
    const second = ask(r, sources, 'att-b')

    r.pushRetrieval({ type: 'completed', attachmentId: 'att-b' })
    r.pushRetrieval({ type: 'completed', attachmentId: 'att-a' })
    r.pushBytes({ type: 'delivered', attachmentId: 'att-b', bytes: BYTES })
    r.pushBytes({ type: 'delivered', attachmentId: 'att-a', bytes: BYTES })

    // Two attachments are two entries, so two URLs — the cache is keyed by identifier, not shared.
    expect(r.minted).toHaveLength(2)
    expect(second.outcomes).toEqual([{ type: 'ready', url: r.minted[0] }])
    expect(first.outcomes).toEqual([{ type: 'ready', url: r.minted[1] }])

    second.release()
    expect(r.revoked).toEqual([r.minted[0]])
  })
})

describe('attachmentImageSource — the local refusals, which still answer a terminal', () => {
  // ⭐ NOT A SECOND SECURITY GATE. Main re-checks every ask with its own boundary guard regardless, and
  // canonicity stays the single gate at `resolveAttachmentPath`. What these buy is that this module never
  // SUBSCRIBES for an ask that will be dropped: a dropped ask pushes no terminal at all, so its listener
  // would never be torn down.
  //
  // ⭐ AND THEY ANSWER, which is the departure from `downloadAttachment`. That module had no caller to
  // answer and could simply return. AC2 says every failure reaches the caller as one terminal, and a
  // consumer left without one is a thumbnail that spins forever.

  it('answers `refused` with no conversation open, without touching a seam', () => {
    const r = recorder(null)
    const sources = createAttachmentImageSources(r.deps)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const caller = ask(r, sources)

    expect(caller.outcomes).toEqual([{ type: 'failed', reason: 'refused' }])
    expect(r.calls).toEqual([])
    expect(logged).toHaveBeenCalledWith('attachment image source without an open conversation')
    logged.mockRestore()
  })

  it('answers `refused` for an empty or over-long ATTACHMENT id, without subscribing', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    for (const attachmentId of ['', 'a'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH + 1)]) {
      const r = recorder()
      const sources = createAttachmentImageSources(r.deps)
      const caller = ask(r, sources, attachmentId)

      expect(caller.outcomes).toEqual([{ type: 'failed', reason: 'refused' }])
      expect(r.calls).toEqual([])
      expect(r.liveRetrievalListeners()).toBe(0)
    }

    // The boundary itself still passes — the refusal is over the bound, not at it.
    const atTheBound = recorder()
    const sources = createAttachmentImageSources(atTheBound.deps)
    ask(atTheBound, sources, 'a'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH))
    expect(atTheBound.fetches).toHaveLength(1)
    logged.mockRestore()
  })

  it('answers `refused` for an over-long CONVERSATION id, without subscribing', () => {
    // ⭐ The security review's carried-forward MUST FIX, and why this is a separate test. `attachmentId`
    // originates on this machine (main mints the upload id, the timeline records it), but
    // `activeConversationStore` holds the daemon's `ConversationCreatedPayload` VERBATIM off the wire —
    // so a hostile or buggy daemon chooses this string. Bounding only the attachment id would leave a
    // remote party able to make every ask fail main's guard while this module subscribed for it: one
    // accumulated ipcRenderer listener per mounted thumbnail, driven by remote input.
    const r = recorder('c'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH + 1))
    const sources = createAttachmentImageSources(r.deps)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const caller = ask(r, sources)

    expect(caller.outcomes).toEqual([{ type: 'failed', reason: 'refused' }])
    expect(r.calls).toEqual([])
    expect(logged).toHaveBeenCalledWith('attachment image source refused a malformed identifier')
    // The refusal log names no identifier — neither the hostile one nor the ask's own.
    expect(logged.mock.calls.flat().join(' ')).not.toContain('cccc')
    logged.mockRestore()
  })

  it('answers `refused` for an EMPTY conversation id, which is malformed rather than "nothing open"', () => {
    // `getOpenConversationId` returns `null` for "nothing open", written as an explicit null test rather
    // than `open?.id ?? null` precisely so an empty-string id stays an ordinary value that main's guard
    // rejects — `buildRequestAttachment`'s own documented silent failure, since joining `''` onto a
    // directory yields the directory.
    const r = recorder('')
    const sources = createAttachmentImageSources(r.deps)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    const caller = ask(r, sources)

    expect(caller.outcomes).toEqual([{ type: 'failed', reason: 'refused' }])
    expect(r.calls).toEqual([])
    logged.mockRestore()
  })

  it('hands back a working release handle even from a refusal', () => {
    const r = recorder(null)
    const sources = createAttachmentImageSources(r.deps)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    // A caller cannot know which branch it took, so it releases unconditionally. That must be a no-op
    // rather than a throw.
    const caller = ask(r, sources)
    expect(() => caller.release()).not.toThrow()
    expect(r.revoked).toEqual([])
    logged.mockRestore()
  })
})
