import { describe, it, expect, vi } from 'vitest'
import {
  downloadAttachment,
  type AttachmentDownloadDeps
} from './downloadAttachment'
import {
  MAX_RETRIEVAL_IDENTIFIER_LENGTH,
  type AttachmentRetrievalEvent
} from '@shared/ipc/attachmentRetrieval'
import type { AttachmentSaveRequest } from '@shared/ipc/attachmentSave'
import type { MessageAttachment } from '../../store/threadTimeline'

// #816 — the two-ask sequencing behind the file row's click. The whole reason this lives in a module
// rather than inside the `onClick` is `copyMessageText`'s: `vitest.config.ts` sets `environment: 'node'`,
// so the renderer tier is `renderToStaticMarkup` with no DOM and no click, and an effect reachable only
// from a handler would be unprovable here. The click ITSELF is e2e/attachment-file-row.spec.ts's; what
// this file owns is what happens after it.
//
// ⭐ WHY THE SEQUENCING IS THE SUBSTANCE. The save channel does not fetch — `attachmentSave.ts` copies a
// file that is ALREADY in the app's private attachment directory and answers `source-unavailable` when
// nothing is there — and the retrieval leg (#996) is that directory's only writer. A click wired straight
// to the save channel would answer `source-unavailable` on every activation forever while passing a test
// that asserted "the identifier reached the save channel". So every test below that involves a save asserts
// it happened AFTER a `completed` terminal, never merely that it happened.
//
// The fakes stand in for the four preload seams. Nothing here imports React, `window.pyry` or Electron.

const ATTACHMENT: MessageAttachment = {
  attachmentId: 'att-1',
  filename: 'quarterly-report.pdf'
}
const CONVERSATION_ID = 'conv-7'

/** Every recorded interaction in one ordered log, so ORDER is assertable and not just occurrence. */
interface Recorder {
  deps: AttachmentDownloadDeps
  calls: string[]
  asks: unknown[]
  saves: AttachmentSaveRequest[]
  /** Deliver an event to every listener still subscribed, the way `webContents.send` reaches them all. */
  push: (event: AttachmentRetrievalEvent) => void
  liveListeners: () => number
}

function recorder(conversationId: string | null = CONVERSATION_ID): Recorder {
  const calls: string[] = []
  const asks: unknown[] = []
  const saves: AttachmentSaveRequest[] = []
  const listeners = new Set<(event: AttachmentRetrievalEvent) => void>()

  return {
    calls,
    asks,
    saves,
    push: (event) => {
      for (const listener of [...listeners]) listener(event)
    },
    liveListeners: () => listeners.size,
    deps: {
      getOpenConversationId: () => conversationId,
      requestAttachment: (request) => {
        calls.push('ask')
        asks.push(request)
      },
      onAttachmentRetrievalEvent: (listener) => {
        calls.push('subscribe')
        listeners.add(listener)
        return () => {
          calls.push('unsubscribe')
          listeners.delete(listener)
        }
      },
      saveAttachment: (request) => {
        calls.push('save')
        saves.push(request)
      }
    }
  }
}

describe('downloadAttachment — the fetch ask (#816 AC2)', () => {
  it('asks with the conversation and the attachment id AND NOTHING ELSE', () => {
    const r = recorder()

    downloadAttachment(r.deps, ATTACHMENT)

    expect(r.asks).toHaveLength(1)
    // An exact-object assertion, not two field reads: AC2 says "passing the conversation and the
    // attachment identifier and nothing else", so a stray `filename` — the one value a well-meaning
    // implementer would add, since it is right there on the record — has to redden something.
    expect(r.asks[0]).toEqual({
      conversationId: CONVERSATION_ID,
      attachmentId: ATTACHMENT.attachmentId
    })
  })

  it('SUBSCRIBES BEFORE IT ASKS', () => {
    const r = recorder()

    downloadAttachment(r.deps, ATTACHMENT)

    // Load-bearing rather than stylistic. `busy` and `not-connected` are decided synchronously inside
    // main's receiver, so subscribing after the ask is a race by construction — it survives today only
    // because the preload bridge happens to hop the IPC boundary first, which is an implementation
    // detail of a file this module does not own.
    expect(r.calls).toEqual(['subscribe', 'ask'])
  })

  it('never puts a path, a directory or a file name on the fetch ask', () => {
    const r = recorder()

    downloadAttachment(r.deps, { attachmentId: 'att-9', filename: '/etc/passwd' })

    // AC3: "Neither ask builds, joins or forwards a path". Asserted on the SERIALISED ask so a nested key
    // is caught too, and with a filename that is itself a path so a leak would be unmistakable.
    expect(JSON.stringify(r.asks[0])).not.toContain('passwd')
    expect(JSON.stringify(r.asks[0])).not.toContain('/')
  })
})

