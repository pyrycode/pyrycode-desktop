import {
  MAX_RETRIEVAL_IDENTIFIER_LENGTH,
  type AttachmentRetrievalEvent,
  type AttachmentRetrievalRequest
} from '@shared/ipc/attachmentRetrieval'
import type { AttachmentSaveRequest } from '@shared/ipc/attachmentSave'
import type { AttachmentOpenEvent } from '@shared/ipc/attachmentOpen'
import { attachmentAskTarget } from './ComposerAttach'
import type { MessageAttachment } from '../../store/threadTimeline'
import {
  activeConversationStore,
  selectActiveConversation
} from '../../store/activeConversationStore'

/** File activation prefers the owner-scoped original, then retrieves and saves on unavailability.
 * Effects are injected because renderer unit tests cannot execute click handlers. */
export interface AttachmentDownloadDeps {
  /** The conversation the thread is showing, or `null` when none is open. */
  getOpenConversationId: () => string | null
  openLocalAttachment: (request: AttachmentRetrievalRequest) => void
  onAttachmentOpenEvent: (listener: (event: AttachmentOpenEvent) => void) => () => void
  /** `window.pyry.requestAttachment` — fire-and-forget; the terminal arrives on the listener below. */
  requestAttachment: (request: AttachmentRetrievalRequest) => void
  /** `window.pyry.onAttachmentRetrievalEvent`; returns the unsubscribe handle this module must call. */
  onAttachmentRetrievalEvent: (listener: (event: AttachmentRetrievalEvent) => void) => () => void
  /** `window.pyry.saveAttachment` — asked only on this activation's own `completed` terminal. */
  saveAttachment: (request: AttachmentSaveRequest) => void
}

/** No path crosses the bridge. Only the main process resolves the original or sanitizes a fallback name. */
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

  let unsubscribe: (() => void) | null = null
  let settled = false
  unsubscribe = deps.onAttachmentOpenEvent(event => {
    if (settled || event.attachmentId !== attachment.attachmentId) return
    settled = true
    unsubscribe?.()
    if (event.type === 'failed' && event.reason === 'unavailable') {
      retrieveAndSave(deps, attachment, conversationId)
    }
  })
  if (settled) unsubscribe()
  deps.openLocalAttachment({ conversationId, attachmentId: attachment.attachmentId })
}

/** Fallback for attachments without a readable original under this upload owner. */
function retrieveAndSave(
  deps: AttachmentDownloadDeps,
  attachment: MessageAttachment,
  conversationId: string
): void {
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
  openLocalAttachment: request => window.pyry.openAttachment({
    attachmentId: request.attachmentId,
    ...attachmentAskTarget(request.conversationId),
    localOnly: true
  }),
  onAttachmentOpenEvent: listener => window.pyry.onAttachmentOpenEvent(listener),
  getOpenConversationId: () => {
    const open = selectActiveConversation(activeConversationStore.getState())
    return open === null ? null : open.id
  },
  requestAttachment: (request) => window.pyry.requestAttachment(request),
  onAttachmentRetrievalEvent: (listener) => window.pyry.onAttachmentRetrievalEvent(listener),
  saveAttachment: (request) => window.pyry.saveAttachment(request)
}
