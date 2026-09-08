import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { AttachmentUploadEvent } from '../../../../shared/ipc/attachmentUpload'
import type { MessageAttachment } from '../../store/threadTimeline'
import { AttachmentFileIcon } from './AttachmentFileIcon'
import { ComposerAttachmentImage } from './ComposerAttachmentImage'
import { isImageAttachmentName } from './attachmentIsImage'
import { attachmentUploadOutcomeCopy } from './attachmentUploadCopy'
// #1055: the take's shape is declared with its CONSUMER (composerSend's `takeAttachments` dep), so the
// pure send helper never names this React module. See PendingAttachmentTake's own docblock.
import type { PendingAttachmentTake } from './composerSend'

// #863: the attach affordance — the renderer half of the flow #862 shipped headless. Two pure views and
// one thin container hook, the LogDataSection split: the views are props-in/markup-out and server-render
// with no bridge, and everything that touches `window.pyry` lives in the hook, inside an effect or inside
// a click closure — never in a render path.
//
// The two halves mount in DIFFERENT PLACES, which is why this file exports views rather than one
// component: the button is the footer row's last child, and the outcome is the composer column's, one row
// below. The footer holds a hard `height: 20px`, so a sentence inside it would overflow rather than grow
// it; and four shipped e2e specs assert `.composer__footer [role="alert"]` has count 0, which a live
// region in that row invites a collision with. The status row's trailing slot is not available either —
// ComposerErrorSlotControl owns it and `.composer-status` is min-height sized BY that occupant, so a third
// thing there means settling precedence between two error surfaces and can move the composer.

/** The button's accessible name. Client-owned and exported so the e2e spec locates the control by role and
 *  name rather than by class — the sibling footer specs' discipline. */
export const COMPOSER_ATTACH_LABEL = 'Attach file'

// ================================================================================================
// #890 — the DROP entry. A second way into #862's flow, not a second flow: everything from the size
// guard on is already built and is called rather than copied. What follows is only the decision of
// whether a drag is ours, whether the composer wears the edge, and which file (if any) goes over.
//
// The four functions below are PURE and framework-free — the composerSend.ts / dropQueuedMessage.ts
// idiom — so the static tier can walk every branch of a gesture no test in this repo can perform.
// `useComposerFileDrop` at the bottom is the thin container over them, and the ONLY part that touches
// React or the DOM.
// ================================================================================================

/** The modifier `.composer` wears while a file is held over it. Exported so the e2e spec locates the
 *  state by the production constant rather than by a literal it could drift from. */
export const COMPOSER_DROP_ACTIVE_CLASS = 'composer--drop-target'

/**
 * The composer block's `class` attribute, as one whole run.
 *
 * ⭐ THE RESTING BRANCH RETURNS THE BARE LITERAL, and that is load-bearing rather than tidiness: three
 * shipped assertions in composerSlot.test.tsx match `class="composer"` as a WHOLE ATTRIBUTE RUN, two of
 * them as `class="composer" hidden=""`. A template literal with an empty tail, an array `join`, or a
 * modifier written ahead of the block would each redden them — which is why this is a branch and not an
 * interpolation, and why the active branch appends rather than prepends.
 */
export function composerClassName(active: boolean): string {
  return active ? `composer ${COMPOSER_DROP_ACTIVE_CLASS}` : 'composer'
}

/**
 * Whether a drag is carrying files, read off `DataTransfer.types` — the one list a browser exposes
 * during `dragover`, when the files themselves are deliberately unreadable.
 *
 * THIS IS THE WHOLE OF "INTERCEPTION IS SCOPED TO FILE DRAGS". Everything downstream — the edge, the
 * preventDefault that stops a navigation, the attach itself — is gated on it, so a drag carrying text,
 * a URL or an image dragged out of a web page is not intercepted at all and keeps doing exactly what it
 * does today, including text dropped into the textarea.
 *
 * `text/uri-list` is NOT treated as ours, deliberately. A `file:///…` URL dragged onto the page would
 * otherwise navigate, and the answer to that is `will-navigate` in the background process, which
 * already refuses every target but the app's own document. Widening here would swallow ordinary link
 * drags into the message box to close a hole that is already closed a layer down.
 *
 * `undefined` is accepted and answers false: `event.dataTransfer` is nullable on the DOM type, and a
 * drag with no transfer at all is not one this composer wants.
 */
export function dragCarriesFiles(types: readonly string[] | undefined): boolean {
  return types !== undefined && types.includes('Files')
}

// ================================================================================================
// #1033 — the PASTE entry, and the third way into #862's flow. Like the drop before it, everything
// from the size guard on is already built and is called rather than copied; unlike the drop, even the
// bridge member and the background-process reader are already built (#1032). What is left is exactly
// the decision below and the handler that acts on it.
// ================================================================================================

/**
 * Whether a paste is an attach or ordinary text, read off `ClipboardEvent.clipboardData.types` — the
 * advertised flavour list, and the ONLY thing this feature reads about the clipboard in the window.
 *
 * ⭐ THE WINDOW NEVER HOLDS A BYTE, and that is what this signature is for rather than a `DataTransfer`.
 * A paste event can expose the image as a `File`, and reading those bytes here to ship them over IPC is
 * the one cut this slice must not make (CLAUDE.md "keep the transport out of the window"). `getAsFile`,
 * `getAsString` and `.files` are therefore never touched anywhere in this file: `pasteAttachmentImage()`
 * is content-free and #1032's background-process path reads the operator's clipboard itself.
 *
 * ⭐ THE IMAGE TEST IS A DISJUNCTION BECAUSE A BITMAP HAS TWO SPELLINGS, AND THE LOAD-BEARING ARM IS
 * THE ONE THAT LOOKS REDUNDANT. Chromium normalises the OS clipboard before a page sees it, and it is
 * not self-evident which spelling a bitmap arrives under. MEASURED against a real trusted paste of a
 * real seeded bitmap (e2e/composer-paste-image.spec.ts drives it with `webContents.paste()`): the list
 * is exactly `['Files']` — the file-item spelling, with NO `image/png` entry at all. So an `image/*`
 * test on its own would have matched nothing and a screenshot paste would have silently done nothing,
 * which is the failure an operator cannot diagnose. `image/*` is kept for the page-image spelling a
 * copied web-page image can produce, and the e2e asserts this function's own answer for the list a real
 * paste carried, so the breadth stays evidence rather than defensiveness.
 *
 * What the 'Files' arm additionally admits is a FILE copied in Finder or Explorer, which the ticket puts
 * out of scope. Accepted rather than overlooked: main reads the clipboard, finds no bitmap, and reports
 * `no-image` — an honest refusal sentence instead of silence, and no path, name or byte is involved on
 * either side. The prefix test is `startsWith`, not `includes`, so a flavour merely NAMED after an image
 * cannot smuggle itself in.
 *
 * ⭐ THE text/plain CONJUNCT, AND THE LAYER IT IS NOT. Only a clipboard advertising an image and NO
 * plain text takes the attach branch, so a password-manager secret can never take it — but this
 * predicate is the ERGONOMIC half of that rule, not its enforcement. `contextBridge` exposes
 * `pasteAttachmentImage()` to the whole renderer, so a compromised window calls it directly and never
 * runs this function at all. The bound that actually holds is main's: `clipboard.readImage()` returns a
 * bitmap or nothing, so a text-flavoured secret yields an empty image and a refusal whatever the window
 * claims. Do not delete main's check on the strength of this one, and do not "harden" this one — the
 * residual is #1032's, deliberately left open (see this ticket's plan, § Security review).
 *
 * `undefined` is accepted and answers false, `dragCarriesFiles`'s reason exactly: `event.clipboardData`
 * is nullable on the DOM type, and a paste with no transfer at all is not one this composer wants.
 */
