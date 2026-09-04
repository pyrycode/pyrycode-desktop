import {
  MAX_RETRIEVAL_IDENTIFIER_LENGTH,
  type AttachmentRetrievalEvent,
  type AttachmentRetrievalRequest
} from '@shared/ipc/attachmentRetrieval'
import type { AttachmentSaveRequest } from '@shared/ipc/attachmentSave'
import type { MessageAttachment } from '../../store/threadTimeline'
import {
  activeConversationStore,
  selectActiveConversation
} from '../../store/activeConversationStore'

/**
 * #816 — what one activation of the bubble's attachment file row does.
 *
 * A module-level helper with injected effects, beside `copyMessageText` and for its recorded reason: the
 * renderer test tier is static server renders (`environment: 'node'`, no DOM, no `@testing-library`), so
 * an effect reachable only from an `onClick` would be unprovable. Here it is one function with three
 * seams and `downloadAttachment.test.ts` pins exactly what reaches each. The click itself belongs to
 * `e2e/attachment-file-row.spec.ts`, which is the only tier in this repo that can press anything.
 *
 * ⭐ THE DOWNLOAD IS TWO ASKS, NOT ONE, AND THAT IS THE WHOLE SUBSTANCE OF THE SLICE. The save channel
 * does not fetch: `src/main/attachmentSave.ts` copies a file that is ALREADY in the app's private
 * attachment directory and answers `source-unavailable` when nothing is there. The retrieval leg (#996)
 * is that directory's only writer — `storeAttachment`'s single caller is the composition root's
 * `createAttachmentRetrieval` — and the upload leg keeps no local copy, it streams the picked file to the
 * host and retains nothing. Every attachment a row can draw is one THIS window uploaded (`MessagePayload`
 * carries no attachment field and there is no list verb), so its bytes are on the host and not here. A
 * click wired straight to the save channel would therefore answer `source-unavailable` on every
 * activation, on every machine, forever — while satisfying a criterion reading "sends the identifier to
 * the save channel". That is a dead control that passes its own test, which is why the sequencing lives
 * here rather than in a follow-up.
 *
 * NO PENDING STATE AND NO FAILURE STATE, and both are deliberate rather than unfinished. The drawing has
 * neither, this slice invents nothing (AC4), and the ticket's Open Question records both gaps as needing
 * a Figma node and their own ticket. That is also what makes "leaves the row activatable again" true by
 * construction: there is no flag, no `disabled`, nothing a failure could leave stuck.
 *
 * NO SHARED FETCH-THEN-ACT MACHINERY. #868 and #869 will want this shape; neither is refined or started,
 * and the first one to need it twice can lift it.
 */

/**
 * The three seams plus the conversation read. Injected rather than imported so the whole decision surface
 * is exercisable with plain fakes under `environment: 'node'` — the `ConversationLastReadDeps` idiom.
 */
export interface AttachmentDownloadDeps {
  /** The conversation the thread is showing, or `null` when none is open. */
  getOpenConversationId: () => string | null
  /** `window.pyry.requestAttachment` — fire-and-forget; the terminal arrives on the listener below. */
  requestAttachment: (request: AttachmentRetrievalRequest) => void
  /** `window.pyry.onAttachmentRetrievalEvent`; returns the unsubscribe handle this module must call. */
  onAttachmentRetrievalEvent: (listener: (event: AttachmentRetrievalEvent) => void) => () => void
  /** `window.pyry.saveAttachment` — asked only on this activation's own `completed` terminal. */
  saveAttachment: (request: AttachmentSaveRequest) => void
}

/**
 * Fetch the attachment back from the host, and on that fetch's own `completed` terminal ask the save
 * channel for it. Never throws, and returns nothing: both channels are fire-and-forget with a pushed
 * terminal, so there is no result to hand back and nothing for a caller to await.
 *
 * NOTHING HERE BUILDS, JOINS OR FORWARDS A PATH (AC3). The window holds none: both directories — the
 * app-private attachment store and Downloads — are computed in the background process from Electron's
 * own per-user locations. The name rides along on the SAVE ask only, because main cannot get it any
 * other way (the retrieval leg deliberately discards it: `attachmentReassembler` never reads `filename`,
 * the stored file is flat and extension-less, and `AttachmentRetrievalEvent` is content-free). It is
 * display-derived, NOT addressing — the bytes are selected by the identifier alone, so a wrong or hostile
 * name saves the right file under a poor name, never a different file — and it crosses VERBATIM.
 * `sanitizeAttachmentFilename` re-runs in main on the value a path is actually built from; a second
 * sanitiser on this side would make what the operator SEES diverge from what a save WRITES, which is why
 * the renderer must not reach for that module at all.
 */
