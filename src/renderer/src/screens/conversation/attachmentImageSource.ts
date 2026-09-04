import {
  MAX_RETRIEVAL_IDENTIFIER_LENGTH,
  type AttachmentRetrievalEvent,
  type AttachmentRetrievalFailure,
  type AttachmentRetrievalRequest
} from '@shared/ipc/attachmentRetrieval'
import type {
  AttachmentBytesEvent,
  AttachmentBytesFailure,
  AttachmentBytesRequest
} from '@shared/ipc/attachmentBytes'
import {
  activeConversationStore,
  selectActiveConversation
} from '../../store/activeConversationStore'

/**
 * #1044 — one attachment record turned into a URL an `<img>` can point at.
 *
 * A module-level driver with injected seams, beside `downloadAttachment` and for its recorded reason:
 * the renderer test tier is static server renders (`environment: 'node'`, no DOM, no `@testing-library`),
 * so a path reachable only from a `useEffect` would be unprovable. Here it is one function with seven
 * seams and `attachmentImageSource.test.ts` pins what reaches each.
 *
 * NOTHING IS DRAWN HERE AND NO `<img>` IS WRITTEN. The thumbnail is #1045's, and so is deciding what is
 * worth drawing: this module turns bytes into a URL and has no opinion about imageness.
 *
 * ⭐ THE FETCH COMES FIRST, AND THAT IS THE SUBSTANCE OF THE SLICE. `src/main/attachmentBytes.ts` reads
 * one directory — the app-private attachment store — whose SOLE writer is the retrieval leg, and the
 * upload leg keeps no local copy: it streams the picked file to the host and retains nothing. Every
 * attachment a bubble can draw is one THIS window uploaded, so its bytes are on the host and not here,
 * and a lone `requestAttachmentBytes` would answer `unavailable` on every machine, forever, while
 * satisfying a criterion reading "sends the identifier to the bytes channel". That is a dead control
 * that passes its own test, which is `downloadAttachment`'s trap met a second time and answered the
 * same way.
 *
 * ⭐ THE URL IS INERT UNTIL #1045, and that is a staged prerequisite rather than a defect.
 * `src/renderer/index.html`'s CSP is `default-src 'self'` with NO `img-src`, so a `blob:` source does
 * not load at all today. Widening it belongs to #1045 — a security policy is only provable where
 * something actually loads, and no tier here can load anything — and two slices editing that file would
 * be a merge conflict bought for nothing. THE CSP IS NOT TOUCHED HERE.
 *
 * NO SHARED FETCH-THEN-ACT MACHINERY WAS LIFTED, although `downloadAttachment`'s header permits the
 * second consumer to. The two are not the same shape: that one sequences one leg and hands its caller
 * nothing, where this one sequences two, answers a terminal, and owns a refcounted resource that
 * outlives the sequence. What is genuinely common is `awaitTerminal` below, and duplicating a dozen
 * lines inside this file costs less than making `downloadAttachment.ts` a second production file this
 * slice edits (CLAUDE.md — don't refactor adjacent code while you are there). #869 can lift with two
 * instances to generalise from.
 */

/**
 * Why one ask ended without a URL, as a closed set of CLIENT-OWNED literals: the two legs' own unions,
 * unioned. Every inhabitant is a string written in this repo, so a value of this type provably carries
 * no daemon text, no host path, no local path, no errno, no filename and no part of the identifier —
 * true BY THE TYPE rather than by care, which is `downloadAttachment`'s argument for the one value it
 * lets through to a log.
 *
 * A UNION ALIAS, NOT A NEW VOCABULARY. The rejected alternative was a collapsed client-owned union
 * behind an exhaustive mapping switch: fifteen arms and a test each, buying a consumer nothing the
 * literals do not already say, and adding a mirror to keep in step every time a member lands upstream.
 * The distinction that matters is what a consumer can do next, and the two unions already draw it —
 * `refused` never retry, `unavailable` fetch and ask again, `busy` wait. `busy` is a member of both and
 * collapses here, correctly: the answer is to wait either way.
 *
 * The retrieval members collapse harder than they look on the host's side: `not-found` is its ONE code
 * for every request that yields no bytes, made deliberately indistinguishable so two answers cannot turn
 * the verb into a path-existence oracle. A consumer must not present a reason implying more than that.
 */