describe('downloadAttachment — the save ask on the completed terminal (#816 AC3)', () => {
  it('asks the save channel with the identifier and the drawn name, and only after `completed`', () => {
    const r = recorder()

    downloadAttachment(r.deps, ATTACHMENT)
    expect(r.saves).toHaveLength(0)

    r.push({ type: 'completed', attachmentId: ATTACHMENT.attachmentId })

    expect(r.saves).toEqual([
      { attachmentId: ATTACHMENT.attachmentId, filename: ATTACHMENT.filename }
    ])
    // The whole point of the slice, as an ordering: the fetch is asked, its terminal arrives, and only
    // then is the save asked. A `save` before `ask` here is the dead control the ticket describes.
    expect(r.calls).toEqual(['subscribe', 'ask', 'unsubscribe', 'save'])
  })

  it('tears the listener down on the terminal, so a repeat event cannot save twice', () => {
    const r = recorder()

    downloadAttachment(r.deps, ATTACHMENT)
    r.push({ type: 'completed', attachmentId: ATTACHMENT.attachmentId })
    expect(r.liveListeners()).toBe(0)

    // A duplicate push cannot happen through a torn-down listener; pushing anyway proves the teardown is
    // what stops it rather than main's own once-per-ask promise, which this module must not lean on.
    r.push({ type: 'completed', attachmentId: ATTACHMENT.attachmentId })
    expect(r.saves).toHaveLength(1)
  })

  it('passes the name VERBATIM — no sanitising, trimming or normalising on this side', () => {
    const r = recorder()
    // Three separate invitations to "clean it up first", in one value: a traversal segment, a bidi
    // override (the extension-spoofing shape #815 deferred here), and a leading dot.
    const hostile: MessageAttachment = {
      attachmentId: 'att-2',
      filename: '../.report‮gpj.exe'
    }

    downloadAttachment(r.deps, hostile)
    r.push({ type: 'completed', attachmentId: hostile.attachmentId })

    // `sanitizeAttachmentFilename` re-runs in MAIN on the value a path is actually built from. A second
    // sanitiser here would make what the operator SEES diverge from what a save WRITES — the timeline
    // store's own recorded ruling, and a worse defect than the tidiness it buys.
    expect(r.saves[0].filename).toBe(hostile.filename)
  })
})

describe('downloadAttachment — every other terminal is silent (#816 AC4)', () => {
  it('draws nothing and asks no save when the fetch fails', () => {
    const r = recorder()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    downloadAttachment(r.deps, ATTACHMENT)
    r.push({ type: 'failed', attachmentId: ATTACHMENT.attachmentId, reason: 'not-connected' })

    expect(r.saves).toHaveLength(0)
    expect(r.liveListeners()).toBe(0)
    // The log carries the reason and nothing else. `AttachmentRetrievalFailure` is a closed set of
    // literals written in this repo, so it provably holds no daemon text, no filename and no path —
    // which is the whole reason it is the one value allowed through.
    expect(logged).toHaveBeenCalledWith('attachment download fetch failed', 'not-connected')
    const everyArgument = logged.mock.calls.flat().join(' ')
    expect(everyArgument).not.toContain(ATTACHMENT.filename)
    expect(everyArgument).not.toContain(ATTACHMENT.attachmentId)
    logged.mockRestore()
  })

  it('leaves the row activatable: a second activation runs the whole sequence again', () => {
    const r = recorder()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    downloadAttachment(r.deps, ATTACHMENT)
    r.push({ type: 'failed', attachmentId: ATTACHMENT.attachmentId, reason: 'timed-out' })
    downloadAttachment(r.deps, ATTACHMENT)
    r.push({ type: 'completed', attachmentId: ATTACHMENT.attachmentId })

    // AC4's "leaves the row activatable again" holds because there is no state to reset — no pending
    // flag, no disabled attribute, nothing that a failure could leave stuck.
    expect(r.asks).toHaveLength(2)
    expect(r.saves).toHaveLength(1)
    logged.mockRestore()
  })
})

