// The real SecretPersistence: one ciphertext file per secret under `dir`, using node:fs/promises
// only. It is the sole module that touches the filesystem, so its test graph is Electron-free.
//
// The production `dir` is join(app.getPath('userData'), 'secrets'), computed by the composition
// root when a consumer wires the store (#43/#44) — NOT here, so this adapter needs no `app` import
// and unit-tests against a temp dir.
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { SecretPersistence } from './secureStore'

/** True for a Node fs error carrying an errno `code` (ENOENT, EACCES, …). */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

/**
 * A SecretPersistence rooted at `dir`. The secret name is never used verbatim as a path segment:
 * it is base64url-encoded (alphabet [A-Za-z0-9_-], no `/`, `.`, or `..`) before becoming a
 * filename, so a name like "../../etc/passwd" maps to an inert token inside `dir` — path traversal
 * is closed structurally, not by validation.
 */
export function fileSecretPersistence(dir: string): SecretPersistence {
  function fileFor(name: string): string {
    const encoded = Buffer.from(name, 'utf8').toString('base64url')
    return join(dir, `${encoded}.bin`)
  }

  return {
    async read(name) {
      try {
        // Open-then-handle-ENOENT — no existsSync-then-read TOCTOU gap.
        return new Uint8Array(await readFile(fileFor(name)))
      } catch (err) {
        if (isErrnoException(err) && err.code === 'ENOENT') return null
        throw err
      }
    },

    async write(name, bytes) {
      // Owner-only dir (POSIX; on Windows mode is largely ignored — userData is already per-user
      // ACL'd). recursive:true makes an existing dir a no-op.
      await mkdir(dir, { recursive: true, mode: 0o700 })
      const target = fileFor(name)
      // Unique temp suffix so two concurrent writes to the same name never share a temp path.
      const tmp = `${target}.${randomBytes(6).toString('hex')}.tmp`
      try {
        await writeFile(tmp, bytes, { mode: 0o600 })
        // Atomic on the same filesystem: a crash mid-write leaves the prior file intact or the new
        // file whole — never a truncated secret.
        await rename(tmp, target)
      } catch (err) {
        // Best-effort cleanup of the temp on failure; swallow the unlink error, throw the original.
        await unlink(tmp).catch(() => undefined)
        throw err
      }
    },

    async delete(name) {
      try {
        await unlink(fileFor(name))
      } catch (err) {
        if (isErrnoException(err) && err.code === 'ENOENT') return
        throw err
      }
    }
  }
}