export type AttachmentImageSourceFailure = AttachmentRetrievalFailure | AttachmentBytesFailure

/**
 * The terminal outcomes of one ask, discriminated on `type`. EXACTLY ONE reaches the caller, or none at
 * all when the caller released first.
 *
 * `url` is a `blob:` URL this window minted. It is a CAPABILITY HANDLE to the file's bytes within this
 * origin, so it belongs in exactly one place — an `<img>` `src` — and never in a log line, another
 * attribute, a cache key or a lookup path. It carries no part of the identifier: `URL.createObjectURL`
 * mints a random UUID.
 */
export type AttachmentImageSourceOutcome =
  | { type: 'ready'; url: string }
  | { type: 'failed'; reason: AttachmentImageSourceFailure }

/**
 * The seven seams. Injected rather than imported so the whole decision surface is exercisable with
 * plain fakes under `environment: 'node'` — the `AttachmentDownloadDeps` idiom.
 *
 * `createObjectUrl` and `revokeObjectUrl` are injected even though both work unfaked under node
 * (a `Blob` over a `Uint8Array` mints `blob:nodedata:<uuid>` and revoking it does not throw), because
 * the lifetime claim is only assertable against recorded URLs: "revoked exactly once, and only after the
 * last holder let go" needs to see the calls.
 */
export interface AttachmentImageSourceDeps {
  /** The conversation the thread is showing, or `null` when none is open. */
  getOpenConversationId: () => string | null
  /** `window.pyry.requestAttachment` — fire-and-forget; the terminal arrives on the listener below. */
  requestAttachment: (request: AttachmentRetrievalRequest) => void
  /** `window.pyry.onAttachmentRetrievalEvent`; returns the unsubscribe handle this module must call. */
  onAttachmentRetrievalEvent: (listener: (event: AttachmentRetrievalEvent) => void) => () => void
  /** `window.pyry.requestAttachmentBytes` — asked only on a `completed` retrieval terminal. */
  requestAttachmentBytes: (request: AttachmentBytesRequest) => void
  /** `window.pyry.onAttachmentBytesEvent`; returns the unsubscribe handle this module must call. */
  onAttachmentBytesEvent: (listener: (event: AttachmentBytesEvent) => void) => () => void
  /** `URL.createObjectURL`. */
  createObjectUrl: (blob: Blob) => string
  /** `URL.revokeObjectURL`. */
  revokeObjectUrl: (url: string) => void
}

export interface AttachmentImageSources {
  /**
   * Ask for one attachment's displayable URL, and hand back the caller's RELEASE HANDLE — always, on
   * every branch, before any terminal, so a caller can release unconditionally without knowing which
   * branch it took. Never throws.
   *
   * `onOutcome` runs at most once. It may run synchronously, when the URL is already live.
   */
  request: (
    attachmentId: string,
    onOutcome: (outcome: AttachmentImageSourceOutcome) => void
  ) => () => void
}

/** One live URL and the number of callers still drawing it. */
interface LiveSource {
  url: string
  holders: number
}

/**
 * Build the image-source driver: one `request` the thread's consumers call per attachment.
 *
 * CONSTRUCT IT ONCE FOR THE APP LIFETIME, not per ask. The live-URL map is the only state here and it is
 * only meaningful ACROSS asks — it is what makes "asking twice does not leave a second URL alive" true —
 * so a per-ask closure would reset it every time and disable the sharing silently, minting one URL per
 * mount and revoking none of the others. `createAttachmentBytes`'s recorded trap, one process over.
 *
 * NO RENDERER-SIDE QUEUE. Both legs cap at 4 concurrent, so a thread with five images in view meets
 * `busy` on both, and `busy` reaches the caller as a terminal it can act on. A queue here would be
 * machinery for a failure mode nobody has observed; if #1045 finds thumbnails routinely `busy`, raising
 * a cap is its own ticket. NO MAIN-SIDE CAP IS TOUCHED.
 */
