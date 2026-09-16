// THE JOIN between the two facts a sidebar row holds about one conversation (#799, split from #676): what
// is this conversation DOING, as exactly one status. That is the whole module — no store, no bridge, no IPC
// arm, no render. #800 draws the dot from the type below and #801 feeds the function from the two stores'
// selectors; neither exists yet, so nothing imports this today.
//
// Not a store, so no `Store` suffix, no `createStore`, no zustand — `conversationUnread.ts` next door took
// exactly this shape for exactly this reason, and `threadTimeline.ts` (pure) beside `timelineStore.ts` (a
// store) is the naming pair both follow. It lives in `store/` rather than under a `screens/` directory
// because its inputs are STORE SLICES rather than wire rows, and its consumer is the sidebar of the new
// desktop layout rather than any one existing screen.
//
// HARD IMPORT CONSTRAINT, checkable by grep: the single `import type` below is this module's ONLY import,
// and it has NO VALUE IMPORT AT ALL. Written as `import type` it is erased at compile time, so this module
// has ZERO RUNTIME DEPENDENCIES — which is what lets the function be tested with no store, no persistence
// port and no singleton in scope. Dropping the `type` keyword is no type error and no failing test, and it
// changes what this module IS: `conversationActivityStore.ts:231` constructs an app-wide singleton at
// module load, so a value import would drag it into this module's graph and into every test that imports
// the resolver. `conversationUnread.ts:20-26` states the same constraint for the same reason.
//
// Two imports a reader might reach for and must not. `isConversationUnread` from `./conversationUnread` —
// unread arrives as a PARAMETER; this module does not re-derive it and never touches the timeline or
// last-read stores. (That import would not even violate the constraint above, since `conversationUnread.ts`
// is itself runtime-free, which is exactly why it needs saying separately.) And `selectActivityFor` — the
// id-to-entry lookup is the CALLER's job, for the reason under SECURITY below.
//
// SECURITY: there is NO `conversationId` PARAMETER here and one must not be added. #801 resolves the id to
// an activity entry and an unread boolean through the two source stores' own `Map` lookups BEFORE calling
// in, so the untrusted daemon-asserted string never enters this file and cannot be added without changing
// the signature. No `Map` lookups here, no object literal keyed by an id, no computed object keys, no
// `Object.fromEntries`. Daemon text is likewise unreachable: this module reads booleans only and returns
// one of four client-owned literals, so untrusted content has no path in at all. #873's `inputRequired` is
// a BOOLEAN for exactly this reason — #874 resolves the id through `selectHasOutstandingFor`'s own `Map`
// lookup at the call site, the same way the activity entry and the unread flag already arrive.
//
// Log-free by construction — no `console.*` on any path, matching both source stores. There is no read miss
// to report: a `null` entry is a DEFINED READING, not an error.
import type { ConversationActivityEntry } from './conversationActivityStore'

/**
 * The one status a sidebar row draws, as a sealed set. Declared in PRECEDENCE ORDER, so the type reads as
 * the rule the resolver applies.
 *
 * A string-literal union rather than a discriminated union of objects: none of the four carries a payload,
 * and a payload-free closed set is a literal union repo-wide (`PairingRejectReason` at
 * pairingPayload.ts:37, `FingerprintRejectReason`, `WireModalClass`). CLAUDE.md's "discriminated unions on
 * a `type` field" rule is scoped to EVENTS AND ACTIONS; a status is a value, and `{ type: 'working' }`
 * would buy #800's `switch` nothing a literal union does not already give it.
 *
 * Kebab-case, matching every client-owned union in the repo (`'not-base64url'`, `'pubkey-wrong-length'`).
 * The snake_case of `src/shared/wire/` is a WIRE convention and does not apply: none of these four strings
 * ever crosses the wire, and none is ever rendered either — #800 maps them to client-owned display copy.
 */
export type ConversationStatus =
  | 'input-required' // a permission or trust prompt is outstanding; the operator is the blocker
  | 'working' // the assistant is mid-work in this conversation
  | 'new-messages' // content this client holds that the operator has not read
  | 'idle' // nothing to report

