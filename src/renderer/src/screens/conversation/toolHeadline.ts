// The collapsed tool row's second run — framework-free and React-free, co-located with the screen like
// shortenPath.ts / messageViewModel.ts / threadScrollPosition.ts. It performs no effects and takes no
// injected deps: a total function of its argument, whose only import is the sibling shortener.
//
// Why it lives here rather than inside ToolRow: the renderer test tier is renderToStaticMarkup string
// assertions in the `node` environment (vitest.config.ts:27), so a rule expressed inside the component
// could only ever be asserted through rendered markup. Expressed here, each rule is a string in, a
// string out.
//
// WHAT IT REPLACES. The row drew `inputSummary` — the daemon's whole tool input squeezed onto one line
// and cut for length. It was never designed as a headline; for an Edit that is mostly replacement text
// the file path is buried inside it and usually truncated away entirely. #642 decodes the tool's own
// input fields off the wire and #643 carries them onto the item; this picks which one becomes the run.
//
// DELIBERATELY DUMB, and meant to stay that way. The rules come from a measurement over 11336 real tool
// calls (2026-08-21) and the expanded form is one click away, so a wrong guess costs almost nothing —
// which is the argument against a smarter classifier here. Do not "improve" the picker without new
// data; the expanded per-field list (#706) is what covers its misses.
//
// SAFETY. Every value this module returns is untrusted daemon display text and stays a plain `string`
// all the way to its one caller, which renders it as auto-escaped React children of the same <span>
// that carried `inputSummary` — never into an attribute, a URL, a filename, a cache key or a log line.
// See ConversationScreen.tsx's SAFETY block for the sinks that are declined on purpose. The KEY is
// never returned: keys are daemon-controlled display text too, and drawing them is #706's separately
// reviewed decision.

import { shortenPath } from './shortenPath'

/**
 * Exactly the three `toolCall` fields the picker reads.
 *
 * Deliberately NOT `ThreadItem`: the arm carries `kind`, `turnId`, `toolUseId` and `result` besides,
 * which would be noise in every fixture here and would drag a store type into a screen-local helper.
 * The call site still passes the whole item — TypeScript's excess-property check does not apply to a
 * variable — so this narrows the contract without narrowing the call.
 */
export interface ToolHeadlineSource {
  name: string
  inputSummary: string
  // ABSENT means the WIRE omitted it (a pre-pyrycode#1678 daemon); `{}` means that daemon sent no
  // fields for this call. Both read identically here — rules 1 to 3 have nothing to look at either
  // way, so both fall through to `inputSummary`. The distinction survives at the item (#643), it is
  // just not surfaced in the row.
  input?: Readonly<Record<string, string>>
}

/**
 * Rule 2's probe order: the first present, non-empty one wins.
 *
 * Exported and pinned by a test because it is measured data rather than a preference — reordering it
 * is a deliberate change to the picker (the `KEPT_SEGMENTS` precedent one file over). `readonly
 * string[]` and not `as const`: the members are consumed as `string`, and an `as const` tuple narrows
 * the element type to a literal union, which makes `PATH_FIELDS.includes(key)` a compile error.
 */
export const PREFERRED_FIELDS: readonly string[] = [
  'file_path',
  'path',
  'notebook_path',
  'command',
  'pattern',
  'url',
  'query',
  'description'
]

/**
 * The field names whose value is shortened for display. Membership IS the shortening decision.
 *
 * Declared independently, never `PREFERRED_FIELDS.slice(0, 3)`: they coincide today, but a preference
 * ORDER and a path-ness PREDICATE are two unrelated facts, and deriving one from the other would let a
 * future reorder of the list silently change what gets shortened.
 */
export const PATH_FIELDS: readonly string[] = ['file_path', 'path', 'notebook_path']

/**
 * Rule 1's probe order, for the one tool name that gets a precedence override.
 *
 * Module-private: unlike the two above it pins no measured order a caller could need. The FALLBACK is
 * load-bearing rather than defensive — measured over 6459 real `Bash` calls, 1397 of them (22%) carry
 * no `description` at all, so a headline keyed on `description` alone would render blank on nearly a
 * quarter of shell calls.
 */
const BASH_FIELDS: readonly string[] = ['description', 'command']

/**
 * The tool name whose input reads better description-first. Matched with `===`, see `pick`.
 *
 * Exported for toolBody.ts, which keys #780's body carve-out on the SAME name — dropping `description`
 * from the field list precisely because this rule promoted it onto the headline. Sharing the constant
 * is what makes "the name moved in one file and not the other, so the body drops a field the headline
 * no longer shows" unreachable rather than merely unlikely.
 */
export const BASH_TOOL_NAME = 'Bash'

interface PickedField {
  key: string
  value: string
}

/**
 * The first of `fields` that is present in `input` with a non-empty value, or null.
 *
 * THE CENTRAL TRAP LIVES HERE. `tsconfig.web.json` sets `strict: true` and nothing else, so
 * `noUncheckedIndexedAccess` is OFF: `input[key]` on a `Record<string, string>` types as `string`
 * while being `undefined` at runtime for an absent key, and the compiler will not force the check.
 * The annotation below is what restores it — testing only `!== ''` would let `undefined` through,
 * React would render it as nothing, and the blank headline would return through the type system.
 */
