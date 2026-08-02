# #515 — `conversationCreated` re-requests the conversation list

**Size: S** (held from PO — see § Sizing). **Security-sensitive: no** (label absent; §3 security pass skipped).

## Design source

None — the ticket body has no `## Figma` section, and that is correct here, not a PO gap. This change adds
no UI: no new component, no new token, no layout or copy change. It makes an **already-designed** Channel
List row render at the moment it should, by firing an existing `list_conversations` request one event
earlier. Every pixel the user ends up seeing is already specified and already implemented (the
`ChannelList` row + `partitionByPromotion` sections). There is no Figma node that describes "the list is
fresh", so requesting one would be ceremony. Code-review should treat the visual-fidelity check as
**not applicable**, not as skipped.

## Files to read first

Codegraph is not initialised for this repo (`codegraph_impact` → *"CodeGraph not initialized for this
project"*), so this list was built by grep + read. The fan-out was verified the same way:
`shouldRefreshList` has exactly **one** non-test call site.

| Path | What to extract |
| --- | --- |
| `src/renderer/src/store/conversationListBridge.ts:47-49` | `shouldRefreshList` — **the whole production change lives here** (one boolean clause). |
| `src/renderer/src/store/conversationListBridge.ts:16-33` | `translateConversationsEvent` — returns `null` for `conversationCreated`, which is *why* AC2's "writes no rows" needs no new code. |
| `src/renderer/src/store/conversationListBridge.ts:76-86` | `subscribeConversations` — the single listener with two independent reactions. Unchanged; read it to confirm the new arm can't cross-fire. |
| `src/renderer/src/store/conversationListBridge.ts:35-46, 61-74, 104-110` | The three production docblocks that describe the trigger as "the two arms". All three go stale — rewrite targets P1/P2/P3 below. |
| `src/renderer/src/store/conversationListBridge.test.ts:92-114` | The `shouldRefreshList` describe block. `:103-113` is the **only** test pinning the bug; AC1 moves the `conversationCreated` entry out of it. |
| `src/renderer/src/store/conversationListBridge.test.ts:304-331` | The promotion test — **the exact shape AC3's new test clones** (seed → trigger → assert one refresh → land the authoritative reply → assert the store). |
| `src/renderer/src/store/conversationListBridge.test.ts:23-50` | The `row()` / `updated()` builders. There is **no** `created()` builder yet; AC1's moved case inlines its payload at `:107-110` — reuse that literal. |
| `src/renderer/src/store/conversationCreatedBridge.ts:36-60` | The *other* `conversationCreated` consumer (nav). Independent subscription, no command sent — confirms no double re-list. |
| `e2e/fixtures/conversationStateFake.ts:34-40` | The **"Two reflect paths"** docblock — a stale site the ticket's list misses. See § Comment sweep. |
| `e2e/fixtures/conversationStateFake.ts:110-126` | The fake `list_conversations` + `create_conversation` arms. `list.push(row)` at `:124` is what makes the create-triggered re-list actually return the new row. |
| `e2e/conversation-archive-lifecycle.spec.ts:14-25, 80-92` | Header Gap A/B block + the create and archive step comments. |
| `e2e/real-daemon-conversation-lifecycle.spec.ts:14-26, 99-114` | The real-daemon twin of the same two blocks. |
| `e2e/conversation-create-rename.spec.ts:66-71` | The single Gap A block in this spec. |
| `CLAUDE.md` | "Don't refactor adjacent code while you are there. Touch only what the task needs." — load-bearing for this ticket; see § Scope fence. |

## Context

`shouldRefreshList` re-requests the list on `conversationUpdated` and `conversationDeleted`, but not on
`conversationCreated`. The list is otherwise requested once per connection episode
(`conversationListBridge.ts:125-133`), so after a FAB create nothing re-lists: the user navigates back and
the discussion they were just typing in is absent until a reconnect or an unrelated rename / archive /
promote / delete.

The premise is discharged in the ticket body and was re-confirmed at `3dd187b`; do not re-derive it. Two
facts from that verification are load-bearing for this design and worth restating:

- The remedy is **not** a no-op. `daemonConnection.ts:787-788` emits `{ type: 'conversationCreated', … }`
  onto the same `DaemonEvent` channel `subscribeConversations` subscribes to, and `daemonEventBridge.ts:70`
  carries the arm through. The predicate genuinely sees the event.
- The fix is **creator-only**. `conversation_created` is a correlated reply to the requester, so a second
  client's list stays stale until its own next mutation. That is not fixable renderer-side (no create
  broadcast exists daemon-side) and is out of scope.

