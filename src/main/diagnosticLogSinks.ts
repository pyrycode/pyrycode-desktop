// The two DiagnosticSink adapters for the content-free logger (diagnosticLog.ts). Selected at the
// composition root by app.isPackaged: stdout in dev, a rotating file in a packaged build. Only
// node:fs / node:path — no Electron import, so both unit-test against a temp dir / capture writer.
//
// The file sink REUSES fileSecretPersistence.ts's disk patterns — injected `dir`, owner-only 0o700
// dir + 0o600 file, the isErrnoException typed-errno guard, open/stat-then-handle-ENOENT (no
// existsSync, no TOCTOU). It does NOT copy that module's whole-file temp-then-rename write: a log
// sink APPENDS and rotates by size, a different write shape, and it uses the SYNCHRONOUS fs variants
// so `event()` is ordered and non-interleaving with no rotation race and no buffered tail lost on
// app.quit (see diagnosticLog.ts § concurrency). The filenames are the static literals main.log /
// main.log.N — derived from no event field, so there is not even an encoded-name traversal surface.
import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { DiagnosticSink } from './diagnosticLog'

/** True for a Node fs error carrying an errno `code` (ENOENT, EACCES, …). Reused shape from
 *  fileSecretPersistence.ts. */
function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err
}

/**
 * A sink that writes one record per line to the injected writer, defaulting to process.stdout. The
 * injected writer is the test seam (capture into an array). It appends the line separator the core
 * deliberately omits, so both sinks agree on "one serialized record, then a newline".
 */
export function stdoutSink(
  write: (chunk: string) => void = process.stdout.write.bind(process.stdout)
): DiagnosticSink {
  return {
    write(line: string): void {
      write(line + '\n')
    }
  }
}

// ~5 MiB per file, ~5 rotated files. The INVARIANT (bounded file count, oldest discarded) is what
// matters; these numbers are sane defaults. Tests drive tiny values to exercise rotation quickly.
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const DEFAULT_MAX_FILES = 5

/**
 * A sink that appends records to `dir/main.log` and rotates by size with bounded retention. Before an
 * append that would push `main.log` past `maxBytes`, it rename-shifts main.log → .1 → … → .maxFiles
 * and discards the old .maxFiles, so at most `maxFiles` rotated files plus the active log ever exist
 * — the file set never grows unbounded (AC2). All fs is synchronous, so each record lands durably in
 * seq order with no interleaving and no rotation race.
 */
export function fileRotatingSink(
  dir: string,
  opts?: { maxBytes?: number; maxFiles?: number }
): DiagnosticSink {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
  const maxFiles = opts?.maxFiles ?? DEFAULT_MAX_FILES
  const active = join(dir, 'main.log')

  // statSync the active file; a not-yet-created file is size 0 (open-then-handle-ENOENT, no
  // existsSync TOCTOU). Any other fs error propagates and is swallowed by the core's try/catch.
  function activeSize(): number {
    try {
      return statSync(active).size
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') return 0
      throw err
    }
  }

  // Rename a rotated file, treating a missing source as a no-op (a gap in the .1…N chain is fine —
  // e.g. before enough writes exist to fill every slot).
  function renameIfPresent(from: string, to: string): void {
    try {
      renameSync(from, to)
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') return
      throw err
    }
  }

  // Discard a file, treating absence as a no-op.
  function unlinkIfPresent(path: string): void {
    try {
      unlinkSync(path)
    } catch (err) {
      if (isErrnoException(err) && err.code === 'ENOENT') return
      throw err
    }
  }

  // Discard the oldest, then shift .（maxFiles-1) → .maxFiles, …, .1 → .2, main.log → .1, leaving a
  // fresh (absent) main.log for the pending append to create.
  function rotate(): void {
    unlinkIfPresent(`${active}.${maxFiles}`)
    for (let i = maxFiles - 1; i >= 1; i -= 1) {
      renameIfPresent(`${active}.${i}`, `${active}.${i + 1}`)
    }
    renameIfPresent(active, `${active}.1`)
  }

  return {
    write(line: string): void {
      // Owner-only dir, created lazily on write (recursive:true makes an existing dir a no-op).
      // Mirrors fileSecretPersistence; on Windows the mode is largely ignored (userData is per-user).
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const entry = line + '\n'
      const size = activeSize()
      // Rotate only when main.log already holds content AND this entry would push it past the cap —
      // so a lone entry larger than maxBytes still lands (rotation can't make it fit) and an empty
      // log is never rotated. appendFileSync applies the 0o600 mode only when it creates the file.
      if (size > 0 && size + Buffer.byteLength(entry) > maxBytes) rotate()
      appendFileSync(active, entry, { mode: 0o600 })
    }
  }
}
