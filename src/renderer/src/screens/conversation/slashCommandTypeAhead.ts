// #939 — the slash type-ahead's opening, filtering and completion decisions, as plain data. Framework-free
// and DOM-free, co-located with the screen like composerSend.ts / composerOptionsKeyboard.ts /
// composerOptionsPlacement.ts / threadScrollPosition.ts.
//
// WHY IT IS A MODULE RATHER THAN A CONTAINER. composerOptionsKeyboard.ts's reason verbatim: nothing in
// this repo can click. vitest.config.ts sets `environment: 'node'`, there is no jsdom and no
// @testing-library, and every renderer spec renders through renderToStaticMarkup. So the proof has to be
// ARRANGED — everything the type-ahead DECIDES is a total function of the composer's text and the
// published command list, where a vitest spec can execute it, and what is left in #940's container is the
// useState and the wiring, thin enough to be correct by inspection.
//
// It composes WITH the shipped keyboard module rather than duplicating it. `resolveComposerOptionsKey`
// already owns arrows-with-wrap, Enter-picks and Escape-dismisses, and `initialFocusedOptionIndex`
// already opens a command list (`currentId: null`) on its first row. None of that is re-decided here.
// What IS here is the part the TEXT decides. The reverse coupling is already accounted for on that side:
// filtering narrows the list while the panel is open, so a focused index can end up addressing no row,
// and that module's Enter arm is range-guarded for exactly this reason.
//
// ENTER COMPLETES, IT DOES NOT SEND. Enforcing that is the container's job; what this module returns is
// text for the box and never a message to send.

import type { WireSlashCommand } from '@shared/wire/types'

/**
 * The composer text that opens the panel: a slash followed by zero or more NON-SPACE characters, with
 * the fragment captured. `null` when the text is anything else.
 *
 * ONE RULE COVERS ALL FOUR REQUIREMENTS, because claude only intercepts a message that BEGINS with a
 * slash: a slash typed first opens the panel, a slash anywhere else opens nothing, deleting the slash
 * closes it, and typing the space before an argument closes it — argument completion is out of scope, so
 * once an argument is being typed there is nothing left to offer.
 *
 * `\S` rather than a literal space, so a tab or a newline terminates too: a fragment is one unbroken run
 * by construction. JavaScript's `$` is strict end-of-input — unlike Python's it does NOT also match
 * before a trailing newline — so `"/clear\n"` is closed rather than silently trimmed. The pattern is
 * anchored at both ends with no alternation and no nested quantifier, so it is linear on any input.
 */
const SLASH_FRAGMENT = /^\/(\S*)$/

function openFragment(text: string): string | null {
  const match = SLASH_FRAGMENT.exec(text)

  return match === null ? null : match[1]
}

/**
 * Whether this row's alias list must be read as UNKNOWN rather than as *none*.
 *
 * `aliases: []` states NOTHING on its own. Claude never emits an empty alias array — against the capture
 * `initialize_control_v2.1.239.json` (51 entries), 42 omit the key and 9 carry a non-empty one, zero
 * carry `[]` — so an entry with no aliases and an entry whose aliases the daemon cut to nothing arrive as
 * the identical wire value, and a `truncated_fields` NAMING `aliases` is the only thing separating them.
 *
 * Written with an explicit `!== null` rather than `truncated_fields?.includes('aliases')`. The
 * optional-chaining form is the exact trap `WireSlashCommand`'s doc comment names: reached through a bare
 * `as` on `Envelope.payload` an absent key is `undefined`, and `?.` is then falsy for the same reason
 * `null` is, silently inverting the rule. The list arrives here through #936's fail-closed narrower, which
 * is what makes the reading sound; spelling the null test out is what keeps that dependency visible.
 *
 * A cut `name` is deliberately NOT handled, and the asymmetry is the ticket's: completing a truncated name
 * sends a command claude answers with a zero-cost "Unknown command", where a mishandled cut alias
 * silently hides a working one.
 */
function hasUnknownAliases(command: WireSlashCommand): boolean {
  return command.truncated_fields !== null && command.truncated_fields.includes('aliases')
}

// How well one row answers the typed fragment. A sealed union rather than three ordered numbers, on
// purpose: nothing sorts by this value — the buckets below are concatenated in a fixed order — so a rank
// that looked comparable would advertise a mechanism that is not there.
//
// Not exported, and deliberately not a field on the result either: the ORDER of the returned array is the
// whole report, and a consumer able to read a rank would be tempted to draw a maybe-row differently — a
// decision that belongs to #940 the day an acceptance criterion asks for it.
type CommandRank = 'prefix' | 'contained' | 'none'

/**
 * Rank `command` against an already-lower-cased `needle`, over its `name` and each of its visible aliases.
 *
 * A contains hit does NOT stop the scan: a row that merely contains the fragment in its name but PREFIXES
 * it in a later alias is a prefix match, and breaking early would rank it below rows it should outrank.
 *
 * `toLowerCase()`, never `toLocaleLowerCase()`. The locale-aware form makes the same list answer the same
 * keystrokes differently for a Turkish-locale user (dotless `i`), which is a matching rule that changes
 * under the user's machine settings. There is no other normalisation — no `normalize()`, no trim, no
 * charset assumption: the ticket asks for the case-insensitive comparison and nothing beyond it, and one
 * measured name is `__remote-workflow`. The `description` is never searched; a fragment matching only
 * prose would hand the user a command whose name they never typed.
 */
