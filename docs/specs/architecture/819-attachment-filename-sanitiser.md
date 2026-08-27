# #819 — Reduce an untrusted attachment file name to one safe path component

One new main-process module, one new test file. No existing file changes, no consumer wired — #814 (save-to-Downloads) is the first, and #687 is what makes an attachment name reach this app at all.

## Design source

N/A — a pure main-process function with no rendered surface. The saved name and the displayed name are deliberately allowed to differ (#686); the bubble keeps rendering the raw wire name and nothing here touches it.

## Files to read first

Codegraph is **not indexed for this repo** (`codegraph_status` → "CodeGraph not initialized", re-probed 2026-08-27), so this list is hand-built and there is no symbol-level query to fall back on. Read in order; the first three are the whole design surface.

| Read | What to extract |
|---|---|
| `src/main/attachmentPath.ts:1-22` | **The register to write in, and the sibling half of this pair.** The file-header comment of an untrusted-input gate: what enters, what the module does and stops at, why it lives in `src/main`, and the explicit "PURE, SYNCHRONOUS, TOTAL … LOG-FREE by construction" claim. Mirror this header. Note especially the paragraph explaining why an *identifier* is refused rather than rewritten — this module is the documented opposite and its header must say so. |
| `src/main/attachmentPath.ts:33-56` | The doc-comment convention for a module-constant `RegExp`: a bulleted list of the properties that fall out of the pattern, each with its *reason*, and the note that a narrow shape ships narrow because widening is backward-compatible. The allowlist here gets the same treatment. |
| `src/main/attachmentPath.test.ts:1-35` | The test-file header and the two helper shapes (`expectResolvedInto`, `expectRefused`). The load-bearing sentence: **never build an expectation from the function's own return value.** § Testing strategy turns that into the universal-postcondition helper below. |
| `src/main/attachmentPath.test.ts:111-139` | Three concrete row shapes to copy: the reserved-device-name loop, the homoglyph loop, and the **non-vacuity control** (`a build that refuses everything fails here rather than scoring full green`). Also the five-line source-text import-set test — copied here with an empty expected set. |
| `src/main/pairingPayload.ts:1-17` | The original of the register: an untrusted-input gate's header, the "no field value ever reaches a reason or an error" claim, and the log-free-by-construction sentence. Read for tone; `attachmentPath.ts` is the closer model. |
| `src/main/saveDebugBundle.ts:1-11, 44-60` | The **exclusive-create loop** (`flag: 'wx'`, EEXIST → next candidate). This is #814's precedent for the no-overwrite guarantee, and the reason this module must **not** contain an existence check. Read it so the hand-off in § Non-goals is concrete. |
| `src/shared/ipc/events.ts:255-262` | The standing repo rule this module is the one sanctioned crossing of: daemon-supplied text "is not a cache key, a filename, or a lookup path". Read one instance; the same paragraph repeats on seven arms. The header comment must name the crossing explicitly. |
| `CLAUDE.md` § Conventions, the final bullet (operator ruling, 2026-08-20) | The same rule in its authoritative form, plus the never-reaches-a-log clause that binds this module's **output** as hard as its input. |
| `docs/knowledge/features/attachment-path-resolution.md` | #818's folded-in feature doc. § "Why refusal, not rewriting" states the distinction from the other side; this module is the rewriting half. |
| pyrycode/pyrycode `docs/specs/architecture/1772-attachment-filename-sanitiser.md` § Design | The daemon's version of this exact function. Two arguments carry over verbatim: the positive-allowlist argument, and why the dot check runs on the **built result**. Its step 4 (a byte bound) does **not** carry over — see § Non-goals. Reachable via `mcp__qmd__get` on `pyrycode-docs/specs/architecture/1772-attachment-filename-sanitiser.md`. |

## Context

An attachment's `filename` arrives over the wire and is model-chosen: the assistant generates a file and names it. That string may carry `/` or `\`, `..`, a leading dot, a Windows reserved device name, or control characters including NUL.

This module is the single place a wire-supplied name becomes a host-side path component. `CLAUDE.md` and the field comments in `src/shared/ipc/events.ts` both say daemon-supplied text is never "a filename, a cache key, or a lookup path"; **this function is the one sanctioned crossing of that rule, and only because the string is transformed on the way through.** That is why it is its own module with its own header stating the exemption, rather than a few lines inside #814's write.

The contract is the mirror image of #818's. An attachment **identifier** is checked and refused, never rewritten, because rewriting one changes which attachment is addressed. A **file name** is rewritten and never refused, because every input has a safe answer and a refusal would have nothing better to offer than the fallback already gives. The two halves ship as separate modules for that reason.

No ADR. The design is the daemon's established shape (`internal/attachments.SanitizeFilename`, #1772) with one criterion added, one step dropped, and both divergences argued below.

## Design

One new file, `src/main/attachmentFilename.ts`, carrying one exported function, one exported-or-module constant for the fallback, and two module-constant `RegExp`s. Nothing else.

```ts
// src/main/attachmentFilename.ts — MAIN-PROCESS ONLY, zero imports

/** The component returned when nothing in the input survives the allowlist. Fixed, so the answer is
 *  the same every time. Itself a fixpoint of the function (pinned by a test). */
const FALLBACK_FILENAME = 'attachment'

/** One character the allowlist keeps, verbatim. Everything else becomes `_`.
 *  ANCHORED, and the hyphen is LAST — see § Design, "Two one-character traps". */
const ALLOWED_CHARACTER = /^[A-Za-z0-9._-]$/u

/** A Windows reserved device name, matched on an already-lowercased stem. */
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/

/** Reduce an untrusted, model-chosen file name to exactly one safe path component. Total: every
 *  input has an answer, so there is no error and no result union. */
export function sanitizeAttachmentFilename(name: string): string
```

Spell it `sanitize`, with a **z**. There is no existing `sanit*` identifier anywhere in `src/` to follow, the repo's prose uses British "sanitise" but its identifiers are otherwise unremarkable American-English, and the cross-repo sibling this design descends from is `SanitizeFilename`. Matching it keeps the two greppable as a pair.

### The pipeline

Four steps, in this order. **The order is load-bearing** and § Testing strategy pins each dependency with a dedicated row.

1. **Map, character-wise.** Walk `name` with a `for…of` loop (the string iterator, so an astral character is one item and yields one `_`, not two). Append the character when `ALLOWED_CHARACTER` matches it; append `'_'` otherwise. Alongside, track a `boolean` recording whether **any character was appended unchanged**.
2. **Fallback.** If that flag is false, return `FALLBACK_FILENAME` directly.
3. **Leading dot.** If the built result begins with `'.'`, prefix it with `'_'`.
4. **Reserved device name.** Take the built result's stem — everything before its first `'.'`, or the whole string if it has none — lowercase it with `String.prototype.toLowerCase`, and if `RESERVED_DEVICE_NAME` matches, prefix the result with `'_'`.

Return the result. No other branch, no other statement.

### Two one-character traps

Both are mistakes a careful developer makes, both are silent, and one of them reopens traversal completely. Named here so they are decisions rather than accidents; § Testing strategy has a row that reddens each.

- **The hyphen must be the last member of the character class.** `[A-Za-z0-9._-]` is correct: a trailing `-` is a literal. `[A-Za-z0-9.-_]` is a **range** from `.` (U+002E) to `_` (U+005F) — which contains `/` (U+002F). That one transposition admits the separator, `:`, and every uppercase letter, and the function silently stops sanitising anything. The `'../etc/passwd'` row and `expectSafeComponent`'s no-`/` clause are its reds.
- **Take the stem with `split('.')[0]`, not `slice(0, indexOf('.'))`.** `indexOf` returns `-1` when there is no dot, and `slice(0, -1)` drops the last character rather than returning the whole string — so `'CON'` would be tested as `'CO'`, match nothing, and come back unprefixed. `split('.')[0]` is total and correct for both shapes (`'CON'` → `'CON'`, `'NUL.tar.gz'` → `'NUL'`, `'.CON'` → `''`). The extensionless `'CON'` row is its red.

### Why each step is where it is

**Step 1 discharges the separator, control-character and encoding hazards at once, because the allowlist is positive.** `/` is not on it, so it becomes `_`; neither is `\`, nor NUL, nor DEL, nor U+202E, nor a space, nor a shell metacharacter. Nothing has to be enumerated and nothing can be forgotten — that is the entire argument for an allowlist over a denylist, and it is why AC 3 ("no control character survives, NUL included") needs no rule of its own. NUL is still worth naming in the tests by itself: `report.txt\x00.exe` is the classic filename attack, not merely one control character among several.

It also fixes the encoding. Every character appended is ASCII, so the returned string is well-formed by construction rather than by a check — an unpaired surrogate is not on the allowlist and decays to `_` like anything else.

The allowlist is `A-Za-z0-9._-` — the daemon's, byte for byte. **How wide it is, is a decision; that it stays positive is not.** ASCII-only is accepted with its visible cost: `Raportti-läpivienti.pdf` saves as `Raportti-l_pivienti.pdf`. #686 already ruled that the saved name and the displayed name may differ, the bubble still renders the real wire name, and widening the allowlist later is backward-compatible where narrowing it is not. Ship it narrow.

**Step 2's condition is derived from the input, and that is the one place this design cannot look at its own output.** The flag is what distinguishes `"///"` (nothing survived → AC 2's fixed fallback) from the literal name `"___"` (everything survived → AC 5's byte-identity). Both build the string `"___"`, so **the two cases are indistinguishable in the result** and any check on the result — `/^_+$/`, a `replaceAll('_','') === ''` trim, anything — collapses them and breaks one AC or the other. The ticket's Technical Notes call this out as the interaction that gets missed; 1772 § Design step 2 records the same finding independently.

State the flag relative to the allowlist ("some character passed"), not relative to any particular allowlist, so widening it later does not drift the flag's meaning.

One condition covers both of AC 2's arms: the empty input appends nothing, so its flag is false for the same reason `"///"`'s is.

Note the consequence for `.` and `..`: `.` **is** on the allowlist, so `"."` and `".."` set the flag and reach step 3 rather than the fallback. That is intended — step 3 is what answers them.

**Step 3 prefixes rather than appends.** A suffix (`"._"`, `".._"` — the shape a naive reading produces) satisfies "never `.` or `..`" but leaves the file hidden, which AC 1 forbids in the same sentence. The prefix discharges **both clauses with one rule**: afterwards the result cannot begin with `'.'`, and a string that does not begin with `'.'` is neither `"."` nor `".."`. Run it on the **built result**, not the input, so it keeps holding if the allowlist ever changes.

`.` stays on the allowlist. Dropping it would satisfy AC 1 trivially and break AC 5, which needs `report-2026.pdf` back byte-identical.

**Step 4 is the criterion the daemon's version does not have,** because #818 got it for free — its identifier alphabet cannot spell `con` at all. Here letters and digits are on the allowlist, so `CON.txt` survives step 1 intact and needs an explicit rule.

- It **prefixes `_` rather than returning the fallback**: same mechanism as step 3, so there is one rule shape rather than two, and the client's name survives instead of collapsing into the most collision-prone value the function can return. No reserved device name begins with `_`, so one pass is enough — the prefix cannot produce another reserved name, and it cannot produce a leading dot, so step 3's postcondition survives it.
- It matches **on the stem before the first `.`**, which is what makes `CON.txt` and `NUL.tar.gz` both hit (AC 4 names the second explicitly, and first-dot rather than last-dot semantics is what covers it).
- It is a **`RegExp`, not an object-literal lookup table.** A bare `RESERVED[stem]` inherits `Object.prototype`, so `'constructor'`, `'toString'` and `'valueOf'` all read back truthy and would be prefixed as if they were device names — a wrong answer reached with no attacker involved. A `RegExp` (or a `Set`, if the list ever wants to be data) has no such surface. § Testing strategy carries `'constructor.txt'` as the row that reddens it.
- It folds case with `toLowerCase()` rather than a `/i` flag. `toLowerCase` is locale-independent (no Turkish-dotless-I hazard, unlike `toLocaleLowerCase`), and it sidesteps the question of whether `/i` under `u` would fold a non-ASCII character onto an ASCII one — moot here, since the result is ASCII by step 1, but the reader should not have to derive that to trust the line.
- The pattern spells `com[0-9]`/`lpt[0-9]`, one character wider than AC 4's `COM1`–`COM9`/`LPT1`–`LPT9`. Microsoft's current naming guidance lists `COM0` and `LPT0` too; the AC's range is covered *a fortiori* and the widening costs no branch. The superscript-digit variants (`COM²`) are not spellable after step 1 and need no rule.
- It runs **after** step 3 rather than before. Either order is correct today — a leading-dot name has an empty or `_` stem and is never reserved — but this order states the dependency once: **every prefixing rule runs after the last rule that inspects the front of the string.**

### Forward constraint on any later length bound

The ticket decides a length bound is **out of scope**, not open (see § Non-goals). If a later ticket adds one anyway, it must run **after both steps 3 and 4** — prefixing a character to an already-truncated result puts it back over the bound, and the 255-byte-name-beginning-with-a-dot row is where that shows. Say so in the doc comment, so the constraint travels with the function rather than living only here.

### Contract to state in the doc comment

Not prose to copy — the properties the comment has to carry:

- **What is returned**: exactly one path component, never empty, never `.` or `..`, never beginning with `.`, containing no separator and no control character, never a Windows reserved device name, ASCII by construction.
- **What is *not* returned: a unique name, deliberately.** `a/b` and `a_b` both answer `a_b`; every unusable name answers `FALLBACK_FILENAME`, which makes the fallback the most collision-prone value in the range; and APFS is case-insensitive by default, so `Report.pdf` and `report.pdf` are one file on this app's primary platform. **The no-overwrite guarantee belongs to the write, not here** — #814 owns it, on `saveDebugBundle.ts`'s exclusive-create precedent. Do not add an existence check.
- **What it must *not* be called on**: an attachment identifier. Sanitising an id changes which attachment is addressed; `resolveAttachmentPath` (#818) is that half, and it refuses rather than rewrites. Name the sibling by symbol so the two are greppable together.
- **That this is the sanctioned crossing** of the `CLAUDE.md` / `events.ts` "never a filename, a cache key, or a lookup path" rule, and that the exemption is bought by the transform — a caller that builds a path from the *raw* field instead has bypassed it. The return is a plain `string`, indistinguishable from the raw name, so nothing structural enforces this (§ Security review).
- **That the never-log rule still binds the output.** Sanitising removes the log-injection half of the hazard: the result carries no newline and no control character, so it cannot forge a log line. It does not touch the privacy half — a file name is often private in itself. "Sanitised" therefore does not mean "safe to log", and #814 must not read it that way.
- **That there is no length bound here, on purpose**, and that an over-long name surfaces as `ENAMETOOLONG` from #814's write rather than being silently shortened.
- **Pure, synchronous, total, throw-free, log-free**: no filesystem, no socket, no wire, no state, no `console.*`, nothing to cancel.

### Non-goals

- **No length bound. Decided, not open.** 1772 truncates to 255 bytes because the daemon's wire bound has no validator. Nothing here has been observed to need one: no attachment name can reach this app until #687 lands, and the binding constraint is whole-path `PATH_MAX`, which only the write knows the directory for. Adding a bound now would be a defence for an unobserved failure mode, and it would drag in a rune-safe truncation helper and its own direct test for nothing. An over-long name is #814 AC 5's `ENAMETOOLONG`.
- **No existence check, no collision suffix, no uniqueness.** #814, via the `saveDebugBundle` exclusive-create loop.
- **No path construction and no directory layout.** The function returns a component; joining it behind a directory is #814's.
- **No identifier validation.** #818, already merged.
- **No consumer, no IPC channel, no `src/main/index.ts` edit.** The module ships unreferenced.
- **No knowledge-base doc.** The developer's deliverables end at the two files above; `docs/knowledge/features/` is the documentation phase's.

## State and concurrency model

None, and that is the design. The function holds no state, takes no lock, touches no module-level mutable binding, and awaits nothing — the two `RegExp` constants are used only via `.test()` and carry **no `g` or `y` flag**, so there is no `lastIndex` to be shared across calls. It is re-entrant and safe to call from anywhere in the main process. There is no store slice, no async task, no stream, and nothing to tear down on window close.

## Error handling

There is none, and the absence is the contract rather than an omission. The function is **total**: every string has a safe component, so a refusal would have no better answer to offer than the fallback already gives. Returning a `{ok, reason}` union like #818's would push a branch into every call site that could only ever log or ignore it — and logging it is precisely what the never-log rule forbids.

The consequence is structural: with no error there is no error string, so this file has no second surface for a private file name to leak through. Nothing in it can throw either — string concatenation, `RegExp.test` on a non-global pattern, `toLowerCase`, `indexOf` and `slice` are all total on a `string`.

Failure modes that belong elsewhere, named so they are not rediscovered as gaps: an over-long name (`ENAMETOOLONG`, #814), a name that collides with an existing file (`EEXIST` → next candidate, #814), and a malformed attachment identifier (`{ok:false}`, #818).

## Testing strategy

One new file, `src/main/attachmentFilename.test.ts`. Static, pure, no temp dir, no fixture, no cleanup — vitest under `environment: 'node'`, and nothing here renders.

**Assert the universal postconditions on every row, in addition to the row's own expected string.** All five criteria are stated on the *returned value*, so they hold for every input rather than only for the row aimed at them; asserting them in one shared helper is both cheaper and stronger than scattering them across rows. Write `expectSafeComponent(got)` checking: non-empty; contains no `/` and no `\`; is neither `.` nor `..`; does not begin with `.`; contains no character below U+0020 and no U+007F; **every character is on the allowlist** (the positive form — free, and stronger than the two negative clauses above it); and the lowercased stem is not a reserved device name. Every row in every table below runs through it, which makes each row a fixture for all five criteria at once.

Carry over #818's header rule verbatim: **never build an expectation from the function's own return value.** Every row states its expected string as a literal.

### Rows — exact input → expected output

**AC 1 — one component, no separator, no dot-leading result.** Expected strings, not property assertions:

- `'../etc/passwd'` → `'_.._etc_passwd'` — both separators replaced, and the result began with `.` so step 3 prefixed. The ticket's own example.
- `'a/../b'` → `'a_.._b'` — no prefix; the result does not begin with `.`.
- `'a\\b'` (a single backslash) → `'a_b'` — AC 1 names both separators; this is the `\` half.
- `'..'` → `'_..'` and `'.'` → `'_.'` — the two rows that pin prefix-not-suffix. A suffixing build answers `'.._'` / `'._'` and these are its sole reds.
- `'.bashrc'` → `'_.bashrc'`, `'.ssh'` → `'_.ssh'`.
- `'a.b.c'` → `'a.b.c'` — a non-leading dot is untouched, so the rule is positional rather than a blanket dot ban.

**AC 2 — the fixed fallback.** Every row answers `FALLBACK_FILENAME`:

- `''` — the empty input.
- `'///'` — **the row that makes AC 2's second arm live.** A build whose emptiness check reads the result answers `'___'` here; this row is its sole red.
- `'報告書'` — a legitimate non-ASCII name where nothing survives. Include it beside `'///'`: it is what shows the stronger reading is the *useful* one, not merely the literal one, and it is the visible cost of an ASCII allowlist.
- `'\x00\n'` — control characters only.
- A dedicated `it` asserting the fallback is a **fixpoint**: `sanitizeAttachmentFilename(FALLBACK_FILENAME) === FALLBACK_FILENAME`. One line, and it turns red on any future edit that gives the constant a leading dot, a separator, or a reserved stem — which is what licenses step 2 returning it directly instead of routing it through steps 3–4.

**AC 3 — control characters:**

- `'report.txt\x00.exe'` → `'report.txt_.exe'` — **name this row on its own**; the ticket calls it out and it is the classic filename attack, not one control character among several.
- `'a\nb'` → `'a_b'`, `'a\rb'` → `'a_b'`, `'a\r\nb'` → `'a__b'` — the last pins that the map is per-character and does not collapse runs.
- `'a\x7fb'` → `'a_b'` — DEL is above the C0 range a naive `< 0x20` denylist would check, and dies on the allowlist for free.

**AC 4 — Windows reserved device names.** Each expects the input with `_` prefixed:

- `'CON'` → `'_CON'`, `'con'` → `'_con'` — the case-fold pair.
- `'CON.txt'` → `'_CON.txt'` — extension ignored.
- `'NUL.tar.gz'` → `'_NUL.tar.gz'` — **first-dot, not last-dot, stem semantics**; a build that takes the stem after the *last* dot answers `'NUL.tar.gz'` unchanged and this row is its sole red.
- `'PRN'`, `'AUX'`, `'COM1'`, `'COM9'`, `'LPT1'`, `'LPT9'` — the range endpoints, each prefixed.
- **Near-misses that must come back unchanged**, or the rule is over-broad: `'CONSOLE.txt'`, `'COM.txt'` (no digit), `'COM10'` (two digits), `'contract.pdf'`. These are the sole reds for a prefix-match or substring-match implementation.
- `'constructor.txt'` and `'toString'` → unchanged. The rows that redden an object-literal lookup table (§ Design, step 4).
- `'.CON'` → `'_.CON'` — one prefix, not two. The stem after step 3 is `'_'`, not `'con'`, so step 4 does not fire; a build that runs step 4 on the input answers `'__.CON'`.

**AC 5 — byte-identity for an already-safe name.** Assert equality with the input:

- `'report-2026.pdf'`, `'a_b-c.tar.gz'`, `'README'`, `'2026'`.
- `'___'` and `'_'` — **the rows that pin step 2's flag against every result-derived emptiness check.** A row aimed at "the distinction comes from the input, not the output" has to use the value whose *output* is indistinguishable from the property's absence, and `'___'` is exactly that value.
- Note in a comment that AC 5's "already one safe component" excludes a reserved device name: `'CON'` is a valid single component on POSIX and still must not be the result, which is why it lives in AC 4's table and not this one.

**Non-vacuity control.** One `it` asserting a plain name comes back unchanged, stated as its own test rather than only as an AC 5 row — a build that returns `FALLBACK_FILENAME` for every input satisfies every negative postcondition above and would otherwise score full green.

**Module-graph pin.** Copy `attachmentPath.test.ts:127-138`'s source-text test, with the expected specifier set **empty** — this module imports nothing at all, not even `node:path`. Extend the same `it` with one further assertion: the source contains no `console.` occurrence. Two greps, five lines, and together they are the sole red for a future `electron` import, a `node:fs` import, a renderer import, or a log call — each of which this design forbids in prose and would otherwise be enforced only by review. **Deliberately not an acceptance criterion** (the AC list is all observable behaviour of the returned value, per the ticket); it is a testing-strategy decision.

### Verification

`npm test` and `npm run typecheck`. No e2e tier is involved — nothing here reaches a socket, a subprocess, the filesystem, or the window, and no `e2e/` spec changes.

The "sole red" claims above are stated as design intent, not as measurement. They are cheap for code review to spot-check by hand: each names one implementation variant and one row.

## Open questions

- **The fallback's value.** `'attachment'` is descriptive, extensionless, and honest about carrying nothing from the client — and it matches the daemon sibling, which keeps the pair greppable. `'_'` would be shorter and read as noise on disk. Take `'attachment'` unless #814's Downloads layout gives a reason to prefer otherwise. Either satisfies every criterion.
- **The fallback carries no extension**, so a file saved under it has no OS handler association. Declined rather than open: the wire's `mime_type` rides the same frame and the raw name still renders in the bubble, so #814 has the material to do better at the write if it wants to. Noted so it is not rediscovered as a bug.
- **A branded type for the sanitised value** — see § Security review, Trust boundaries. Declined for this slice; #814 is where the question becomes real.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** SHOULD FIX, discharged in the doc comment. `sanitizeAttachmentFilename` *is* the boundary — one exported function, the whole crossing from a model-chosen wire string to a host-side path component, with nothing scattered elsewhere. The weakness is that it returns a plain `string`, indistinguishable from the raw `filename` field it was derived from, so nothing structural stops #814 from building a path out of the raw field instead. A branded `type SafeComponent = string & { readonly __brand: unique symbol }` would make the boundary type-visible and is genuinely cheap in TypeScript; declined here because this ticket fences path construction to #814, because the repo defines no branded types anywhere today (introducing the idiom in a module with no consumer is preemptive abstraction), and because #818's sibling returns a plain `string` inside its result union. The mitigation that costs nothing is the doc comment's imperative plus a hand-off: **#814's spec must require this call to be the only place the save path reads `filename`.** Note also that "sanitised" is host-side only — it says nothing about rendering, and the raw name keeps being displayed by design (#686).
- **[Tokens, secrets, credentials]** Not applicable — no token, no key, no randomness, no comparison against a secret. One adjacent property does apply and is easy to get backwards: a file name is treated as **private in itself**, which is why the never-log rule survives sanitisation (see Errors/logs below). Disk permissions for the eventual stored file are #814's (`saveDebugBundle`'s `mode: 0o600` is the precedent).
- **[File operations]** No findings in this slice — it opens nothing, stats nothing, joins nothing, and constructs no path. Four hand-offs, all real:
  - **Traversal is discharged, and discharged on the built result.** No `/` and no `\` (neither is on the allowlist), and neither `.` nor `..` (step 3's prefix). The component is also never empty, so a later `resolve(dir, component)` can never collapse to `dir` itself — the exact hazard #818's alphabet lower-bound exists to close on its side. NUL is worth naming separately: `report.txt\x00.exe` dies at step 1 with everything else outside the allowlist.
  - **Two one-character mistakes reopen the category, and both are silent** (§ Design, "Two one-character traps"). Transposing the allowlist's trailing hyphen into `[.-_]` admits `/` and disables the whole function; taking the stem with `slice(0, indexOf('.'))` mis-tests an extensionless name and lets `CON` through. Each has a named red row, which is what keeps them from being review-only properties.
  - **The component is not unique, and that is an overwrite hazard one layer up.** `a/b` and `a_b` both answer `a_b`; every unusable name answers `'attachment'`, making the fallback maximally collision-prone; and APFS is case-insensitive by default, so `Report.pdf` and `report.pdf` are one file on macOS — the same platform property #818 cites for its case-unambiguous alphabet. If #814 writes by this component alone with a plain `writeFile`, a second attachment silently overwrites a first. #814 must use `saveDebugBundle`'s exclusive-create loop. Stated in the doc comment so the obligation travels with the function.
  - **Windows strips trailing dots and spaces before resolving a name**, so `'report.'` resolves as `report` and `'_..'` resolves as `'_'`. Named and declined: neither shape can produce traversal (the stem check and the leading-dot prefix both survive the strip) nor a device name (the stem is checked before any strip could apply), and no failure mode here has been observed. Recorded so it is not rediscovered.
  - `PATH_MAX` (1024 on macOS, 4096 on Linux, 260 for a non-long-path Windows API) bounds the whole path, where `NAME_MAX` bounds this component. Neither is enforced here, on purpose (§ Non-goals) — the arithmetic needs the directory, which only #814 knows, and it surfaces as `ENAMETOOLONG` there.
- **[Inter-process / Electron attack surface]** No findings **in this slice**, and the reason is that it has no surface: the module ships unreferenced, so it adds no `BrowserWindow`, no `webPreferences`, no `contextBridge` API, no `ipcMain.handle`/`ipcMain.on` channel, no custom-protocol or deep-link handler, and no navigation. Nothing to configure and nothing to minimise. Two hand-offs to #814, both about *where* the call goes rather than what it does:
  - **The sanitise must happen in main, on the value main uses to build the path** — never in the renderer with main trusting the returned component. The renderer is untrusted relative to the main process even though both are our code; a component that arrives over `contextBridge` is an untrusted string like any other, and main re-running the function on it is the only thing that makes it safe. The module lives in `src/main/` so the renderer cannot import it today, and it must not be re-exposed across the bridge.
  - **A compromised renderer would still choose the on-disk name** if #814's channel accepts a `filename` argument rather than reading it from main-held state. Bounded — the result is still one safe component inside one directory, and `saveDebugBundle`'s exclusive-create loop stops it overwriting anything — so this is a SHOULD FIX for #814, not a gate here: prefer keying the save off the attachment identifier (#818's `resolveAttachmentPath`) and carrying the filename from main's own copy of the wire frame.
- **[Subprocess / external command execution]** OUT OF SCOPE, named rather than dismissed. `-` is on the allowlist, so `-rf` survives as `-rf`, and a component passed as an argv element would parse as a flag. No current or planned path does that — the component is only ever joined behind a directory in #814, where it is never argv-leading. Adding a leading-`-` rule now would defend an unobserved failure mode while mangling the legitimate name `-report.pdf`. The nearer relative is `shell.openPath` (#691), which takes a path rather than an argv and resolves by extension, not by leading character; that slice owns its own check, and it consumes #818's identifier path rather than this component. Nothing here reaches a shell or touches the environment.
- **[Cryptographic primitives]** Not applicable. One deliberate decision worth recording: the fallback is a fixed constant and is **not** randomised or hashed. AC 2 requires the same answer every time, and a random fallback would trade a documented collision for a non-deterministic filename no test could pin.
- **[Network & I/O]** One finding, no fix needed here. Nothing bounds this function's input: the wire's filename bound is a producer-side contract with no validator on either side, and no bound is added here (§ Non-goals). A hostile daemon could therefore send a filename as large as the application envelope allows. The cost is **bounded and linear** — one pass appending at most one character per input character, then two `RegExp.test` calls on non-global anchored patterns and one `toLowerCase` — so it is O(input) with no amplification and no backtracking (both patterns are a single character class; neither can backtrack). It is not a DoS vector. The one implementation note with a security reason behind it: build the result with a `for…of` append (or an array `join`), and **do not** write the map as a repeated `String.replace` over the whole string per character, which would be quadratic. Rejecting an over-long name outright, if the app ever wants to, belongs to the wire decode.
- **[Errors, logs, telemetry]** MUST-NOT-LOG, and the reason is easy to get wrong. Sanitising removes the *log-injection* half of the hazard — the output carries no newline, no `\r` and no control character, so it cannot forge or split a log line — but it does not touch the *privacy* half: a file name is often private in itself, and `CLAUDE.md`'s never-reaches-a-log rule binds the output exactly as hard as the input. **"Sanitised" must not be read as "safe to log"**, and the doc comment says so for #814's benefit. Structurally the file has no error strings at all (§ Error handling) and no `console.*`, so there is no second surface for the name to leak through; § Testing strategy pins the `console.` absence with a source-text grep rather than leaving it to review.
- **[Concurrency]** No findings. The function is pure and holds no state; the two `RegExp` constants are module-level and shared across calls, which is safe **only because neither carries a `g` or `y` flag** — a global pattern reused via `.test()` carries mutable `lastIndex` and would return alternating results under repeated calls. That is a live TypeScript footgun with no Go analogue in the 1772 original, so § Design states the constraint on the constants explicitly rather than leaving it implicit in the flags.
- **[Threat model alignment]** The threat is a model-chosen file name reaching the user's filesystem — the assistant generates a file, names it, and the name arrives over a channel the app treats as untrusted. This slice discharges the rewrite half of that: it is the single sanctioned crossing of the standing `CLAUDE.md` / `events.ts` rule that daemon text is never a filename, and the exemption is bought by the transform rather than asserted. The check half — an attachment *identifier*, refused rather than rewritten — is #818 and is already merged; the two are deliberately separate modules because rewriting an identifier changes which attachment is addressed. What this slice does **not** discharge, and does not claim to: the write's no-overwrite guarantee (#814), the whole-path length bound (#814), and rendering safety for the raw name, which stays with the bubble exactly as #686 published it.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-08-27
