# #818 — Resolve an attachment identifier to a path confined inside a base directory

## Files to read first

| Read | What to extract |
|---|---|
| `src/main/pairingPayload.ts:1-21` | **The register this module is written in.** The file-header comment of an untrusted-input gate: what enters, what the module does and stops at, why it lives in `src/main`, and the explicit "PURE, SYNCHRONOUS, TOTAL … LOG-FREE by construction" claim. Mirror this header, smaller. |
| `src/main/pairingPayload.ts:24-45` | The discriminated result type — `{ ok: true; … } \| { ok: false; reason }` — and the doc-comment convention that a reason is a *bounded, value-free category string*, never a field value. This module's result is the same shape with one reason. |
| `src/main/pairingPayload.ts:83-89, 105-111, 176-179` | The strict-alphabet precedent: a module-constant `RegExp` with a doc comment saying *why* the strictness exists, the `!PATTERN.test(x)` reject, and the `reject()` helper that keeps "no value ever reaches a reason" structural rather than reviewed. |
| `src/main/saveDebugBundle.ts:1-11, 44-48` | The composition-root seam — `dir` is a parameter so the module carries no `electron` import — and the `resolve(dir, name)` choice, whose doc records that it returns an absolute path *even if a relative `dir` is passed*. This module reuses both verbatim. |
| `src/main/saveDebugBundle.test.ts:1-8` | The one-paragraph "Electron-free: this file's module graph never touches `electron`" test-header comment. Precedent for the claim; §&nbsp;Testing strategy turns it into an assertion here. |
| `src/main/fileSecretPersistence.ts:17-27` | The **rejected** alternative, in code: base64url-encoding an untrusted name so traversal is closed *by construction* instead of by a check. Read it so the rejection in §&nbsp;Design, "Why refusal and not rewriting" is concrete rather than abstract. |
| `docs/knowledge/features/save-debug-bundle.md` §&nbsp;"The composition-root seam" | The documented form of the injected-`dir` seam, and the sentence that its test graph is Electron-free *by construction*. This ticket's AC 4 is that same property. |
| `src/main/index.ts:56-71` | `setWindowOpenHandler` drops every `file:` URL so a hostile link cannot open a local file. **Nothing here changes** — it is the reason #814 and #691 each need their own channel, and the reason this module exists. Context only. |
| `vitest.config.ts` | `environment: 'node'`, `include: ['src/**/*.{test,spec}.{ts,tsx}']`, cwd is the project root (it reads `package.json` by a bare relative `resolve`). No config change is needed; the AC-4 test relies on that cwd. |
| `CLAUDE.md` §&nbsp;Conventions, §&nbsp;Layout | Test-first; the transport and anything touching untrusted paths stays in the background process. |

Codegraph is **not indexed for this repo** (`.codegraph/` holds a config and no database; every `codegraph_*` call returns *"CodeGraph not initialized"*). This list was built by hand. There is also **no attachment code anywhere in `src/` yet** — `grep -ri attachment src/` is empty — so there is no existing type or constant for this module to line up with.

## Design source

N/A — a main-process module with no consumer and nothing UI-visible; the ticket body carries no `## Figma` section for that reason. The visual-fidelity check is intentionally skipped.

## Context

The renderer never passes a path. It passes an **attachment identifier**, and the background process turns that identifier into a file path. Two channels need exactly that translation — #814 (save into Downloads) and #691 (open in the OS image viewer) — and both are explicit from the caller's side that the outcome of a bad identifier is a **refusal**: #814 AC 1 *"rejects an identifier that does not resolve inside the app's attachment directory"*, #691 AC 7 *"refuses any identifier that escapes it"*. #691 is wired blocked-by this ticket so it consumes this module instead of growing a second, divergent one.

The identifier is untrusted in the same way a file name is. It reaches the main process over IPC, and the renderer is untrusted relative to the main process even though both are our code. Upstream it originates on the wire, where the daemon documents its 64-byte `attachment_id` ceiling as explicitly **not** a defence and assigns the real check to whoever turns the id into a path component (`internal/protocol/attachments.go`). On this side, that is this ticket — the same "last owner of the check" position the daemon's `1781` records for itself.

What makes the refusal load-bearing rather than hygienic is what the two consumers do with the result. #814 copies the resolved file into the user's Downloads folder; #691 hands it to `shell.openPath`, which lets the operating system pick a handler. An identifier that escapes the attachment directory therefore reads an arbitrary file off the user's disk, and in #691's case opens it with whatever application the OS associates with it.