function rankCommand(command: WireSlashCommand, needle: string): CommandRank {
  let rank: CommandRank = 'none'

  for (const candidate of [command.name, ...command.aliases]) {
    const folded = candidate.toLowerCase()
    if (folded.startsWith(needle)) return 'prefix'
    if (folded.includes(needle)) rank = 'contained'
  }

  return rank
}

/**
 * The rows the type-ahead should show for `text`, in the order it should show them — and an EMPTY ARRAY
 * when the panel should not open at all.
 *
 * THE EMPTINESS IS THE OPEN STATE, and that is deliberate rather than a shortcut. The panel opens exactly
 * when the text is a bare slash-fragment AND there is at least one row to show, so encoding the answer as
 * a row list makes "open with zero rows" unrepresentable rather than merely forbidden — a fragment nothing
 * can match reports closed instead of an empty box, through the same return as an absent list. All six
 * closed cases share it: empty text, a slash after any other character, a slash followed by a space,
 * `commands === null` (no frame has arrived), `commands: []` (claude published an empty menu), and no
 * match. It is also this cluster's existing convention — `ComposerOptionsMenu`'s consumers already gate on
 * `options.length`, and `resolveComposerOptionsKey` answers `ignore` below one option.
 *
 * THE ONE HAZARD IT CARRIES: `[]` is truthy in JavaScript. A container writes
 * `rows.length > 0 && <ComposerOptionsPanel …/>`, never `rows.length && …` (which renders a bare `0`) and
 * never `rows && …`.
 *
 * ORDER. A name that STARTS with the fragment sorts above one that merely CONTAINS it, and within each
 * group claude's published order is preserved — three buckets concatenated rather than a sort, so the
 * stability is by construction and does not rest on `Array.prototype.sort`'s guarantee. A row whose alias
 * list is unknown and which nothing visible matched trails both groups: it is a MAYBE, not a match, so it
 * must not outrank a row the user's own fragment genuinely hit, and where it is the only candidate it
 * keeps the panel open rather than closed. Cuts are rare — the whole measured 51 fit in 14,277 bytes —
 * so this costs a bounded tail of extra rows and buys the user story's stated failure not happening.
 *
 * A LONE `/` needs no special case: the empty fragment is a prefix of every string, so every row lands in
 * the first bucket and the whole list comes back in published order.
 *
 * ROWS ARE RETURNED BY REFERENCE — the objects the store holds, verbatim, nothing projected, copied or
 * normalised, which is `slashCommandListStore`'s own posture carried one hop further. The ARRAY is fresh
 * on every call and its identity is deliberately not a contract: do not `useEffect` on it.
 *
 * Total: it throws for no input, mutates nothing it is handed, and every row it returns came from
 * `commands`.
 */
export function slashCommandTypeAheadRows(
  text: string,
  commands: readonly WireSlashCommand[] | null
): readonly WireSlashCommand[] {
  const fragment = openFragment(text)
  if (fragment === null || commands === null) return []

  const needle = fragment.toLowerCase()
  const prefix: WireSlashCommand[] = []
  const contained: WireSlashCommand[] = []
  const unknown: WireSlashCommand[] = []

  for (const command of commands) {
    switch (rankCommand(command, needle)) {
      case 'prefix':
        prefix.push(command)
        break
      case 'contained':
        contained.push(command)
        break
      case 'none':
        // Nothing VISIBLE matched. The row survives only if what it can show is not all there was —
        // never merely because its alias array is empty, which says nothing at all.
        if (hasUnknownAliases(command)) unknown.push(command)
        break
    }
  }

  return [...prefix, ...contained, ...unknown]
}

/**
 * The text a picked row puts in the box: the CANONICAL name with its leading slash, plus exactly one
 * trailing space when the row's argument hint is non-empty and none when it is empty.
 *
 * Canonical even for a row matched only by an alias, so nothing downstream has to resolve an alias back —
 * which is why this takes the row rather than a matched string.
 *
 * Both branches are ordinary rather than one being an edge case: the hint is empty on 33 of the capture's
 * 51 entries. The emptiness test is LITERAL, not trimmed — normalising a hint of `" "` would be
 * normalisation nothing asked for, on a field the daemon bounds without sanitizing.
 *
 * THE TWO RULES AGREE BY CONSTRUCTION: completing a hinted command produces a trailing space, and a slash
 * followed by a space is closed, so the panel gets out of the way exactly when an argument is about to be
 * typed. Completing an UN-hinted command leaves the fragment intact and the panel matching, which is why
 * the container closes it on pick rather than relying on the text to do it.
 *
 * It takes the whole row rather than `(name, argumentHint)` for composerOptionsPlacement.ts's reason: two
 * `string` parameters transpose silently and produce a wrong answer with no type error.
 *
 * The name is copied VERBATIM — no escape, no trim, no case change, no charset assumption. It is
 * workspace-authored text bounded but not sanitized by the daemon, and its destination is a controlled
 * textarea value: plain text, never markup, an attribute, a URL, a filename, a cache key or a log.
 */
export function completeSlashCommand(command: WireSlashCommand): string {
  return command.argument_hint === '' ? `/${command.name}` : `/${command.name} `
}
