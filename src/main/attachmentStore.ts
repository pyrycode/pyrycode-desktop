// Puts one verified attachment on this machine, and answers the question three other tickets and one
// shipped spec were waiting on: WHERE a fetched attachment lives. The answer, in full, because #814
// (save into Downloads), #866 (deliver bytes to the window) and #867 (open in the OS viewer) each say
// the directory is established here, and 818-attachment-identifier-path-resolution.md records the
// on-disk shape as an open question of #687's:
//
//   - an APP-PRIVATE DIRECTORY whose absolute path the composition root derives from Electron's
//     per-user app-data location, never from anything the window sent;
//   - A FLAT FILE, NOT A PER-ATTACHMENT DIRECTORY — the choice #818 left open — at the path
//     resolveAttachmentPath returns: a direct child named by the identifier verbatim, NO EXTENSION;
//   - the directory created on first write, owner-only; the file written owner-only.
//
// THE STORED FILE IS DELIBERATELY EXTENSION-LESS, and that is a commitment other tickets read:
// nothing about an attachment's type may be inferred from its on-disk name (#867 owns the
// consequences for opening one in the OS). `filename` and `mime_type` ride every chunk and are
// display strings only — neither may reach a path segment, and #814's Downloads copy takes its name
// from the wire through sanitizeAttachmentFilename, never from this on-disk name.
//
// THE ESCAPE CHECK IS resolveAttachmentPath's AND THERE IS NO SECOND ONE. That module's own doc
// comment names this ticket as the writer it was built for and explains why it refuses rather than
// rewrites; two divergent escape checks on one directory is exactly the shape that ends with one of
// them being weaker than the other.
//
// WHAT IS NOT COPIED FROM saveDebugBundle.ts: its exclusive-create no-overwrite rule. That exists to
// protect a user-facing Downloads name, whereas this path is content-addressed by identifier, so
// re-fetching the same attachment must land on the SAME file rather than accumulate suffixed copies.
// The recipe here is fileSecretPersistence's instead — mkdir recursive owner-only, write to a
// uniquely-suffixed temp path, rename onto the target, unlink the temp on failure — which is what
// makes "no partial file" true rather than merely intended.
//
// The composition-root seam is saveDebugBundle's: `baseDir` is a PARAMETER, so this module carries no
// `electron` import and its test graph is Electron-free (pinned by a test, not by this paragraph).
// The app.getPath('userData') call stays at the composition-root edge, where #996 joins
// ATTACHMENT_DIR_NAME onto it.
//
// MAIN-PROCESS ONLY, and LOG-FREE by construction: it writes a user's decrypted file bytes, so
// nothing here logs a byte, a filename, a digest or a path.
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolveAttachmentPath } from './attachmentPath'

/**
 * The one directory name every composition root joins onto Electron's per-user app-data path, so the
 * four consumers of this store read one string rather than four that drift. It sits beside the
 * `secrets` and `logs` siblings already under userData.
 */
export const ATTACHMENT_DIR_NAME = 'attachments'

/**
 * Discriminated result. Success carries the absolute path written; failure carries only a static,
 * value-free reason — never a path, never the identifier, never an errno.
 *
 * ONE REASON ACROSS TWO BRANCHES, deliberately. A refused identifier and a failed write are separate
 * branches, and a consumer's answer to both is identical: the bytes are not on disk, do not present
 * the file. Splitting them would mint a distinction only this module can act on, and #995's own
 * technical notes are explicit that a further failure mode is merged into an existing reason rather
 * than given its own.
 */
export type StoreAttachmentResult = { ok: true; path: string } | { ok: false; reason: 'store-failed' }

/**
 * Write `bytes` for `attachmentId` under `baseDir`, and answer the absolute path written.
 *
 * `baseDir` is TRUSTED input from the composition root; `attachmentId` is UNTRUSTED in the same way
 * a wire field is, and the two carry different trust levels behind the same type, so the distinction
 * can only be said here. It should be the identifier THIS CLIENT ASKED FOR — the same value passed to
 * createAttachmentReassembler — never `chunk.attachment_id` read back off the wire. The two are
 * provably equal by the time a transfer completes, since the reassembler refuses a chunk naming a
 * different transfer, so this is a fragility to avoid rather than a hole to close.
 *
 * IT NEVER THROWS, and that is a containment decision rather than a style one: a node:fs
 * ErrnoException carries the offending path in its own message, and a caller that catches and logs
 * one would put an attachment path into a log AC 5 forbids one from reaching. Swallowing the errno
 * behind a static reason keeps that structural instead of resting on every future caller's discipline.
 *
 * `rename` RATHER THAN A DIRECT WRITE TO THE TARGET also closes a symlink redirect: rename REPLACES
 * whatever sits at the target, where a plain write would follow a symlink there and write through it.
 * The temp path is unguessable, so nothing can be pre-planted at that name either. saveDebugBundle
 * gets the same property from O_EXCL; it arrives here by a different route.
 *
 * The returned `path` is a RETURN VALUE, not something to log or forward: #814, #866 and #867 consume
 * it, and nothing may write it to a diagnostic record or send it to the window.
 */
export async function storeAttachment(
  baseDir: string,
  attachmentId: string,
  bytes: Uint8Array
): Promise<StoreAttachmentResult> {
  const resolved = resolveAttachmentPath(baseDir, attachmentId)
  if (!resolved.ok) return { ok: false, reason: 'store-failed' }
  const target = resolved.path

  // Unique temp suffix so two concurrent stores of one identifier never share a temp path; both then
  // land whole and the loser is simply replaced, which is the right answer for a content-addressed
  // file. randomBytes, not Math.random: collision avoidance, and the codebase's one RNG.
  const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
  try {
    // Owner-only dir (POSIX; on Windows mode is largely ignored — userData is already per-user
    // ACL'd). recursive:true makes an existing dir a no-op, and note it does NOT re-chmod one that
    // already exists: the 0o700 claim holds for a directory this call created.
    await mkdir(baseDir, { recursive: true, mode: 0o700 })
    await writeFile(tmp, bytes, { mode: 0o600 })
    // Atomic on the same filesystem: a crash mid-write leaves the prior file intact or the new file
    // whole — never a truncated attachment presented as a complete one.
    await rename(tmp, target)
    return { ok: true, path: target }
  } catch {
    // Best-effort cleanup of the temp, so a failed transfer leaves no partial artifact. Its own
    // failure is swallowed: there is nothing further to do and nothing safe to say about it.
    await unlink(tmp).catch(() => undefined)
    return { ok: false, reason: 'store-failed' }
  }
}
