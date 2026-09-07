import { attachmentExtensionLabel } from './attachmentExtensionLabel'

/**
 * #1262 — the file drawing, shared between the message bubble's file row (#815) and the composer's pending
 * tile. Figma `File` (`390:7239` inside the composer's attachment slot; `132:4605` inside the bubble): the
 * outlined document at 45×60 with the name's extension centred across its lower half.
 *
 * IT WAS LIFTED, NOT WRITTEN. `BubbleAttachmentRow` transcribed this node first and every decision below is
 * that transcription's, carried across unchanged: the export's `preserveAspectRatio="none"`,
 * `overflow="visible"` and full-bleed clipPath are dropped (they mean something only for the `<img>` wrapper
 * Figma generates), the glyph is sized by its own width/height with a matching viewBox, and both children
 * are `aria-hidden` because whatever accessible name this drawing sits inside belongs to the caller.
 *
 * ⭐ THE THREE CLASS PROPS ARE THE WHOLE POINT, and they are not styling flexibility for its own sake.
 * `ConversationScreen.test.tsx` matches the bubble's `class="bubble__file-icon"` and
 * `class="bubble__file-ext"` as WHOLE ATTRIBUTE RUNS, so lifting a shared class into them as a two-class
 * mix would redden four assertions and let a fifth pass vacuously (`composer-attach.md` records that
 * degradation). Substituting the caller's own class instead makes the bubble's markup BYTE-IDENTICAL after
 * the lift, which is this ticket's third criterion by construction rather than by re-assertion.
 *
 * ⭐ TWO INKS OUT OF A DRAWING THAT HAS ONLY EVER HAD ONE. The bubble derives both from one inherited
 * `color`; the composer's tile wants the glyph in --color-inverse-primary and the label in --color-primary
 * (measured off the Figma variables, not off the generated snippet — see the plan's Design source). The
 * seam that lets them differ is that the glyph keeps `stroke="currentColor"` while the LABEL and the GLYPH
 * each carry their own class, so each consumer's stylesheet resolves `color` on the two elements
 * independently. No colour prop, no `style` attribute, and the bubble — which sets neither — keeps
 * inheriting the row's colour on both halves exactly as before.
 *
 * STROKE, NOT FILL. The export is `fill="none"` over a stroked path: this is an OUTLINE, and filling it
 * renders a solid document. The layer is named `file-solid-full` and this repo has been caught by that name
 * once already; the render is what ships, never the name.
 *
 * INLINED, NEVER REFERENCED. Figma's export hands back an `https://` asset URL for this glyph. Shipping it
 * would put a remote subresource in a renderer whose CSP is `default-src 'self'` — it would fail closed,
 * and it would also be an outbound request to a third party on every render.
 */
const FILE_GLYPH_PATH =
  'M7.5 0.5H25.0195C26.7633 0.5 28.4292 1.1438 29.7119 2.30566L29.9629 2.54492L42.4551 15.0254C43.7667 16.3371 44.5 18.1197 44.5 19.9805V52.5C44.5 56.3606 41.3606 59.5 37.5 59.5H7.5C3.63942 59.5 0.5 56.3606 0.5 52.5V7.5C0.5 3.63942 3.63942 0.5 7.5 0.5ZM23.875 17.8125C23.875 19.6472 25.3528 21.125 27.1875 21.125H39.3516L23.875 5.64844V17.8125Z'

/**
 * The drawing for one attachment, in the caller's own three classes.
 *
 * ⭐ ONLY THE DERIVED LABEL OF `filename` REACHES THE DOM, and that is a security property rather than a
 * layout one. The name is operator-supplied text arriving over `ipcRenderer.on`, where the declared type is
 * the compile-time half only; `attachmentExtensionLabel` reduces it to at most four `[A-Za-z0-9]`
 * characters in linear time, and that label is escaped React CHILDREN — never an attribute, a `title`, an
 * `alt`, a URL or a React key. The raw name is deliberately NOT rendered here: the bubble draws it in its
 * own sibling element, and the composer's tile draws it nowhere in this slice (#1265 owns the tooltip, and
 * inherits the 255-byte-name and bidi-spoof obligations with it).
 *
 * IT DOES NOT SANITISE THE NAME and must not start — `attachmentExtensionLabel`'s standing ruling: the
 * value a save builds a path from is re-sanitised in main, and a second cleaner on this side would make
 * what the operator sees differ from what a save writes.
 */
export function AttachmentFileIcon({
  filename,
  frameClassName,
  glyphClassName,
  labelClassName
}: {
  filename: string
  /** The 45×60 positioning context the label is absolutely placed against. */
  frameClassName: string
  /** The svg's own class — where a consumer resolves the STROKE's `color`. */
  glyphClassName: string
  /** The overlay's class — where a consumer resolves the LABEL's `color` and its type. */
  labelClassName: string
}): JSX.Element {
  return (
    <span className={frameClassName}>
      <svg
        className={glyphClassName}
        viewBox="0 0 45 60"
        width="45"
        height="60"
        fill="none"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path d={FILE_GLYPH_PATH} />
      </svg>
      {/* aria-hidden because this restates characters the name already carries. An empty label (a name with
          no usable extension) emits an empty element and needs no rule of its own — the glyph beside it
          holds the drawing's height regardless. */}
      <span className={labelClassName} aria-hidden="true">
        {attachmentExtensionLabel(filename)}
      </span>
    </span>
  )
}
