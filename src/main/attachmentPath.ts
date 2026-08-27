// The attachment-identifier → path gate. The renderer never passes a path: it passes an attachment
// identifier, and the background process turns that identifier into a file path. This module is that
// translation, and it is the last owner of the check — the daemon documents its 64-byte
// `attachment_id` ceiling as explicitly NOT a defence and assigns the real check to whoever turns the
// id into a path component (`internal/protocol/attachments.go`). On this side, that is here.
//
// It does one job and stops: test the identifier against the canonical shape, then resolve it against
// a base directory the composition root supplies. The identifier is untrusted — it reaches the main
// process over IPC from a renderer that is untrusted relative to it, and upstream it originates on the
// wire — so it may carry `..`, a separator, or an absolute path. It is REFUSED, never rewritten:
// fileSecretPersistence's base64url-encoding closes traversal by construction because that module also
// owns the write; this one owns no write, so rewriting would fix an on-disk name that #687 has no
// design to agree with. Both consumers (#814 save-to-Downloads, #691 open-in-viewer) say "refuse" in
// their own acceptance criteria.
//
// `baseDir` is a PARAMETER, not a constant — the same composition-root seam saveDebugBundle.ts and
// fileSecretPersistence.ts use — so this module carries no `electron` import and its test module graph
// is Electron-free (pinned by a test, not by this paragraph). It is a PURE, SYNCHRONOUS, TOTAL
// function: no filesystem call of any kind, no async, no state, nothing to cancel — and LOG-FREE by
// construction (no console.*; the reason is a fixed value-free category, never the identifier, which
// would otherwise be a log-injection vector).
import { resolve } from 'node:path'

/**
 * Discriminated result. Success carries the resolved absolute path; failure carries only a value-free
 * category — never a path, never the identifier. A union rather than a nullable string, so a consumer
 * cannot use a failure as a path by forgetting a check.
 */
export type ResolveAttachmentPathResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'not-canonical-id' }

/**
 * The canonical attachment-identifier shape: lowercase hex digits and ASCII hyphen-minus, 1–64
 * characters. Every guarantee this module makes is a consequence of this one line, so it ships at its
 * narrowest — widening it later is backward-compatible, narrowing it is not.
 *
 * - Traversal is structurally impossible rather than merely checked: no `.` (so `..` and any dotted
 *   variant are unspellable), no `/` or `\` (no separator), no `:` (no drive-relative `c:foo`, no UNC
 *   prefix). A passing identifier names exactly one path component, and that component is itself.
 * - The ceiling is the daemon's `MaxAttachmentIDBytes`, exactly: the alphabet is ASCII, so 64
 *   characters IS 64 bytes with no UTF-8 surprise in between.
 * - It admits both plausible daemon shapes and nothing else — a canonical lowercase UUIDv4 (36 chars)
 *   and a 64-character hex token — which is the narrowest shape that survives either choice.
 * - It is case-unambiguous, and that matters more here than on the daemon: APFS and NTFS are both
 *   case-insensitive by default, so a mixed-case alphabet would let two DISTINCT identifiers resolve
 *   to one file on this app's primary platforms, cross-contaminating #687's writes. `_` is absent for
 *   the same reason — it would only serve a base64url-style id, which is mixed-case.
 * - No Windows reserved device name (`con`, `prn`, `aux`, `nul`, `com1`, `lpt1`) is spellable; each
 *   carries at least one character outside the alphabet. That falls out for free.
 * - The empty identifier is refused by the lower bound: `resolve(base, '')` is `base` itself, which
 *   would hand a consumer the attachment DIRECTORY where it expected a file.
 */
const CANONICAL_ATTACHMENT_ID = /^[0-9a-f-]{1,64}$/

/**
 * Resolve an untrusted `attachmentId` to an absolute path confined inside `baseDir`, or refuse it.
 *
 * `baseDir` is TRUSTED input from the composition root; `attachmentId` is UNTRUSTED input from the
 * renderer. The two carry different trust levels and the same type, so the distinction can only be
 * said here. `baseDir` is deliberately not validated — no validator can tell a right directory from a
 * wrong one — and containment is guaranteed relative to whatever base is given; a relative one is
 * anchored at process.cwd() by `resolve`, exactly as saveDebugBundle documents. Each consumer's
 * composition root owns passing an absolute app.getPath('userData')-derived path, computed there and
 * never from anything the renderer sent.
 *
 * Containment is STRUCTURAL, not checked: it follows from the alphabet above, so there is no prefix or
 * relative-path post-condition here — such a branch is unreachable without first bypassing the shape
 * test, and dead code that reads as diligence is worse than none. There is deliberately no filesystem
 * resolution either: the attachment directory is single-principal and app-owned, this module creates
 * nothing, and a `realpath` here would be unsound as well as unnecessary — it needs the path to exist
 * (conflating "escapes" with "not downloaded yet"), and whatever it resolved could be re-symlinked in
 * the gap before the consumer's own open. That answer changes if the directory ever becomes shared
 * between principals, if a consumer opens a path it did not resolve through here, or if the alphabet
 * ever admits `.`.
 *
 * The returned path is a direct child of `baseDir` named by the identifier verbatim, with no
 * extension. The module makes no filesystem claim about what is at that path — it never looks.
 *
 * Pure, synchronous, total, throw-free: `resolve` on a single validated component cannot throw, and
 * there is no other call.
 */
export function resolveAttachmentPath(
  baseDir: string,
  attachmentId: string
): ResolveAttachmentPathResult {
  if (!CANONICAL_ATTACHMENT_ID.test(attachmentId)) {
    return reject('not-canonical-id')
  }
  return { ok: true, path: resolve(baseDir, attachmentId) }
}

/** Build a reject arm. Isolated so the "no identifier ever reaches a reason" property stays structural. */
function reject(reason: 'not-canonical-id'): ResolveAttachmentPathResult {
  return { ok: false, reason }
}
