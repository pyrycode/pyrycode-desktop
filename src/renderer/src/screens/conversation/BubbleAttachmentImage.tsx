import { useEffect, useState } from 'react'
import type { MessageAttachment } from '../../store/threadTimeline'
import { attachmentImageSources } from './attachmentImageSource'

/**
 * #1045 — an image attachment drawn as a picture inside the message bubble (Figma `Slot`
 * `I132:4567;132:4465` in `120-3848`), in place of #815's file row.
 *
 * TWO EXPORTS, SPLIT ON PURPOSE. `AttachmentThumbnail` is a PURE function of its state — no hooks, no
 * seams — and `BubbleAttachmentImage` owns the one `useState` and the one `useEffect` and renders it. The
 * renderer test tier is `renderToStaticMarkup` under `environment: 'node'` with no DOM and no effects, so
 * a path reachable only from a `useEffect` is unprovable there (#1044's own tests record this). Split, all
 * three drawn states are ordinary static renders; unsplit, two of the three would be reachable only from
 * the browser tier. The container's own arm — draws nothing, because the fetch has not started — is what
 * that tier CAN see, and it is asserted.
 *
 * THE MODULE SINGLETON IS CONSUMED, NEVER RECONSTRUCTED. `attachmentImageSources` is built once for the
 * app lifetime and its live-URL map is only meaningful across asks: a per-consumer instance would mint one
 * URL per mount, revoke none of the others, and disable the sharing silently. Its own header says so.
 *
 * NO RENDERER-SIDE QUEUE, AND NO MAIN-SIDE CAP IS TOUCHED. Both legs cap at 4 concurrent, so a thread with
 * five images in view meets `busy` — which arrives here as an ordinary terminal and draws the fallback.
 * #1044 declined both as machinery for an unobserved failure mode; if this proves routine in use, raising
 * a cap is its own ticket.
 */

/**
 * What is drawn, as a closed set. ⭐ `failed` CARRIES NO REASON, and that absence is the design rather
 * than an omission. AC5 forbids a per-reason message, and the host's `not-found` is its ONE code for every
 * request that yields no bytes — made deliberately indistinguishable so two answers cannot turn the verb
 * into a path-existence oracle, which a per-code message would undo from this side. Collapsing the reason
 * at this boundary means there is no reason IN SCOPE for a later edit to interpolate, so the criterion is
 * structural instead of careful.
 */
export type AttachmentThumbnailState =
  | { type: 'pending' }
  | { type: 'ready'; url: string }
  | { type: 'failed' }

/**
 * ⭐ A CLIENT-OWNED CONSTANT, and the whole reason the accessible name is one. An `<img>` needs an
 * accessible name and `alt` IS an attribute — the sink #815's row closed on purpose when it declined an
 * `aria-label`, because `filename` is untrusted, operator- or model-chosen text. A constant satisfies the
 * requirement without reopening that ruling. It says what the element IS, not what it depicts, because
 * nothing on this side knows what it depicts.
 */
export const ATTACHMENT_IMAGE_ALT = 'Attached image'

/** The one sentence every non-drawable ask produces. Client-owned, and deliberately says no more than
 *  "no picture" — see `AttachmentThumbnailState` for why it may not say more. */
export const ATTACHMENT_IMAGE_UNAVAILABLE = 'Image could not be shown'

