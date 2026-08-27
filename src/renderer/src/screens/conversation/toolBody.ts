// The expanded tool row's input treatment — framework-free and React-free, co-located with the screen
// like toolHeadline.ts / shortenPath.ts / messageViewModel.ts. Both functions are total over their
// argument and take no injected deps.
//
// Why it lives here rather than inside ToolRow: toolHeadline.ts's reason, verbatim. The renderer test
// tier is renderToStaticMarkup string assertions in the `node` environment (vitest.config.ts:27), so a
// rule expressed inside the component could only ever be asserted through rendered markup. Expressed
// here, each rule is a value in and a value out. toolHeadline.ts is the collapsed row's run; this is
// the expanded row's input.
//
// WHAT IT CHANGES. #706 landed the body's field list as a LITERAL rendering of the whole input map,
// and its rule — a field silently missing from the list is worse than a repeated one — is right for
// every tool whose headline is a GUESS. `Bash` is the one tool whose headline is not: toolHeadline's
// rule 1 matches the name with `===` and probes `description` then `command` in fixed order, so there
// is no miss for the list to cover. #780 therefore promotes a shell call's `command` into a code block
// above the list and drops both fields from the list itself. Both are still in the body, louder than a
// list row draws them — promoted, not missing.
//
// SAFETY. Every string these functions return is untrusted daemon display text and stays a plain
// `string` all the way to its one caller, which renders it as auto-escaped React children of a <pre>
// or a <span> — never into an attribute, a URL, a filename, a cache key or a log line, and in
// particular never through AssistantMarkdown, which would yield links and images from daemon-relayed
// text. See ConversationScreen.tsx's SAFETY block for the sinks that are declined on purpose.

import { BASH_TOOL_NAME } from './toolHeadline'

/**
 * Exactly the two `toolCall` fields the body's input treatment reads.
 *
 * Deliberately NOT `ThreadItem`: the arm carries `kind`, `turnId`, `toolUseId`, `inputSummary` and
 * `result` besides, which would be noise in every fixture here. The call site still passes the whole
 * item — TypeScript's excess-property check does not apply to a variable — so this narrows the
 * contract without narrowing the call. `ToolHeadlineSource` is the precedent, and the two are separate
 * interfaces: this one has no `inputSummary`, because the body has no rule-4 fallback.
 */
export interface ToolBodySource {
  name: string
  // ABSENT means the WIRE omitted it (a pre-pyrycode#1678 daemon); `{}` means that daemon sent no
  // fields for this call. Both read identically here, exactly as they do in the picker.
  input?: Readonly<Record<string, string>>
}

/**
 * The `??` right-hand side for an absent `input` map, so absent and `{}` reach `Object.entries` as the
 * same value.
 *
 * A NAMED constant and never a bare `{}` literal at the call site: `item.input ?? {}` has type
 * `Readonly<Record<string, string>> | {}`, and TypeScript resolves `Object.entries` on that union to
 * the `entries(o: {}): [string, any][]` overload — silently typing every VALUE as `any` on a
 * security-sensitive render path. With both branches carrying the same type, `T` infers as `string`
 * and no annotation or explicit type argument is needed.
 *
 * Moved here verbatim from ConversationScreen.tsx (#706's), because the `??` it exists for moved here.
 */
const NO_INPUT_FIELDS: Readonly<Record<string, string>> = {}

/** The one field a shell call's code block promotes out of the list. */
const COMMAND_FIELD = 'command'

/**
 * The two fields a shell call's list leaves out, because the body draws each of them ELSEWHERE:
 * `description` on the row's own headline (toolHeadline.ts rule 1), `command` in the code block above
 * the list. That is the whole argument for this carve-out being compatible with #706's rule — neither
 * is missing from the body, both are promoted within it.
 *
 * Declared independently, never `BASH_FIELDS` imported from toolHeadline.ts: they hold the same two
 * strings today, but a probe ORDER and an omission SET are two unrelated facts, and deriving one from
 * the other would let a future reorder of the picker silently change what the body draws. This is the
 * `PREFERRED_FIELDS` / `PATH_FIELDS` precedent one file over.
 *
 * `readonly string[]` and not `as const`, for that file's reason: an `as const` tuple narrows the
 * element type to a literal union, which makes `OMITTED_SHELL_FIELDS.includes(name)` a compile error.
 */
const OMITTED_SHELL_FIELDS: readonly string[] = ['description', 'command']

