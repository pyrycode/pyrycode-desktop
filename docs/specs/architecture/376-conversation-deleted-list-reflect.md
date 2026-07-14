# #376 — Renderer reflects a deleted conversation (leaves the list)

**Size:** XS. One production file (`conversationListBridge.ts`), one predicate broadened + renamed, its single internal caller and its test updated. Zero cross-module fan-out.

## Files to read first

- `src/renderer/src/store/conversationListBridge.ts:35-82` — the whole change lives here. Lines 36-46 are the refresh-trigger predicate (`isConversationUpdated`); lines 72-82 are `subscribeConversations`, whose line 80 `if (isConversationUpdated(event)) refreshOnChange()` is the seam to broaden. Read the doc comments on 36-46 — they already describe a general "should this event re-request the list?" predicate that happens to be named after its single arm.
- `src/renderer/src/store/conversationListStore.ts:22-73` — the store you must NOT write to on a delete. Note `setConversations` (line 48) is whole-array replacement (no merge), `conversations: null` is "not loaded", and `selectArchivedCount` (line 71) is one of the readers that reflects for free.
- `src/shared/ipc/events.ts:207-219` — the two arms that trigger a refresh. `conversationUpdated` (207, broadcast) is the existing trigger; `conversationDeleted` (219, `{ type: 'conversationDeleted'; id: string }`, correlated reply, shipped dormant by #375) is the one you add. Read the 208-218 comment: the `id` is self-sufficient and must NOT be consulted by the trigger.
- `src/renderer/src/store/conversationListBridge.test.ts` — the spy harness you extend. Line 191 (`re-requests (refreshOnChange) on a conversationUpdated — and does NOT write rows`) is the exact mirror for the new delete test; lines 225-252 (`a promotion flips the row ... once the re-request lands`) is the integration-shape mirror for the delete-leaves-the-list test; the `describe('isConversationUpdated')` block at 92-109 is renamed alongside the predicate.

## Design source

N/A — pure list-reflect state plumbing. No new component, layout, or styling: the visible effect (a row disappearing) is produced entirely by the existing Channel List (#141) render reacting to a shorter store array. Same shape and precedent as the sibling `conversationUpdated` reflect (#275) and the archive row-leaves reflect (#348), neither of which carried a Figma anchor. There is nothing to design against, so the absence of a `## Figma` section is correct, not a PO gap.

## Context

Archive / unarchive / promote / rename reflect in the list "for free": the daemon confirms each with a `conversation_updated` broadcast, and `subscribeConversations` re-requests the full list on that signal (#275), so rows update or leave. **Delete is the exception** — the daemon confirms a permanent delete with a distinct, *correlated* `conversation_deleted { id }` reply and **no broadcast** (pyrycode #822). #375 (merged, PR#378) surfaced that as a dormant `conversationDeleted` DaemonEvent; no renderer consumes it yet, so a deleted conversation lingers in the list until the next reconnect re-list.

This slice makes a `conversationDeleted` event fire the same authoritative full-list re-request that `conversationUpdated` already fires. It is pure renderer state: it consumes an already-decoded typed event and fires an existing bare command — no keys, sockets, or raw bytes.

## Design

### The single change: broaden the refresh trigger to cover both "a conversation changed" arms

The refresh trigger answers one question: *did a daemon-side conversation change occur that requires re-fetching the authoritative list?* As of #375 two events answer "yes" — the `conversationUpdated` broadcast and the `conversationDeleted` correlated reply. Model that honestly with **one** predicate rather than two parallel single-arm predicates OR'd at the call site.

**Rename `isConversationUpdated` → `shouldRefreshList`** and broaden its body:

```ts
// was: return event.type === 'conversationUpdated'
export function shouldRefreshList(event: DaemonEvent): boolean {
  return event.type === 'conversationUpdated' || event.type === 'conversationDeleted'
}
```

Keep the existing doc comment's intent verbatim (react to the *occurrence* of a daemon-side change; never consult the payload `id`/`name`/`cwd` — AC3), and extend it to name both arms and the correlated-vs-broadcast contrast.

`subscribeConversations` line 80 becomes:

```ts
if (shouldRefreshList(event)) refreshOnChange()
```

Nothing else in `subscribeConversations` changes. `translateConversationsEvent` is untouched — `conversationDeleted` still falls through its `default: null`, so the delete event never lands rows directly (AC2). The `ConversationListData` container, the store, and `daemonEventBridge.ts` are untouched.

### Why rename rather than add a parallel `isConversationDeleted`

The ticket leaves this to the architect. Chosen: rename. Rationale —

- The function's *responsibility* changes (it now covers two arms), so renaming it to match is part of this change, not adjacent refactoring. The name `isConversationUpdated` would become a lie the moment it also matches deletes.
- The existing doc comment (lines 36-46) already documents a general "should this event re-request the list?" predicate; the rename aligns the name with the already-written intent.
- Two parallel `isX` predicates OR'd in the caller (`if (isConversationUpdated(e) || isConversationDeleted(e))`) splits the "which events refresh" policy across three places (two predicates + the caller's `||`). One predicate keeps it in one place, and the subscribe body reads as the intent: `if (shouldRefreshList(event)) refreshOnChange()`.

The parallel-predicate alternative was considered and rejected for the above; the developer should not re-derive it.

A local remove-by-id setter is explicitly out (AC4): it would re-implement the null-safe and absent-id-safe guarantees the re-request path gets for free.

### Why this reflects everywhere with no per-reader wiring

All list surfaces — Channel List (#141), the Settings archived-count row (`selectArchivedCount`, #351), any future reader — read the single `conversationListStore` singleton. The refresh fires the bare `requestConversations` command; the daemon's fresh `list_conversations` reply omits the deleted id; `setConversations` lands the shorter array via whole-array replacement (no merge). Every reader re-renders off the one store update. AC1 names those readers precisely because the change touches only the bridge.

## State + concurrency model

- **Store writes:** unchanged. `setConversations` remains the *sole* writer of `conversationListStore`, invoked only from the `conversationsReceived` arm (line 79). A `conversationDeleted` never writes the store (AC2) — it only triggers `refreshOnChange`.
- **Null-safety by construction (AC2):** a `conversationDeleted` arriving while `conversations === null` (list not yet loaded) fires the re-request but leaves the store `null`. It cannot fabricate an empty loaded list, because the delete arm has no path to `setConversations`.
- **Absent-id safety by construction (AC3):** the trigger is id-blind — it reacts to the event's occurrence, never inspects `event.id`. A delete for an id not in the current list still fires one re-request; the fresh reply simply never contained that id, so the whole-array replacement is content-identical and produces no observable change.
- **Concurrency:** unchanged. Still exactly one subscription (AC4 of the parent), one listener with two independent, mutually-exclusive reactions (a single event is never both a `conversationsReceived` and a `conversationDeleted`). Fire-and-forget send, matching the composer and the existing `conversationUpdated` path. No new async, no new cancellation surface.

## Error handling

No new failure modes. The delete event is already decoded and typed upstream (#375); this slice consumes a typed union member and fires an existing command. The listener only dispatches — it never throws into React. A re-request lost to a mid-flight disconnect self-heals on the next connect via the existing per-connection-episode request in `ConversationListData` (lines 121-129), unchanged. The daemon's authoritative reply is the single source of truth for what the list contains; a stale or duplicate delete event is harmless (idempotent whole-array replace).

## Testing strategy

`npm test` (vitest), extending `conversationListBridge.test.ts` with the existing framework-free spy harness (`fakeBridge`, injected spies, isolated `createConversationListStore`). No React, no Electron. Scenarios (bullet-level — write in the file's existing idiom):

- **`shouldRefreshList` (rename the `describe('isConversationUpdated')` block):**
  - returns `true` for a `conversationDeleted` event (the new arm).
  - returns `true` for a `conversationUpdated` broadcast (existing behavior preserved).
  - returns `false` for a sample of unrelated events — include `conversationsReceived` and `conversationCreated` (the two most confusable), plus `connecting`.
- **`subscribeConversations` — delete fires the re-request but writes no rows** (direct mirror of the line-191 `conversationUpdated` test): emit `{ type: 'conversationDeleted', id: 'a' }`; assert `refreshOnChange` called exactly once and `setConversations` never called.
- **AC2 null-not-fabricated:** with the real isolated store starting `null`, emit a `conversationDeleted`; assert `selectConversations` is still `null` and `refreshOnChange` fired once (the delete cannot manufacture `[]`).
- **AC1/AC3 delete-leaves-the-list, integration shape** (mirror of the line-225 promotion test): seed `conversationsReceived` with `[row(a), row(b)]`; emit `conversationDeleted{ id: 'a' }`, assert exactly one `refreshOnChange` and no store write from the event; then emit the daemon's fresh `conversationsReceived` `[row(b)]` (the authoritative reply omits `a`); assert the store is now `[b]`. Reuse the same test to cover absent-id by emitting `conversationDeleted{ id: 'zzz' }` against a seeded list and asserting the re-request fires once and the subsequent identical reply leaves rows unchanged.

Type coverage via `npm run typecheck`: the `case`/comparison against the sealed `DaemonEvent` union means a future rename of the `conversationDeleted` arm is a compile error, not a silent miss. Update the test import (`isConversationUpdated` → `shouldRefreshList`) in the same edit; `npm run build` is the gate.

## Open questions

None. The seam, the event, and the store contract are all merged and read directly above; the only real decision (rename vs parallel predicate) is settled in Design.
