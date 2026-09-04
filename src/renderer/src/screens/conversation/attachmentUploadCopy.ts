// #863: the composer's copy for one attachment-upload outcome — the whole of the third acceptance
// criterion, in a module with no React and no bridge so it is provable by calling a function.
//
// WHAT MAKES THIS A SELECTION RATHER THAN A RENDERING. Every field on AttachmentUploadEvent is
// client-owned by construction (see the union's own docblock): no member can hold the file's bytes, its
// host path or its name, `reason` is a literal written in this repo, and `limitBytes` is a client-owned
// constant. So there is no daemon text on this path — no escaping obligation, no length bound, and no
// truncation chain of the kind .composer__model-label carries for a claude-authored label. What IS at
// stake is coverage: every terminal the channel can deliver must produce a sentence.

import type {
  AttachmentUploadEvent,
  AttachmentUploadFailure
} from '../../../../shared/ipc/attachmentUpload'

/**
 * One sentence per member of `AttachmentUploadFailure`.
 *
 * `Record<AttachmentUploadFailure, string>` IS THE THIRD CRITERION'S MECHANISM: a member added to the
 * union upstream fails to typecheck here rather than silently rendering blank, so exhaustiveness is the
 * compiler's job and not a thing to remember. That check has already fired once for real — #999's two
 * retrieval codes reached the union through it.
 *
 * NO COUNT IS WRITTEN HERE, and none should be added. The union has grown since this family started, and
 * the shipped docblock now refuses to give a number on the explicit grounds that every one written in
 * prose went stale when it did.
 *
 * Exported for its own tests, which walk `Object.values` to prove no member is blank — the only form of
 * that proof that keeps covering the union as it grows, since a restated member list would still
 * typecheck while quietly missing the new one.
 */
export const ATTACHMENT_UPLOAD_FAILURE_COPY: Record<AttachmentUploadFailure, string> = {
  // This client's own read of the chosen file did not survive. The underlying errno is dropped on the
  // main side (it holds the host path), so there is nothing more specific to say and nothing safe to add.
  unreadable: 'That file could not be read.',

  // — the transport's own three —
  'not-connected': 'Not connected — the file was not sent.',
  'connection-lost': 'The connection dropped before the file finished uploading.',
  'send-failed': 'The file could not be sent.',

  // — the daemon's verdicts on the upload leg. These are the sentences that speak for the HOST, which is
  //   what keeps `refused` free to speak for this app (see attachmentUploadOutcomeCopy). —
  'attachment-invalid-chunk': 'The host rejected part of the upload.',
  'attachment-integrity-failed': 'The host could not verify the uploaded file.',
  'attachment-too-large': 'The host refused the file as too large.',
  'attachment-too-many-uploads': 'The host has too many uploads in progress. Try again shortly.',
  'attachment-storage-failed': 'The host could not store the file.',
  'message-too-long': 'The host refused the upload as too long.',

  // — the retrieval leg's two, and ONE SHARED NON-COMMITTAL SENTENCE for them. The union's docblock rules
  //   that both answer a `request_attachment` and never an `attachment_chunk`, so no upload ends this way
  //   and "no composer copy should be written for them" — while a HOSTILE daemon can put either code on an
  //   `error` frame correlated to a pending chunk, so they must not fall through to blank either. Saying
  //   nothing about WHY is the resolution of those two facts, not a gap between them. If a conforming
  //   daemon ever starts producing one of these for an upload, that is a protocol change and this line is
  //   where the honest sentence gets written. —
  'attachment-not-found': 'The upload did not complete.',
  'attachment-stream-aborted': 'The upload did not complete.',

  unclassified: 'The upload failed for an unknown reason.'
}