export function AttachmentThumbnail({
  state,
  filename,
  onDecodeError
}: {
  state: AttachmentThumbnailState
  filename: string
  /** AC5's second half — the `<img>` could not decode the bytes. A PROP rather than a field on the
   *  `ready` state, so the state union stays a plain description of what is drawn and the argument above
   *  ("no reason is in scope to interpolate") is about a type with no behaviour smuggled into it.
   *  Required rather than optional: the container always supplies one, and an optional handler would be
   *  dead surface that only the static tier — which drops handlers anyway — ever omits. */
  onDecodeError: () => void
}): JSX.Element | null {
  switch (state.type) {
    case 'pending':
      // ⭐ NOTHING DRAWN AND NOTHING RESERVED. No spinner, no placeholder box: reserving space needs the
      // image's aspect ratio, which needs the bytes, which is the thing being fetched — so there is no
      // honest box to reserve. That a late-arriving thumbnail therefore moves the reader's scroll position
      // is a real follow-up ticket, blocked on this one, rather than a defect to paper over with a guessed
      // box that would be wrong for every image whose ratio is not the guess.
      return null
    case 'ready':
      // THE URL REACHES EXACTLY ONE PLACE. It is a capability handle to the file's bytes within this
      // origin (#1044's header), so it belongs in an `<img>` `src` and in no log line, no second
      // attribute, no cache key and no lookup path. No `width`/`height` attribute either: the box is
      // .bubble__image's two max-* declarations, and an intrinsic-size attribute here would fight them.
      //
      // `onError` IS AC5's SECOND HALF — bytes that arrive and do not decode because the name lied. It
      // cannot loop: moving off `ready` unmounts the very <img> that raised it.
      return (
        <img
          className="bubble__image"
          src={state.url}
          alt={ATTACHMENT_IMAGE_ALT}
          onError={onDecodeError}
        />
      )
    case 'failed':
      // THE NAME IS UNTRUSTED DISPLAY TEXT AND REACHES THE DOM AS AUTO-ESCAPED REACT CHILDREN ONLY —
      // never an attribute, a title, an alt, a URL or dangerouslySetInnerHTML. #815's row's posture,
      // carried unchanged to the one state here that draws it.
      //
      // The name is INCLUDED rather than omitted because a reader who sent several pictures needs to know
      // which one is missing, and AC5 anticipates exactly this by bounding how it may reach the DOM
      // rather than by forbidding it.
      return (
        <p className="bubble__image-fallback">
          {ATTACHMENT_IMAGE_UNAVAILABLE}
          <span className="bubble__image-fallback-name">{filename}</span>
        </p>
      )
  }
}

export function BubbleAttachmentImage({
  attachment
}: {
  attachment: MessageAttachment
}): JSX.Element | null {
  const [state, setState] = useState<AttachmentThumbnailState>({ type: 'pending' })

  useEffect(() => {
    // ⭐ THE RELEASE HANDLE IS THE CLEANUP, RETURNED DIRECTLY. #1044's contract hands it back on EVERY
    // branch before any terminal, so it is callable unconditionally without knowing which branch the ask
    // took — which is what licenses this one-liner. Releasing on unmount is LOAD-BEARING, not hygiene: URLs
    // are refcounted and the last release is what revokes, so a consumer that never released would leak
    // the file's bytes for the window's lifetime.
    //
    // A SYNCHRONOUS OUTCOME IS EXPECTED, not defended against: when the URL is already live `onOutcome`
    // runs inside this call, and setting state from an effect body is legal. #1044's `takeShare` records
    // the map entry BEFORE running the callback precisely so a release from inside it is still counted.
    //
    // Under React's development double-invoke (`React.StrictMode` in main.tsx) this runs
    // request → release → request. The second ask finds the retrieval already `inFlight` main-side and is
    // a total no-op, and the second mount STILL settles: main answers on
    // ATTACHMENT_RETRIEVAL_EVENT_CHANNEL with `sender.send`, a channel broadcast every listener receives
    // and filters by attachment id, not a per-request reply.
    return attachmentImageSources.request(attachment.attachmentId, (outcome) => {
      if (outcome.type === 'ready') {
        setState({ type: 'ready', url: outcome.url })
        return
      }
      // The reason is DROPPED here rather than carried into state. It is safe by type — every inhabitant
      // of AttachmentImageSourceFailure is a literal written in this repo — but nothing about it may reach
      // the reader, so the one place it could is the one place it does not go. Not logged either:
      // attachmentImageSource.ts already logs each terminal at its own boundary, and a second line here
      // would duplicate the record without adding a fact.
      setState({ type: 'failed' })
    })
    // The record is frozen at send, so this never changes for a given mount today. Depending on the id
    // rather than on the object keeps that true if a reducer ever re-creates the record.
  }, [attachment.attachmentId])

  return (
    <AttachmentThumbnail
      state={state}
      filename={attachment.filename}
      onDecodeError={() => setState({ type: 'failed' })}
    />
  )
}