/**
 * Which single status a conversation is in, from the facts this client already holds about it.
 *
 * Total: every input is a defined reading, there is no throw path and no failure mode, so no result type
 * and no UI error path. PARAMETER ORDER IS THE PRECEDENCE ORDER — a reader who has the signature has the
 * rule. That is why `inputRequired` is FIRST and REQUIRED rather than optional-and-trailing: an optional
 * parameter cannot hold first position, and keeping the order the rule outranks leaving #801's call site
 * untouched. The resulting `tsc` red at that one call is the enforcement, not a cost.
 *
 *   0. INPUT REQUIRED → a permission or trust prompt is outstanding for this conversation. The one state
 *      blocked on the OPERATOR, so it outranks everything below and must never hide behind a busier-looking
 *      status. A boolean, derived at #874's call site from `selectHasOutstandingFor` (modalPrompts.ts:254)
 *      — never a `conversationId` here, per SECURITY above.
 *   1. WORKING       → any of the five activity facts (see `isWorking`).
 *   2. NEW MESSAGES  → the `unread` boolean, already derived by `isConversationUnread` at the call site.
 *   3. IDLE          → otherwise.
 *
 * The order is what a green suite most easily misses, at both of its levels: an implementation that tests
 * `unread` first compiles clean and fails exactly one assertion in `conversationStatus.test.ts` (the
 * working-AND-unread one), and one that tests `isWorking` before `inputRequired` compiles clean and fails
 * only the input-required-AND-working one.
 *
 * The two-store read that feeds this happens at #801's CALL SITE, where the non-torn-read argument
 * `conversationUnread.ts:78-84` records applies unchanged — back-to-back reads with no `await` between them
 * in a single-threaded renderer. Nothing here needs a merged snapshot and #801 must not build one.
 */
export function resolveConversationStatus(
  inputRequired: boolean,
  activity: ConversationActivityEntry | null,
  unread: boolean
): ConversationStatus {
  if (inputRequired) return 'input-required'
  if (isWorking(activity)) return 'working'
  if (unread) return 'new-messages'
  return 'idle'
}

/**
 * Whether the assistant is mid-work in this conversation: ANY of the five activity facts.
 *
 * "Not idle" rather than "a turn is strictly in flight" — a stalled turn, an API retry, a compaction and a
 * session reset are all the assistant mid-work, and reading any of them as idle would be a false negative
 * on the one state the operator most wants to see. A ticket-level ruling (#799), not an inherited fact:
 * narrowing it to `turnRunning` alone is a change to this helper and to four tests, and to nothing else.
 *
 * `resetting` (#1516) is the fifth, admitted under that same #799 reading rather than under a new one: a
 * conversation mid-reset is the assistant mid-work, and a reset that read as an idle chat is exactly the
 * false negative above. It is a DELIBERATE EDIT HERE, which is what the `Object.values` ban below exists
 * to force. This function reads the fact only — `phase` and `handoff` are not held in the entry at all.
 *
 * The `null` guard is NULL-SAFETY, NOT PRECEDENCE, and there is no disagreement hiding behind it: an absent
 * key ("no frame has ever arrived") and a present all-false entry ("observed; nothing is happening") both
 * mean not working, and both fall through to the same place. `selectActivityFor`
 * (conversationActivityStore.ts:238-265) keeps the two distinct upstream on purpose, for readers other than
 * this one — do not go hunting here for a distinction this function is entitled to collapse.
 *
 * Four things this must not become, none of them a type error and only the first catchable by a test:
 *
 *   - A SHORT DISJUNCTION. A dropped clause typechecks clean; each of the five single-fact tests is the
 *     only assertion in the file that catches its own clause.
 *   - `Object.values(entry).some(Boolean)`. Behaviourally identical TODAY and therefore catchable by no
 *     test at all, which is why it is banned in writing: it silently absorbs the next field the day
 *     `ConversationActivityEntry` grows one, and it truthy-reads a non-boolean. The ban did its work at
 *     #1516 — under it, the fifth fact was a deliberate edit HERE with a test of its own; under
 *     `Object.values` the dot would have started lighting with no edit, no test and no decision. Named
 *     reads keep the SIXTH fact the same kind of edit.
 *   - EXPORTED. Nothing outside needs it, and exporting it ships an unread read surface — the
 *     backgroundTaskRosterStore.ts:418-420 rule this repo already applies to selectors.
 *   - OPTIONAL-CHAINED INTO THE CALLER (`activity?.turnRunning === true || …`). Five `?.` reads restate the
 *     null case five times; the single guard below states it once.
 */
function isWorking(entry: ConversationActivityEntry | null): boolean {
  if (entry === null) return false
  return (
    entry.turnRunning || entry.stalled || entry.apiRetrying || entry.compacting || entry.resetting
  )
}