export function createAttachmentImageSources(deps: AttachmentImageSourceDeps): AttachmentImageSources {
  /** Keyed by attachment id — the correlation key both legs echo back. An entry exists only while a
   *  holder does, so there is nothing to clear on conversation exit or pairing end. */
  const live = new Map<string, LiveSource>()

  function request(
    attachmentId: string,
    onOutcome: (outcome: AttachmentImageSourceOutcome) => void
  ): () => void {
    let released = false
    let held: LiveSource | null = null
    // EVERY listener teardown this ask takes, rather than one slot that the second leg overwrites. Each
    // is idempotent (its own `settled` flag), so releasing calls them all and a spent one is a no-op —
    // which is what makes the sequence correct even if a seam delivers its terminal synchronously,
    // where a single slot would be overwritten by the first leg's spent handle after the second leg had
    // already stored its live one.
    const teardowns: Array<() => void> = []

    const release = (): void => {
      // Idempotent, and that is not tidiness: without it a double release decrements past zero, and a
      // later join then revokes a URL another holder is still pointing at.
      if (released) return
      released = true
      for (const teardown of teardowns) teardown()
      teardowns.length = 0
      if (held === null) return
      held.holders -= 1
      if (held.holders === 0) {
        live.delete(attachmentId)
        deps.revokeObjectUrl(held.url)
      }
      held = null
    }

    /**
     * Take a share of a live URL and answer it.
     *
     * ⭐ THE ENTRY IS RECORDED BEFORE `onOutcome` RUNS. A consumer is free to release synchronously from
     * inside its own callback — a React effect that unmounts in the same commit does exactly that — and
     * a release running while this ask had not yet recorded what it holds would decrement nothing,
     * leaving the URL with a holder count of one and no holder: alive for the life of the window, with
     * the file's bytes behind it.
     */
    const takeShare = (source: LiveSource): void => {
      source.holders += 1
      held = source
      onOutcome({ type: 'ready', url: source.url })
    }

    const fail = (reason: AttachmentImageSourceFailure): void => {
      onOutcome({ type: 'failed', reason })
    }

    // The URL is already live: join it and touch no seam at all. This is what makes a scroll-away-and-
    // back remount free, and it is why fetching first costs a round trip only on the cold path.
    const alreadyLive = live.get(attachmentId)
    if (alreadyLive !== undefined) {
      takeShare(alreadyLive)
      return release
    }

    const conversationId = deps.getOpenConversationId()
    if (conversationId === null) {
      // A thumbnail can only be mounted inside an open conversation, so this is unreachable rather than
      // a state to present — but it is still ANSWERED. Logged as a bare event name: no identifier.
      console.error('attachment image source without an open conversation')
      fail('refused')
      return release
    }

    if (!addressable(conversationId) || !addressable(attachmentId)) {
      console.error('attachment image source refused a malformed identifier')
      fail('refused')
      return release
    }

    // LEG ONE — fetch the attachment back from the host.
    awaitTerminal<AttachmentRetrievalEvent>(
      attachmentId,
      deps.onAttachmentRetrievalEvent,
      () => deps.requestAttachment({ conversationId, attachmentId }),
      teardowns,
      (retrieval) => {
        if (released) return
        if (retrieval.type === 'failed') {
          // The reason is allowed through where nothing else is, and it is safe BY THE TYPE: every
          // inhabitant of `AttachmentRetrievalFailure` is a literal written in this repo.
          console.error('attachment image source fetch failed', retrieval.reason)
          fail(retrieval.reason)
          return
        }

        // LEG TWO — read the bytes that fetch just put on this machine.
        awaitTerminal<AttachmentBytesEvent>(
          attachmentId,
          deps.onAttachmentBytesEvent,
          () => deps.requestAttachmentBytes({ attachmentId }),
          teardowns,
          (bytes) => {
            if (released) return
            if (bytes.type === 'failed') {
              console.error('attachment image source read failed', bytes.reason)
              fail(bytes.reason)
              return
            }

            // ⭐ MINT-OR-JOIN, AND THIS BLOCK CONTAINS NO `await`. It is check-then-act on shared state
            // and it is sound only because run-to-completion keeps two handlers from interleaving inside
            // it — `createAttachmentBytes`'s argument for its own counter. A suspension point here lets
            // two concurrent asks both observe an empty map and both mint, and the loser's URL is then
            // alive with no holder that can revoke it.
            //
            // The join arm is not hypothetical: the bytes leg does NOT coalesce, so two asks for one
            // attachment produce two `delivered` events — and both asks' listeners are still subscribed
            // when the first arrives, so both settle on it and the second one lands here.
            const raced = live.get(attachmentId)
            if (raced !== undefined) {
              takeShare(raced)
              return
            }
            const source: LiveSource = { url: deps.createObjectUrl(toBlob(bytes.bytes)), holders: 0 }
            live.set(attachmentId, source)
            takeShare(source)
          }
        )
      }
    )

    return release
  }

  return { request }
}