export function pasteCarriesImageOnly(types: readonly string[] | undefined): boolean {
  if (types === undefined) return false
  if (types.includes('text/plain')) return false
  return types.some((type) => type === 'Files' || type.startsWith('image/'))
}

/** What moves the drag-over depth. Sealed on `type`, the repo's convention for an event set: `enter`
 *  and `leave` are the DOM pair, `settled` is a drop or the drag ending. */
export type FileDropEvent = { type: 'enter' } | { type: 'leave' } | { type: 'settled' }

/**
 * The drag-over state, as a DEPTH COUNTER rather than a boolean — which is the whole of "it survives the
 * pointer crossing a child element rather than flickering", and the classic bug here.
 *
 * `dragover` fires continuously and every child element fires its own `dragenter`/`dragleave` pair, both
 * of which bubble to the composer's handler. A boolean flipped on `dragleave` would therefore clear the
 * state the instant the pointer moved from the composer onto the textarea, and the edge would strobe as
 * the operator crossed the box, the footer row and each of its five controls.
 *
 * `leave` FLOORS AT ZERO rather than going negative: a stray leave is what a missed enter produces (a
 * drag that began over a child, or one whose enter was lost to a re-render), and an unfloored counter
 * would sit below zero and never light the composer up again.
 *
 * `settled` RESETS OUTRIGHT rather than decrementing, because a drop fires no matching `dragleave` at
 * all — from a depth of three the decrement would leave the edge painted with no drag in progress.
 */
export function reduceFileDropDepth(depth: number, event: FileDropEvent): number {
  switch (event.type) {
    case 'enter':
      return depth + 1
    case 'leave':
      return Math.max(0, depth - 1)
    case 'settled':
      return 0
  }
}

/**
 * Which file a drop attaches: the one file, or nothing.
 *
 * GENERIC OVER THE ELEMENT so the static tier needs no `File` — what is being decided is the COUNT, and
 * nothing about the file is read to decide it. A drop of more than one file attaches nothing AND SAYS
 * NOTHING in this slice: a refusal would mean a new reason in the shared union plus a branch in
 * `attachmentUploadCopy`'s compiler-forced switch, which is copy for a feature that does not exist yet.
 * The follow-up ticket owns multi-file support and its messaging together; the daemon's concurrency
 * bound (`attachment.too_many_uploads`, #861) is why a naive loop is the wrong first cut.
 */
export function fileToAttach<T>(files: readonly T[]): T | null {
  return files.length === 1 ? files[0] : null
}

/** Figma node 115:3655, the single vector inside the `Attachment` frame (115:3654). The export's clip-path
 *  is dropped: its rect is the full viewBox, so it clips nothing. */
const ATTACHMENT_PATH =
  'M5.09007 0.921312C6.37531 -0.307104 8.46097 -0.307104 9.74621 0.921312C11.0314 2.14973 11.0314 4.14317 9.74621 5.37158L5.99569 8.95628C5.20899 9.7082 3.93519 9.7082 3.14849 8.95628C2.3618 8.20437 2.3618 6.98689 3.14849 6.23497L6.64288 2.89945C6.92874 2.62623 7.39298 2.62623 7.67885 2.89945C7.96471 3.17268 7.96471 3.61639 7.67885 3.88962L4.18446 7.22732C3.96949 7.43279 3.96949 7.76503 4.18446 7.96831C4.39943 8.17159 4.74704 8.17377 4.95972 7.96831L8.71024 4.38361C9.42375 3.70164 9.42375 2.59344 8.71024 1.91148C7.99673 1.22951 6.83727 1.22951 6.12375 1.91148L2.37323 5.49618C1.15889 6.65683 1.15889 8.5388 2.37323 9.69945C3.58758 10.8601 5.5566 10.8601 6.77095 9.69945L9.74849 6.85574C10.0344 6.58251 10.4986 6.58251 10.7845 6.85574C11.0703 7.12896 11.0703 7.57268 10.7845 7.8459L7.80691 10.6874C6.02084 12.3945 3.12562 12.3945 1.33955 10.6874C-0.446518 8.98033 -0.446518 6.21311 1.33955 4.50601L5.09007 0.921312Z'

/**
 * The attach trigger (Figma 115:3654), the footer row's LAST item — right-aligned past the four menus and
 * the context reading by `margin-left: auto`, which the row's comment has reserved for this control since
 * #811. A sibling of the design's `Info and buttons` group rather than a member of it, which is what makes
 * it right-aligned instead of the next item in that group's 20px rhythm.
 *
 * IT WEARS THE SHARED `.composer__footer-button` TREATMENT as a two-class mix, the idiom every other footer
 * control already wears. The evaluation the ticket asked for: the block's reset (padding, border and
 * background off), its flex centring and its `color: var(--color-primary)` are exactly what an icon-only
 * button needs; its type block and its `gap` are inert for a button with no label, which is harmless and
 * consistent with the rule's own note that it is named for the ROW rather than for a consumer. Declaring a
 * private rule instead would duplicate a six-declaration reset to avoid five inert ones. No shipped element
 * is re-classed.
 *
 * NO DISABLED AND NO IN-FLIGHT VARIANT. The composition root's `pickerOpen` flag already drops a second
 * intent while a picker is open, so a double click is handled below the bridge; a state drawn here would
 * pre-empt #864 and be exactly the placeholder #811 forbade. The trigger stays operable while
 * disconnected, on ComposerActionsMenu's reasoning — a `not-connected` attempt reports itself through the
 * outcome line below, which is more use than an unexplained dead control.
 *
 * The accessible name is an `aria-label`, which is the OPPOSITE call from ComposerErrorChip's hidden text
 * and correct for the opposite reason: <button> is not on ARIA's name-prohibited list, while a bare
 * <div>/<span> maps to role="generic" and has its name dropped. `.composer__send` names its two icon-only
 * variants exactly this way.
 */