## Design

### The production change

One clause in `shouldRefreshList` (`conversationListBridge.ts:47-49`) — add `conversationCreated` to the
disjunction. Nothing else in `src/` changes.

The design question worth answering explicitly: **why is this a refresh trigger rather than an optimistic
insert?** Because the existing seam already does the work correctly. `conversation_created` carries a
5-field `ConversationCreatedPayload`, not a full `ConversationSummary` — it has no `is_archived` and no
`last_message_ts`. Inserting it locally would either fabricate those fields or force
`conversationListStore` to grow a per-row setter it deliberately does not have (it exposes only a
whole-array `setConversations`). Re-requesting keeps the daemon authoritative and lands a complete row,
exactly as promote / rename / archive / delete already do. This is the established pattern, not a new one.

### Why nothing else needs to change

Three properties fall out of the existing structure — the developer should confirm each by reading, not by
adding code:

- **AC2's "writes no rows" is free.** `translateConversationsEvent` returns `null` for
  `conversationCreated` (its `default:` arm), so `setConversations` is not called. The new arm behaves
  identically to `conversationUpdated` (`:196`) and `conversationDeleted` (`:208`) with no branch added.
- **No cross-fire, no double re-list.** `subscribeConversations`' two reactions stay mutually exclusive per
  event, so the `:61-74` docblock's "a single event is never both" claim remains true.
  `conversationCreatedBridge` consumes the same event on an **independent** subscription and sends no
  command — it only navigates — so exactly one `list_conversations` goes out per create.
- **No feedback loop.** The re-request's reply is a `conversationsReceived`, for which
  `shouldRefreshList` is `false`. The existing test at `:282` already pins this; it needs no change.

### State + concurrency

No new state, no new subscription, no new async work. The create now produces two concurrent effects on one
inbound event — `conversationCreatedBridge` routes to `thread`, and this bridge fires a request whose reply
lands in the app-singleton `conversationListStore`. They are independent: `ChannelList` is unmounted while
the route is `thread`, so the store write is invisible until the user navigates back, which is precisely the
behaviour the ticket asks for. No ordering constraint between them, so no synchronisation.

### Error handling

Unchanged. `requestConversationList` is fire-and-forget (`sendCommand` is `void`), matching the composer's
send. A request lost to a mid-flight disconnect still recovers on the next connected edge via the existing
episode trigger. No new failure mode, no new UI surface.

## Comment sweep — ten sites, not seven

**AC4 as written in the ticket names seven sites. The real count is ten.** The ticket's list was built from
a literal `"Gap A"` string grep; three further sites assert the gap as current behaviour without using the
phrase. All three are in live test files, so they are in scope under the ticket's own rule ("only live
test-file comments are in scope") — and leaving them would mean shipping a fix whose own fixture docblock
contradicts it.

Rewrite exactly these, and nothing else:

**Production docblocks** (`src/renderer/src/store/conversationListBridge.ts`) — in scope by definition, the
file is being changed:

| Ref | Lines | Why it goes stale |
| --- | --- | --- |
| P1 | `35-46` | "True for the **two arms**…" — now three. The `#275` / `#822` provenance notes stay; add `#515`. |
| P2 | `61-74` | "a `conversationUpdated` broadcast (#275) **or** a `conversationDeleted` reply (#376)" — enumerates the trigger set. |
| P3 | `104-110` | "a conversationUpdated broadcast (#275) re-requests the list so the flipped row lands without a reconnect" — same enumeration, inside the effect. |

**Test-file sites** — the ticket's seven:

| # | File | Lines | Shape |
| --- | --- | --- | --- |
| 1 | `e2e/real-daemon-conversation-lifecycle.spec.ts` | 15-21 | Header **Gap A** bullet |
| 2 | `e2e/real-daemon-conversation-lifecycle.spec.ts` | 99 | FAB create-nav step header |
| 3 | `e2e/real-daemon-conversation-lifecycle.spec.ts` | 103 | "NOT list membership (Gap A)" |
| 4 | `e2e/conversation-archive-lifecycle.spec.ts` | 15-20 | Header **Gap A** bullet |
| 5 | `e2e/conversation-archive-lifecycle.spec.ts` | 80 | FAB create-nav step header |
| 6 | `e2e/conversation-archive-lifecycle.spec.ts` | 83 | "NOT list membership (Gap A)" |
| 7 | `e2e/conversation-create-rename.spec.ts` | 69-71 | Gap A parenthetical |

