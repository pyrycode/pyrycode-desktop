# Attachment filename sanitiser

The **attachment-file-name → path-component rewrite**: a pure, main-process function that reduces an untrusted, model-chosen attachment file name to exactly one safe path component. Unlike its sibling, it never refuses — every input has a safe answer.

Introduced in [#819](https://github.com/pyrycode/pyrycode-desktop/issues/819). **No consumer is wired in this slice.**

## What it does

```ts
// src/main/attachmentFilename.ts — MAIN-PROCESS ONLY, zero imports
export const FALLBACK_FILENAME = 'attachment'
export function sanitizeAttachmentFilename(name: string): string
```

Four steps, in order:

1. **Map, character-wise.** Walk `name` with `for…of` (code points, not code units — one astral character yields one `_`, never two). Keep a character verbatim when it matches the allowlist `/^[A-Za-z0-9._-]$/u`, else emit `_`. Track whether *any* character survived unchanged.
2. **Fallback.** If nothing survived, return `FALLBACK_FILENAME` (`'attachment'`) directly — decided from the **input**, never the built result (see below).
3. **Leading dot.** If the built result starts with `.`, prefix (not append) an `_`.
4. **Reserved device name.** Take the stem before the first `.` (or the whole string), lowercase it, and if it matches `/^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/`, prefix an `_`.

The result is never empty, never `.` or `..`, never begins with `.`, contains no separator and no control character, is never a Windows reserved device name (case- and extension-insensitive), and is ASCII by construction. It is not unique — `a/b` and `a_b` both answer `a_b`, and every unusable name answers the same fallback.

## Why rewriting, not refusal

This is the mirror image of [attachment path resolution](attachment-path-resolution.md) (#818). An attachment **identifier** is checked and refused, never rewritten, because rewriting one changes which attachment is addressed. A **file name** is rewritten and never refused, because every input has a safe answer and a refusal would have nothing better to offer than the fallback already gives. That distinction is why the two ship as separate modules rather than one gate with two modes.

The design descends directly from the daemon's own `internal/attachments.SanitizeFilename` (`pyrycode/pyrycode` `docs/specs/architecture/1772-attachment-filename-sanitiser.md`), same allowlist, same reserved-name list, with one divergence: no length bound here (see below).

## The one sanctioned crossing of the never-a-filename rule

`CLAUDE.md` and the field comments on `src/shared/ipc/events.ts`'s daemon-text fields both say daemon-supplied text is never "a filename, a cache key, or a lookup path." `sanitizeAttachmentFilename` is **the one sanctioned crossing** of that rule, and the exemption is bought by the transform: a caller that builds a save path out of the *raw* wire `filename` field instead has bypassed the gate rather than used it. The function returns a plain `string`, indistinguishable from the raw field it was derived from — nothing structural stops that bypass, so **this call must be the only place a save path reads the wire's file name**. A future consumer (#814) should key its save on the attachment identifier (`resolveAttachmentPath`, #818) and carry the filename from main's own copy of the wire frame, not from a value that crossed the `contextBridge`.

Sanitising removes the log-injection half of the daemon-text hazard (the result carries no newline, no control character), but not the privacy half — a file name is often private in itself, so the never-reaches-a-log rule binds this function's **output** exactly as hard as its input. "Sanitised" does not mean "safe to log."

## The two one-character traps

Both are silent, and one reopens traversal completely:

- **The hyphen must be the last member of the allowlist's character class.** `[A-Za-z0-9._-]` is correct — a trailing `-` is a literal. `[A-Za-z0-9.-_]` is a **range** from `.` (U+002E) to `_` (U+005F) that contains `/` (U+002F), silently admitting the separator and disabling sanitisation entirely.
- **The stem must be taken with `split('.')[0]`, not `slice(0, indexOf('.'))`.** `indexOf` returns `-1` with no dot, and `slice(0, -1)` drops the last character — `'CON'` would test as `'CO'` and slip through unprefixed.

## Why the fallback decision can't read the result

`'///'` (nothing survives) and the literal client name `'___'` (everything survives) both build the string `'___'`. The two cases are **indistinguishable in the result** — any check on the built string (`/^_+$/`, a trim-and-compare) collapses them and breaks either the "same fixed fallback every time" guarantee or the "already-safe name comes back byte-identical" guarantee. The function tracks survival as a `boolean` while walking the input and branches on that, never on the result. The daemon's own spec (1772 § Design, step 2) records the same finding independently.

## Non-goals (deliberate)

- **No length bound.** The daemon's version truncates to 255 bytes because its wire bound has no validator; here nothing has been observed to need one, no attachment name can reach this app until #687 lands, and the binding constraint is whole-path `PATH_MAX`, which only the eventual write (#814) knows the directory for. An over-long name is expected to surface as `ENAMETOOLONG` from that write. If a later ticket adds a bound anyway, it must run **after** the leading-dot and reserved-name steps — prefixing a character to an already-truncated result can push it back over the bound.
- **No existence check, no collision suffix, no uniqueness.** The result is deliberately non-unique (case folding on APFS, `a/b` vs `a_b` colliding, every unusable name sharing one fallback). The no-overwrite guarantee belongs to the write, not here — [save-debug-bundle](save-debug-bundle.md)'s exclusive-create (`flag: 'wx'`, retry on `EEXIST`) is #814's precedent.
- **No path construction, no directory layout, no IPC channel.** The function returns a component; joining it behind a directory and wiring a consumer is #814's.

## Testing

`src/main/attachmentFilename.test.ts`, plain vitest, no fixture, no temp dir — the module touches nothing. Every row asserts its expected string as a literal (never built from the function's own return value) and is additionally run through a shared `expectSafeComponent` helper asserting all five ship-time guarantees at once, so every row is a fixture for all of them rather than only the one it targets.

Notable rows: `'../etc/passwd'` → `'_.._etc_passwd'` (both separators, then the leading-dot prefix); `'///'` and `'報告書'` → the fallback (the row that makes the "decided by input, not result" guarantee live, and the one that shows the ASCII allowlist's visible cost on a legitimate non-ASCII name); `'report.txt\x00.exe'` → `'report.txt_.exe'` (the classic filename attack, named on its own); `'NUL.tar.gz'` → `'_NUL.tar.gz'` (first-dot, not last-dot, stem semantics); `'constructor.txt'`/`'toString'` → unchanged (the rows that would fail an object-literal reserved-name lookup, which inherits `Object.prototype`); `'___'`/`'_'` → unchanged (the fallback-decided-by-input rows, using the one value whose built result is indistinguishable from "nothing survived"). A module-graph test asserts the source imports nothing at all (not even `node:path`) and contains no `console.` call.

## Security posture

Architect self-review verdict: **PASS**. No filesystem, no IPC, no `BrowserWindow` surface — the module ships unreferenced. Two hand-offs recorded for #814: sanitise must happen in main on the value main actually uses to build the path (never trust a component that crossed the bridge without re-running this function on it), and the write must use `saveDebugBundle`'s exclusive-create loop rather than a plain `writeFile`, since the result is not unique. A leading `-` surviving the allowlist (`-rf` → `-rf`) is named and declined as out of scope: no current or planned path passes this component as an argv element.

## Related

- [Attachment path resolution](attachment-path-resolution.md) — the sibling, refusal half of the pair (#818): an attachment identifier is checked and refused rather than rewritten.
- [Save debug bundle](save-debug-bundle.md) — the exclusive-create (`flag: 'wx'`) precedent that #814 must reuse for the no-overwrite guarantee this module deliberately does not provide.
- [Pairing-payload gate](pairing-payload-gate.md) — the untrusted-input-gate register this module's header draws tone from, though this module's result is a plain string rather than a discriminated `{ok}` union, since it never refuses.
- `docs/specs/architecture/819-attachment-filename-sanitiser.md` — the full architecture spec, including the security review this doc summarizes.
- pyrycode `docs/specs/architecture/1772-attachment-filename-sanitiser.md` — the daemon-side original this design descends from.
- #814 (save-to-Downloads, not yet started) — the intended consumer.
- #687 — establishes the attachment directory and is what makes an attachment name reach this app at all.