/**
 * Subscribe, then ask, then hand the FIRST event naming this attachment to `onTerminal`, exactly once.
 * Registers its teardown in `teardowns` before asking, so an ask answered synchronously is still torn
 * down by a release that arrives during it.
 *
 * SUBSCRIBE BEFORE ASK is load-bearing rather than stylistic: `busy` and `not-connected` are decided
 * synchronously inside main's receiver, so the reverse order is a race by construction — it survives
 * today only because the preload bridge happens to hop the IPC boundary first, which is an
 * implementation detail of a file this module does not own.
 *
 * The handle is held in a `let` the listener reads through, with `settled` beside it, so a seam that
 * fired during subscription still tears down exactly once instead of leaking.
 *
 * `attachmentId` is the correlation key because it is this window's OWN value coming back, never a
 * wire-supplied one: two attachments fetched at once stay distinguishable, and an event belonging to
 * another ask is left for that ask's own listener. A malformed ask delivers no event at all on either
 * channel, which is why nothing subscribes before `addressable` has passed — a listener taken for a
 * dropped ask would never be torn down.
 */
function awaitTerminal<E extends { attachmentId: string }>(
  attachmentId: string,
  subscribe: (listener: (event: E) => void) => () => void,
  askFor: () => void,
  teardowns: Array<() => void>,
  onTerminal: (event: E) => void
): void {
  let unsubscribe: (() => void) | null = null
  let settled = false

  const listener = (event: E): void => {
    if (settled || event.attachmentId !== attachmentId) return
    settled = true
    unsubscribe?.()
    onTerminal(event)
  }

  unsubscribe = subscribe(listener)
  if (settled) unsubscribe()
  teardowns.push(() => {
    if (settled) return
    settled = true
    unsubscribe?.()
  })
  askFor()
}

/**
 * The delivered bytes as a `Blob`, WITH NO MEDIA TYPE.
 *
 * ⭐ THE SEAM A TYPE WOULD BE THREADED THROUGH, and the one place it would land. Nothing on this side
 * knows the type: the bytes channel carries none by construction, the retrieval leg discarded name and
 * type on purpose (`attachmentReassembler` reads neither `filename` nor `mime_type` and the stored file
 * is extension-less), and `matchImageSignature` lives in `src/main/` where the renderer must not reach —
 * sniffing here would mean a second copy of a signature table, the divergent-checks shape this family
 * argues against. Guessing one from `filename` would be a second imageness decision over an untrusted
 * name, and imageness is #1045's call.
 *
 * An `<img>` does not need it: image decoding is driven by the bytes, not by the blob's type. What a
 * declared type WOULD buy is forcing a `Content-Type` on a navigation to this URL, and that vector is
 * already closed three times over — `will-navigate` confines in-place navigation to the app's own
 * document, `setWindowOpenHandler` denies every scheme and externalises only `http:`/`https:`, and the
 * CSP's `default-src 'self'` plus `object-src 'none'` blocks a blob frame or object. #1045 must widen
 * `img-src` ONLY; a `frame-src`, `child-src` or relaxed `default-src` would reopen it.
 *
 * Deliberately not an optional `mediaType` parameter: an unexercised parameter is speculative
 * machinery, where a one-line function is a real seam with no dead surface.
 *
 * THE COPY IS A TYPE NARROWING, NOT A DEFENCE, and it is the honest one of four bad options. `bytes` is
 * declared `Uint8Array`, which TypeScript reads as `Uint8Array<ArrayBufferLike>`, and `BlobPart` demands
 * `ArrayBufferView<ArrayBuffer>` — a `SharedArrayBuffer`-backed view is what it is refusing. It cannot
 * arrive here (a SAB is not structured-cloneable across these two hops) but nothing in the type says so,
 * and the alternatives all cost more than one memcpy that runs once per attachment per window lifetime:
 * an unchecked `as` is forbidden outright, a runtime `instanceof` branch would be a failure path for a
 * structurally impossible input AND does not narrow the view itself, and widening
 * `AttachmentBytesEvent.bytes` would edit a shared IPC contract that main and preload also read, for a
 * renderer-local convenience. `new Uint8Array(view)` is `exactBytes`'s own line, one process over, and
 * the `Blob` would copy these bytes regardless.
 *
 * Nothing else is done to the delivered array: it is not re-validated, re-shaped or inspected. If the
 * `contextBridge` hop ever proved to re-wrap it, the repair is local to the preload listener, not to
 * this consumer (`attachment-bytes.md` § "The one property no tier in this repo can pin"). #1045's
 * browser tier is the first thing that can observe that hop at all.
 */
