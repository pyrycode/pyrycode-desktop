// #681 — whether each fixed Actions entry is a verb this conversation's workspace can actually run.
// Framework-free and DOM-free, co-located with the screen like composerSend.ts /
// composerOptionsKeyboard.ts / composerOptionsPlacement.ts / slashCommandTypeAhead.ts.
//
// WHY IT IS A MODULE RATHER THAN A COMPONENT. The sibling modules' reason verbatim: nothing in this repo
// can click, and vitest runs the `node` environment, so every renderer spec is a renderToStaticMarkup
// string assertion. A markup test can observe the greyed row but not the four UNKNOWN readings that
// decide it, so the whole decision is a total function of the store entry and the client's own entry list
// — where composerActionAvailability.test.ts executes it as data — and what is left in the menu is the
// store read and the wiring.
//
// SECURITY. This is the first consumer in the family to make a GATING DECISION from workspace-authored
// text, and the boundary is this file. `name` and every string in `aliases` are written by whoever wrote
// the repository claude is running in, bounded by the daemon and NOT sanitized (slashCommandListStore's
// header, WireSlashCommand's own note). Three properties hold here by construction rather than by review:
//
//   (a) THEY ARE ONLY EVER COMPARED. Nothing published is stored, returned, rendered, logged, or used to
//       build an index — the scan below is a linear `some` over the rows and deliberately NOT a Set, a
//       Map or an object keyed by `name`, which is the store header's "name is not an identifier" clause
//       carried one hop. Three client entries against a measured 51 rows costs nothing perceivable, and
//       it makes the property structural.
//   (b) THE GATE IS ONE-WAY. The only thing a published list can do is turn `unavailable` on, which makes
//       `ComposerOptionsMenu` return early. No branch anywhere lets a value from the frame become, alter
//       or select the text that is sent — the sent string is the client-owned entry id. So a hostile
//       workspace can at worst grey a row out, never send or substitute something the user did not pick.
//   (c) IDENTITY IS CARRIED THROUGH. `markUnavailableActions` spreads the caller's option and sets one
//       boolean; it never rebuilds `id` or `label` from a published row. Rebuilding them is exactly how
//       workspace text would reach the sent string, so the property is pinned by a test rather than left
//       to inspection.
//
// NOTHING HERE IS LOGGED, not even a content-free count of greyed rows. The store's header states that
// the no-diagnostic property has to be total to be worth anything, and this consumer inherits it.

import type { ComposerOptionsPanelOption } from './ComposerOptionsPanel'
import type { SlashCommandListEntry } from '../../store/slashCommandListStore'
import type { WireSlashCommand } from '@shared/wire/types'

/** The two `truncated_fields` names that can hide a match, in the wire's own vocabulary. A cut
 *  `description` or `argument_hint` is text this decision never reads, so it must not lock the menu —
 *  over-reading truncation would make a busy daemon's every frame useless. */
const MATCHABLE_FIELDS = ['name', 'aliases']

/**
 * Whether a row's own report leaves this decision anything it cannot see.
 *
 * Written with an explicit `!== null` rather than `command.truncated_fields?.includes(…)`. That is the
 * trap `WireSlashCommand`'s doc comment names and `slashCommandTypeAhead.ts` spells out from its own
 * side: reached through a bare `as` on `Envelope.payload` an absent key is `undefined`, and `?.` is then
 * falsy for the same reason `null` is, so the reader concludes nothing was cut. The list arrives here
 * through #936's fail-closed narrower, which is what makes the reading sound; spelling the null test out
 * is what keeps that dependency visible.
 */
function hidesAMatch(command: WireSlashCommand): boolean {
  return (
    command.truncated_fields !== null &&
    command.truncated_fields.some((field) => MATCHABLE_FIELDS.includes(field))
  )
}

