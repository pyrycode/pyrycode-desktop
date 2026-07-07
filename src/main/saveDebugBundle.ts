// Persists a reassembled debug-bundle archive (opaque .tar.gz bytes from #116) to a directory,
// using node:fs/promises only. Zero project imports, so its test module graph is Electron-free.
//
// The production `dir` is app.getPath('downloads'), computed by the orchestrating command (#118)
// — NOT here, so this module carries no `app` import and unit-tests against a temp dir. This is
// the inverse of fileSecretPersistence: that module overwrites one name in place (temp-then-rename
// for an atomic replace); this one must NEVER overwrite, so it picks a fresh, collision-free name
// with an exclusive-create write (flag: 'wx').
import { writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'

/** True for a Node fs error carrying an errno `code` (ENOENT, EEXIST, EACCES, …). */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

// Filename parts are module constants — never derived from `bytes` or any daemon field — so no
// untrusted input ever reaches a path segment and traversal is structurally impossible.
const STEM = 'pyrycode-debug-bundle'
const EXT = '.tar.gz'

// Loop-termination insurance against a pathological all-names-taken directory; not a defence
// against an observed attack. Any generous constant works.
const MAX_ATTEMPTS = 10_000

// Candidate 0 -> "pyrycode-debug-bundle.tar.gz"; n >= 1 -> "pyrycode-debug-bundle (n).tar.gz"
// (browser-style next-available integer suffix).
function candidateName(n: number): string {
  return n === 0 ? `${STEM}${EXT}` : `${STEM} (${n})${EXT}`
}

/**
 * Write `bytes` verbatim into `dir` under a collision-free `.tar.gz` filename with owner-only
 * (0o600) permissions, and resolve the absolute path written.
 *
 * `flag: 'wx'` (O_CREAT | O_EXCL | O_WRONLY) makes each attempt create-exclusive: if the name
 * already exists the OS rejects with EEXIST atomically — that single syscall is both the
 * no-overwrite guarantee and the collision-race close, with no existsSync-then-write TOCTOU gap.
 * On EEXIST we advance to the next candidate; any other errno rejects (after a best-effort unlink
 * of a possible partial), so the caller (#118) can catch and map it to a user-facing error. The
 * module never overwrites, never creates `dir`, and emits no logs — `bytes` never enters an Error.
 *
 * On Windows the 0o600 mode is largely ignored; the per-user profile ACL on the downloads folder
 * is the control there (called out in the AC, not worked around).
 */
export async function saveDebugBundle(dir: string, bytes: Uint8Array): Promise<string> {
  for (let n = 0; n < MAX_ATTEMPTS; n += 1) {
    const target = resolve(dir, candidateName(n))
    try {
      await writeFile(target, bytes, { flag: 'wx', mode: 0o600 })
      return target
    } catch (err) {
      if (isErrnoException(err) && err.code === 'EEXIST') continue
      // Non-collision failure: clear a possible partial file, then re-throw the original errno.
      await unlink(target).catch(() => undefined)
      throw err
    }
  }
  throw new Error(`saveDebugBundle: no free filename after ${MAX_ATTEMPTS} attempts in ${dir}`)
}