export function ComposerAttachButton({ onAttach }: { onAttach: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="composer__footer-button composer__attach"
      aria-label={COMPOSER_ATTACH_LABEL}
      onClick={onAttach}
    >
      {/* The glyph's size comes from the svg's own width/height attributes (the .composer__send-icon
          idiom), and its colour from `currentColor` inheriting --color-primary off the shared button
          class — the export's #9DCBFC is byte-identical to that token, so the name is what ships and the
          hex appears nowhere.

          THE VIEWBOX IS THE NODE'S OWN FRACTIONAL BOX and the rendered size is the rounded one: the frame
          measures 10.9989 x 11.9678, which is what the path's coordinates are drawn in, so the viewBox
          keeps the drawing's own space and width/height state the CSS pixels the row can actually paint.
          The implied scale is 1.0001 x 1.0027 — sub-pixel, and the honest translation of a fractional
          design node into an integer box.

          NO GLYPH RULE OF ITS OWN, unlike the four menu chevrons. Theirs each declare `flex: 0 0 auto`
          because a label sits beside them and the pair can be over-constrained when the row shrinks; this
          button's only child is the glyph and the button itself is `flex: 0 0 auto`, so there is nothing
          to squeeze it. Declining it also keeps the standing four-rule glyph tidy-up (see
          .composer__actions-icon's note) from growing to five. */}
      <svg
        viewBox="0 0 10.9989 11.9678"
        width="11"
        height="12"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={ATTACHMENT_PATH} />
      </svg>
    </button>
  )
}

/**
 * The latest event to arrive, stated beneath the footer row: an in-flight figure while a large upload
 * is moving (#864), and the terminal sentence after it.
 *
 * `null` renders NOTHING AT ALL — not an empty element holding the slot — which is the fifth criterion's
 * second half and ContextUsageReading's absent arm restated. The composer column's gap is a flex `gap`, so
 * an absent child costs no space at all.
 *
 * ONE SLOT, NEVER TWO. The two states are branches of one render over one nullable, so "no second
 * indicator appears beside the outcome" holds by construction rather than by arbitration — there is no
 * moment at which both could be mounted, and nothing has to decide which wins.
 *
 * ⭐ THE TWO `key`s ARE LOAD-BEARING, not decoration, and they are the whole of not regressing #863's
 * live-region decision. React reconciles by element type and position, so without them the in-flight
 * <div> and the terminal <div> are the SAME DOM node: the terminal transition would ADD role="status"
 * to an existing element while changing its text, which is the case assistive technology handles least
 * reliably. Distinct keys make the terminal a fresh insertion carrying its content — byte-for-byte the
 * behaviour #863 shipped and reasoned about. renderToStaticMarkup drops keys, so no static test can
 * see this and only this comment records why they are here.
 *
 * THE IN-FLIGHT LINE IS NOT A LIVE REGION, which is the deliberate departure from the terminal below
 * it. An outcome fires at most once per attach; progress fires per chunk, up to
 * ATTACHMENT_MAX_UPLOAD_CHUNKS times for one file, and a polite region announcing each one is worse
 * than the silence this feature replaces. Of the three ways out — a separate non-live element, a
 * coarser cadence, or a role that differs while in flight — this takes the first, so the figure is
 * readable by browsing and announced by nothing.
 *
 * SEPARATE CLASSES RATHER THAN A SHARED TREATMENT WORN AS A MIX. Every shipped assertion on this
 * element matches `class="composer__attach-outcome"` as a whole attribute run, and prepending or
 * appending a class to that run is the change that reddens several of them while another passes
 * vacuously. conversation.css adds the in-flight class to the existing rule's selector list instead:
 * one declaration block, no duplicated treatment, no shipped element re-classed.
 *
 * THE TERMINAL IS A LIVE REGION, departing from both of its neighbours, and the departure is the point.
 * ComposerErrorChip and ContextUsageReading each decline one with a stated reason — the #279 banner
 * already announces the same fact, and a per-turn cadence would announce a percentage after every turn.
 * Neither reason holds here: this sentence is the only evidence anywhere that an attach went WRONG (#1262
 * narrowed that from "produced anything" — a completion draws a tile instead and is silent here), it
 * appears asynchronously after an operator gesture, and it fires at most once per attach, which is if
 * anything a stronger case for announcing than the one #863 made. `role="status"` is polite (announced
 * without stealing focus) —
 * LogDataSection's idiom for an operator-initiated outcome — and deliberately not `role="alert"`, which is
 * assertive, would collide with permission-modal-answer-paths.spec.ts's bare getByRole('alert'), and would
 * announce a success as an emergency.
 *
 * A <div>, not a <p>: this repo ships no margin reset and this is a flex item in the composer column, so a
 * <p>'s UA margin would move the message box for no semantic gain. ComposerErrorChip's ruling verbatim.
 *
 * The sentence is SELECTED, never composed — see attachmentUploadCopy, where the reasoning and the
 * compiler-forced exhaustiveness live. Nothing about the event reaches the DOM except that sentence: not
 * the uploadId, not the discriminator, not the reason literal.
 *
 * ⭐ #1262 CUT THE COMPLETION'S SENTENCE, and the cut is a second `null` arm rather than an empty element:
 * the outcome element's attribute run stays untouched and the role="status" region simply does not mount
 * for a completion. A completed upload draws a TILE in the strip above the message box now, so a line here
 * would state the same fact twice — Juhana's ruling of 2026-09-05, that the tile is the report. The two
 * halves landed together because either alone is wrong: no strip and no sentence leaves a completion with
 * no feedback at all, and both report it twice.
 *
 * WHAT THAT COSTS, STATED: a completion no longer announces to assistive technology. `refused`, `failed`
 * and the in-flight figure are unchanged, and if a completion should announce later, that is a
 * client-owned constant in a live region on the strip — never the filename — and not this ticket.
 */
export function ComposerAttachOutcome({
  outcome
}: {
  outcome: AttachmentUploadEvent | null
}): JSX.Element | null {
  if (outcome === null) return null
  if (outcome.type === 'completed') return null
  if (outcome.type === 'progress') {
    return (
      <div key="in-flight" className="composer__attach-progress">
        {attachmentUploadOutcomeCopy(outcome)}
      </div>
    )
  }
  return (
    <div key="terminal" className="composer__attach-outcome" role="status">
      {attachmentUploadOutcomeCopy(outcome)}
    </div>
  )
}

/**
 * #1264 — one stable reconciliation key per position: the attachment's id, qualified by WHICH OCCURRENCE of
 * that id this entry is. `[X, Y, X]` keys as `X#0`, `Y#0`, `X#1`.
 *
 * ⭐ WHY THE ARRAY INDEX STOPPED WORKING, precisely. #1262 keyed by index on the recorded ground that the
 * pending list only appends and is cleared wholesale; this ticket makes it removable from the MIDDLE, and
 * index keys reconcile `[A, B] → [B]` as "key 0 reused with new props, key 1 deleted". The tile behind key 0
 * is `ComposerAttachmentImage`, which owns a `useState` and an effect keyed on the attachment id — so the
 * REUSED fiber keeps A's state (`{ ready, url: A's picture }`) while its props now name B. React runs every
 * passive destroy before every create, so B's own fiber releases B's URL before the reused one asks for it
 * again: the refcount hits zero, `attachmentImageSource` revokes, and the survivor takes the COLD path back
 * to the host. For that whole round trip the operator watches the tile they just removed keep its picture on
 * the tile that survived. Nothing in this repo reddens on it — renderer specs are static renders with no
 * effects, and a strip of non-image tiles cannot reach the stateful component at all.
 *
 * ⭐ A BARE `attachmentId` WOULD NOT DO, which is why this qualifies it. Two completions can carry one id
 * (the same file attached twice) and AC2 requires those tiles to remove independently, so the id alone is
 * not unique and duplicate React keys are undefined behaviour. Qualifying by occurrence makes the key
 * injective — the decimal occurrence contains no `#`, so the last `#` splits a key back into exactly one
 * (id, occurrence) pair — and gives the property that actually matters: two entries share a key only if they
 * share an id, so a fiber is only ever reused between tiles drawing the SAME attachment, where its state and
 * its held URL are already correct and its effect dep does not change.
 *
 * A CLIENT-MINTED SEQUENCE NUMBER was the alternative and is not taken: it would have to be carried on the
 * record, which means a new element type threaded through `reducePendingAttachments`, `drainPendingAttachments`,
 * `PendingAttachmentTake` and `submitMessage`'s `attachment_ids` map — a wide change to hold a number this
 * function derives from the set it already has.
 *
 * THE ID IN A KEY IS NOT THE ID IN THE MARKUP. #1262 kept `attachmentId` out of the render path to keep it
 * out of the DOM; a React key is consumed by the reconciler and emitted nowhere (`renderToStaticMarkup` drops
 * keys outright), so the strip's markup is byte-identical and the shipped assertion that no part of the record
 * reaches the DOM still holds. The `Map` below is keyed by that untrusted string safely — a `Map` has no
 * prototype chain to walk.
 */