export function downloadAttachment(
  deps: AttachmentDownloadDeps,
  attachment: MessageAttachment
): void {
  const conversationId = deps.getOpenConversationId()
  if (conversationId === null) {
    // A row can only be drawn inside an open conversation, so this is unreachable rather than a state to
    // present. Logged as a bare event name — no identifier, no name.
    console.error('attachment download without an open conversation')
    return
  }

  if (!addressable(conversationId) || !addressable(attachment.attachmentId)) {
    console.error('attachment download refused a malformed identifier')
    return
  }

  // Subscribe BEFORE asking. Load-bearing rather than stylistic: `busy` and `not-connected` are decided
  // synchronously inside main's receiver, so the reverse order is a race by construction — it survives
  // today only because the preload bridge happens to hop the IPC boundary first, which is an
  // implementation detail of a file this module does not own.
  //
  // The handle is held in a `let` the listener reads through, with `settled` beside it, so a seam that
  // fired during subscription would still tear down exactly once instead of leaking. Two lines, and they
  // are what make the lifetime claim independent of how the bridge is built.
  let unsubscribe: (() => void) | null = null
  let settled = false

  const listener = (event: AttachmentRetrievalEvent): void => {
    // `attachmentId` is this window's OWN value coming back, never a wire-supplied one, so it is the
    // correlation key: two rows fetched at once stay distinguishable, and an event belonging to another
    // activation is left for that activation's own listener.
    if (settled || event.attachmentId !== attachment.attachmentId) return
    settled = true
    unsubscribe?.()

    if (event.type === 'failed') {
      // The reason is allowed through where nothing else is, and that is safe BY THE TYPE rather than by
      // care: every inhabitant of `AttachmentRetrievalFailure` is a string literal written in this repo,
      // so the value provably carries no daemon text, no filename, no digest, no host path and no local
      // path. AC4: nothing is drawn for any of the eleven.
      console.error('attachment download fetch failed', event.reason)
      return
    }

    deps.saveAttachment({
      attachmentId: attachment.attachmentId,
      filename: attachment.filename
    })
  }

  unsubscribe = deps.onAttachmentRetrievalEvent(listener)
  if (settled) unsubscribe()

  // A FRESH LITERAL rather than a spread of the record, so no field this timeline item carries now or
  // later can reach the ask by accident — `daemonConnection`'s posture for the envelope it builds from
  // these same two values, applied one boundary earlier. AC2: the conversation and the attachment, and
  // nothing else.
  deps.requestAttachment({ conversationId, attachmentId: attachment.attachmentId })

  // No save-event subscription. AC4 draws nothing on either save outcome, so there is no consumer; a
  // second subscription taken purely to log would double a listener's lifetime for a line main already
  // owns. And no de-duplication of activations: the ticket is explicit that a second activation simply
  // fetches again, and main's own `inFlight` map already collapses a duplicate ask for an attachment
  // being fetched into the live retrieval's single terminal.
}

/**
 * Whether an identifier can address anything at all — non-empty and within the bound main's boundary
 * guard enforces.
 *
 * ⭐ A LISTENER-LIFETIME PRECONDITION, NOT A SECOND SECURITY GATE, and the distinction is the point.
 * `isAttachmentRetrievalRequest` re-checks every ask in main regardless, and canonicity stays the single
 * gate at `resolveAttachmentPath` — a `../..` identifier still passes here, still goes to the daemon, and
 * still comes back refused with no local path ever built from it. What this buys is that no subscription
 * is ever taken for an ask that will be DROPPED: a dropped ask pushes no terminal at all, so its listener
 * would never be torn down. The bound is imported rather than restated, so there is no number to drift.
 *
 * BOTH IDENTIFIERS ARE CHECKED, and the conversation id is the one that matters. `attachmentId`
 * originates on this machine — main mints the upload id, `driveUpload` sends it as `attachment_id`, and
 * the timeline records it — so bounding it is hygiene. `activeConversationStore` holds the daemon's
 * `ConversationCreatedPayload` VERBATIM off the wire, so a hostile or buggy daemon chooses that string;
 * checking only the attachment id would leave a remote party able to make every activation's ask fail the
 * guard while this module subscribed for it, accumulating one listener per click.
 */
function addressable(identifier: string): boolean {
  return identifier.length > 0 && identifier.length <= MAX_RETRIEVAL_IDENTIFIER_LENGTH
}

/**
 * The production wiring. Each seam reaches its singleton inside the arrow body — the
 * `conversationLastReadDeps` / `runConfigLive` idiom — so `window.pyry` is dereferenced neither at module
 * load nor during render, only inside the click closure. Module-level, so the row's `onClick` closes over
 * a stable value and no re-render can rebuild it.
 *
 * The open-conversation read is the identical two-line getter `App.tsx` and `conversationLastReadBridge`
 * already hold, DUPLICATED a third time rather than relocated (CLAUDE.md — don't refactor adjacent code
 * while you are there). Written the same way in both existing places, as an explicit `null` test rather
 * than `open?.id ?? null`, so an empty-string id stays an ordinary value that `addressable` refuses on its
 * own merits instead of collapsing into "nothing open". `conversationLastReadBridge`'s own comment records
 * that "two consumers is the signal that a `selectOpenConversationId` selector would have a home — a
 * separate three-line ticket for whoever needs a third". This is the third; the ticket is not this one.
 */
export const attachmentDownloadDeps: AttachmentDownloadDeps = {
  getOpenConversationId: () => {
    const open = selectActiveConversation(activeConversationStore.getState())
    return open === null ? null : open.id
  },
  requestAttachment: (request) => window.pyry.requestAttachment(request),
  onAttachmentRetrievalEvent: (listener) => window.pyry.onAttachmentRetrievalEvent(listener),
  saveAttachment: (request) => window.pyry.saveAttachment(request)
}