/**
 * The runtime lookup, and NOT the object literal above.
 *
 * `reason` arrives off `ipcRenderer.on`, where the declared type is the compile-time half only — nothing
 * validates the value that actually crosses. Against a bare object literal a `reason` of `'constructor'`
 * or `'toString'` reads straight off `Object.prototype` and returns a FUNCTION; `?? fallback` then does
 * not fall through, because a function is not nullish, and React throws "Objects are not valid as a React
 * child" out of the composer's render. A `Map` has no prototype chain to reach, so the miss is a real miss.
 *
 * The two halves are deliberately different fabrics: the `Record` above is a compile-time check, this is a
 * data structure. Neither substitutes for the other — dropping the `Record` loses exhaustiveness, dropping
 * the `Map` loses totality at the boundary. `Object.entries` is prototype-safe, so the derivation itself
 * introduces nothing. Same reasoning as the main side's mime-type table (#862), applied in the read
 * direction rather than the write one.
 */
const FAILURE_COPY_BY_REASON = new Map<string, string>(
  Object.entries(ATTACHMENT_UPLOAD_FAILURE_COPY)
)

/** What a `failed` whose reason is not representable resolves to. Unreachable through the declared type;
 *  reachable through a non-conforming sender, which is the whole reason the `Map` above exists. */
const UNREPRESENTABLE_FAILURE_COPY = ATTACHMENT_UPLOAD_FAILURE_COPY.unclassified

/**
 * How far the transfer has got, as a whole percent (#864).
 *
 * TOTAL AGAINST ANY INPUT, and that is not defensive habit — it is the same argument
 * FAILURE_COPY_BY_REASON's `Map` makes one constant down. These two counts arrive off
 * `ipcRenderer.on`, where the declared type is the compile-time half only and nothing validates the
 * value that actually crosses. Against a bare `(sent / total) * 100` a zero total renders "NaN%" out
 * of the composer, which is a worse answer than any number.
 *
 * `Number.isFinite` AND NEVER THE GLOBAL `isFinite`. The global COERCES its argument, so
 * `isFinite('5')` is `true` and a string count would reach the arithmetic; `Number.isFinite` returns
 * false for every non-number, which is the totality this boundary needs.
 *
 * FLOORED, so the figure only ever understates. 100 means every chunk is on the wire and the host's
 * answer is still outstanding — which is exactly what "how far the transfer has got" measures, and
 * the terminal is what says the file was stored. Capping at 99 to reserve the figure would leave the
 * reading permanently short of the number it counts towards.
 *
 * Exported for its own tests; it has no other caller.
 */
export function uploadProgressPercent(sentChunks: number, totalChunks: number): number {
  if (!Number.isFinite(sentChunks) || !Number.isFinite(totalChunks) || totalChunks <= 0) return 0
  return Math.min(100, Math.max(0, Math.floor((sentChunks / totalChunks) * 100)))
}

/** The acknowledgement a stored file gets. It exists because #815 has not landed: until a file row
 *  appears in the message bubble, this sentence is the ONLY evidence anywhere that an upload stored
 *  anything, and a silent success would be indistinguishable from a cancelled picker. */
const COMPLETED_COPY = 'File attached.'

/**
 * What a paste that found nothing gets (#1032). It NAMES THE CLIPBOARD, which is the whole of the
 * ticket's second criterion in one string: the operator asked for the image on the clipboard and there
 * was none, and saying so is what stops this reading as a failure — nothing was attempted and nothing
 * went wrong.
 *
 * NO FIGURE AND NOTHING FROM THE CLIPBOARD. The sibling refusal states a limit because it has one; this
 * one has none, and it must not describe what the clipboard DID hold — not the flavour, not a length —
 * because the event carries none of that and inventing it would be the leak the union is shaped to
 * prevent. `refused` speaks for this app, which is why this sentence claims nothing about the host.
 */
const NO_IMAGE_COPY = 'No image on the clipboard — nothing was attached.'

