# Attachment path resolution

The **attachment-identifier → path gate**: a pure, main-process function that turns an untrusted attachment identifier into a file path confined inside a base directory, or refuses it. The renderer never passes a path — it passes an attachment identifier — and the background process is where that identifier becomes a path component. This module is that translation and, per its own doc comment, the **last owner of the check**: the daemon documents its 64-byte `attachment_id` ceiling as explicitly *not* a defence and assigns the real check to whoever turns the id into a path component (`internal/protocol/attachments.go`).

Introduced in [#818](https://github.com/pyrycode/pyrycode-desktop/issues/818). Written in the [pairing-payload gate](pairing-payload-gate.md)'s register — a pure, synchronous, total, log-free untrusted-input gate with a discriminated `{ok:true}/{ok:false, reason}` result and a value-free reason — and reusing the [save-debug-bundle](save-debug-bundle.md) composition-root seam of an injected `dir` parameter. **No consumer was wired in this slice**; its first is [`storeAttachment`](attachment-reassembly-and-store.md) (#995), consuming this gate verbatim with no second escape check.

## What it does

```ts
// src/main/attachmentPath.ts — MAIN-PROCESS ONLY
export type ResolveAttachmentPathResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'not-canonical-id' }

export function resolveAttachmentPath(
  baseDir: string,
  attachmentId: string
): ResolveAttachmentPathResult
```

The body is two steps: test `attachmentId` against a canonical-shape pattern, and on a pass, `resolve(baseDir, attachmentId)`. `baseDir` is **trusted** input from the composition root; `attachmentId` is **untrusted** input from the renderer (and, upstream, the wire) — the two parameters carry the same type but different trust levels, so the doc comment is what says which is which. `resolveAttachmentPath` is pure, synchronous, total and throw-free: no filesystem call, no async, no state, nothing to cancel, and no `console.*` of any kind.

Three consumers need exactly this translation and each says "refuse a bad identifier" from their own side: [`storeAttachment`](attachment-reassembly-and-store.md) (#995, landed) writes the verified attachment at the resolved path; [attachment save](attachment-save.md) (#814, landed) copies the resolved file out to Downloads; #691/#867 (open in the OS image viewer) hands the resolved path to `shell.openPath`. An identifier that escaped containment would let any of them touch an arbitrary file on the user's disk, and in #691/#867's case have the OS execute or open it with whatever handler the extension implies.

## Why refusal, not rewriting

The precedent for the *seam* is [`fileSecretPersistence`](secure-store.md), which closes traversal on an untrusted name by base64url-encoding it into an inert token — the right shape when the same module also owns the write. This module owns no write: rewriting would fix an on-disk name that #687 (the ticket that will actually write attachment files) has no design yet for. Both consumers ask for a refusal in their own acceptance criteria ([attachment save](attachment-save.md) AC1, #691 AC7), and the daemon reached the same place independently on its own side.

## The canonical shape

```ts
const CANONICAL_ATTACHMENT_ID = /^[0-9a-f-]{1,64}$/
```

Lowercase hex digits and ASCII hyphen-minus, 1–64 characters. **This module imposes a shape, and that shape is now a contract #685 and #687 must honour** — there was no attachment type anywhere in `src/` before this ticket, and the wire's `attachment_id` is otherwise just a client-chosen string with a byte ceiling. Every guarantee below is a consequence of this one line, which is why it ships at its narrowest (widening later is backward-compatible; narrowing is not):

- **Traversal is structurally unspellable, not merely checked.** No `.` (rules out `..` and any dotted variant), no `/` or `\` (no separator), no `:` (no drive-relative `c:foo`, no UNC prefix). A passing identifier names exactly one path component: itself.
- **The 64-character ceiling is the daemon's `MaxAttachmentIDBytes`, exactly** — the alphabet is ASCII, so character count and byte count coincide.
- **It admits both plausible daemon shapes and nothing else**: a canonical lowercase UUIDv4 (36 chars, what the daemon mints today) and a 64-character hex token (the alternative a later daemon change might pick).
- **It is case-unambiguous**, which matters more here than on the daemon side: APFS and NTFS are both case-insensitive by default, so a mixed-case alphabet would let two *distinct* identifiers collide on one file on this app's primary platforms — a #687 write cross-contamination reached with no symlink involved. `_` is deliberately absent too; it would only serve a base64url-style id, and base64url is mixed-case.
- **No Windows reserved device name is spellable** (`con`, `prn`, `aux`, `nul`, `com1`, `lpt1` each contain a character outside the alphabet) — this falls out for free rather than needing its own rule.
- **The empty identifier is refused by the `{1,64}` lower bound**, not cosmetically: `resolve(base, '')` is `base` itself, which would hand a consumer the attachment *directory* where it expected a file.

If the daemon ever publishes an attachment-id shape outside this pattern, the fix is one regex and its test rows — but any replacement must keep the case-unambiguity property or [`storeAttachment`](attachment-reassembly-and-store.md)'s writes cross-contaminate on macOS and Windows.

## Containment is structural — no filesystem resolution

The module makes **no filesystem call**. Not `realpath`, not `stat`, not `existsSync` — its only import is `node:path`. This is the opposite of the daemon's own attachment-directory design (`pyrycode/pyrycode` `docs/specs/architecture/1781-attachment-directory-resolution.md`), which uses `EvalSymlinks` plus resolved-path equality because a prefix/relative-path test is vacuous against a symlink *inside* the base directory pointing at a sibling. The daemon's directory is shared between different conversations and clients, so a sibling redirect crosses a real confidentiality boundary; this app's attachment directory is single-principal (one user's own attachments under `app.getPath('userData')`), this module creates nothing (there is no write ordering to get wrong), and planting a symlink inside `userData` already requires the write access needed to replace the secret-store ciphertexts or the paired-server record — redirecting one attachment read is strictly weaker than what that attacker already has. A `realpath`-based check would also be unsound: it requires the target to exist (conflating "this identifier escapes" with "this attachment hasn't been downloaded yet"), and whatever it resolved could be re-symlinked before the consumer's own `copyFile`/`openPath` runs.

This reasoning is scoped and named to be revisited: an attachment directory shared between principals, a consumer that opens a path it didn't resolve through this module, or a widening of the alphabet to admit `.` would each put resolved-path equality back on the table. There is no textual post-condition check either (no `isSameParent`-style assertion) — containment is a theorem about the alphabet, stated in the doc comment and pinned by the traversal/absolute-path test tables rather than by a redundant runtime branch.

## Error handling

One failure mode, one category: `{ ok: false, reason: 'not-canonical-id' }`, with no `path` key at all. A caller cannot repair a malformed identifier — it is a bug in an upstream caller or an attack from a compromised renderer, never retryable — so there is no value in splitting the reason further. The reason is a fixed value-free string built through a `reject()` helper (the same structural pattern `pairingPayload.ts` uses), never the identifier itself, since the identifier is renderer-supplied and would otherwise be a log-injection vector in a line-oriented log — this module never logs at all.

`baseDir` is not validated; it is composition-root input, not untrusted, and no validator can distinguish a right directory from a wrong one. A relative `baseDir` is anchored at `process.cwd()` by `resolve` (documented explicitly, since a caller might expect `join`'s literal-concatenation behaviour instead) — containment holds relative to whatever base is given, so each future consumer's composition root owns passing an absolute `app.getPath('userData')`-derived path, computed at the composition root and never from renderer input.

## The on-disk shape this commits future work to

`resolve(baseDir, attachmentId)` is a direct child of `baseDir` named by the identifier verbatim, **with no extension**. That is deliberate: an extension would be model-chosen (the assistant names the file it produced), and a model-chosen extension sitting in the store is exactly what makes `shell.openPath` dangerous — a `.command`, `.desktop`, `.app` or `.scpt` opens by *executing*. Keeping the on-disk name extension-less pushes the "what does the OS see" decision to #691, the only layer positioned to validate an image type before deciding. [Attachment save](attachment-save.md) (#814, landed) is unaffected, since its Downloads-folder filename comes from the wire (sanitised elsewhere) rather than from the on-disk name. Whether #687 stores the attachment as a flat file at this path or as a per-attachment directory is #687's to choose either way — this module makes no filesystem claim about what is at the path it returns; it never looks.

The wire file name itself is sanitised by a separate module, [`sanitizeAttachmentFilename`](attachment-filename-sanitiser.md) (#819) — rewritten rather than refused, since a display/Downloads-folder name has no addressing consequence the way an identifier does. [Attachment save](attachment-save.md) is unaffected by this module's extension-less on-disk shape, since its Downloads-folder filename comes from that sibling rather than from the on-disk name.

**Closed by #995: a flat file, not a per-attachment directory.** [`storeAttachment`](attachment-reassembly-and-store.md) writes the verified bytes directly at `resolve(baseDir, attachmentId)` — a direct child of the attachment directory, no intermediate folder per identifier. This module still makes no filesystem claim about what is at the path it returns; it never looks, and the choice was #995's to make as the ticket that first wrote to that path.

## Testing

`src/main/attachmentPath.test.ts`, plain vitest under the repo's `environment: 'node'` config — no temp directories, no fixtures, no cleanup, since the module never touches the filesystem. The macOS `os.tmpdir()` → `/private/var/…` symlink trap that bites a resolved-path comparison doesn't apply here (nothing is resolved against a real directory), but its sibling rule still does and is the one to reuse on any future path-arithmetic test in this repo: **never build an expectation from the function's own return value** — assert independently instead (`isAbsolute`, `dirname(...) === resolve(baseDir)`, `basename(...) === id`), or a build that returns the base directory unchanged would still pass.

Coverage shape, reusable for any future identifier-shape gate in this codebase:
- accepted rows (a canonical UUIDv4, a 64-hex-char token, a single character, a relative `baseDir`) asserted by the three-property triple above, never by string equality against the result;
- `..`-traversal and absolute-path refusal tables, each asserting a full `toEqual({ ok: false, reason: 'not-canonical-id' })` so a leaked `path` key on a refusal fails the row instead of passing unnoticed;
- shape-hygiene rows pinning the ceiling, the case-unambiguity requirement, Windows device names, whitespace/control characters, and — worth calling out for future untrusted-string gates — **homoglyph rows** (`ü`, U+00AD soft hyphen, U+FF0D fullwidth hyphen-minus) that specifically target the one punctuation character the alphabet does admit;
- a non-vacuity control (a canonical id still succeeds against the same `baseDir` the refusal tables use), so a build that refuses everything fails a real assertion instead of scoring an all-green board of refusal-only tests;
- a module-graph test that reads the module's own source as text, extracts every `from`/`require` specifier, and asserts the set is exactly `['node:path']` — pinning "no `electron`, no `node:fs`, no renderer import" as a test rather than a paragraph, since vitest's cwd is the project root.

## Security posture

Architect self-review verdict: **PASS**, with one accepted **SHOULD FIX** residual: a symlink planted *inside* the app's own attachment directory is not defended against (see § Containment is structural above) — bounded by the capability required (write access to `userData`, which already permits worse) and the single-principal nature of the directory, revisited only if that scope changes. Two further **SHOULD FIX**s land on the consumers rather than here: each composition root must pass an absolute, `app.getPath('userData')`-derived `baseDir`, computed at the composition root and never from renderer input. No IPC channel, no `contextBridge` API and no `BrowserWindow` are added in this slice — `src/main/index.ts`'s `setWindowOpenHandler` `file:` block is untouched, and both [attachment save](attachment-save.md) and #691 needed their own channel rather than a relaxation of it; #814 confirmed that in practice.

## Edge cases and limitations

- **Nothing evicts these files.** Attachment-directory retention/cleanup has no ticket yet; worth revisiting now that [`storeAttachment`](attachment-reassembly-and-store.md) is writing real bytes.
- **The extension question is #691/#867's, not this module's or #995's.** Naming it here so it isn't rediscovered at that implementation turn: the extension must come from a validated image type, never from the model-chosen name.
- **`baseDir` correctness is the caller's obligation.** This module cannot and does not validate it.

## Related

- [Attachment filename sanitiser](attachment-filename-sanitiser.md) — the rewriting half of the pair (#819): a file name is rewritten, never refused, because every input has a safe answer.
- [Pairing-payload gate](pairing-payload-gate.md) — the register this module borrows: pure/synchronous/total/log-free, a discriminated `{ok:true}/{ok:false,reason}` result, a value-free reason, a `reject()`-helper precedent.
- [Save debug bundle](save-debug-bundle.md) § "The composition-root seam" — the injected-`dir`, no-`electron`-import pattern this module reuses; its test's "Electron-free module graph" claim is what this module's AC4 test pins mechanically instead.
- [Secure store](secure-store.md) — hosts `fileSecretPersistence`, the base64url-encoding precedent for the *seam*, explicitly not for the *mechanism* here (see § Why refusal, not rewriting).
- `docs/specs/architecture/818-attachment-identifier-path-resolution.md` — the full architecture spec, including the security review and the open questions this doc summarizes.
- pyrycode `docs/specs/architecture/1781-attachment-directory-resolution.md` § "Why equality and not `withinDir`" — the daemon-side precedent this module's containment design deliberately diverges from, and why.
- [Attachment reassembly and store](attachment-reassembly-and-store.md) — #995, the first wired consumer: writes the verified attachment at the path this gate returns, flat and extension-less, closing the on-disk-shape open question below.
- [Attachment save](attachment-save.md) — #814, the second wired consumer: copies the resolved file out to Downloads.
- #691/#867 (open-in-viewer) — the one remaining intended consumer; not wired yet.