function firstNonEmpty(
  input: Readonly<Record<string, string>>,
  fields: readonly string[]
): PickedField | null {
  for (const key of fields) {
    const value: string | undefined = input[key]
    if (value !== undefined && value !== '') {
      return { key, value }
    }
  }
  return null
}

/** True iff the value would wrap the single-line chip onto a second line. `\n` or `\r`, nothing else. */
function isSingleLine(value: string): boolean {
  // Not a layout guard — `.tool-row__summary` is `white-space: nowrap` (conversation.css:1033), so a
  // newline could not break the row even if it were selected. This is about headline QUALITY: the
  // first line of a multi-line blob rarely names what the tool is acting on. U+2028/U+2029 are an
  // accepted miss, in the same class as the literal `null`/`true`/`[1,2]` values rule 3 can land on.
  return !value.includes('\n') && !value.includes('\r')
}

/**
 * The four rules, as ONE fallback chain rather than four independent branches.
 *
 * 1. `Bash` exactly: `description`, then `command`.
 * 2. Always: the `PREFERRED_FIELDS` order.
 * 3. Always: every entry in iteration order whose value has no line break. This is what makes MCP
 *    tools work — their inputs mostly use names no fixed list would guess (`symbol`, `task`, `fileKey`,
 *    `nodeId`), and on the real corpus this rule lands on the right one.
 * 4. Nothing selected: the caller falls back to `inputSummary`.
 *
 * Rule 1 is a precedence OVERRIDE for one tool name, not a branch that ends the chain: when it selects
 * nothing the chain continues, which is what makes "the headline is never blank" structural. `===` and
 * not `startsWith`, because `BashOutput` is a real tool name and belongs in rule 2, where `command`
 * still reaches it.
 *
 * Every rung requires a value that is present and `!== ''` — never `.trim() !== ''`. A whitespace-only
 * value would draw a blank-looking headline and is a real residual, left unguarded on purpose: no such
 * value appears in the measurement, the ticket says not to improve the picker without new data, and
 * `=== ''`-never-`.trim()` is already the shipped decision one element away
 * (ConversationScreen.tsx:724-727). Guarding it would be a defence for an unobserved failure mode.
 *
 * The wire facts this rests on, read off #642's spec: key order is alphabetical (a Go map-marshalling
 * artefact, so rule 3 is deterministic per call), every value is already a string daemon-side, the
 * decoder has already stripped `__proto__` / `constructor` / `prototype`, and the map MAY BE INCOMPLETE
 * — which is exactly why rule 4 keeps `inputSummary` as the whole-input fallback rather than retiring
 * it. `Object.entries` yields own enumerable properties only, and none of the eight preferred names
 * collides with an `Object.prototype` member, so no `Object.hasOwn` guard is needed.
 */
function pick(source: ToolHeadlineSource): PickedField | null {
  const { input } = source
  if (input === undefined) {
    return null
  }

  if (source.name === BASH_TOOL_NAME) {
    const overridden = firstNonEmpty(input, BASH_FIELDS)
    if (overridden !== null) {
      return overridden
    }
  }

  const preferred = firstNonEmpty(input, PREFERRED_FIELDS)
  if (preferred !== null) {
    return preferred
  }

  for (const [key, value] of Object.entries(input)) {
    if (value !== '' && isSingleLine(value)) {
      return { key, value }
    }
  }

  return null
}

/**
 * The collapsed row's second run: the picked input value, shortened iff it came from a path-named
 * field, else `inputSummary` verbatim.
 *
 * The shortening decision is keyed on the FIELD NAME, not on which rule fired. The two are equivalent
 * today — rule 1 only ever picks `description`/`command`, and rule 3 can never reach a non-empty
 * `file_path`/`path`/`notebook_path` because rule 2 would have taken it — but the field-name form is
 * the one that stays true if the rules are ever reordered. Path rules must not be applied to a command
 * line, a search pattern or a URL: `shortenPath` splits on `/` and prefixes `.../`, which would mangle
 * `grep -r foo src/` into something that reads like a path and is not one. Keeping the decision here is
 * also what lets `shortenPath` stay a total function of one string that never decides whether its
 * argument is a path, exactly as its own doc comment promises.
 *
 * Total over its input type: every branch is a comparison, a property read or a loop over
 * `Object.entries`, none of which throws, and rule 4 guarantees a `string` for every possible source.
 * No try/catch, no length cap, no null guard — the signature is the contract, `shortenPath`'s posture.
 * (Rendering is bounded independently: the daemon caps each value at 4000 runes and the run ellipsizes.)
 * If a case turns up that genuinely needs a second branch, that is a signal the rules are wrong — route
 * back rather than guarding around them.
 */
export function toolHeadline(source: ToolHeadlineSource): string {
  const picked = pick(source)
  if (picked === null) {
    return source.inputSummary
  }
  return PATH_FIELDS.includes(picked.key) ? shortenPath(picked.value) : picked.value
}