export function pendingAttachmentKeys(pending: readonly MessageAttachment[]): readonly string[] {
  const occurrences = new Map<string, number>()
  return pending.map((attachment) => {
    const occurrence = occurrences.get(attachment.attachmentId) ?? 0
    occurrences.set(attachment.attachmentId, occurrence + 1)
    return `${attachment.attachmentId}#${occurrence}`
  })
}

/**
 * #1262 — the pending set, drawn: a row of file tiles between the status row and the message box (Figma
 * `Attachment area` 390:7136), in the set's own completion order.
 *
 * `null` FOR AN EMPTY SET, NOT AN EMPTY ELEMENT — `ComposerAttachOutcome`'s ruling applied to the column's
 * FIRST child instead of its last, and load-bearing for the same reason twice over: `.composer` is a flex
 * column with a `--space-1` gap, so an element that mounts empty is not free. It would move the message box
 * down on every launch, in every spec, forever.
 *
 * ⭐ #1263 — ONE BRANCH, OVER THE NAME. `isImageAttachmentName` is the message bubble's own rule applied to the
 * same untrusted string: an image name draws its picture, everything else keeps the file tile. It decides what is
 * DRAWN, never what is fetched or from where — the fetch is addressed by `attachmentId`, which that predicate
 * never sees — so a name that lies produces a picture that fails to decode and falls back to the file tile,
 * never a different file and never a different request. The two drawings wear the same frame class and the same
 * 45x60 box, which is why the strip's tile count and each tile's position are a property of this SET and not of
 * what any picture is doing.
 *
 * ⭐ #1264 FALSIFIED THE ARRAY-INDEX KEY THIS STRIP INHERITED, and the replacement is `pendingAttachmentKeys`
 * below. #1262's reason for the index — "this list only ever appends and is cleared wholesale, so index
 * identity is stable" — was true of an append-only list and stopped being true the moment a tile could be
 * taken out of the MIDDLE. See that function for what an index key costs once it can.
 *
 * ITS OWN THREE CLASSES, sharing no whole class token with `.composer__attach`,
 * `.composer__attach-outcome` or `.composer__attach-progress`, so no shipped locator and no
 * whole-attribute-run assertion can reach this markup. The drawing itself is the bubble's, through
 * `AttachmentFileIcon` — see that module for why the classes are passed down rather than shared.
 */
export function ComposerAttachmentStrip({
  attachments,
  onRemove
}: {
  attachments: readonly MessageAttachment[]
  /** #1264 — take the tile at this POSITION back out of the pending set. By position rather than by id
   *  because two completions can carry one `attachmentId`; see `removePendingAttachment`. */
  onRemove: (index: number) => void
}): JSX.Element | null {
  if (attachments.length === 0) return null
  // Computed once for the whole row rather than per item, because an entry's key depends on the entries
  // BEFORE it — which occurrence of its id this one is. See `pendingAttachmentKeys`.
  const keys = pendingAttachmentKeys(attachments)
  return (
    <div className="composer__attachments">
      {attachments.map((attachment, index) => (
        // ⭐ #1264 — THE SLOT, AND WHY THE CONTROL IS THE TILE'S SIBLING RATHER THAN ITS CHILD.
        // `.composer__attachment` declares `overflow: hidden` and that clip is #1263's: its picture is
        // `object-fit: cover` and overflows the 45px frame by 7.5px each side. This control overhangs the
        // frame by 5px on both axes, so rendered INSIDE it it is simply invisible — and nothing in this
        // repo reddens to say so. Dropping the clip to make room would un-cut the picture. So the tile
        // keeps its frame untouched and the control hangs on a wrapper outside it.
        //
        // The wrapper takes the tile's own 45x60 box and becomes the flex item in its place, so every
        // tile's POSITION in the row is arithmetically unchanged (the shipped x = 0 / 57 geometry reads
        // the same numbers). It shares no WHOLE class token with `.composer__attachment` — a class
        // selector does not prefix-match, and both unit tests count tiles with `class="composer__attachment"`
        // including the closing quote — so no shipped locator, tile count or `toHaveText('PDF')` can reach
        // it. The control contributes no text to the tile for the same reason: it is not inside it.
        //
        // THE KEY MOVES OUT HERE with the outermost element per item, and it is no longer the array index:
        // this ticket is exactly what falsified that choice, since the list it was justified against was one
        // that only appended. `pendingAttachmentKeys` above carries the mechanism and the alternatives.
        <span className="composer__attachment-slot" key={keys[index]}>
          {isImageAttachmentName(attachment.filename) ? (
            <ComposerAttachmentImage attachment={attachment} />
          ) : (
            <AttachmentFileIcon
              filename={attachment.filename}
              frameClassName="composer__attachment"
              glyphClassName="composer__attachment-glyph"
              labelClassName="composer__attachment-ext"
            />
          )}
          {/* The index is closed over at render, which is what makes "this tile and only this tile" a
              property of the drawing rather than of a lookup: nothing is searched for at click time, so
              two tiles carrying one attachmentId cannot be confused for each other. */}
          <ComposerAttachmentRemoveButton onRemove={() => onRemove(index)} />
        </span>
      ))}
    </div>
  )
}

/** The control's accessible name (#1264 AC4). A CLIENT-OWNED CONSTANT saying what the control does, never
 *  which file it drops: the filename is untrusted display text arriving over `ipcRenderer.on`, and an
 *  `aria-label` is an attribute — the sink CLAUDE.md's 2026-08-20 ruling closes and #696's security review
 *  rejected as a MUST FIX. #1265's tooltip renders the name as escaped CHILDREN, which is the other half of
 *  that same rule rather than an exception to it. */
export const REMOVE_ATTACHMENT_LABEL = 'Remove attachment'

/** Figma `Icon` 390:7183 — Font Awesome's `circle-xmark-solid`, the solid disc whose cross is a CUT-OUT
 *  rather than a stroke. That is why the export puts a plain circle behind it: the cut-out is where the
 *  darker circle shows through, so the cross reads dark on a light disc. The export's clip-path is dropped,
 *  its rect being the full viewBox (ATTACHMENT_PATH's ruling, and FILE_GLYPH_PATH's), as are its
 *  `preserveAspectRatio="none"` and `overflow="visible"`, which mean something only to the <img> wrapper
 *  Figma generates around it. */
