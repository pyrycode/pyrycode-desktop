# Spec — Save a debug-bundle archive to the downloads folder (#117)

**Size:** S (one new leaf module + its unit test; no consumer cascade — the consumer is #118).

## Files to read first

- `src/main/fileSecretPersistence.ts:1-68` — the precedent adapter this module mirrors: `node:fs/promises`-only, Electron-free, the `isErrnoException` errno-typing helper (copy it verbatim), `writeFile(..., { mode: 0o600 })`, and an injected `dir` so the test graph carries no `electron` import. **Two deliberate divergences** — see *Design § Divergences from the precedent*.
- `src/main/fileSecretPersistence.test.ts:1-93` — the test harness to mirror: a `freshDir()` helper + `afterEach` `rm(root, { recursive: true, force: true })`, the `it.runIf(process.platform !== 'win32')` guard on the permissions assertion, and byte-array round-trip via `Array.from(...)`.
- `CLAUDE.md` (repo root) — main-process-only rule, `node:fs/promises` only, test-first, no Electron/DOM in this module or its test graph. Note the memory item: `@shared/*` alias is unavailable under `src/main` — but this module imports nothing from `shared` (only `node:*`), so the point is moot here.
- `docs/specs/architecture/115-send-debug-bundle-request.md` (optional) — sibling slice, for feature framing only. #115 sends the request, #116 reassembles the bytes, **#117 (this) persists them**, #118 orchestrates all three. This slice is independent: bytes in → path out.

## Context

The persistence slice of the client debug-bundle feature (split from #71). Given the reassembled opaque `.tar.gz` bytes (produced by sibling #116), write them to the OS downloads folder as a file the user can open or share. The slice takes bytes + a target dir and returns the written path, so it is built and unit-tested on its own against a temp dir — no transport, no Electron.

A user-chosen path via a native save dialog is **out of scope** (deferred). The deterministic downloads-folder target is the simplest thing that keeps the slice unit-testable and satisfies the parent intent.

The bundle is the **highest-value secret surface in the system** (recent daemon logs + terminal recording), so file placement and permissions are a security design decision — see the `## Security review` section (this ticket is `security-sensitive`).

## Design

### Module

New module `src/main/saveDebugBundle.ts` (sibling to `fileSecretPersistence.ts`). It is **not** wire-codec work, so it does **not** go under `src/main/transport/`. It imports only `node:fs/promises` and `node:path` — zero project imports, so its test module graph is Electron-free by construction.

### Public contract

```ts
// src/main/saveDebugBundle.ts
export function saveDebugBundle(dir: string, bytes: Uint8Array): Promise<string>
```

Writes `bytes` **verbatim** into `dir` under a collision-free `.tar.gz` filename with owner-only (`0o600`) permissions, and resolves the **absolute** path written. Rejects with the underlying errno error on any non-collision failure. This is the only export (no new type; the return is `Promise<string>`). `Uint8Array` accepts both `Uint8Array` and `Buffer`, matching the precedent's `write(name, bytes)` shape.

`dir` is a **parameter injected by the composition root** — the production value `app.getPath('downloads')` is computed by the orchestrating command (#118), not here, so this module carries no `electron`/`app` dependency. This mirrors the Electron-free seam of `fileSecretPersistence.ts`, whose production `dir` is likewise computed by its consumer.

### Filename + collision strategy

- Stem constant `pyrycode-debug-bundle`, extension `.tar.gz` (module constants, **not** derived from `bytes` or any daemon field — so no untrusted input ever reaches a path segment; path traversal is structurally impossible here, unlike the precedent which base64url-encodes an arbitrary name).
- Candidate `n`: `n === 0` → `pyrycode-debug-bundle.tar.gz`; `n ≥ 1` → `pyrycode-debug-bundle (n).tar.gz` (browser-style next-available integer suffix).

### Write algorithm (behaviour, not code — developer writes the body)

- Iterate candidates `n = 0, 1, 2, …` in a **bounded** loop; for each: `writeFile(resolve(dir, name), bytes, { flag: 'wx', mode: 0o600 })`.
  - `flag: 'wx'` = `O_CREAT | O_EXCL | O_WRONLY`: **create-exclusive**. If the name already exists, `writeFile` rejects with `EEXIST` — the OS enforces no-clobber atomically, with **no `existsSync`-then-write TOCTOU gap**. This single syscall is both the no-overwrite guarantee and the collision-race close.
  - On `EEXIST` → advance to the next candidate (not surfaced as an error).
  - On any **other** errno → best-effort `unlink(candidate).catch(() => undefined)` to clear a possible partial file, then re-throw the original error.
  - On success → resolve `resolve(dir, name)`.
- `resolve(dir, name)` (not `join`) guarantees the returned path is **absolute** even if a relative `dir` is ever passed; the same resolved string is what we open, so the returned path is exactly what was written.
- **Loop bound:** cap `n` at a constant (`MAX_ATTEMPTS`, e.g. `10_000`) and throw a typed `Error` if exhausted, so the loop can never hang on a pathological all-names-taken directory. The exhaustion error is itself a catchable rejection (satisfies the "caller can catch" AC in the degenerate case too). This is loop-termination insurance, not a defence against an observed attack.

### Divergences from the precedent (the elegance call)

The requirement here is the **inverse** of `fileSecretPersistence`, so the mechanism inverts — don't copy the precedent's temp-then-rename blindly:

1. **Exclusive-create, not temp-then-`rename`.** The precedent overwrites the *same* name in place, so it needs `writeFile(tmp)` + `rename(tmp, target)` for an atomic replace. This module must **never** overwrite and must pick a **fresh** name, so `flag: 'wx'` is the right primitive — it prevents clobber and closes the collision race in one syscall. Temp-then-rename would (a) **reintroduce a race** (pick next-free name → rename, with a gap that `rename` clobbers through) and (b) drop a `.tmp` sibling into the *user-visible* downloads folder. **Accepted tradeoff:** a crash mid-write can leave a partial `.tar.gz` at the final visible name. That is a re-triggerable broken download, not a corrupted secret store — nothing reads the bundle back — so atomicity is deliberately not worth the `.tmp` UX wrinkle. (No crash-mid-write failure has been observed; per evidence-based fix selection we don't add temp-then-rename to defend it.)
2. **No `mkdir`/`chmod` on the directory.** The downloads folder pre-exists and is user-owned; the `0o600` **file** mode is the confidentiality control, not a dir mode. The precedent creates its `secrets/` subdir `0o700`; this module must not, and a non-existent `dir` must **reject** (not be silently created) — pinned by a test.

## State + concurrency model

- No store slice, no async task lifecycle, no listeners, no sockets. A pure leaf function; the orchestrating command (#118) owns any progress state and cancellation of the overall download.
- No `AbortController`: a single `writeFile` is not a long-lived task. Cancellation of the end-to-end flow lives at #118, not here.
- **Concurrent-call safety:** two overlapping calls in the same process (or another process writing the same base name) cannot collide destructively — `flag: 'wx'` makes the loser observe `EEXIST` and deterministically advance to the next name. Distinct inputs → distinct files, guaranteed by the OS, no app-level lock.

## Error handling

| Layer / failure | errno | Result to caller |
| --- | --- | --- |
| Candidate name already exists | `EEXIST` | Internal retry — **not** surfaced |
| `dir` missing / not a directory | `ENOENT` / `ENOTDIR` | Rejected promise (caller maps to user-facing error) |
| No write permission on `dir` | `EACCES` / `EPERM` | Rejected promise |
| Disk full mid-write | `ENOSPC` | Best-effort `unlink` of the partial, then rejected promise |
| All `MAX_ATTEMPTS` names taken | — | Typed `Error`, rejected promise |

- Every failure is a **catchable rejection** of the async function — no raw, unhandled throw escapes the module.
- **No log line or rejection value carries byte values.** The module emits no logs of its own (user-facing progress/logging is #118's job). The only identifiers in an errno error are the `code` and the destination path — which is the user's own new download path, not sensitive. `bytes` never appears in any `Error`.

## Testing strategy

`npm test` (vitest), against a throwaway temp dir, Electron-free — mirror `fileSecretPersistence.test.ts` (a `freshDir()` helper + `afterEach` cleanup). Scenarios (developer writes the bodies in the project idiom):

- **Round-trip verbatim** — write bytes including edge values (`0x00, 0x80, 0xFF, 0x7F`) to a fresh temp dir; `readFile` the returned path; assert byte-for-byte equal. Assert the returned path `isAbsolute` and its dirname is the temp dir.
- **Collision → two distinct files** — two successive saves of *different* payloads into the same dir: assert the two returned paths differ, both files exist, file 1 still equals payload 1 (**not overwritten**), file 2 equals payload 2. A third save confirms the suffix sequence advances (` (1)`, ` (2)`). Assert on the *returned* paths, not on predicted names.
- **Owner-only permissions** (`it.runIf(process.platform !== 'win32')`) — `stat(path).mode & 0o777 === 0o600`. On Windows the mode is largely ignored; the test is skipped, and the AC calls that out rather than working around it.
- **Write failure rejects** — pass a `dir` that does not exist (or is a regular file): `await expect(saveDebugBundle(badDir, bytes)).rejects.toThrow()` carrying an errno `code`; assert the rejection message contains no byte values.
- **Does NOT create the dir** — a non-existent `dir` must reject (`ENOENT`/`ENOTDIR`), not silently `mkdir`. Pins the divergence from the precedent.
- **Empty payload** — `new Uint8Array(0)` writes a 0-byte file, returns a path, reads back empty (defensive; the module never inspects contents).

Type coverage via `npm run typecheck`: signature `Promise<string>`, `Uint8Array` in.

## Open questions

- **Umask vs. `0o600`.** Like the precedent, the file mode passed to `writeFile` is subject to the process umask; typical umasks (022/027) don't clear owner bits, so `0o600` survives — the precedent's perms test passes on exactly this basis. An explicit `chmod(path, 0o600)` after create would close a hostile-umask edge, but that's unobserved; mirror the precedent and rely on the `mode` arg.
- **`MAX_ATTEMPTS` value.** Any generous constant works (only guards a pathological all-names-taken loop); developer's call.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. Two inputs: `bytes` (in-process, from #116 reassembly, in the main process) and `dir` (from the composition root, `app.getPath('downloads')`, trusted). Neither is renderer-controlled. The bytes are the **opaque** tarball — written **verbatim**, never parsed, unpacked, or executed here (#116 owns any structural handling). No untrusted-to-trusted boundary is crossed inside this module.
- **[File / storage — path traversal]** No findings. The filename is a **module constant** (`pyrycode-debug-bundle`), never derived from `bytes` or any daemon field, so no untrusted segment is ever concatenated into a path. `resolve(dir, constant)` stays inside the injected `dir`. Traversal is structurally impossible (this module needs no base64url-encoding step because, unlike the precedent, it never takes an attacker-influenced name).
- **[File / storage — TOCTOU]** No findings. `flag: 'wx'` (`O_CREAT | O_EXCL`) is create-exclusive; there is **no** `existsSync`-then-write gap. The OS atomically fails with `EEXIST` if the name exists, which is exactly the no-clobber guarantee (cf. `pyrycode` #95 Pool.Remove wrapping `ErrExist` rather than clobbering).
- **[File / storage — atomic write]** SHOULD-note (accepted design decision, not a gate). This module **deliberately does not** temp-then-`rename` (unlike the precedent). A crash mid-write can leave a partial `.tar.gz` at the visible name. Accepted because (a) the bundle is never read back by the system — a partial file is a re-triggerable broken download, not a corrupted secret store; and (b) temp-then-rename into a next-available name reintroduces a clobber race and litters a `.tmp` file into the user-visible downloads folder. Documented in *Design § Divergences*.
- **[File / storage — encryption at rest]** No findings (intentional plaintext-at-rest). The bundle is **deliberately not** `safeStorage`-encrypted: the user story requires a portable `.tar.gz` the user can open or share, and OS-keychain-bound encryption would make it un-openable off this machine. Confidentiality at rest is provided by the `0o600` file mode (owner-only on POSIX) plus the user's custody of their own downloads folder. On Windows `0o600` is largely ignored; the per-user profile ACL on the Downloads folder is the control there (called out in the AC, not worked around).
- **[File / storage — storage scope]** SHOULD-note / OUT OF SCOPE. The downloads folder can be user-configured as a cloud-synced folder (Dropbox/OneDrive), in which case the bundle leaves the machine on save. Inherent to this ticket's downloads-folder scope; the deferred user-chosen-path variant would let the user target a non-synced location. Accepted as a ticket-scoped residual — the save is an explicit, user-initiated action that materialises the evidence archive as a shareable file by design.
- **[Error messages / logs]** No findings. The module emits **no logs** (user-facing progress is #118's). Rejections carry only the errno `code` and the destination path (the user's own new download path — not sensitive); `bytes` never enters any `Error`. Pinned by the "rejection message contains no byte values" test.
- **[Inter-process / Electron attack surface]** No findings. This module adds no IPC channel, no `BrowserWindow`, no `contextBridge` API, and no custom-protocol handler. It carries no `electron` import; the composition root (#118) supplies `dir`.
- **[Cryptographic primitives]** N/A. No crypto in this module. Confidentiality-in-transit was provided by the Noise session upstream; at-rest confidentiality is the `0o600` file mode (see encryption-at-rest above), not a hand-rolled scheme.
- **[Network & I/O]** N/A. No network. Frame-size / oversized-bundle limits are enforced **upstream** at the transport `maxPayload` and #116 reassembly; this module receives already-bounded bytes and, even for a very large payload, degrades gracefully to an `ENOSPC` rejected promise rather than corrupting state. If #116 does not cap reassembled size, that is a #116 finding — OUT OF SCOPE here.
- **[Concurrency]** No findings. Pure leaf function: no shared mutable state, no listeners, no long-lived task. Two concurrent calls cannot collide destructively — `flag: 'wx'` makes the loser see `EEXIST` and advance to a fresh name. No `AbortController` needed (single `writeFile`; the flow's cancellation lives at #118).
- **[Threat model alignment]** Token-theft-from-disk: the bundle is high-value; on-disk protection is `0o600` (blocks *other* local users). An attacker already running as the user can read it — inherent and out of scope. Hostile daemon response: the bytes are opaque and written verbatim, never parsed here; oversized-payload exhaustion is bounded upstream (see Network & I/O). Renderer compromise: this module has no renderer reach.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