/**
 * Whether this entry PROVES ABSENCE — whether a command the list does not carry can be concluded not to
 * exist. AC2, and the rule most easily got backwards.
 *
 * **IT INVERTS THE ASYMMETRY THE SIBLING MODULE CHOSE, on purpose.** `slashCommandTypeAhead.ts`'s
 * `hasUnknownAliases` deliberately IGNORES a cut `name`, because there completing a truncated name costs
 * a free zero-cost "Unknown command" reply while a mishandled cut alias hides a working command. Here
 * both cuts point the same way, and so does a frame-level drop: each can make a command that genuinely
 * exists look absent, and greying it out is the exact user-visible failure this ticket exists to prevent.
 * So absence is provable only from a COMPLETE list, and the condition below is wider than the helper it
 * resembles. Do not narrow it back by reusing that helper.
 *
 * Four readings, all of them ordinary rather than error states:
 *
 *   null                                        → false   no frame has arrived (best-effort delivery
 *                                                         names three loss points; a slow daemon, or one
 *                                                         older than the forwarding change, must not
 *                                                         lock the menu)
 *   droppedCommands > 0                         → false   a dropped row may be the one we asked about
 *   any row cut on `name` or `aliases`          → false   unknowable text that could have been the match
 *   otherwise, INCLUDING `commands: []`         → true    claude's positive statement of what it accepts
 *
 * `droppedCommands` is compared to `0` as a VALUE and never consulted for truthiness — the store writes
 * the key unconditionally, so an absent one is a defect rather than a valid zero.
 *
 * It is spelled as a TYPE PREDICATE rather than a plain boolean, which is honest (it answers true only
 * for a non-null entry) and is what lets `markUnavailableActions` narrow on it alone, with no second
 * null test that would be dead at runtime and read as a real branch.
 *
 * Total: it throws for no input and mutates nothing.
 */
export function slashCommandMenuProvesAbsence(
  entry: SlashCommandListEntry | null
): entry is SlashCommandListEntry {
  if (entry === null) return false
  if (entry.droppedCommands > 0) return false

  return !entry.commands.some(hidesAMatch)
}

/**
 * Whether `command` names this entry — AC3's whole rule, applied identically to all three entries.
 * `/clear` and `/compact` are not special-cased and there is no per-command table.
 *
 * EXACTLY ONE leading slash is stripped from the client's id, because a published `name` carries none
 * (`WireSlashCommand`) while every entry id does (`COMPOSER_ACTIONS`, where the id IS the command sent
 * verbatim as message text). A row that published `/clear` with the slash is a different string and does
 * not match — which is the honest answer, not a gap: the wire says names have no slash.
 *
 * EXACT EQUALITY, the `publishedRowFor` posture: no case fold, no trim, no `normalize()`, no charset
 * assumption. The sibling type-ahead folds case only because ITS ticket asked for case-insensitive
 * typing; nothing asks for it here, and folding text the daemon bounds without sanitizing would be
 * normalisation nobody requested. One measured name is `__remote-workflow`.
 *
 * The alias arm is required even though no shipped entry is matched only by an alias today: 9 of the
 * capture's 51 entries carry 11 aliases, and a name-only rule would grey out a command that works the
 * moment a workspace publishes one under an alias this menu names.
 */
function isPublished(command: string, commands: readonly WireSlashCommand[]): boolean {
  const name = command.startsWith('/') ? command.slice(1) : command

  return commands.some(
    (published) => published.name === name || published.aliases.includes(name)
  )
}

/**
 * `actions` with `unavailable: true` on each entry a COMPLETE published list does not carry.
 *
 * Returns the caller's array BY REFERENCE whenever nothing is unavailable — which is every unknown
 * reading and every fully-published workspace — so the common case allocates nothing and the panel sees a
 * stable `options` identity. The array's identity is deliberately not a contract beyond that: no effect
 * may depend on it (the shared clamp's deps are `[active]` for exactly this reason).
 *
 * Each marked entry is the caller's own option SPREAD with one boolean added: `id` and `label` are
 * carried through untouched, never rebuilt from a published row. See property (c) in the header — that is
 * the line between "a hostile list greys a row out" and "a hostile list changes what gets sent".
 *
 * Total: it throws for no input, mutates neither argument, and returns exactly as many options as it was
 * given, in the same order.
 */
export function markUnavailableActions(
  actions: readonly ComposerOptionsPanelOption[],
  entry: SlashCommandListEntry | null
): readonly ComposerOptionsPanelOption[] {
  if (!slashCommandMenuProvesAbsence(entry)) return actions

  const commands = entry.commands
  if (actions.every((action) => isPublished(action.id, commands))) return actions

  return actions.map((action) =>
    isPublished(action.id, commands) ? action : { ...action, unavailable: true }
  )
}