const REMOVE_GLYPH_PATH =
  'M10 20C15.5234 20 20 15.5234 20 10C20 4.47656 15.5234 0 10 0C4.47656 0 0 4.47656 0 10C0 15.5234 4.47656 20 10 20ZM6.52344 6.52344C6.89062 6.15625 7.48437 6.15625 7.84766 6.52344L9.99609 8.67188L12.1445 6.52344C12.5117 6.15625 13.1055 6.15625 13.4687 6.52344C13.832 6.89062 13.8359 7.48437 13.4687 7.84766L11.3203 9.99609L13.4687 12.1445C13.8359 12.5117 13.8359 13.1055 13.4687 13.4687C13.1016 13.832 12.5078 13.8359 12.1445 13.4687L9.99609 11.3203L7.84766 13.4687C7.48047 13.8359 6.88672 13.8359 6.52344 13.4687C6.16016 13.1016 6.15625 12.5078 6.52344 12.1445L8.67188 9.99609L6.52344 7.84766C6.15625 7.48047 6.15625 6.88672 6.52344 6.52344Z'

/**
 * #1264 — one tile's remove control, hung off its slot's top-right corner.
 *
 * A REAL <button type="button">, `ComposerAttachButton`'s idiom for an icon-only control: <button> is not
 * on ARIA's name-prohibited list, so an `aria-label` names it, where a <span> would map to role="generic"
 * and have its name dropped. The `type` is explicit because this control sits inside the composer, where a
 * submit-typed button would send the message it exists to edit.
 *
 * ⭐ TWO INKS OUT OF ONE DRAWING, `AttachmentFileIcon`'s seam applied to a fill instead of a stroke. A
 * presentation attribute cannot hold a `var()`, so the glyph takes `fill="currentColor"` and resolves the
 * button's own `color: var(--color-primary)`, while the disc carries its own class and resolves
 * `--color-on-primary` there. A directly declared `fill` beats an inherited presentation attribute, so the
 * two never fight. No colour prop and no `style` attribute.
 *
 * INLINED, NEVER REFERENCED: Figma hands back an `https://` asset URL for this glyph, and the renderer's
 * CSP is `default-src 'self'` — it would fail closed AND be a third-party request on every render.
 *
 * NOTHING CROSSES THE WIRE when this is clicked. The attachment family is `attachment_chunk` /
 * `attachment_stored` / `request_attachment` — there is no delete verb — so removal is an edit to a message
 * not yet sent and the host keeps the file it stored. This component closes over no bridge, and the strip
 * hands it no sender.
 */
function ComposerAttachmentRemoveButton({ onRemove }: { onRemove: () => void }): JSX.Element {
  return (
    <button
      type="button"
      className="composer__attachment-remove"
      aria-label={REMOVE_ATTACHMENT_LABEL}
      onClick={onRemove}
    >
      <svg viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
        <circle className="composer__attachment-remove-disc" cx="10" cy="10" r="7" />
        <path d={REMOVE_GLYPH_PATH} />
      </svg>
    </button>
  )
}

// ================================================================================================
// #1039 — the PENDING SET. What an upload completing means to the message the operator has not sent
// yet, as a rule that is neither a view nor a gesture: it is the first thing in this app that
// associates an attachment with a message.
//
// IT IS A PURE FUNCTION FOR A REASON THIS FILE'S FOUR OTHERS DID NOT FACE. Those are pure so the static
// tier can walk gestures nothing in this repo can perform. This one is pure because there is no other
// tier AT ALL: nothing renders the pending set, so Playwright has nothing to observe, and this repo's
// renderer specs are static server renders with no DOM and no `renderHook`, so a rule living inside the
// hook would be reachable by no test anywhere. The hook below holds the value; this decides it.
// ================================================================================================

/** The empty pending set, as one shared reference — a send with nothing attached hands back this exact
 *  array rather than a fresh `[]`, so a caller comparing references sees "unchanged" (the
 *  `initialTimelineState` idiom). Exported for its own tests. */
export const NO_PENDING_ATTACHMENTS: readonly MessageAttachment[] = []

/**
 * Fold one arriving upload event into the set the next send will record.
 *
 * A COMPLETION IS THE ONLY THING THAT RECORDS ANYTHING (the third criterion): a refusal, a failure and an
 * in-flight `progress` each return the set UNCHANGED — the same reference, not an equal copy, so
 * "contributes nothing" is structural rather than incidental. An upload still moving when the message is
 * sent is in that set of nothing too: only its terminal can add it, and by then the message is gone.
 *
 * THE PAIR IS THE DAEMON'S ID AND THE DISPLAY NAME. `uploadId` is what `driveUpload` sent as
 * `attachment_id`, so it names the file the HOST stored rather than a local correlation key, and
 * `filename` is #1038's supply — the first consumer that field has had. Both are carried verbatim: no
 * trim, no non-empty guard, no dedup by id. See `MessageAttachment`.
 *
 * ORDER IS COMPLETION ORDER, which is the only order this window can know. The composer never learns the
 * `uploadId` its own click minted (`requestAttachmentUpload()` returns void), so it cannot order by
 * gesture, and it does not need to: what the operator gets is the files that finished uploading before
 * they pressed send, in the order the host confirmed them.
 *
 * An explicit return type and NO `default`, so a member added to `AttachmentUploadEvent` upstream trips
 * TS2366 here and has to be classified as recording or not recording — `attachmentUploadOutcomeCopy`'s
 * idiom one module over, and sufficient for the same reason it is not sufficient for that module's
 * `reason` read: this switches on the DISCRIMINATOR, which our own background process mints, where
 * `reason` is a value a hostile daemon can choose and therefore needs the `Map`'s runtime totality.
 */
export function reducePendingAttachments(
  pending: readonly MessageAttachment[],
  event: AttachmentUploadEvent
): readonly MessageAttachment[] {
  switch (event.type) {
    case 'completed':
      return [...pending, { attachmentId: event.uploadId, filename: event.filename }]
    case 'refused':
    case 'failed':
    case 'progress':
      return pending
  }
}

/**
 * #1264 — take one tile back out of the pending set, so the next send does not name its id.
 *
 * The third pure rule beside the two around it, and pure for their reason twice over: the gesture that
 * calls it belongs to a tier that cannot render, and the holder it writes belongs to a tier that cannot
 * click, so a rule living inside the hook would be reachable by no test anywhere.
 *
 * ⭐ BY POSITION, NEVER BY ID. Two completions can carry the same `attachmentId` — the same file attached
 * twice — and removing by id would take both tiles for one click, dropping a file the operator never asked
 * to drop from a message they are still writing. Position is what the strip's own `map` hands each control,
 * so the control's index and the set's index are the same number by construction rather than by correlation,
 * and nothing is searched for at click time. (The strip's REACT key is a different thing and is deliberately
 * NOT the position — see `pendingAttachmentKeys` for why removal is what forced them apart.)
 *
 * THE SAME REFERENCE FOR AN INDEX THAT NAMES NO TILE, `reducePendingAttachments`'s idiom for "this changes
 * nothing" — structural rather than incidental, and what makes an impossible index unable to clear a set.
 * The pathological ordering is a removal landing after a send's take: it folds against an emptied set,
 * where every index is out of range, so it is a no-op by this rule rather than by timing.
 *
 * NOTHING CROSSES THE WIRE. There is no delete verb in the attachment family, and none is wanted: the
 * operator is editing an unsent message, not deleting a file the host has already stored.
 */
