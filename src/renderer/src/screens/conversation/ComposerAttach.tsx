import { useEffect, useState, type DragEvent } from 'react'
import type { AttachmentUploadEvent } from '../../../../shared/ipc/attachmentUpload'
import { attachmentUploadOutcomeCopy } from './attachmentUploadCopy'

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
 * Neither reason holds here: until #815 lands a file row in the message bubble this sentence is the ONLY
 * evidence anywhere that an upload produced anything, it appears asynchronously after an operator gesture,
 * and it fires at most once per attach. `role="status"` is polite (announced without stealing focus) —
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
 */
export function ComposerAttachOutcome({
  outcome
}: {
  outcome: AttachmentUploadEvent | null
}): JSX.Element | null {
  if (outcome === null) return null
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
 * The container half: the held outcome and the intent that clears it.
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
 * ONE NULLABLE HOLDS BOTH STATES (#864). In-flight progress and the terminal occupy the same slot
 * because they are the same value: the listener assigns whatever arrived last, so a terminal replaces a
 * progress line without anything having to clear it, and a connection lost mid-transfer clears the
 * figure on exactly the path a completion does. No second piece of state, and nothing to keep in step.
 *
 * THE COMPOSER STATES THE LATEST EVENT TO ARRIVE, and it cannot state anything narrower.
 * `requestAttachmentUpload()` returns void, so this window never learns the uploadId its own click
 * minted, and the main-side guard is scoped to the DIALOG rather than to the transfer — two transfers
 * with distinct ids can be live at once. So the listener assigns; it does not merge, queue or correlate.
 * `uploadId` is deliberately unread: surfacing it could only invite a correlation that does not exist.
 */
export function useAttachmentUpload(): {
  outcome: AttachmentUploadEvent | null
  requestAttach: () => void
  dropFile: (file: File) => void
} {
  const [outcome, setOutcome] = useState<AttachmentUploadEvent | null>(null)

  useEffect(() => {
    // One subscription per mount; the returned off handle IS the effect cleanup, so a remount nets
    // exactly one live listener (the LogDataSection / daemonEventBridge idiom). Wrapped in an arrow
    // rather than passed as `setOutcome` directly: React's setter treats a FUNCTION argument as an
    // updater, so handing it the listener slot would be a latent foot-gun the day this channel carries
    // anything but an object.
    return window.pyry.onAttachmentUploadEvent((event) => setOutcome(event))
  }, [])

  const requestAttach = (): void => {
    // THE CLEAR HAPPENS ON THE CLICK, and it has to. A cancelled picker reports NOTHING at all, so a
    // clear driven by an arriving event would leave the previous refusal or failure on screen for an
    // attach the operator abandoned. Clearing first also means the line that appears next is unambiguously
    // about the attach just started — as far as this bridge can express that at all.
    setOutcome(null)
    // `window.pyry` is dereferenced only here and in the effect above — never during render — so every
    // static render of the composer still touches no bridge (Composer.handleSubmit's standing rule).
    // Fire-and-forget with no argument: this window names an INTENT, never a file. Nothing that could
    // name one exists here to send.
    window.pyry.requestAttachmentUpload()
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
    setOutcome(null)
    window.pyry.dropAttachmentFile(file)
  }

  return { outcome, requestAttach, dropFile }
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
