/**
 * #1045 — whether an attachment should be DRAWN as a picture.
 *
 * ⭐ THIS IS A CLIENT-OWNED DECISION OVER AN UNTRUSTED NAME, and it is the window's only option rather
 * than its preferred one. Nothing tells this side an attachment's type. The bytes channel says so in as
 * many words ("THE CHANNEL CARRIES BYTES AND NOTHING ELSE — no filename, no media type"), the retrieval
 * leg discarded name and type on purpose (`attachmentReassembler` reads neither `filename` nor
 * `mime_type`, and the stored file is extension-less), the blob #1044 mints has `type === ''`, and
 * `matchImageSignature` lives in `src/main/` where the renderer must not reach. `MessagePayload` carries
 * no attachment field either. What is left is `MessageAttachment.filename` — the operator's own basename
 * for a picked or dropped file, or `clipboardImageFilename`'s client-owned stem for a pasted one.
 *
 * IT DECIDES WHAT IS DRAWN, NEVER WHAT IS FETCHED OR FROM WHERE. The fetch is addressed by
 * `attachmentId`, which this module never sees. A name that lies therefore produces a picture that fails
 * to decode — the fallback — and never a different file, never a path, and never a different request.
 *
 * ⭐ IT IS NOT `attachmentExtensionLabel`, AND MUST NOT BECOME IT. That helper is deliberately DECORATIVE:
 * it uppercases, strips every non-alphanumeric character and caps at four, so `photo.p-n-g` yields `PNG`
 * and `x.jpegg` yields `JPEG`. As a label drawn in a 44px slot that is exactly right; as an imageness test
 * it admits names whose actual extension is neither. Imageness needs an EXACT comparison against the whole
 * extension, which is what this is. `attachmentIsImage.test.ts` asserts both functions on both names so a
 * later "just reuse the label" edit cannot pass.
 *
 * LINEAR TIME, NO BACKTRACKING PATTERN — inherited from `attachmentExtensionLabel`'s recorded constraint
 * and for the same reason: this runs on an untrusted-length name on every render, so a pattern like
 * `/(\.\w+)+$/` would be the ReDoS shape. `lastIndexOf` + `slice` + `toLowerCase` + `Set.has` are each
 * linear with no nested quantifier.
 *
 * IT DOES NOT SANITISE OR NORMALISE THE NAME, and must not start — the other constraint that module
 * records. `sanitizeAttachmentFilename` already re-runs in main on the value a save builds a path from, and
 * a second sanitiser on this side is the divergent-checks shape. Concretely: `holiday.png ` (trailing
 * space) is NOT an image here, because trimming would make what is DECIDED differ from what is DRAWN
 * beside it.
 */

/**
 * The formats this app draws, lowercase, compared for exact equality against the whole extension.
 *
 * ⭐ `svg` IS EXCLUDED, and that is a decision rather than an oversight. It is the one candidate that is a
 * DOCUMENT rather than bytes. Chromium disables scripting and external fetches for SVG in image mode, so
 * this is not a live vector — but the argument licensing the `img-src 'self' blob:` widening in
 * `src/renderer/index.html` is the single sentence "a blob: URL only ever reaches an <img> src", and
 * admitting a format whose safety rests on a second browser-internal rule makes that argument two
 * sentences. Nothing in this app produces an SVG attachment.
 *
 * `heic`, `heif` and `tiff` ARE EXCLUDED because Chromium cannot decode them, and excluding an undecodable
 * format is strictly better for the reader than admitting it: an excluded name draws #815's file row,
 * which is a working download control, where an admitted one would draw the textual fallback and offer
 * nothing.
 *
 * WIDENING IS BACKWARD-COMPATIBLE, NARROWING IS NOT — `CANONICAL_ATTACHMENT_ID`'s posture, one process
 * over. A name that stops being an image stops being downloadable-as-drawn for records already in a
 * thread, so the set ships at what is provably decodable and grows on evidence.
 */
const DRAWABLE_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'bmp'
])

export function isImageAttachmentName(filename: string): boolean {
  const lastDot = filename.lastIndexOf('.')
  // No dot at all. `lastIndexOf` answers -1 and slicing from 0 would hand the WHOLE name to the set, so
  // this guard is what keeps a file literally named `png` from being drawn as a picture.
  if (lastDot === -1) return false
  return DRAWABLE_IMAGE_EXTENSIONS.has(filename.slice(lastDot + 1).toLowerCase())
}
