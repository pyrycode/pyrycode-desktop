// The display shortener for tool subject paths — framework-free and React-free, co-located with the
// screen like messageViewModel.ts / sendInterrupt.ts / threadScrollPosition.ts. It performs no effects,
// so like threadScrollPosition it takes no injected deps: it is a total function of one string.
//
// Why it shipped on its own, unreferenced: this is the one piece of the tool-row work (#606's split)
// with no daemon dependency and no UI, so isolating the rule here gave the feature a tested core while
// its three siblings waited on the daemon. It stayed dormant until #705, which is its first and only
// caller. (This paragraph and the next used to describe a `kind`/`subject` pair the daemon never sent;
// #705 corrected them against the shape that actually shipped — #642 decodes the tool's INPUT MAP off
// the wire, name → value, and #643 carries that onto the timeline item. `subject` exists nowhere in
// src/; `kind` does exist, as ThreadItem's union discriminant, which is what made the old instruction
// fail SILENTLY rather than erroring — it reads `'toolCall'` on every row, so a caller following it
// would have shortened everything.)
//
// Display formatting only, never path resolution: it never touches the filesystem, never normalises `.`
// or `..`, and never decides whether a string is a real path. Whether a value is a path at all is the
// caller's decision — toolHeadline.ts makes it from the FIELD NAME the headline was taken from
// (`file_path`, `path`, `notebook_path`), and shortens only those. A command line, a search pattern and
// a URL are passed through untouched: splitting them on `/` would mangle them into something that reads
// like a path and is not one.
//
// ZERO imports, deliberately: not React, not a store, and above all not `node:path`. A `node:path`
// implementation would split on a backslash under Windows, so the result would vary with the host; a
// file with no import statements is the whole of that guarantee, readable at a glance.

/**
 * How many trailing segments survive shortening: three folders plus the file name.
 *
 * Exported rather than inlined because it is the entire content of a resolved ambiguity. #606 stated the
 * form as "the last three folders plus the file name" — four segments — but illustrated it with
 * `.../screens/conversation/ConversationScreen.tsx`, which keeps two; the example was written with no
 * source path beside it, so the two never had to agree. pyrycode#1678 refuses to specify ("shortening for
 * display is the client's job and must not be done here") and mobile has no counterpart helper, so
 * nothing upstream settles it. This takes the rule as written. If the operator meant three segments in
 * total, this number goes to 3 and one test assertion changes — nothing else in either file moves.
 */
export const KEPT_SEGMENTS = 4

/**
 * Shorten a path to its last few segments for display, prefixed with `...` when anything was dropped.
 *
 * Split on `/`, drop the empty entries, and hand back the input UNCHANGED when `KEPT_SEGMENTS` or fewer
 * remain; otherwise rebuild from the last `KEPT_SEGMENTS`. Dropping the empties is the whole of the
 * leading, trailing and repeated-separator handling — none of them is a case of its own, and neither is
 * the separator-only string, which simply has no segments left to count. `/` is the only separator, so a
 * backslash is an ordinary character inside a segment and the result is identical on every host.
 *
 * Two properties of that shape are deliberate:
 *
 * - **The passthrough is verbatim; the shortened form is not.** A path that fits comes back as it went
 *   in, keeping a doubled or trailing separator, because this is a display passthrough and not a
 *   normaliser. A path that is shortened is rebuilt from its kept segments, so a doubled separator
 *   inside the kept window collapses and a trailing one is dropped. That asymmetry is intended.
 * - **The shortened output is display text, not a path.** `.../b/c/d/e.txt` resolves to nothing and is
 *   never meant to; nothing downstream may feed it back into a path operation.
 *
 * Total over `string`: split, filter, slice and join cannot throw, so there is no guard here by design —
 * no try/catch, no length cap, no null check. The signature is the contract. If a case turns up that
 * genuinely needs a second branch, that is a signal the criteria are wrong — route back rather than
 * guarding around them.
 */
export function shortenPath(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0)

  if (segments.length <= KEPT_SEGMENTS) {
    return path
  }

  return `.../${segments.slice(-KEPT_SEGMENTS).join('/')}`
}
