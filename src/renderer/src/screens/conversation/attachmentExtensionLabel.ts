/**
 * #815 — the extension label overlaid across the lower half of a file attachment's glyph.
 *
 * A pure function in its own module beside `messageTime`, for the same reason that one exists: keeping the
 * derivation out of the component is what lets `attachmentExtensionLabel.test.ts` pin the exact characters
 * with nothing rendered. `ConversationScreen.tsx` is its only consumer.
 *
 * THE RULE, in the order the steps run: the text after the LAST dot, uppercased, letters and digits only,
 * capped at four characters. Each of the four decisions is load-bearing and each has a case pinning it:
 *
 *   - LAST dot, so `archive.tar.gz` draws `GZ` rather than `TAR`.
 *   - STRIP BEFORE CAPPING, so the cap bounds what is DRAWN rather than what was parsed: `a.p-d-f-x` fills
 *     the slot with `PDFX`, where capping first would draw `PDF` and lose a character to punctuation that
 *     was never going to appear.
 *   - `[A-Za-z0-9]`, NOT `\p{L}`. A 44px slot cannot hold an arbitrary script, and admitting one would make
 *     the row's width depend on the name's alphabet. `файл.документ` draws nothing, which is the designed
 *     empty case rather than a defect.
 *   - FOUR, because that is what fits the drawn slot at body-small emphasized.
 *
 * EMPTY, NEVER A FALLBACK WORD. AC4 asks specifically that a name with no usable extension draws nothing
 * rather than `FILE`, and there are three routes here: no dot, a trailing dot, and an extension the
 * character class removes entirely. All three return `''`, which the row draws as an empty overlay — the
 * `.bubble__meta-time` empty-slot precedent, needing no CSS of its own because the glyph beside it holds
 * the row's height regardless.
 *
 * LINEAR TIME, DELIBERATELY. "Parse the extension" invites a backtracking pattern like `/(\.\w+)+$/`, which
 * is the ReDoS shape and would run on untrusted-length input on every render. `lastIndexOf` + `slice` + a
 * single-character-class `replace` + `slice` are each linear with no nested quantifier and no overlapping
 * alternation. See the plan's security review.
 *
 * IT DOES NOT SANITISE THE NAME, and must not start. This derives a decorative LABEL; the name itself is
 * rendered untouched beside it, because `sanitizeAttachmentFilename` already re-runs in main on the value a
 * save actually builds a path from, and a second sanitiser on this side is the divergent-checks shape the
 * timeline store's own contract argues against. Cleaning the name here would make what the operator SEES
 * differ from what a save WRITES.
 *
 * A NOTE FOR #816. Because the character class drops bidi controls, this label is the trustworthy half of a
 * spoofed name: `report<U+202E>gpj.exe` renders its NAME run reversed but still draws `EXE` here. The row
 * is drawn and not wired in this slice, so the spoof has no action attached; the ticket that gives the row
 * a download action is where that matters.
 */
const NON_LABEL_CHARACTERS = /[^A-Za-z0-9]/g

/** The drawn slot holds four characters at body-small emphasized. */
const MAX_LABEL_LENGTH = 4

export function attachmentExtensionLabel(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  // No dot at all — not a defect, one of AC4's three empty cases. `lastIndexOf` answers -1, and slicing
  // from 0 would return the WHOLE name, so this guard is what keeps `README` from drawing `READ`.
  if (lastDot === -1) return ''
  return filename
    .slice(lastDot + 1)
    .toUpperCase()
    .replace(NON_LABEL_CHARACTERS, '')
    .slice(0, MAX_LABEL_LENGTH)
}
