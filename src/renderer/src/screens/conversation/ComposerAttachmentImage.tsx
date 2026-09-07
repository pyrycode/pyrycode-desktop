import { useEffect, useState } from 'react'
import type { MessageAttachment } from '../../store/threadTimeline'
import { AttachmentFileIcon } from './AttachmentFileIcon'
import { ATTACHMENT_IMAGE_ALT, type AttachmentThumbnailState } from './BubbleAttachmentImage'
import { attachmentImageSources } from './attachmentImageSource'

/**
 * #1263 — a pending image attachment drawn as its own picture in the composer's strip (Figma `Input attachment`
 * `390:7199` in `134-5013`), in place of the file tile #1262 draws for everything.
 *
 * TWO EXPORTS, SPLIT ON PURPOSE — `BubbleAttachmentImage`'s shape one region over, and for its recorded reason:
 * the renderer tier is `renderToStaticMarkup` under `environment: 'node'` with no DOM and no effects, so a path
 * reachable only from a `useEffect` is unprovable there. `ComposerAttachmentTile` is a PURE function of its state
 * and every one of its three drawings is an ordinary static render; the container owns the one `useState` and the
 * one `useEffect`.
 *
 * THE MODULE SINGLETON IS CONSUMED, NEVER RECONSTRUCTED. `attachmentImageSources` shares live URLs by refcount
 * across every view that asks, so a second instance here would mint one URL per mount, revoke none of the others,
 * and — worse than in the bubble's case — could revoke one the bubble's own thumbnails are still showing.
 *
 * ⭐ THE BYTES COME BACK FROM THE HOST, AND THAT IS THE COST THIS SLICE ACCEPTS RATHER THAN AN OVERSIGHT. The
 * upload leg streams the picked file and retains no local copy, and the app-private attachment directory has ONE
 * writer — the retrieval leg (`attachment-bytes.md`). So the picture the operator has just attached is fetched
 * back before an `<img>` can point at it: one round trip per image tile. Making the upload leg a second writer is
 * what that costs to avoid. If it proves slow in daily use, retaining the picked file locally is its own ticket.
 */

/**
 * The drawing for one pending image attachment, as a pure function of what is known about its bytes.
 *
 * ⭐ THE STATE UNION IS `AttachmentThumbnailState`, REUSED RATHER THAN RE-DECLARED. It is the same closed set for
 * the same reason — bytes absent, bytes here, ask ended without a drawable picture — and its own docblock's
 * argument carries verbatim: `failed` CARRIES NO REASON, so there is no reason in scope for a later edit to
 * interpolate. That matters more here than there, because this tile's failure arm is a file icon with no text
 * node of its own: the criterion is structural rather than careful. Same state, two DRAWINGS, and the two
 * deliberate departures from the bubble's are both in this switch.
 */