export function removePendingAttachment(
  pending: readonly MessageAttachment[],
  index: number
): readonly MessageAttachment[] {
  if (index < 0 || index >= pending.length) return pending
  return [...pending.slice(0, index), ...pending.slice(index + 1)]
}

/**
 * Hand the pending set to a send and empty it, in ONE act (#1039) — the second half of that ticket's
 * fourth criterion, and the reason it is a function over a holder rather than three lines inside the
 * hook: the hook is unreachable by every tier this repo has, and "a second message sent with no further
 * uploads records none" is a rule, not a detail. Generic over the holder in the way `fileToAttach` is
 * generic over the element — a `MutableRefObject` satisfies `{ current }` structurally, so this tier
 * needs no React to walk it.
 *
 * TAKE AND CLEAR CANNOT BE SPLIT. A reader that did not empty, or an emptier a caller had to remember to
 * call, would each leave a window in which one send's attachments can be recorded twice. Emptying to the
 * shared constant rather than to a fresh `[]` keeps a second take reference-identical to the first.
 *
 * ⭐ #1055 GIVES THE ACT AN UNDO, WITHOUT SPLITTING IT. The ids now ride the outbound frame, so the take
 * has to happen ABOVE the guarded send (the payload literal needs them) — and a send whose bridge throws
 * named nothing on the wire, so the files must still be attached for the retry. `rollback` is that, and
 * it is handed back WITH the set precisely so the paragraph above still holds: there is no reader that
 * does not empty and no emptier to remember, only one act that can be undone. The closure captures this
 * holder, so a take cannot be restored into a different one.
 *
 * RESTORING IS SOUND BECAUSE THE CALLER IS SYNCHRONOUS. `submitMessage` takes, sends and rolls back with
 * no `await` between them, and the listener that appends to the set runs as a separate task, so nothing
 * can arrive in the gap for the restore to clobber.
 *
 * WHO may call it is the criterion's other half and is NOT decided here: `submitMessage` reads its
 * `takeAttachments` dep once, below both of its `false` returns, so a blank Enter or a submit with no
 * active conversation never reaches this and the operator's attached file survives for the next send.
 */
/**
 * #1262 — the take's DISPLAY half, wrapped around the act above rather than folded into it.
 *
 * ⭐ IT DOES NOT CHANGE THE ACT IT WRAPS, and that is the whole reason it is a wrapper. Everything the
 * docblock above argues still holds byte-for-byte: one destructive read of the holder, no reader that does
 * not empty, no emptier to remember, and a rollback that is synchronous with respect to the holder. What
 * this adds is a second, DISPLAY-ONLY writer that mirrors both directions of that act to the strip.
 *
 * PURE, FOR `drainPendingAttachments`'S OWN REASON: the hook it serves is reachable by no tier this repo
 * has — no DOM, no `renderHook` — so a rule living inside it would be provable nowhere. A recorder function
 * is all its tests need.
 *
 * ⭐ THE HOLDER IS RESTORED BEFORE THE DISPLAY. `take.rollback()` runs first, so there is no instant at
 * which a tile is drawn for an attachment the next send would fail to record. The reverse order would be
 * wrong in the direction that loses a file rather than the one that draws a stale tile.
 */
export function mirrorTakeToDisplay(
  take: PendingAttachmentTake,
  showPending: (attachments: readonly MessageAttachment[]) => void
): PendingAttachmentTake {
  showPending(NO_PENDING_ATTACHMENTS)
  return {
    attachments: take.attachments,
    rollback: () => {
      take.rollback()
      showPending(take.attachments)
    }
  }
}

export function drainPendingAttachments(holder: {
  current: readonly MessageAttachment[]
}): PendingAttachmentTake {
  const attachments = holder.current
  holder.current = NO_PENDING_ATTACHMENTS
  return {
    attachments,
    rollback: () => {
      holder.current = attachments
    }
  }
}

/**
 * The container half: the held outcome, the pending set, and the intent that clears the outcome.
 *
 * EPHEMERAL, SCREEN-LOCAL, READ BY NOTHING ELSE — ADR 0006's `useState` shape, not ADR 0004's module
 * singleton. The one wrinkle the ADR does not cover is that this state has a display-lifetime
 * SUBSCRIPTION, which its pairing precedent did not; it stays component-scoped regardless. The
 * subscription is a single effect feeding one nullable value that nothing outside the composer reads, its
 * cleanup is the bridge's own unsubscribe handle, and the reset the ticket asks for comes free —
 * PairedShellView keys the chat pane on the conversation id, so a switch destroys and rebuilds the
 * composer with a fresh `null`. A store plus its bridge would add a singleton that must then be
 * EXPLICITLY cleared on switch and on unpair: more code and one more clearing arm to get wrong, for no
 * reader outside this component.
 *
 * ONE NULLABLE HOLDS BOTH DISPLAY STATES (#864). In-flight progress and the terminal occupy the same slot
 * because they are the same value: the listener assigns whatever arrived last, so a terminal replaces a
 * progress line without anything having to clear it, and a connection lost mid-transfer clears the
 * figure on exactly the path a completion does. No second piece of state, and nothing to keep in step.
 * QUALIFIED BY #1039: that nullable is still the whole of what this hook DISPLAYS, but it is no longer
 * the whole of what this hook holds — the pending set below sits beside it, fed by the same listener and
 * read by nothing on screen. QUALIFIED AGAIN BY #1262, which spends the other half of that sentence: the
 * pending set IS read on screen now, by the strip. The nullable's own paragraph is untouched by that —
 * the two display states it holds are still one value in one slot — except that a `completed` event now
 * assigns a value the outcome view deliberately renders as nothing.
 *
 * ⭐ WHAT #1039 FALSIFIES, HONESTLY. The paragraph that stood here said the composer "states the latest
 * event to arrive, and it cannot state anything narrower", because `requestAttachmentUpload()` returns
 * void and this window never learns the uploadId its own click minted. THE CLICK-TO-ID HALF IS STILL
 * TRUE and is still why the displayed line is the latest event and nothing narrower: there is no
 * correlation from a gesture to an id, and `uploadId` is still unread by everything that renders.
 * What was wrong was the leap from there to "so the listener cannot accumulate". A message's attachments
 * do not need a click correlated to an id — they need the completions that ARRIVED since the last send,
 * in arrival order, which the events give on their own. So the listener now assigns AND accumulates; it
 * still does not merge, queue, or correlate anything to a gesture.
 *
 * ⭐ THE PENDING SET LIVES IN A REF, AND #1262 DID NOT MOVE IT. The half of that decision this ticket
 * falsifies is its FIRST clause — "because nothing renders it" — since `ComposerAttachmentStrip` now
 * does. The half that carries the weight survives untouched, and it was never about rendering: `useState`
 * batching would open a real drop window, because a completion arriving after the last commit but before
 * the click would be invisible to the closure the CLICK reads, and the take would then clear it unsent. A
 * ref is written by the listener and read by the send synchronously, so that window does not exist.
 *
 * So the set is held TWICE and the two holdings answer different questions. The ref is the record — what
 * the send takes, authoritative, synchronous. The `useState` beside it is the DISPLAY's copy, written from
 * the same fold in the same listener call, and it is allowed to be batched precisely because nothing reads
 * it to decide anything. Do not collapse them by making the take read the state: that is the drop window
 * above, restored, and it would fail silently. Both are still ADR 0006 state in every other respect —
 * ephemeral, screen-local, per-mount — and both reset on a conversation switch for the held outcome's free
 * reason: `PairedShellView` keys the chat pane on the conversation id, so a switch rebuilds this component
 * with an empty set and an empty strip.
 */