function toBlob(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)])
}

/**
 * Whether an identifier can address anything at all — non-empty and within the bound main's boundary
 * guard enforces.
 *
 * ⭐ A LISTENER-LIFETIME PRECONDITION, NOT A SECOND SECURITY GATE, and the distinction is the point.
 * `isAttachmentRetrievalRequest` and `isAttachmentBytesRequest` re-check every ask in main regardless,
 * and canonicity stays the single gate at `resolveAttachmentPath` — a `../..` identifier still passes
 * here, still goes to the daemon, and still comes back refused with no local path ever built from it.
 * What this buys is that no subscription is ever taken for an ask that will be DROPPED: a dropped ask
 * pushes no terminal at all, so its listener would never be torn down. The bound is imported rather than
 * restated, so there is no number to drift; the two legs declare the same 256.
 *
 * BOTH IDENTIFIERS ARE CHECKED, and the conversation id is the one that matters. `attachmentId`
 * originates on this machine — main mints the upload id, `driveUpload` sends it as `attachment_id`, and
 * the timeline records it — so bounding it is hygiene. `activeConversationStore` holds the daemon's
 * `ConversationCreatedPayload` VERBATIM off the wire, so a hostile or buggy daemon chooses that string;
 * checking only the attachment id would leave a remote party able to make every ask fail the guard while
 * this module subscribed for it, accumulating one listener per mounted thumbnail.
 */
function addressable(identifier: string): boolean {
  return identifier.length > 0 && identifier.length <= MAX_RETRIEVAL_IDENTIFIER_LENGTH
}

/**
 * The production wiring, constructed ONCE at module load — the lifetime the live-URL map needs. Each
 * seam reaches `window.pyry` inside the arrow body (the `attachmentDownloadDeps` idiom), so the bridge
 * is dereferenced neither at module load nor during render, only inside the ask.
 *
 * The open-conversation read is the identical two-line getter `App.tsx`, `conversationLastReadBridge`
 * and `attachmentDownloadDeps` already hold, DUPLICATED a fourth time rather than relocated (CLAUDE.md
 * — don't refactor adjacent code while you are there). Written the same way, as an explicit `null` test
 * rather than `open?.id ?? null`, so an empty-string id stays an ordinary value that `addressable`
 * refuses on its own merits instead of collapsing into "nothing open".
 */
export const attachmentImageSources: AttachmentImageSources = createAttachmentImageSources({
  getOpenConversationId: () => {
    const open = selectActiveConversation(activeConversationStore.getState())
    return open === null ? null : open.id
  },
  requestAttachment: (request) => window.pyry.requestAttachment(request),
  onAttachmentRetrievalEvent: (listener) => window.pyry.onAttachmentRetrievalEvent(listener),
  requestAttachmentBytes: (request) => window.pyry.requestAttachmentBytes(request),
  onAttachmentBytesEvent: (listener) => window.pyry.onAttachmentBytesEvent(listener),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url)
})