export function ComposerAttachmentTile({
  state,
  filename,
  onDecodeError
}: {
  state: AttachmentThumbnailState
  filename: string
  /** The `<img>` could not decode the bytes — the name lied. A PROP rather than a field on the `ready` state, so
   *  the union stays a plain description of what is drawn (`AttachmentThumbnail`'s ruling). Required rather than
   *  optional: the container always supplies one, and an optional handler would be dead surface only the static
   *  tier — which drops handlers anyway — ever omits. */
  onDecodeError: () => void
}): JSX.Element {
  switch (state.type) {
    case 'pending':
      // ⭐ THE FRAME IS DRAWN AND EMPTY, and this is the FIRST departure from `AttachmentThumbnail`, whose own
      // `pending` arm draws nothing at all. That arm reserves nothing because reserving a box would need the
      // picture's aspect ratio, which needs the bytes; here the box is a fixed 45x60 whatever the picture turns
      // out to be, so there IS an honest box and drawing it is what makes the strip's tile count and every
      // tile's position constant as bytes arrive. No spinner and no placeholder fill: the design draws no
      // loading state for the slot and this slice invents none.
      return <span className="composer__attachment" />
    case 'ready':
      // THE URL REACHES EXACTLY ONE PLACE. It is a capability handle to the file's bytes within this origin
      // (`attachmentImageSource.ts`), so it belongs in an `<img>` `src` and in no log line, no second attribute,
      // no cache key and no lookup path.
      //
      // ⭐ NO <button> AND NO CONTROL OF ANY KIND — the SECOND departure. #869 wrapped the bubble's picture in a
      // real button so the reader could open it; clicking a composer tile to open the file is not planned, and
      // #1264's remove control is the one control this tile will ever get. So: no tab stop, no handler, no
      // accessible control. No `width`/`height` attribute either — the box is `.composer__attachment`'s, and an
      // intrinsic-size attribute here would fight it.
      //
      // THE ACCESSIBLE NAME IS A CLIENT-OWNED CONSTANT, shared with the bubble rather than restated. `alt` IS an
      // attribute, and `filename` is untrusted text — the sink #815 closed on purpose when it declined an
      // `aria-label`. The constant says what the element IS, because nothing on this side knows what it depicts.
      //
      // `onError` is the decode failure, and it cannot loop: moving off `ready` unmounts the very <img> that
      // raised it.
      return (
        <span className="composer__attachment">
          <img
            className="composer__attachment-image"
            src={state.url}
            alt={ATTACHMENT_IMAGE_ALT}
            onError={onDecodeError}
          />
        </span>
      )
    case 'failed':
      // ONE DRAWING FOR EVERY WAY AN ASK CAN END WITHOUT A PICTURE — a retrieval that failed, bytes that could
      // not be read, and bytes that arrived and did not decode. NEVER a broken-image icon: the element that
      // would draw one is unmounted by the very transition that reaches this state.
      //
      // ⭐ THE FILE TILE IS CALLED DIRECTLY, NOT NESTED INSIDE A SECOND FRAME. `AttachmentFileIcon` renders the
      // frame itself, in the class it is handed — so the image tile and the file tile are alternative drawings
      // of the SAME `.composer__attachment` box, which is what keeps this arm the same size and position as the
      // other two. A second file icon is not drawn and a tile is not nested in a tile.
      //
      // No reason is carried in, and none could be: this drawing has no text node but the derived extension
      // label. The host's `not-found` is its single code for every request yielding no bytes, made
      // indistinguishable on purpose so the verb cannot become a path-existence oracle, and collapsing every
      // failure to one drawn state keeps that true from this side.
      return (
        <AttachmentFileIcon
          filename={filename}
          frameClassName="composer__attachment"
          glyphClassName="composer__attachment-glyph"
          labelClassName="composer__attachment-ext"
        />
      )
  }
}

export function ComposerAttachmentImage({
  attachment
}: {
  attachment: MessageAttachment
}): JSX.Element {
  const [state, setState] = useState<AttachmentThumbnailState>({ type: 'pending' })

  useEffect(() => {
    // ⭐ THE RELEASE HANDLE IS THE CLEANUP, RETURNED DIRECTLY. The contract hands it back on EVERY branch before
    // any terminal, so it is callable unconditionally without knowing which branch the ask took. Releasing is
    // LOAD-BEARING, not hygiene: URLs are refcounted and the last release is what revokes, so a tile that never
    // released would hold the file's bytes for the window's lifetime.
    //
    // ⭐ THE STRIP IS DRAINED ON SEND AND RESTORED ON A SEND THAT THREW (`mirrorTakeToDisplay`), which is a
    // lifecycle the bubble's thumbnails never face. The drain unmounts every tile, the last release revokes; a
    // rollback remounts them and each re-fetches from scratch, so a rolled-back send costs a second round trip
    // and the tile blinks back to its empty frame. That is correct rather than merely tolerable — no leak, no
    // stale URL, no double revoke — because `release` is idempotent and the map entry is recorded BEFORE
    // `onOutcome` runs, so a synchronous release from inside the callback is still counted.
    //
    // Under `React.StrictMode` this runs request → release → request. The second ask finds the retrieval already
    // in flight main-side and is a no-op, and the second mount still settles: main answers on a channel
    // broadcast every listener receives and filters by attachment id, not a per-request reply.
    return attachmentImageSources.request(attachment.attachmentId, (outcome) => {
      if (outcome.type === 'ready') {
        setState({ type: 'ready', url: outcome.url })
        return
      }
      // The reason is DROPPED rather than carried into state. Nothing about it may reach the operator, so the
      // one place it could is the one place it does not go. Not logged either: `attachmentImageSource.ts`
      // already records each terminal at its own boundary, and a second line here would duplicate the record
      // without adding a fact.
      setState({ type: 'failed' })
    })
    // Depending on the id rather than on the record keeps this correct if a reducer ever re-creates the object.
  }, [attachment.attachmentId])

  return (
    <ComposerAttachmentTile
      state={state}
      filename={attachment.filename}
      onDecodeError={() => setState({ type: 'failed' })}
    />
  )
}
