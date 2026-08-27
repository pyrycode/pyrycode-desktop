// The attachment-file-name → path-component rewrite. An attachment's file name arrives over the wire
// and is model-chosen — the assistant generates a file and names it — so it may carry `/` or `\`, `..`,
// a leading dot, a Windows reserved device name, or a control character including NUL. This module is
// the single place such a string becomes a host-side path component.
//
// It is THE ONE SANCTIONED CROSSING of a standing repo rule. CLAUDE.md and the field comments in
// src/shared/ipc/events.ts both say daemon-supplied text is never "a cache key, a filename, or a lookup
// path"; this function crosses that rule, and the exemption is bought by the TRANSFORM — a caller that
// builds a path out of the raw wire field instead has bypassed the gate rather than used it. That is why
// this is its own module carrying its own header, and not a few lines inside #814's write.
//
// It is the mirror image of its sibling `resolveAttachmentPath` (attachmentPath.ts, #818). An attachment
// IDENTIFIER is checked and REFUSED, never rewritten, because rewriting one changes which attachment is
// addressed. A file NAME is REWRITTEN and never refused, because every input has a safe answer and a
// refusal would have nothing better to offer than the fallback already gives. Two contracts, two modules.
//
// It lives in src/main because sanitising untrusted wire text on the way to the filesystem is a
// background-process concern, and the renderer must not be able to import it: the renderer is untrusted
// relative to the main process even though both are our code, so a component that arrived over the
// bridge is an untrusted string like any other, and main re-running this function on the value it
// actually builds the path from is the only thing that makes it safe. The module imports NOTHING — no
// `electron`, no node built-in, nothing from the renderer — so its test module graph is Electron-free
// (pinned by a test, not by this paragraph). It is a PURE, SYNCHRONOUS, TOTAL, throw-free function: no
// filesystem, no socket, no wire, no state, nothing to cancel — and LOG-FREE by construction, with no
// `console` call anywhere.

/**
 * The component returned when nothing in the input survives the allowlist. Fixed, so the answer is the
 * same every time; a randomised or hashed fallback would trade a documented collision for a
 * non-deterministic name no test could pin. It is itself a fixpoint of the function (pinned by a test),
 * which is what licenses step 2 returning it directly instead of routing it through steps 3 and 4.
 *
 * It deliberately carries no extension, so it says nothing the client chose. A file saved under it has
 * no OS handler association; the wire's `mime_type` rides the same frame and the raw name still renders
 * in the bubble, so the write (#814) has the material to do better if it wants to.
 */
export const FALLBACK_FILENAME = 'attachment'

/**
 * One character the allowlist keeps, verbatim; everything else becomes `_`. Every guarantee this module
 * makes about separators, control characters and encoding is a consequence of this one line, so it ships
 * at its narrowest — widening it later is backward-compatible, narrowing it is not.
 *
 * - Traversal, control characters and encoding are discharged AT ONCE, because the list is POSITIVE.
 *   `/` is not on it, nor `\`, nor NUL, nor DEL, nor U+202E, nor a space, nor a shell metacharacter.
 *   Nothing has to be enumerated, so nothing can be forgotten — that is the whole argument for an
 *   allowlist over a denylist here.
 * - Every kept character is ASCII, so the result is well-formed by construction rather than by a check:
 *   an unpaired surrogate is not on the list and decays to `_` like anything else.
 * - ASCII-only has a visible cost, accepted: `Raportti-läpivienti.pdf` saves as
 *   `Raportti-l_pivienti.pdf`. #686 ruled the saved name and the displayed name may differ, and the
 *   bubble still renders the real wire name — nothing here changes what is shown.
 * - `.` stays on the list. Dropping it would satisfy the never-`.`/never-`..` rule trivially and break
 *   byte-identity, which needs `report-2026.pdf` back unchanged.
 * - THE HYPHEN IS LAST, AND THAT IS LOAD-BEARING. A trailing `-` is a literal; `[A-Za-z0-9.-_]` is a
 *   RANGE from `.` (U+002E) to `_` (U+005F), and that range contains `/` (U+002F). The transposition
 *   admits the separator and silently stops this function sanitising anything at all.
 * - It is ANCHORED and carries no `g` and no `y` flag. A global pattern reused through `.test()` carries
 *   a mutable `lastIndex`, which on a shared module constant would return alternating answers across
 *   calls; flagless is what makes this constant safe to share.
 */
const ALLOWED_CHARACTER = /^[A-Za-z0-9._-]$/u

/**
 * A Windows reserved device name, matched on an already-lowercased stem. It spells `com[0-9]`/`lpt[0-9]`,
 * one character wider than COM1–COM9/LPT1–LPT9: Microsoft's current naming guidance lists COM0 and LPT0
 * too, the narrower range is covered a fortiori, and the widening costs no branch.
 *
 * A `RegExp` rather than an object-literal lookup table, on purpose: `RESERVED[stem]` inherits
 * Object.prototype, so `constructor`, `toString` and `valueOf` all read back truthy and would be
 * prefixed as if they were device names — a wrong answer reached with no attacker involved. Same
 * no-`g`/no-`y` rule as above.
 */
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/

