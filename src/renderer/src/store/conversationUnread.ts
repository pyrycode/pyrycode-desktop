// THE READ BOUNDARY between the two keyed stores (#778, split from #677): a conversation is UNREAD when
// its held timeline has more items than its last-read mark. That is the whole module — no store, no
// bridge, no IPC arm, no render. #676 draws the green "New messages" dot from it.
//
// Not a store, so no `Store` suffix, no `createStore`, no zustand: `threadTimeline.ts` (pure) sits beside
// `timelineStore.ts` (a store) in this same directory and the naming follows that pair. It lives in
// `store/` rather than under a `screens/` directory because its inputs are STORE SLICES, not
// `ConversationSummary` wire rows, and its consumer is the sidebar of the new desktop layout rather than
// any one existing screen. `channelListViewModel.ts` / `archiveViewModel.ts` are the model for its SHAPE —
// plain exported function, injected inputs, framework-free, every branch unit-testable — not its location.
//
// WHY A COUNT AND NOT `ConversationSummary.last_message_ts`, recorded here because it is the trap this
// module would otherwise be rewritten into: that field only moves when the renderer re-requests
// `list_conversations`, which `conversationListBridge.ts:53-60` does at mount and on `conversationUpdated`
// / `conversationDeleted` / `conversationCreated` — and the daemon's `conversation_updated` broadcast fans
// out on promote, rename and archive, NOT on message arrival. A derivation on `last_message_ts` unit-tests
// green and never fires in the running app. `items.length` is the only live per-conversation quantity in
// the renderer that moves on content arrival (conversationLastReadStore.ts:38-45).
//
// HARD IMPORT CONSTRAINT, checkable by grep: this module's only two imports are the `import type` pair
// below, and it has NO VALUE IMPORT AT ALL. Written as `import type`, both are erased at compile time, so
// the module has ZERO RUNTIME DEPENDENCIES — which is what lets the predicate be tested with no store, no
// persistence port and no singleton in scope. Dropping either `type` keyword is no type error and no
// failing test, and it changes what this module IS: a value import of `conversationLastReadStore`
// constructs its app-wide singleton, pulling the `localStorage` port into this module's graph and into
// every test that imports the predicate.
//
// SECURITY: the `conversationId` is NOT A PARAMETER HERE — the caller resolves it to a slice and a mark
// through the two source stores' `Map` lookups BEFORE calling in, so the untrusted string never enters this
// file and cannot be added without changing the signature. Do not add a `conversationId` parameter and do
// not perform `Map` lookups here. Daemon message text is likewise unreachable: this module reads only
// `items.length` and never an element, so untrusted content has no path in at all. At the call site the id
// stays a `Map` key and nothing else — no object literal keyed by an id, no computed object keys, no
// `Object.fromEntries`, no spreading either store's map into an object.
//
// Log-free by construction — no `console.*` on any path, matching both source stores. There is no read
// miss to report: an absent input is a DEFINED READING, not an error.
import type { TimelineState } from './threadTimeline'
import type { LastReadMark } from './conversationLastReadStore'

/**
 * Whether a conversation has content this client holds but has not read.
 *
 * Both parameters are nullable ON PURPOSE and each absent case is a written-out branch. That is the whole
 * structural defence: `?? 0`, `?? initialTimelineState`, `||`, a default parameter and a non-null
 * assertion are all BANNED here, and the nullable parameter types mean a caller cannot reach this function
 * with a collapsed value without deliberately writing the collapse itself. `items.length > (lastRead ?? 0)`
 * typechecks identically, collapses branch 2 into branch 3, and is the same collapse both source-store
 * headers ban at their read sites (conversationTimelineStore.ts:46-51, conversationLastReadStore.ts:386-391).
 *
 * THE BRANCH ORDER IS THE CONTRACT, because AC4 and AC5 disagree about the (absent timeline, absent mark)
 * state and AC4 wins:
 *
 *   1. NO TIMELINE HELD → read. Never fed, or evicted at `MAX_RETAINED_TIMELINES` — there is no content
 *      this client can see, whatever mark it carries. A stuck mark nobody can clear is worse than a missed
 *      one. THIS BRANCH IS FIRST, and that precedence is what resolves the collision: at launch no slices
 *      are held and no marks exist for conversations never opened, so a mark-first reading would light the
 *      entire sidebar on every start — the exact failure #776's persistence was built to prevent.
 *   2. A TIMELINE HELD, NO MARK RECORDED → unread. A chat another client has driven is never invisible.
 *      Opening it clears the mark by the ordinary path (`stampLastReadFor`); nothing here writes.
 *   3. OTHERWISE → strictly more items than the mark. Equal counts read as READ.
 *
 * Two corners that are DECIDED, not open, each pinned by a named test in `conversationUnread.test.ts`:
 *
 *   - A PRESENT BUT EMPTY SLICE WITH NO MARK READS AS UNREAD. It falls out of branch 2 running ahead of
 *     branch 3, and it is reachable: `dispatchFor` creates a slice on an absent key unconditionally
 *     (conversationTimelineStore.ts:279-282), including for arms that never touch `items` — `turnState`,
 *     `stallDetected`, `apiRetry`, `compacting`, `reconnected`. A turn running in a conversation the
 *     operator has never opened mints an empty slice with no mark, and an event that creates a slice
 *     without adding a row is still evidence of activity in a conversation this client has never read. The
 *     alternative reading (`0 > 0` ⇒ read) requires exactly the `?? 0` above.
 *   - A RECREATED SLICE BELOW A STALE MARK READS AS READ. Mark `47` against a recreated count of `1` is
 *     `1 > 47` ⇒ `false`. This answers the open question left at
 *     `docs/knowledge/features/conversation-last-read-store.md:113-118` in the direction the ticket states:
 *     a missed mark beats a stuck one. Recovering it would need a history backfill this app does not have
 *     (conversationTimelineStore.ts:88-93).
 *
 * READING TWO STORES IS NOT A TORN READ and must not be "fixed" into a combined snapshot. The two reads
 * happen back to back with no `await` between them; zustand's vanilla `setState` reassigns state and THEN
 * calls its listeners, and the renderer is single-threaded, so there is no suspension point for a write to
 * interleave into. At #676's call site the two `useStore` subscriptions are independently tearing-free
 * within a render, and a pair drawn from adjacent commits is at most one render stale and self-corrects on
 * the next — a momentary dot, never a wrong resting state. No merged snapshot, no combined store, no
 * `useMemo` over both.
 *
 * No guard against a negative or non-integer mark: `decodeLastReadMarks` already rejects them at the
 * persistence boundary (conversationLastReadStore.ts:228) and `recordLastRead`'s only caller passes
 * `items.length`. Shipping a defence for an unobserved failure is the anti-pattern both source stores name.
 */
export function isConversationUnread(
  timeline: TimelineState | null,
  lastRead: LastReadMark | null
): boolean {
  if (timeline === null) return false
  if (lastRead === null) return true
  return timeline.items.length > lastRead
}