export function useAttachmentUpload({ conversationId }: { conversationId: string | null }): {
  outcome: AttachmentUploadEvent | null
  pending: readonly MessageAttachment[]
  requestAttach: () => void
  dropFile: (file: File) => void
  pasteImage: () => void
  takePendingAttachments: () => PendingAttachmentTake
  removePending: (index: number) => void
} {
  const [outcome, setOutcome] = useState<AttachmentUploadEvent | null>(null)
  // #1039: the files whose uploads have completed since the last send. See the ref-not-state paragraph
  // above; `useRef` gives a fresh empty set per mount, which is the whole of the conversation-switch reset.
  const pendingRef = useRef<readonly MessageAttachment[]>(NO_PENDING_ATTACHMENTS)
  // #1262: the same set again, as state this time, and the DISPLAY's copy alone. The strip draws this; the
  // send still reads the ref. Both are written from one fold in one place (see the listener), so they
  // cannot disagree about which events happened, and the drop window the paragraph above names stays
  // closed: it is a window in what the CLICK reads, and state that only draws cannot open it.
  const [pending, setPending] = useState<readonly MessageAttachment[]>(NO_PENDING_ATTACHMENTS)

  useEffect(() => {
    // One subscription per mount; the returned off handle IS the effect cleanup, so a remount nets
    // exactly one live listener (the LogDataSection / daemonEventBridge idiom). Wrapped in an arrow
    // rather than passed as `setOutcome` directly: React's setter treats a FUNCTION argument as an
    // updater, so handing it the listener slot would be a latent foot-gun the day this channel carries
    // anything but an object.
    return window.pyry.onAttachmentUploadEvent((event) => {
      setOutcome(event)
      // #1039: the same event, folded into the pending set by the pure rule above — the display and the
      // record are two readings of one arrival, taken in one place so they cannot disagree about which
      // events happened. The assignment is synchronous, so an upload that completes while the operator is
      // typing is already in the set by the time the send reads it.
      // #1262: ONE fold, TWO writes. The ref is what the send reads and stays authoritative; the state is
      // what the strip draws. A refusal, a failure and a progress each fold to the same reference, so they
      // set the state to the value it already holds and React bails out of the re-render on its own.
      const next = reducePendingAttachments(pendingRef.current, event)
      pendingRef.current = next
      setPending(next)
    })
  }, [])

  const requestAttach = (): void => {
    // #1205: no open conversation, no upload. `submitMessage`'s rule for a null id, applied to the
    // three entries here: the ask has to name the conversation the bytes are for, and there is no
    // conversation to name, so nothing is asked and nothing on screen changes. The daemon would refuse
    // the chunk anyway (pyrycode #2143); refusing here costs no picker and no bytes.
    if (conversationId === null) return
    // THE CLEAR HAPPENS ON THE CLICK, and it has to. A cancelled picker reports NOTHING at all, so a
    // clear driven by an arriving event would leave the previous refusal or failure on screen for an
    // attach the operator abandoned. Clearing first also means the line that appears next is unambiguously
    // about the attach just started — as far as this bridge can express that at all.
    setOutcome(null)
    // `window.pyry` is dereferenced only here and in the effect above — never during render — so every
    // static render of the composer still touches no bridge (Composer.handleSubmit's standing rule).
    // Fire-and-forget: this window names an INTENT and a DESTINATION, never a file. Nothing that could
    // name one exists here to send. The id is the open chat's daemon-minted one, read at the click —
    // the ask carries it once and the background process spreads it onto every chunk, so a chat switch
    // after this line cannot re-point the transfer (pyrycode #2146 would refuse it if it could).
    window.pyry.requestAttachmentUpload({ conversationId })
  }

  /**
   * The DROP entry (#890), and the reason it lives in this hook rather than at the drop site: the clear
   * is the SAME ACT `requestAttach` performs a few lines up, so it stays with one owner instead of being
   * re-implemented where a second copy could drift. "Dropping clears whatever outcome line is showing"
   * is that one line, and it must happen on the gesture for the picker's recorded reason — a drop whose
   * path the preload declines to resolve reports nothing at all, so a clear driven by an arriving event
   * would strand the previous refusal on screen.
   *
   * THE WINDOW HOLDS THE `File` HANDLE AND NOTHING ELSE. The path is recovered inside the preload and
   * never comes back, so it reaches no state here, no log line and no diagnostic record. `window.pyry`
   * is dereferenced only here and in the two closures above — never during render — so every static
   * render of the composer still touches no bridge.
   */
  const dropFile = (file: File): void => {
    if (conversationId === null) return // #1205, `requestAttach`'s reason
    setOutcome(null)
    window.pyry.dropAttachmentFile(file, { conversationId })
  }

  /**
   * The PASTE entry (#1033), and the third member of the act this hook owns. It lives here for
   * `dropFile`'s reason: the clear is the SAME ACT the two above perform, so it stays with one owner
   * instead of being re-implemented at a third gesture site where a copy could drift.
   *
   * THE CLEAR IS FOR CONSISTENCY HERE, NOT FOR A STRANDING IT PREVENTS — worth stating, because the
   * two members above it clear for a reason that does NOT arise on this path. A cancelled picker and an
   * unresolvable dropped path each report nothing at all, which is what would strand a previous line;
   * #1032's clipboard path draws exactly one terminal for every ask, `no-image` included, so an
   * event-driven clear would have worked here. It clears on the gesture anyway, so all three entries
   * behave identically and the line that appears next is unambiguously about the paste just made.
   *
   * IT CARRIES NOTHING, which is the whole reason this slice is small. `pasteAttachmentImage()` takes
   * no argument: the window names an INTENT and the background process reads the clipboard itself, so
   * no clipboard content reaches renderer state, a log line, a diagnostic record or the bridge. Nothing
   * about the image — not a byte, a dimension, a length or a name — is knowable here. `window.pyry` is
   * dereferenced only in this closure and the two above, never during render.
   *
   * ⭐ STILL TRUE OF THE CALL, AND NOW QUALIFIED AT THE SHAPE (#1129). `AttachmentPasteRequest`
   * admits an optional `serverId` naming which paired server the image is for, so the ask is no
   * longer literally empty — but this sender passes none and `pasteAttachmentImage()` still takes
   * no argument, because the composer has nothing to source a server id from until #1086. Every
   * sentence above survives the widening regardless: a routing key is not clipboard content, it is
   * resolved against the registry's held entry set in the background process and discarded, and
   * nothing about the image becomes knowable here. When this composer does acquire a server, this
   * is the call that names it.
   */
  const pasteImage = (): void => {
    if (conversationId === null) return // #1205, `requestAttach`'s reason
    setOutcome(null)
    window.pyry.pasteAttachmentImage({ conversationId })
  }

  /**
   * The send's read of the pending set — the pure `drainPendingAttachments` above, bound to this mount's
   * ref, which is all this member is.
   *
   * ⭐ IT IS NOT THE GESTURE CLEAR, AND THE THREE ENTRIES ABOVE MUST NOT TOUCH THE PENDING SET.
   * `requestAttach`, `dropFile` and `pasteImage` each call `setOutcome(null)` on the gesture, which is
   * about the DISPLAYED line: a cancelled picker reports nothing at all, so an event-driven clear would
   * strand a stale refusal on screen. A pending set that shared that clear would erase the first file the
   * moment the operator attached a second — which is exactly the "one or more" the first criterion asks
   * for. The two clears answer different questions and are kept apart on purpose.
   *
   * Its `attachments` is the shared empty constant when nothing is pending, so a send with no
   * attachments hands back the same reference every time and `submitMessage` normalises it to an absent
   * field — on the echo since #1039, and on the outbound frame since #1055.
   */
  // #1262: the same act, with the strip kept in step through `mirrorTakeToDisplay` — the take empties the
  // tiles, and a rolled-back take (a send whose bridge threw) brings exactly those tiles back. The ref is
  // still the only thing the send reads: the display copy must never become the take's source, which is
  // precisely the drop window the ref exists to close and would fail silently.
  const takePendingAttachments = (): PendingAttachmentTake =>
    mirrorTakeToDisplay(drainPendingAttachments(pendingRef), setPending)

  /**
   * #1264 — the removal, bound to this mount's two holdings. ONE FOLD, TWO WRITES: the upload listener's
   * shape exactly, and for its reason. The set is held twice on purpose — the ref is the record
   * `takePendingAttachments` reads, the `useState` is the display's own copy — and folding once into both
   * is what keeps them unable to disagree about which tiles are gone. The take is NOT made to read the
   * state to save this write; doing so reopens the drop window the ref exists to close, silently.
   *
   * THE REF FIRST, then the display: the mirror of `mirrorTakeToDisplay`'s ordering argument. There is no
   * instant at which the record names an attachment the strip is no longer drawing.
   *
   * It does NOT clear the outcome line, unlike the three gesture entries above: this gesture is about one
   * tile, and clearing a refusal the operator has not read because they took a different file back would
   * be the same conflation those entries are kept apart from.
   */
  const removePending = (index: number): void => {
    const next = removePendingAttachment(pendingRef.current, index)
    pendingRef.current = next
    setPending(next)
  }

  return {
    outcome,
    pending,
    requestAttach,
    dropFile,
    pasteImage,
    takePendingAttachments,
    removePending
  }
}