…plus the three the grep missed:

| # | File | Lines | Stale claim |
| --- | --- | --- | --- |
| 8 | `e2e/fixtures/conversationStateFake.ts` | 34-40 | *"**Two** reflect paths (matching … `conversationListBridge.shouldRefreshList`)"* and *"create_conversation → … the new row surfaces on the **NEXT** `list_conversations`, **not via a re-list**"*. Both halves are now false: there are three reflect paths, and create **does** trigger a re-list. This docblock names `shouldRefreshList` directly, so it is the most misleading site of the ten. |
| 9 | `e2e/conversation-archive-lifecycle.spec.ts` | 91-92 | *"conversation_updated → re-list → the store **gains** the created row now archived"* — the store already holds the row (landed at create); archive **flips it to archived**. |
| 10 | `e2e/real-daemon-conversation-lifecycle.spec.ts` | 112-114 | *"shouldRefreshList re-lists → the store **gains** the created row now archived"* — same correction as #9. |

**Rewrite intent, not just wording.** Sites 1 and 4 are the header bullets that *justify the whole
assertion surface* of those specs. After the fix, "the created row never enters the active list at create
time" is false — but "assert thread nav at the create step, not list membership" is still the right call,
for a different reason: the route flips to `thread`, so the Channel List is unmounted and there is nothing
to assert against there. Rewrite them to carry that reason. Do **not** rewrite them into a claim that
active-list membership is now assertable at the create step — it is not, and no assertion should be added
to try (see AC5).

**Gap B is untouched.** Sites 1 and 4 also document Gap B (the active list never filters archived rows,
`#469`). That gap is real and unchanged. Leave every Gap B sentence exactly as it stands.

## Scope fence

The developer's worktree must mutate **only**: `src/renderer/src/store/conversationListBridge.ts`, its
`.test.ts`, the three e2e specs, `e2e/fixtures/conversationStateFake.ts`, and this spec file. Specifically:

- **Do not edit `docs/specs/architecture/`.** `434-conversation-state-fake.md`,
  `440-real-daemon-conversation-lifecycle-e2e.md`, `451-conversation-create-rename-e2e.md` and
  `452-conversation-archive-lifecycle-e2e.md` all describe Gap A. They are per-ticket records frozen at
  their own merge; rewriting them is editing history.
- **Do not edit `docs/knowledge/`.** `features/e2e-harness.md:105` and `codebase/{440,451,452}.md` also
  mention Gap A. That tree is owned by the documentation phase, which will reconcile it from this spec plus
  the merged diff. Four extra markdown files is exactly the sprawl this fence exists to stop.
