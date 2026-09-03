// The type gate for #867: leading bytes in, a file suffix from a closed set or nothing out.
//
// WHY THIS EXISTS AT ALL. The stored attachment is deliberately extension-less (see
// attachmentPath.ts), because an extension would be model-chosen — the assistant names the file it
// produced — and a model-chosen extension is precisely what makes handing a path to the operating
// system dangerous, since a `.command`, `.desktop`, `.app` or `.scpt` opens by EXECUTING. So the
// type the OS is told about is derived here, from the file's own bytes, and never from the wire's
// declared `mime_type` (a claim, not a verified property) and never from a file name.
//
// WHAT THAT BUYS, STATED PRECISELY, SO THE GATE IS READ AT THE RIGHT STRENGTH. The job is to pick a
// suffix out of a CLOSED SET THIS APP WRITES DOWN ITSELF. The bytes CHOOSE which member; they never
// SUPPLY one. Even a matcher that got its answer completely wrong could only mis-pick between
// raster suffixes, because no other string is spellable as an `ImageSuffix`. That is the whole
// security property, and it is a consequence of the return type rather than of care taken here.
//
// THIS IS SIGNATURE MATCHING, NOT IMAGE VALIDATION, and it must not become image validation. A file
// whose header matches PNG and whose remainder is garbage is a corrupt image, which is the OS
// viewer's problem and not a security one — the handler is still an image handler.
//
// SVG IS DELIBERATELY EXCLUDED even though it appears in the upload-side MIME map. It has no byte
// signature (it is XML, recognisable only by heuristics), and the OS default handler for it is
// routinely a browser, which executes script inside it. A raster-only set is what makes "open in the
// default handler" a safe sentence, so widening this set is a security decision and not a feature.
//
// PURE, SYNCHRONOUS, TOTAL and dependency-free: no import of any kind (pinned by a test), no
// filesystem call, no state, and LOG-FREE by construction — attachmentPath.ts's register.

/**
 * How many leading bytes decide every member of the set below. The widest member is WebP, whose
 * `WEBP` form tag ends at byte 11, so twelve is exact rather than generous.
 *
 * This is what lets the driver read a PREFIX rather than a file. Attachments are bounded at ~23 MB
 * each; reading one whole to look at twelve bytes would be a regression against both landed
 * siblings' care, and it is also why this path needs no concurrency cap the way attachmentBytes does.
 */
export const SIGNATURE_PREFIX_BYTES = 12

/**
 * The closed set of suffixes this app is willing to give a derived file. Four raster image types,
 * every one of which opens in a viewer rather than by executing.
 *
 * THE MEMBERS ARE THE SECURITY BOUNDARY. Adding one is a decision about which OS default handler the
 * app is willing to hand a daemon-supplied file to — see the SVG paragraph above for the shape of
 * that argument. A test reads these literals off this declaration for exactly that reason.
 */
export type ImageSuffix = '.png' | '.jpg' | '.gif' | '.webp'

/** One member: the suffix it earns, and the byte runs that must all match at their offsets. */
interface Signature {
  suffix: ImageSuffix
  runs: { offset: number; bytes: number[] }[]
}

/**
 * The table, in the order it is tried. Order carries no meaning — no two members can match one
 * input, since their byte-0 runs are pairwise distinct — so it is written widest-first only to read
 * in the same order as the doc comment above.
 *
 * WebP takes TWO runs, and both are load-bearing: `RIFF` alone is a container magic shared with
 * `.wav` and `.avi`, so matching on it would suffix an audio file `.webp` and hand it to an image
 * handler. The four bytes between them are a little-endian chunk length, which is content and is
 * therefore not matched.
 */
const SIGNATURES: Signature[] = [
  {
    suffix: '.webp',
    runs: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }
    ]
  },
  { suffix: '.png', runs: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  // GIF87a and GIF89a are two spellings of one type, so they earn one suffix rather than two members
  // of ImageSuffix — the version digit is the only byte that differs.
  { suffix: '.gif', runs: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }] },
  { suffix: '.gif', runs: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }] },
  // SOI plus the first byte of the following marker. Every JPEG variant — JFIF, Exif, raw — starts
  // this way, and three bytes is the whole of what is common to them.
  { suffix: '.jpg', runs: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] }
]

/**
 * Answer the suffix `prefix`'s leading bytes earn, or `null` if they match no member.
 *
 * `prefix` is the file's first `SIGNATURE_PREFIX_BYTES` bytes, or fewer when the file is shorter —
 * a short read is not an error here. Every run must fit entirely within what actually arrived, so a
 * truncated signature matches nothing, and an empty prefix matches nothing.
 *
 * `null` means REFUSE, not "unknown type to be guessed at downstream": AC 3 requires a file whose
 * leading bytes match no member to be refused rather than opened, whatever it claims to be.
 *
 * Total and throw-free: every path is an index comparison over a plain array.
 */
export function matchImageSignature(prefix: Uint8Array): ImageSuffix | null {
  for (const signature of SIGNATURES) {
    if (signature.runs.every((run) => matchesRun(prefix, run.offset, run.bytes))) {
      return signature.suffix
    }
  }
  return null
}

/** True when `bytes` sits at `offset` in `prefix` in full. A run that would read past the end of
 *  what arrived is a non-match, never a partial one — that is what refuses a truncated signature. */
function matchesRun(prefix: Uint8Array, offset: number, bytes: number[]): boolean {
  if (prefix.length < offset + bytes.length) return false
  return bytes.every((byte, index) => prefix[offset + index] === byte)
}