The base directory is a **parameter**, not a constant, so this slice does not need to know where the app's attachment directory lives and does not wait on #687 to establish it. `saveDebugBundle.ts` and `fileSecretPersistence.ts` both take `dir` the same way.

**No consumer is wired in this slice.** The module and its tests land alone.

## Design

One new file, `src/main/attachmentPath.ts`, and its test file. Nothing else in `src/` changes.

### The contract

```ts
// src/main/attachmentPath.ts — MAIN-PROCESS ONLY

/** Success carries the resolved absolute path; failure carries only a value-free category. */
export type ResolveAttachmentPathResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'not-canonical-id' }

/** Pure, synchronous, total, throw-free. Touches no filesystem, emits no log. */
export function resolveAttachmentPath(
  baseDir: string,
  attachmentId: string
): ResolveAttachmentPathResult
```

Two exported symbols, one reject branch. The body is: test the id against the canonical-shape pattern, and on success `resolve(baseDir, attachmentId)`.

`baseDir` is **trusted** input from the composition root; `attachmentId` is **untrusted** input from the renderer. The doc comment says which is which, because the type system cannot.

### Decision 1 — the identifier is checked against a canonical shape

**This module imposes a shape, and that shape becomes the contract #685 and #687 must honour.**

```
/^[0-9a-f-]{1,64}$/
```

Lowercase hexadecimal digits and ASCII hyphen-minus, one to sixty-four characters. Every property below is a consequence of that one line:

- **Traversal is structurally impossible, not merely checked.** The alphabet contains no `.`, so neither `..` nor `.` nor any dotted variant is spellable. It contains no `/` and no `\`, so no separator can appear. It contains no `:`, so a Windows drive-relative form (`c:foo`) and a UNC prefix cannot be spelled either. A passing identifier can name exactly one path component and that component is itself.
- **The ceiling is the daemon's, and it is exact.** 64 matches `MaxAttachmentIDBytes`. Because the alphabet is ASCII, 64 characters *is* 64 bytes — the character count and the daemon's byte ceiling coincide with no UTF-8 surprise in between.
- **It admits both plausible daemon shapes and nothing else.** A canonical lowercase UUIDv4 (36 characters, which is what the daemon's `conversations.ValidID` admits today) and a 64-character hex token (the alternative `1781` §&nbsp;Open questions names for #1744) both pass. The desktop cannot pin the daemon's choice from here, and this is the narrowest shape that survives either.
- **It is case-unambiguous.** `1781` §&nbsp;Security review records this as the property any replacement shape must keep, and it matters more here than there: APFS is case-insensitive by default and so is NTFS. A mixed-case alphabet would let two *distinct* identifiers resolve to one file on both of this app's primary platforms, so #687's writes would cross-contaminate between attachments — a confidentiality failure reached without any symlink at all. Lowercase-only makes the identifier→path mapping injective on every filesystem this app runs on.
- **No Windows reserved device name is spellable.** `con`, `prn`, `aux`, `nul`, `com1`, `lpt1` each contain at least one character outside `[0-9a-f-]`. This falls out for free; §&nbsp;Testing strategy pins it with rows rather than leaving it as an argument.
- **The empty identifier is refused** by the `{1,64}` lower bound. This is not cosmetic: `resolve(base, '')` is `base` itself, which would hand a consumer the attachment *directory* where it expected a file.

**Widening this later is backward-compatible; narrowing it is not.** That asymmetry is why the shape ships at its narrowest. `_` is deliberately absent — it would only matter for a base64url-style id, and base64url is mixed-case, which the case-unambiguity requirement rules out anyway.

### Decision 2 — containment is structural; there is no filesystem resolution

**The module makes no filesystem call. Not `realpath`, not `stat`, not `existsSync`.** Its only import is `node:path`.

`1781` reached the opposite conclusion on the daemon side, using `EvalSymlinks` plus resolved-path equality because a prefix test is vacuous against a symlink *inside* the base directory pointing at a sibling. The ticket asks whether that is worth defending here, and says the answer turns on whether the attachment directory is app-owned. It is, and four things separate the two cases:

1. **This module creates nothing and writes nothing.** `1781`'s function is `EnsureDir` — it `MkdirAll`s, so the ordering of its checks against its creations is the whole design. This one is a pure translation; there is no creation for a check to precede.
2. **There is no second principal.** The daemon's directory holds attachments belonging to *different conversations from different clients*, so a sibling redirect crosses a confidentiality boundary between them. The desktop's attachment directory holds one user's own attachments on that user's own machine, under `app.getPath('userData')`. There is no boundary inside it for a symlink to cross.
3. **The capability needed exceeds the payoff.** Planting a symlink inside the app's `userData` directory requires write access to it — and anyone holding that can already replace the secret-store ciphertexts (`fileSecretPersistence`'s `dir`), the paired-server record, or the app's own bundle. Redirecting one attachment read is strictly weaker than what that attacker already has. This is the same bound `saveDebugBundle` and `1781` both accept for their residuals.
4. **A resolution here would be unsound as well as unnecessary.** `realpath` requires the path to already exist, which would make the function async and would conflate *"this identifier escapes"* with *"this attachment has not been downloaded yet"* — two outcomes #814 AC 5 keeps separate. And whatever it resolved could be re-symlinked in the gap before the consumer's own `copyFile` or `openPath`, so the check would look sound without being sound: a TOCTOU gap bought at the price of a fabricated distinction.

**No textual containment assertion either.** An `isSameParent`-style post-condition on top of the shape check is a branch that no test can reach without first bypassing the shape check — dead code that reads as diligence. The containment guarantee is a theorem about the alphabet (§&nbsp;Decision 1), it is stated in the module's doc comment, and §&nbsp;Testing strategy pins it with the traversal and absolute-path rows the AC demand.

**What would change this answer**, recorded so a later ticket does not have to re-derive it: an attachment directory shared between principals; a consumer that opens a path it did not resolve through this module; or a widening of the alphabet to admit `.`. Any of those puts resolved-path equality back on the table.

### Why refusal and not rewriting

`fileSecretPersistence` closes traversal by base64url-encoding the caller's name into an inert token — the right shape when the same module also owns the write, which is why it is the precedent for the *seam* and not for the *mechanism*. Here the module owns no write: rewriting would fix the on-disk name, and #687, the ticket that writes those files, has no design for that name to agree with. Both consumers say "refuse" in their own acceptance criteria, and the daemon settled the same question the same way on its side.

### The on-disk shape this commits the app to

`resolve(baseDir, attachmentId)` is a **direct child of `baseDir` named by the identifier verbatim**. Two consequences worth stating, because #687 has to agree with them:

- **The stored name carries no extension.** That is deliberate rather than incidental. An extension would be model-chosen — the assistant names the file it produced — and a model-chosen extension sitting in the app's own store is precisely what makes handing the path to `shell.openPath` dangerous: a `.command`, `.desktop`, `.app` or `.scpt` opens by *executing*. Keeping the store extension-less pushes the "what does the OS see" decision to #691, which is the only layer that can validate an image type before deciding. #814 is unaffected — its Downloads-folder name comes from the wire, sanitised by #819, and never from the on-disk name.
- **Whether that child is the attachment file or a per-attachment directory is #687's to choose**, and it does not change this contract. If #687 follows the daemon's `<id>/<filename>` layout instead, the consumer joins #819's sanitised name onto this module's result. The module makes no filesystem claim about what is at the path it returns — it never looks.

## State + concurrency model

None, and that is a design outcome rather than an omission. The function is synchronous, pure, and total: no store slice, no async task, no stream, no `AbortController`, no teardown, no shared mutable state. Two concurrent calls cannot interact because there is nothing to interact through. This falls directly out of §&nbsp;Decision 2 — the moment a filesystem call enters, so do async ownership and cancellation.

## Error handling

One failure mode, one category.

| Failure | Result |
|---|---|
| `attachmentId` fails `/^[0-9a-f-]{1,64}$/` — empty, over the ceiling, wrong alphabet, any case, any separator, any dot, any control character | `{ ok: false, reason: 'not-canonical-id' }`. No `path` key at all. |

**One reason, not several.** A caller cannot repair any of these — a malformed identifier is a bug in #685/#687 or an attack from a compromised renderer, and it is not retryable — so splitting the category buys a distinction nobody branches on. This is the same test `1781` applies to justify *one* `ErrInvalidID`: split a sentinel when the repair differs. Here it does not.

**The reason is value-free and the module never logs.** The identifier is renderer-supplied and would be a log-injection vector in a line-oriented log, exactly as the daemon's `AttachmentChunkPayload` SECURITY block records for filenames. Keeping the reject arm value-free by construction — via a `reject()` helper, as `pairingPayload.ts` does — means the property survives a later edit rather than depending on one. What a consumer surfaces to the operator is #814's and #691's decision.

**`baseDir` is not validated.** It is a composition-root constant, not untrusted input, and no validator can tell a right directory from a wrong one. A relative `baseDir` is anchored at `process.cwd()` by `resolve`, exactly as `saveDebugBundle` documents; the containment guarantee holds relative to whatever base it is given. Production always passes an absolute `app.getPath(…)`-derived path. §&nbsp;Security review records the obligation this places on #814/#691.

**Nothing throws.** `resolve` on a validated single component cannot throw, and there is no other call. The function is total.

## Testing strategy

`src/main/attachmentPath.test.ts`, plain vitest under the existing `environment: 'node'` config. **No temp directories, no fixtures, no cleanup** — the module never touches the filesystem, so there is nothing to build a fixture around.

**The macOS `os.tmpdir()` trap the ticket flags does not apply, and it is worth knowing why.** `/var/folders/…` symlinking to `/private/var/folders/…` only bites a test that compares a resolved result against an expectation built from a raw temp path. This design resolves nothing and needs no temp path, so the trap is designed out rather than avoided. Its sibling half **does** still apply and is the rule here: **never build an expectation from the function's own return value** — an expectation derived from the return passes under every mutant, including one that returns the base directory unchanged.

**How the happy path is asserted.** Composed independently of the return, and cross-platform, as three assertions on one result:

- `isAbsolute(result.path)` is true,
- `dirname(result.path)` equals `resolve(baseDir)` — the parent is exactly the base, nothing appended, nothing skipped,
- `basename(result.path)` equals the identifier verbatim — the id is neither dropped nor rewritten.

The triple is stronger than a `toContain` or a `startsWith` fragment check, which would survive a build that dropped the identifier entirely.

### Rows

**Accepted (AC 1)**

- A canonical lowercase UUIDv4 (36 chars) → ok, plus the assertion triple above. The shape the daemon mints today.
- 64 lowercase hex characters, no dashes → ok. Pins the ceiling as inclusive and the second plausible daemon shape as admitted.
- A single character (`'a'`) → ok. Pins the lower bound at 1, not at "some canonical length".
- A **relative** `baseDir` → `isAbsolute(result.path)` still true. Pins `resolve` over `join`.

**`..` traversal refused (AC 2)** — one table, each row asserting the result deep-equals `{ ok: false, reason: 'not-canonical-id' }`, so a leaked `path` key fails the row rather than passing unnoticed: `'..'`, `'../secrets'`, `'../../etc/passwd'`, `'a/../b'`, `'.'`, `'..a'`, `'%2e%2e'`, `'..%2f..'`.

**Absolute paths refused (AC 3)** — same table shape: `'/etc/passwd'`, `'/'`, `'//server/share'`, `'C:\\Windows\\System32\\config\\SAM'`, `'C:/Windows'`, `'c:'`, `'\\\\?\\C:\\x'`, `'~'`, `'~/Documents'`, `'file:///etc/passwd'`.

**Shape hygiene refused** — the rows that keep the alphabet's other properties from being arguments rather than tests: `''`; `'a/b'` and `'a\\b'`; 65 hex characters; `'ABCDEF01'` and `'aBcD'` (case-unambiguity); `'zzzz'` and `'g'`; `'ab cd'`, `'abc '`, `'ab\tcd'`; `'ab\u0000cd'`, `'ab\ncd'`, `'\u0007'`; `'con'`, `'nul'`, `'com1'` (Windows device names); `'ü'`, `'\u00ad'` (soft hyphen), `'\uff0d'` (fullwidth hyphen-minus) — the last two are the homoglyph rows, and they matter because they *look* like the one punctuation character the alphabet does admit.

**Non-vacuity control.** One test asserting a canonical identifier succeeds against the same `baseDir` the refusal tables use, so a build that refuses everything fails rather than scoring a full green board.

**Module graph (AC 4).** One test that reads `src/main/attachmentPath.ts` as text — vitest's cwd is the project root, which `vitest.config.ts` already relies on — extracts every `from '…'` and `require('…')` specifier, and asserts the set is exactly `['node:path']`.

This is source-text rather than runtime on purpose: the property is about the *module graph*, and once vitest has resolved the graph there is nothing left at runtime to observe. Asserting the exact set rather than "no `electron`" is what makes it worth its five lines — it fires on an `electron` import, on any `../renderer/…` import, **and** on a `node:fs` import, so §&nbsp;Decision 2's no-filesystem property is pinned by a test instead of by a paragraph. If a later edit legitimately needs another import, updating the allowlist is the conscious decision the test exists to force.

### What each group is the sole red for

A prediction of design intent, not a measured mutation run — this repo has no mutation harness, and the developer should not argue coverage from this table.

| Mutant | Expected sole red |
|---|---|
| The pattern's alphabet gains `.` | The AC-2 `..` table |
| The pattern's alphabet gains `/` or `\` | The AC-3 absolute-path table and the separator rows |
| The pattern becomes case-insensitive (`/i`) | The `'ABCDEF01'` / `'aBcD'` rows |
| The `{1,64}` lower bound becomes `{0,64}` | The `''` row |
| The `{1,64}` ceiling is dropped | The 65-character row |
| `resolve` becomes `join` | The relative-`baseDir` row |
| The identifier stops being appended (`resolve(baseDir)`) | The `basename` assertion in every accepted row |
| An `electron`, `node:fs` or renderer import is added | The AC-4 module-graph test |

`npm test` covers this. No new dependency, no config change, nothing for the Playwright tiers — there is no UI and nothing to click.

## Open questions

- **Does #687 store the attachment as a file named by the identifier, or as a directory containing #819's sanitised name?** Either works against this contract (§&nbsp;"The on-disk shape this commits the app to"), and #687 has no design yet. The recommendation carried forward is the flat, extension-less file, for the `shell.openPath` reason.
- **How does #691 get an extension the OS will route on?** It is out of scope here and it is not #687's to solve either: the extension must come from a validated image type, never from the model-chosen name. Naming it now so it is not discovered at #691's implementation turn.
- **Nothing evicts these files.** Retention and cleanup of the attachment directory have no ticket. Worth one once #687 is writing real bytes. Not this slice's.
- **If the daemon publishes an attachment-id shape outside `[0-9a-f-]{1,64}`**, the change here is one regex and its rows — but any replacement must keep the case-unambiguity property (§&nbsp;Decision 1), or #687's writes cross-contaminate on macOS and Windows.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No MUST FIX. The boundary is a single exported function: `attachmentId` crosses from untrusted to trusted at `resolveAttachmentPath`'s pattern test, which is its first statement and has no filesystem call before it. Downstream holds a `string` with no remaining renderer influence — the identifier cannot spell anything but itself — so #814 and #691 inherit no obligation to re-validate. The two parameters carry different trust levels and the same type; the type system cannot signal that, so the doc comment must say which is which, and §&nbsp;The contract requires it. The result type is a discriminated union rather than a nullable string precisely so a consumer cannot use a failure as a path by forgetting a check.

- **[File operations — path traversal]** No MUST FIX, and this is the category the ticket exists for. No untrusted input reaches `resolve` unvalidated. An identifier passing `/^[0-9a-f-]{1,64}$/` contains no `.`, `/`, `\`, `:`, NUL or control character, so it cannot spell `..`, a separator, an absolute path, a drive-relative path or a UNC prefix — the guarantee is structural, and §&nbsp;Testing strategy pins each half with its own table rather than with a happy-path test. The daemon's 64-byte ceiling is honoured as a bound and is explicitly *not* what provides the defence, per its own doc comment.

- **[File operations — symlinks]** SHOULD FIX, accepted with a stated bound and a stated trigger to revisit. A symlink planted *inside* the attachment directory redirects a read, and this design does not resolve it (§&nbsp;Decision 2). Bounded by: the capability required is write access to the app's own `userData` directory, which already permits replacing the secret-store ciphertexts and the paired-server record; the directory is single-principal, so the sibling-redirect case that forced `1781` to equality has no analogue; and this module creates nothing, so there is no ordering to get wrong. Deferring is per evidence-based fix selection — no such failure has been observed, and `realpath` here would be unsound anyway (existence-dependent, and re-symlinkable in the gap before the consumer's own open). §&nbsp;Decision 2 records the three conditions that would reopen it.

- **[File operations — TOCTOU]** No findings, by construction. There is no check-then-use: the module performs no filesystem operation at all, so it has no gap of its own. The gap it *could* have introduced — resolve here, open in the consumer — is the specific reason resolution was rejected rather than an accident of it. #814 already owns the correct primitive on its side (`COPYFILE_EXCL`, advance on `EEXIST`, no preceding existence check), which is the `saveDebugBundle` pattern its own body cites.

- **[File operations — storage scope, permissions, atomic writes, encryption at rest]** Not applicable, and deliberately so. This module writes nothing, creates nothing, and reads nothing. It sets no file mode and has no partial-state failure mode to make atomic. Where the attachment directory lives and what mode it carries is #687's; the composition-root seam means this module neither knows nor needs to.

- **[File operations — the base directory is trusted input]** SHOULD FIX, landing on **#814** and **#691**, not here. The containment guarantee is *relative to the `baseDir` given*: a relative or wrong base yields a path confined to the wrong directory, and no validator can distinguish a wrong base from a right one. Each consumer's composition root must pass an absolute path derived from `app.getPath('userData')` and the directory #687 establishes — computed at the composition root, never inside a handler, and never from anything the renderer sent. Recorded here because this spec is where the seam is defined and where those two tickets will read it.

- **[Inter-process / Electron attack surface]** No MUST FIX. This slice adds **no** IPC channel, no `contextBridge` API, no `ipcMain` handler, no `BrowserWindow`, no custom protocol and no navigation handler — there is no consumer at all. `setWindowOpenHandler`'s `file:` block in `src/main/index.ts:56-71` is untouched and must stay untouched; both consumers are explicit that they need their own channel rather than a relaxation of it, and this module is what lets them have one safely. The AC-4 module-graph test is what keeps the module out of the renderer's reach mechanically rather than by convention. When #814 and #691 land, the argument-validation obligation on their channels is satisfied *for the identifier* by this function and is not satisfied for anything else they accept.

- **[Error messages, logs, telemetry]** No MUST FIX. The single reject reason is a fixed category string; the identifier never enters it, and the `reject()` helper keeps that structural rather than reviewed — the log-injection concern the daemon's `AttachmentChunkPayload` SECURITY block raises for filenames applies identically to a renderer-chosen identifier. The module makes zero `console.*` calls and throws nothing, so no path, no identifier and no internal state can reach a log, an `Error`, or a crash reporter's captured stack from here. What a consumer surfaces is #814's and #691's decision, and the value-free reason is what makes a safe choice available to them.

- **[Tokens, secrets, credentials]** Not applicable, and worth stating rather than skipping because an attachment identifier *looks* like a token. It is not one: the daemon's own SECURITY block records that it is not secret, not unguessable, and never the only thing between a caller and a file. This design relies on none of those properties — containment comes from the alphabet, never from an identifier being hard to guess — so there is no constant-time comparison to indicate and nothing here to store or rotate.

- **[Cryptographic primitives]** Not applicable. No RNG, no hashing, no key material, no comparison against a secret. The pattern test compares an input against a *shape*, not a value.

- **[Subprocess / external command execution]** Not applicable — no `exec`, no shell, no argv. Noted because the alphabet admits a leading `-`, which would be an argument-injection concern if a path from here were ever passed to a flag-parsing CLI. It is not: #814 uses `fs.copyFile` and `shell.showItemInFolder`, #691 uses `shell.openPath`, none of which is a shell, and every path this module returns is absolute, so a leading hyphen can never land at an argv position a parser would read as a flag.

- **[Network & I/O]** Not applicable. This slice reads no socket, sets no size limit and has no timeout to set. Its resource cost is one string comparison and one `resolve` per call, both bounded by the 64-character ceiling.

- **[Concurrency]** No findings. The function is synchronous, pure and total: no goroutine-equivalent, no timer, no listener, no `AbortController`, no shared mutable state, nothing to cancel on teardown and nothing to leave inconsistent on `app.quit`.

- **[Threat model alignment]** Addressed. The desktop-specific threat this slice owns is **renderer compromise reaching the filesystem**: a script-injection or supply-chain bug in the window sends a crafted identifier over a future channel and gets an arbitrary file copied out (#814) or opened by its OS handler (#691). It is refused by construction here, and the refusal is proven by tables rather than by a happy path. The hostile-daemon variant — a malicious or model-chosen identifier arriving over the wire and reaching #687 — is refused by the same check, since both paths funnel through this one function. Out of scope and named: attachment retention and cleanup (no ticket yet), the extension question `shell.openPath` raises (#691's), and where the attachment directory lives with what permissions (#687's).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