- **Do not fix the adjacent stale comment at `conversationListBridge.ts:96-100`** ("a future
  `conversation_updated`" — already stale since #275) or the `events.ts:271` mis-description the ticket
  flags. Both are real, both are out of scope. `CLAUDE.md`: *touch only what the task needs.*

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. All new coverage lands in
`src/renderer/src/store/conversationListBridge.test.ts`, following the file's existing injected-spy idiom
(no React, no Electron).

**AC1 — move, don't supplement.** `:103-113` currently lists `conversationCreated` inside a
*"returns false for a sample of unrelated daemon events"* array. Delete that third entry from the array and
add a sibling positive case alongside the two existing ones at `:93-101`. The array keeps its remaining two
entries and stays a valid negative test. The point of moving rather than adding: if the entry stays, one
test still asserts the old behaviour and the suite is self-contradicting.

**AC2** — a `subscribeConversations` case mirroring `:196` and `:208`: emit `conversationCreated`, assert
`refreshOnChange` called exactly once and `setConversations` not called at all.

**AC3 — the user-visible outcome, no other event.** Clone the promotion test at `:304-331` against the real
`createConversationListStore`:

- Seed one row via `conversationsReceived`; assert the store holds it.
- Emit `conversationCreated` for a *different* id. Assert `refreshOnChange` fired exactly once and the
  store's rows are **unchanged** (the event itself lands nothing).
- Emit the resulting `conversationsReceived` carrying both rows. Assert the store now holds the new row.

This is the whole bug in one test: no `conversationUpdated`, no `conversationDeleted`, no reconnect
anywhere in it. Reuse the inline `conversationCreated` payload literal from `:107-110`; do not add a
`created()` builder for one call site.

**Untouched by design:** the two `subscribeConversations` negative tests at `:282` and `:293` use
`conversationsReceived` and `connecting`, so neither pins the bug. Leave them.

### e2e — comment-only, assertion-frozen (AC5)

Every assertion in the three specs was traced against the fixed behaviour and **none breaks**. The
developer should not need to touch a single assertion; if one fails, that is a signal something in the
design is wrong, not an invitation to adjust the assertion.

- **`conversation-archive-lifecycle.spec.ts`.** The Archive-view `Channels (0)` / `Discussions (0)`
  baseline is asserted *before* the create, so it is untouched. The created row lands in the store at
  create, but `is_archived: false` — so the later `Discussions (1)` delta still measures the archive, not
  the create. The route is `thread` at create time, so no active-list assertion is racing. Post-delete
  `toHaveCount(1)` / `toHaveCount(0)` hold unchanged.
- **`real-daemon-conversation-lifecycle.spec.ts`.** Same shape. The post-restore re-entry click scopes by
  affordance (`.channel-list__save`, present only on the non-promoted created row) and still resolves to
  exactly one row. The `.channel-list__rename` readiness gate fires before any create, so it stays
  strict-safe at one match.
- **`conversation-create-rename.spec.ts`.** The created row now lands at create with `name: null`, but the
  list is unmounted (route `thread`) throughout, and the rename overwrites the name before the list is next
  rendered. The final two-row assertion — `NEW_TITLE` visible **and** `Seeded channel` visible — holds
  verbatim.

**Two adjacent specs were checked and are genuinely unaffected** — do not touch them, and code-review
should not flag their absence:

- `e2e/default-workspace.spec.ts` FAB-creates, so it now emits an extra `list_conversations` frame into its
  captured array. Its two assertions filter by `create_conversation` and `change_workspace` respectively,
  so neither sees it; the "race-free" ordering argument in its closing comment still holds.
- The `real-claude-*.spec.ts` family creates via the real daemon and asserts streaming, never list
  membership. Their `conversation_created` comments describe nav only, which remains true.

The four fake-driven specs that own a `case 'list_conversations':` arm but never FAB-create
(`queued-backlog-interrupt`, `run-config-settings`, `permission-modal-answer-paths`,
`stall-snapshot-bundle`) never reach the new arm at all.

e2e is not run by the QA gate for this ticket's default suite beyond the existing `npm run e2e`; the specs
are edited for comment accuracy, and `e2e/` is not covered by either tsconfig, so comment-only edits carry
no typecheck risk.

## Sizing

**S, held from PO — not dropped to XS.** The production diff is one boolean clause, comfortably XS on its
own, and the ticket body explicitly invites the drop "if the comment refresh proves mechanical". It did
not:

- The site count grew **7 → 10** under a second grep, across **4** test files plus **3** production
  docblocks. The ticket's list was built from a literal `"Gap A"` match and misses the fixture docblock
  that names `shouldRefreshList` directly.
- Each rewrite needs a judgement, not a find-replace: sites 1 and 4 must keep their *conclusion* (assert
  nav, not membership) while replacing its *reason*; sites 9 and 10 flip "the store gains the row" to "the
  store's existing row flips to archived"; site 8 changes a count ("two reflect paths") and reverses a
  claim.
- AC1 restructures an existing test rather than adding one.

Red lines, all clear: **1** non-test call site for `shouldRefreshList` (≤10); **2** production source files
touched, one of them comment-only (<5); ~80 total LOC across production, tests and comments (≪600); **0**
new exported types; **5** ACs; **0** reject branches. Nothing here justifies a split, and the S→XS override
is one-way — with the sweep having grown rather than shrunk, S is the honest label.

## Open questions

None blocking. One deliberate non-question, recorded so it is not reopened in review: the fix leaves a
**second** client's list stale after a remote create. That is the correlated-reply property of
`conversation_created`, is unfixable renderer-side, and needs a daemon-side broadcast to address. It is out
of scope here and should not be filed as a defect against this change.