/**
 * The sentence for one outcome.
 *
 * An explicit return type and NO `default` on the switch, so a member added to
 * `AttachmentUploadEvent` trips TS2366 here rather than falling through to a blank line — the
 * `relayLeg` / `daemonLeg` discipline, one directory over. That check has fired for real: #864's
 * in-flight `progress` reached this switch through it.
 *
 * NOT EVERY ARM IS A TERMINAL any more. `progress` is in-flight and is stated in the same slot the
 * terminal will occupy, so its sentence has to be distinguishable from all three of them by text
 * alone — the reader has nothing else to go on.
 *
 * NO ARM INTERPOLATES `reason`. `` `Upload failed: ${reason}` `` compiles and renders a client-owned
 * literal, so it is neither an injection nor a length hazard — but it makes the rendered sentence
 * daemon-SELECTED rather than client-authored, which is the property this criterion is about. The tests
 * assert equality with the mapped constant rather than containment, which is what forbids it.
 */
export function attachmentUploadOutcomeCopy(event: AttachmentUploadEvent): string {
  switch (event.type) {
    case 'refused':
      // A SECOND SWITCH, because `refused` is two members (#1032) and only one of them has a limit. It
      // carries no `default` for the outer switch's reason: a third refusal reason leaves this function
      // able to return undefined and trips TS2366 here, rather than falling through to a blank line. That
      // is not a hypothetical — the outer switch caught #864's `progress` this way, and the shape of this
      // member is what caught #1032 at the compiler instead of on screen.
      switch (event.reason) {
        case 'too-large':
          // THE LIMIT IS THIS APP'S, AND THE SENTENCE SAYS SO. `limitBytes` is the client's own bound; the
          // union's docblock is explicit that a file under it can still come back `attachment-too-large`
          // from the daemon. Wording this as the host's limit would state a fact the renderer does not
          // have, and would mislead exactly when someone is working out why an upload failed. The figure
          // is read off the event rather than from a constant here, so this copy cannot drift from the
          // bound the background process actually enforced.
          return `Too large to attach — this app sends files up to ${formatByteLimit(event.limitBytes)}.`
        case 'no-image':
          return NO_IMAGE_COPY
      }
    case 'failed':
      return FAILURE_COPY_BY_REASON.get(event.reason) ?? UNREPRESENTABLE_FAILURE_COPY
    case 'completed':
      return COMPLETED_COPY
    case 'progress':
      // THE FIGURE IS THIS CLIENT'S OWN ARITHMETIC over two counts it computed, which is why it may be
      // interpolated where `reason` may not: the rule one docblock up is about a daemon-SELECTED value
      // reaching the sentence, and `formatByteLimit`'s use in the `refused` arm is the precedent for a
      // computed number in one. The chunk counts themselves are not spelled out — what the composer
      // states is how far, not how the transport happens to be chunked.
      return `Uploading… ${uploadProgressPercent(event.sentChunks, event.totalChunks)}%`
  }
}

/** Decimal units, largest first — the desktop states file sizes this way, and the figure is user-facing. */
const BYTE_UNITS = [
  { suffix: 'MB', scale: 1_000_000 },
  { suffix: 'kB', scale: 1_000 }
]

/**
 * A byte count as a short human figure: at most one decimal, in the largest unit at which the value
 * reaches 1.
 *
 * THE UNIT CHAIN IS THE POINT. A bare `bytes / 1e6` prints "0 MB" for a small bound — a limit nobody can
 * act on and, worse, one that is false. The bound is client-owned and ~23 MB today, but this function must
 * not lie for a value it may be handed later. Exported for its own tests; it has no other caller.
 */
export function formatByteLimit(bytes: number): string {
  for (const unit of BYTE_UNITS) {
    if (bytes >= unit.scale) {
      // Number's own formatting drops the trailing zero, so 23.0 prints as 23 and 1.5 as 1.5.
      return `${Math.round((bytes / unit.scale) * 10) / 10} ${unit.suffix}`
    }
  }
  return `${bytes} bytes`
}
