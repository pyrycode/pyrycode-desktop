# Save debug bundle (persistence)

The **persistence leaf of the client debug-bundle download**: given the reassembled opaque `.tar.gz` bytes, write them verbatim into a directory as a file the user can open or share, and return the absolute path written. Pure `node:fs/promises` — bytes in, path out.

```ts
// src/main/saveDebugBundle.ts — MAIN-PROCESS ONLY
export function saveDebugBundle(dir: string, bytes: Uint8Array): Promise<string>
```

Introduced in [#117](../codebase/117.md). One of the three unblocked leaf slices of the [#71](https://github.com/pyrycode/pyrycode-desktop/issues/71) split: [#115](debug-bundle-request.md) sends the request, #116 reassembles the streamed bytes, **#117 (this) persists them**, and #118 is the renderer command that orchestrates #115→#116→#117. This slice is **transport-independent** — it takes bytes + a target dir and returns a path — so it is built and unit-tested on its own against a temp dir, with **no `electron` import** in its module graph.

The bundle is the **highest-value secret surface in the system** (recent daemon logs + terminal recording), so file placement and permissions are a security design decision — this ticket carried the `security-sensitive` label.

## What it does

`saveDebugBundle(dir, bytes)`:

- Writes `bytes` **verbatim** (the `.tar.gz` is opaque — never unpacked or inspected here; #116 owns any structural handling) into `dir` under a collision-free filename with **owner-only `0o600`** permissions.
- Resolves the **absolute** path written (`resolve(dir, name)`, so the return is absolute even if a relative `dir` is passed, and is exactly what was opened).
- **Never overwrites** an existing file, **never creates** `dir`, **emits no logs**, and **never puts `bytes` into an `Error`**.

## The composition-root seam — injected `dir`, no `electron` import

`dir` is a **parameter injected by the composition root**, not computed here. The production value is `app.getPath('downloads')`, computed by the orchestrating command (#118). This keeps the module free of any `electron`/`app` dependency, so its test module graph is Electron-free by construction (only `node:fs/promises` + `node:path`) — the exact same seam [`fileSecretPersistence`](secure-store.md) uses, whose production `dir` is likewise supplied by its consumer.

## The load-bearing decision — exclusive-create, the inverse of the precedent

This module mirrors [`fileSecretPersistence.ts`](secure-store.md) (the "sensitive bytes → disk" precedent) but **inverts its mechanism**, because the requirement is the inverse:

| | `fileSecretPersistence` (precedent) | `saveDebugBundle` (this) |
|---|---|---|
| Requirement | Overwrite one fixed name **in place** | **Never** overwrite; pick a **fresh** name |
| Primitive | `writeFile(tmp)` + `rename(tmp, target)` (atomic replace) | `writeFile(name, bytes, { flag: 'wx', mode: 0o600 })` (create-exclusive) |
| Directory | `mkdir(dir, { recursive: true, mode: 0o700 })` | **no** `mkdir`/`chmod` — downloads folder pre-exists, is user-owned |
| Name source | base64url-encodes an arbitrary caller name | **module constant** `pyrycode-debug-bundle` — no untrusted segment |

`flag: 'wx'` = `O_CREAT | O_EXCL | O_WRONLY`. If the candidate name already exists, the OS rejects with `EEXIST` **atomically** — that single syscall is **both** the no-overwrite guarantee **and** the collision-race close, with **no `existsSync`-then-write TOCTOU gap**. Temp-then-`rename` would be *wrong* here: it would (a) reintroduce a clobber race (pick next-free name → `rename` through the gap) and (b) drop a `.tmp` sibling into the *user-visible* downloads folder.

**Accepted tradeoff:** a crash mid-write can leave a partial `.tar.gz` at the final visible name. That is a re-triggerable **broken download**, not a corrupted secret store — nothing reads the bundle back — so atomicity is deliberately not worth the `.tmp` UX wrinkle. No crash-mid-write failure has been observed; per evidence-based fix selection, temp-then-rename is not added to defend it.

## Filename + collision strategy

Browser-style next-available integer suffix over the module constants `STEM = 'pyrycode-debug-bundle'` / `EXT = '.tar.gz'`:

- candidate `0` → `pyrycode-debug-bundle.tar.gz`
- candidate `n ≥ 1` → `pyrycode-debug-bundle (n).tar.gz`

The loop iterates `n = 0, 1, 2, …`, advancing on each `EEXIST` (a *retry*, never surfaced), and is **bounded** at `MAX_ATTEMPTS = 10_000` — loop-termination insurance against a pathological all-names-taken directory (throws a catchable typed `Error` if exhausted), **not** a defence against an observed attack. Two successive saves therefore produce two distinct files, each equal to its own input, guaranteed by the OS with **no app-level lock** — two overlapping calls in the same (or another) process cannot collide destructively: the loser sees `EEXIST` and deterministically advances.

Because the filename is a **module constant** (never derived from `bytes` or any daemon field), **no untrusted input ever reaches a path segment** and path traversal is structurally impossible — unlike the precedent, which must base64url-encode an attacker-influenced name.

## Security posture

`security-sensitive`; architect self-review verdict **PASS**.

- **Confidentiality at rest = `0o600`.** The bundle is deliberately **not** `safeStorage`-encrypted: the user story needs a portable `.tar.gz` the user can open or share, and OS-keychain-bound encryption would make it un-openable off this machine. Owner-only file mode (POSIX) plus the user's custody of their downloads folder is the control. On **Windows** `0o600` is largely ignored — the per-user profile ACL on the Downloads folder is the control there; this is **called out, not worked around** (and the `0o600` perms test is `it.runIf(process.platform !== 'win32')`).
- **No byte leak.** The module emits no logs of its own (user-facing progress is #118's job). Rejections carry only the errno `code` and the destination path (the user's own new download path — not sensitive); `bytes` never enters any `Error`. Pinned by the "rejection message contains no byte values" test.
- **No renderer reach / no IPC.** No channel, no `BrowserWindow`, no `contextBridge` API, no custom-protocol handler; no `electron` import.
- **Residual (accepted, out of scope):** if the downloads folder is a cloud-synced folder (Dropbox/OneDrive), the bundle leaves the machine on save — inherent to the downloads-folder scope; the deferred user-chosen-path variant would let the user target a non-synced location. The save is an explicit, user-initiated action that materialises the evidence archive as a shareable file by design.

## Error handling

Every failure is a **catchable rejection** of the async function — no raw, unhandled throw escapes the module.

| Failure | errno | Result to caller |
|---|---|---|
| Candidate name already exists | `EEXIST` | Internal retry — **not** surfaced |
| `dir` missing / not a directory | `ENOENT` / `ENOTDIR` | Rejected promise (caller maps to a user-facing error) |
| No write permission on `dir` | `EACCES` / `EPERM` | Rejected promise |
| Disk full mid-write | `ENOSPC` | Best-effort `unlink` of the partial, then rejected promise |
| All `MAX_ATTEMPTS` names taken | — | Typed `Error`, rejected promise |

On any **non-`EEXIST`** errno the module does a best-effort `unlink(candidate).catch(() => undefined)` to clear a possible partial file, then re-throws the **original** error unchanged.

## Out of scope

- **Native save dialog / user-chosen path** — deferred; the deterministic downloads-folder target keeps the slice unit-testable and is the simplest thing that satisfies the parent intent. A save-dialog variant is a follow-up once there is a demonstrated need.
- **Unpacking / inspecting the archive** — the bytes are opaque; the manifest and recording-absent flag live *inside* the tarball (assembled by pyrycode #811).
- **Oversized-payload bounding** — enforced upstream at the transport `maxPayload` and #116 reassembly; this module receives already-bounded bytes and degrades gracefully to an `ENOSPC` rejection even for a very large payload.

## Related

- [#117 codebase notes](../codebase/117.md) — implementation summary, patterns, lessons, and the code-review NIT carried forward.
- [Debug-bundle request (outbound)](debug-bundle-request.md) / [#115](../codebase/115.md) — the sibling outbound-ask slice; the same #71 split. #118 (renderer command) will orchestrate #115→#116→#117.
- [Secure store](secure-store.md) / [#42](../codebase/42.md) — hosts [`fileSecretPersistence`](../codebase/42.md), the "sensitive bytes → disk" precedent this module mirrors-and-inverts (`isErrnoException` copied verbatim; temp-then-rename deliberately *not* copied — see the load-bearing decision above).
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — the fail-closed secret-at-rest posture; this module is the deliberate exception (plaintext-at-rest by design, `0o600` not `safeStorage`, for a portable/shareable artifact).