/**
 * The one tool-name test, routed through one predicate so "the carve-out matches the tool name
 * exactly" cannot drift between the block and the filter.
 *
 * `BASH_TOOL_NAME` is IMPORTED rather than re-declared, unlike the field list above. Which tool is the
 * shell tool is genuinely one fact, and the coupling is load-bearing rather than incidental: the
 * carve-out's whole safety argument is that THIS SAME tool's headline is a fixed rule rather than a
 * pick. If the name moved in one file and not the other, the body would drop `description` from a list
 * whose headline no longer promoted it — a silently missing field, precisely what #706's rule exists
 * to prevent. Sharing the constant makes that failure unreachable.
 *
 * `===` and never `startsWith`: `BashOutput` is a real tool name, it is not a shell call, and it keeps
 * the general treatment — the same condition the headline rule already uses, so that case comes for
 * free rather than as a second guard.
 */
function isShellCall(source: ToolBodySource): boolean {
  return source.name === BASH_TOOL_NAME
}

/**
 * The command a shell call renders as a code block above its field list, or null when there is none.
 *
 * Null in four cases and there is no fifth: the name is not exactly `Bash`, `input` is absent,
 * `command` is absent, `command` is `''`. Each is "there is nothing to draw", so they collapse into
 * one return value rather than a status — and the caller's `!== null` guard is what makes "no empty
 * code block" structural rather than a second condition that could drift from this one.
 *
 * It never looks at what the HEADLINE picked, so suppressing the block on the 11.2% of shell calls
 * with no `description` — where the headline falls through to `command` and the two carry the same
 * text — is unreachable rather than declined at a branch. That repeat is WANTED: the header ellipsizes
 * on one line and the block does not, and a command long enough to be cut is exactly the call the row
 * was opened for.
 *
 * THE INDEX READ IS DELIBERATE and needs both halves of its argument. `input[COMMAND_FIELD]` is the
 * one form #706 forbids for a DAEMON-chosen key; it is safe here because the key is a client-owned
 * constant AND because `command` collides with no `Object.prototype` member, so no inherited value can
 * be returned. `firstNonEmpty` (toolHeadline.ts) makes the same argument for `PREFERRED_FIELDS`.
 *
 * THE ANNOTATION IS MANDATORY. `tsconfig.web.json` sets `strict: true` and nothing else, so
 * `noUncheckedIndexedAccess` is OFF: `input['command']` on a `Record<string, string>` types as
 * `string` while being `undefined` at runtime for an absent key. Testing only `!== ''` would let
 * `undefined` reach the render, where React draws nothing — an empty bordered box, arriving through
 * the type system.
 *
 * `!== ''` exactly, never `.trim() !== ''`. A whitespace-only command is a real residual left
 * unguarded on purpose: none appears in the measurement, and `=== ''`-never-`.trim()` is already the
 * shipped decision two elements away (ConversationScreen.tsx's empty-result branch).
 */
export function shellCommandBlock(source: ToolBodySource): string | null {
  const { input } = source
  if (!isShellCall(source) || input === undefined) {
    return null
  }
  const command: string | undefined = input[COMMAND_FIELD]
  if (command === undefined || command === '') {
    return null
  }
  return command
}

/**
 * The entries the expanded body's field list draws, in arrival order.
 *
 * `Object.entries` of the map, filtered by an EXACT-NAME test only when the tool is `Bash`, and
 * returned otherwise untouched. No `.sort()`, no re-ordering, no shortening, no salience pick —
 * everything #706 declines is still declined; the carve-out is the only thing added.
 *
 * `.includes(name)` on the whole name, never `startsWith` and never a prefix or substring test: a
 * shell call carrying `command_timeout`, `commands` or `description_url` keeps that field. It is an
 * array membership test rather than a property access, so no daemon-chosen string indexes anything.
 *
 * Object.entries, never `for...in` and never `input[key]`: own enumerable keys only, in insertion
 * order — the map is an ordinary-prototype object, so `input['toString']` would return an inherited
 * function and `for...in` would walk the chain.
 */
export function listedInputFields(
  source: ToolBodySource
): readonly (readonly [string, string])[] {
  const entries = Object.entries(source.input ?? NO_INPUT_FIELDS)
  if (!isShellCall(source)) {
    return entries
  }
  return entries.filter(([name]) => !OMITTED_SHELL_FIELDS.includes(name))
}