/**
 * Reduce an untrusted, model-chosen attachment file name to exactly one safe path component.
 *
 * The returned component is never empty, is never `.` or `..`, never begins with `.`, contains no
 * directory separator and no control character, is never a Windows reserved device name, and is ASCII by
 * construction. TOTAL: every input has a safe answer, so there is no error, no result union and no
 * throw — and with no error there is no error string, so this file has no second surface a private file
 * name could leak through.
 *
 * WHAT IT DOES NOT RETURN IS A UNIQUE NAME, deliberately. `a/b` and `a_b` both answer `a_b`; every
 * unusable name answers FALLBACK_FILENAME, which makes the fallback the most collision-prone value in
 * the range; and APFS is case-insensitive by default, so `Report.pdf` and `report.pdf` are one file on
 * this app's primary platform. THE NO-OVERWRITE GUARANTEE BELONGS TO THE WRITE, NOT HERE — #814 owns it,
 * on saveDebugBundle.ts's exclusive-create (`flag: 'wx'`) precedent. Do not add an existence check here.
 *
 * DO NOT CALL THIS ON AN ATTACHMENT IDENTIFIER. Sanitising an id changes which attachment is addressed;
 * `resolveAttachmentPath` (attachmentPath.ts) is that half, and it refuses rather than rewrites.
 *
 * THE RETURN IS A PLAIN `string`, indistinguishable from the raw wire field it was derived from, so
 * nothing structural stops a consumer building a path out of the raw field instead. This call must be
 * the ONLY place a save path reads the wire's file name.
 *
 * "SANITISED" DOES NOT MEAN "SAFE TO LOG". The transform removes the log-injection half of the hazard —
 * the result carries no newline and no control character, so it cannot forge or split a log line — and
 * touches the privacy half not at all: a file name is often private in itself, so CLAUDE.md's
 * never-reaches-a-log rule binds this OUTPUT exactly as hard as its input.
 *
 * THERE IS NO LENGTH BOUND HERE, ON PURPOSE. The binding constraint is whole-path PATH_MAX, which only
 * the write knows the directory for, so an over-long name surfaces as ENAMETOOLONG from #814's write
 * rather than being silently shortened here. If a later ticket does add a bound, it must run AFTER steps
 * 3 and 4 below — prefixing a character to an already-truncated result puts it back over the bound.
 *
 * Pure, synchronous, total, throw-free, log-free: no filesystem, no socket, no wire, no state, nothing
 * to cancel. Re-entrant and safe to call from anywhere in the main process.
 */
export function sanitizeAttachmentFilename(name: string): string {
  // Step 1 — map, character-wise. `for…of` walks CODE POINTS, so an astral character is one item and
  // yields one `_` rather than two. The flag is stated relative to the allowlist ("some character
  // passed"), not to any particular allowlist, so widening the list later does not drift its meaning.
  let built = ''
  let anyCharacterSurvived = false
  for (const character of name) {
    if (ALLOWED_CHARACTER.test(character)) {
      built += character
      anyCharacterSurvived = true
    } else {
      built += '_'
    }
  }

  // Step 2 — the fallback, decided by the INPUT and never by the result. This is the one place the
  // design cannot look at its own output: `'///'` (nothing survived) and the literal client name `'___'`
  // (everything survived) both build `'___'`, so the two cases are indistinguishable there and any check
  // on the result collapses them, breaking one criterion or the other. The empty input appends nothing,
  // so its flag is false for the same reason `'///'`'s is, and one condition covers both.
  if (!anyCharacterSurvived) return FALLBACK_FILENAME

  // Step 3 — leading dot: PREFIXED, not appended, and run on the BUILT RESULT so it keeps holding if the
  // allowlist ever changes. `.` is on the allowlist, so `'.'` and `'..'` set the flag and arrive here
  // rather than at the fallback — this is the rule that answers them. The prefix discharges both clauses
  // with one rule: afterwards the result cannot begin with `.`, and a string that does not begin with
  // `.` is neither `.` nor `..`. A suffix would satisfy the second clause and leave the file hidden.
  if (built.startsWith('.')) built = `_${built}`

  // Step 4 — Windows reserved device name, taken on the stem before the FIRST dot, which is what covers
  // `NUL.tar.gz` as well as `CON.txt`. `split('.')[0]` and not `slice(0, indexOf('.'))`: `indexOf`
  // returns -1 when there is no dot and `slice(0, -1)` drops the last character, so `'CON'` would be
  // tested as `'CO'` and come back unprefixed. `toLowerCase` and not an `/i` flag: it is
  // locale-independent, with no Turkish-dotless-I hazard. Prefixing rather than falling back keeps the
  // client's name and reuses step 3's mechanism, and one pass suffices — no reserved name begins with
  // `_`, and the prefix cannot reintroduce a leading dot, so step 3's postcondition survives it. It runs
  // AFTER step 3 so the dependency is stated once: every prefixing rule runs after the last rule that
  // inspects the front of the string.
  if (RESERVED_DEVICE_NAME.test(built.split('.')[0].toLowerCase())) built = `_${built}`

  return built
}
