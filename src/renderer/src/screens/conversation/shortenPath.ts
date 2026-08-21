// The display shortener for tool subject paths — framework-free and React-free, co-located with the
// screen like messageViewModel.ts / sendInterrupt.ts / threadScrollPosition.ts. It performs no effects,
// so like threadScrollPosition it takes no injected deps: it is a total function of one string.
//
// Why it lives on its own, unreferenced: this is the one piece of the tool-row work (#606's split) with
// no daemon dependency and no UI. #642 and #643 carry the daemon's `kind`/`subject` onto the timeline
// item and #645 draws it; isolating the rule here gives the feature a tested core before any of it
// touches a component, and it is the reason this piece could ship while its three siblings wait on the
// daemon. It ships dormant BY DESIGN — #645 adds the caller; do not add one here to "prove it works",
// the sibling test proves it.
//
// Display formatting only, never path resolution: it never touches the filesystem, never normalises `.`
// or `..`, and never decides whether a string is a real path. Whether a subject is a path at all is the
// caller's decision — #645 makes that call from the tool `kind`, and shortens only the file-acting ones.
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