describe('downloadAttachment — correlation and independence', () => {
  it('ignores a terminal naming a DIFFERENT attachment and keeps waiting for its own', () => {
    const r = recorder()

    downloadAttachment(r.deps, ATTACHMENT)
    r.push({ type: 'completed', attachmentId: 'someone-elses-attachment' })

    expect(r.saves).toHaveLength(0)
    expect(r.liveListeners()).toBe(1)

    r.push({ type: 'completed', attachmentId: ATTACHMENT.attachmentId })
    expect(r.saves).toHaveLength(1)
  })

  it('runs two activations of two attachments independently', () => {
    const r = recorder()
    const second: MessageAttachment = { attachmentId: 'att-2', filename: 'notes.txt' }

    downloadAttachment(r.deps, ATTACHMENT)
    downloadAttachment(r.deps, second)
    expect(r.liveListeners()).toBe(2)

    // The terminals arrive out of order, which is the realistic case: two retrievals run concurrently
    // under main's cap of four and neither waits for the other.
    r.push({ type: 'completed', attachmentId: second.attachmentId })
    r.push({ type: 'completed', attachmentId: ATTACHMENT.attachmentId })

    expect(r.saves).toEqual([
      { attachmentId: second.attachmentId, filename: second.filename },
      { attachmentId: ATTACHMENT.attachmentId, filename: ATTACHMENT.filename }
    ])
    expect(r.liveListeners()).toBe(0)
  })
})

describe('downloadAttachment — the refusals, which are listener-lifetime preconditions', () => {
  // ⭐ NOT A SECOND SECURITY GATE. Main re-checks every ask with `isAttachmentRetrievalRequest`
  // regardless, and canonicity stays the single gate at `resolveAttachmentPath`. What these refusals buy
  // is that this module never SUBSCRIBES for an ask that will be dropped: a dropped ask pushes no
  // terminal at all, so the listener taken for it would never be torn down.

  it('asks nothing at all when no conversation is open', () => {
    const r = recorder(null)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    downloadAttachment(r.deps, ATTACHMENT)

    expect(r.calls).toEqual([])
    expect(r.liveListeners()).toBe(0)
    expect(logged).toHaveBeenCalledWith('attachment download without an open conversation')
    logged.mockRestore()
  })

  it('refuses an empty or over-long ATTACHMENT id without subscribing', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    for (const attachmentId of ['', 'a'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH + 1)]) {
      const r = recorder()
      downloadAttachment(r.deps, { attachmentId, filename: 'x.pdf' })
      expect(r.calls).toEqual([])
      expect(r.liveListeners()).toBe(0)
    }
    // The boundary itself still passes — the refusal is over the bound, not at it.
    const atTheBound = recorder()
    downloadAttachment(atTheBound.deps, {
      attachmentId: 'a'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH),
      filename: 'x.pdf'
    })
    expect(atTheBound.asks).toHaveLength(1)
    logged.mockRestore()
  })

  it('refuses an over-long CONVERSATION id without subscribing', () => {
    // ⭐ The security review's MUST FIX, and the reason this test exists separately from the one above.
    // `attachmentId` originates on this machine (main mints the upload id, the timeline records it), but
    // `activeConversationStore` holds the daemon's `ConversationCreatedPayload` VERBATIM off the wire —
    // so a hostile or buggy daemon chooses this string. Bounding only the attachment id would leave a
    // remote party able to make every ask fail main's guard while this module subscribed for it: one
    // accumulated ipcRenderer listener per click, driven by remote input.
    const r = recorder('c'.repeat(MAX_RETRIEVAL_IDENTIFIER_LENGTH + 1))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    downloadAttachment(r.deps, ATTACHMENT)

    expect(r.calls).toEqual([])
    expect(r.liveListeners()).toBe(0)
    expect(logged).toHaveBeenCalledWith('attachment download refused a malformed identifier')
    // The refusal log names no identifier — neither the hostile one nor the row's own.
    expect(logged.mock.calls.flat().join(' ')).not.toContain('cccc')
    logged.mockRestore()
  })

  it('refuses an EMPTY conversation id, which is a malformed ask rather than "nothing open"', () => {
    // `getOpenConversationId` returns `null` for "nothing open" (the `conversationLastReadDeps` shape,
    // written as an explicit null test rather than `open?.id ?? null` precisely so an empty-string id
    // stays an ordinary value). An empty string therefore reaches here as a real id that main's guard
    // rejects — buildRequestAttachment's own documented silent failure, since joining `''` onto a
    // directory yields the directory.
    const r = recorder('')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})

    downloadAttachment(r.deps, ATTACHMENT)

    expect(r.calls).toEqual([])
    logged.mockRestore()
  })
})