/**
 * The drag-over container (#890): the depth counter, the four handlers `.composer` wears, and the
 * window-level guard that stops a missed drop from navigating.
 *
 * ADR 0006 state — ephemeral, screen-local, read by nothing else — the same call `useAttachmentUpload`
 * makes for the held outcome, and it resets on a conversation switch for the same free reason
 * (`PairedShellView` keys the chat pane on the conversation id).
 *
 * ⭐ THE WINDOW GUARD IS THE ONLY PART OF THIS FEATURE THAT IS NOT SCOPED TO THE COMPOSER, and it rides
 * this hook rather than `App.tsx` precisely so it is mounted wherever the composer is and no second
 * mount point has to be kept in step. Its whole job is `preventDefault` on `dragover` and `drop` — a
 * file dropped ANYWHERE in the window, on the composer or not, otherwise navigates the window to that
 * file, replacing the app with a rendering of it. It is DEFENCE IN DEPTH: `will-navigate` in the
 * background process already refuses every target but the app's own document, which is why a missed drop
 * is a silent no-op today rather than a hijacked window. Both listeners are gated on `dragCarriesFiles`,
 * so a text or link drag is not intercepted at all.
 *
 * `settled` on window `drop` AND on `dragend`: the composer's own `onDrop` covers a drop it receives,
 * and these cover the two it does not — a drop that lands elsewhere while the edge is painted, and a
 * drag abandoned outside the window. The reset is idempotent, so the double-fire on a composer drop is
 * harmless rather than something to arbitrate.
 */
export function useComposerFileDrop({ onFile }: { onFile: (file: File) => void }): {
  active: boolean
  handlers: {
    onDragEnter: (event: DragEvent<HTMLElement>) => void
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDragLeave: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
  }
} {
  const [depth, setDepth] = useState(0)

  useEffect(() => {
    const suppress = (event: globalThis.DragEvent): void => {
      if (!dragCarriesFiles(event.dataTransfer?.types)) return
      event.preventDefault()
    }
    const settle = (): void => setDepth(0)
    window.addEventListener('dragover', suppress)
    window.addEventListener('drop', suppress)
    window.addEventListener('drop', settle)
    window.addEventListener('dragend', settle)
    // The effect cleanup IS the teardown, so a remount nets exactly one live set of listeners — the
    // onDaemonEvent / useAttachmentUpload idiom, and what keeps a conversation switch from stacking them.
    return () => {
      window.removeEventListener('dragover', suppress)
      window.removeEventListener('drop', suppress)
      window.removeEventListener('drop', settle)
      window.removeEventListener('dragend', settle)
    }
  }, [])

  /** Every handler below opens with this: a drag that carries no file is left entirely alone — not
   *  counted, not prevented, not consumed — which is what keeps text dropped into the textarea working. */
  const isOurs = (event: DragEvent<HTMLElement>): boolean =>
    dragCarriesFiles(event.dataTransfer?.types)

  return {
    active: depth > 0,
    handlers: {
      onDragEnter: (event) => {
        if (!isOurs(event)) return
        event.preventDefault()
        setDepth((current) => reduceFileDropDepth(current, { type: 'enter' }))
      },
      // `dragover` must preventDefault on EVERY tick or the element stops being a drop target and the
      // browser reverts to its own handling — the one handler here that looks redundant and is not.
      onDragOver: (event) => {
        if (!isOurs(event)) return
        event.preventDefault()
      },
      onDragLeave: (event) => {
        if (!isOurs(event)) return
        setDepth((current) => reduceFileDropDepth(current, { type: 'leave' }))
      },
      onDrop: (event) => {
        if (!isOurs(event)) return
        // AC3: nothing navigates and nothing is inserted. This runs whether or not a file is attached
        // below, so a multi-file drop is still swallowed rather than falling through to the browser.
        event.preventDefault()
        setDepth((current) => reduceFileDropDepth(current, { type: 'settled' }))
        const file = fileToAttach(Array.from(event.dataTransfer.files))
        if (file === null) return
        onFile(file)
      }
    }
  }
}
