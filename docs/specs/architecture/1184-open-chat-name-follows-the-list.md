# #1184 — the open chat's name follows the list after a rename or auto-name

## Files read

- `src/renderer/src/store/activeConversationStore.ts` → `ActiveConversationState`, `setActiveConversation` —
  the snapshot being re-seeded; holds a `ConversationCreatedPayload` verbatim, most-recent-wins, no merge.
- `src/renderer/src/store/conversationArchivedBridge.ts` → `archivedActiveConversationId`,
  `subscribeArchivedActiveConversation`, `useArchivedActiveConversationExit` — **the precedent this ticket
  copies wholesale**: the one shipped bridge that derives a signal about the ACTIVE conversation from the
  `conversationsReceived` reply, reads rows off the EVENT rather than the list store, imports
  `translateConversationsEvent` rather than re-declaring it, and mounts from PairedShell.
- `src/renderer/src/store/conversationListBridge.ts` → `translateConversationsEvent` (imported here),
  `subscribeConversations`, `originOf` — the list data path, and the seam the ticket proposed; see
  **Design** for why the reconcile sits beside it rather than inside it.
- `src/renderer/src/store/conversationListStore.ts` → `stampRows` (spread-first ordering),
  `selectExclusiveConversationIdsFor`, `selectConversationsFor` — the doctrine on daemon-supplied
  conversation ids, and the ruling on how much narrowing a path buys itself (strictness where the cost is
  destruction without backfill; not where it self-heals).
- `src/renderer/src/screens/conversation/unpairAction.ts` → `serverIdForOpenConversation` — "refuse an
  ambiguous match with `filter` and a length check, never `find`". The reconcile applies that discipline
  within one reply.
- `src/renderer/src/PairedShell.tsx` → `activateDeps`, the `useArchivedActiveConversationExit` mount — the
  wiring site; `activateDeps` already holds the exact getter/setter pair this bridge needs.
- `src/renderer/src/activateConversation.ts` → `activateConversation` — what the reconcile must NOT be
  (timeline reset, session-id clear, run-config clear, last-read stamp, config request).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ChannelInfoSheetView`'s title, its
  About rows, `ChannelInfoSheet`'s rename prefill, the empty-thread workspace chip — the four readers of
  the snapshot. All six field reads are auto-escaped React children or a boolean branch; see
  **Security review** § Trust boundaries.
- `src/shared/wire/types.ts` → `ConversationSummary` (8 fields), `ConversationCreatedPayload` (6 fields) —
  the two shapes the mapper spans.
- `docs/knowledge/features/conversation-list-fetch.md` — the fetch path; no lesson that changes this design
  (it documents the `list_conversations` round trip, not the active snapshot).

## Design source

**Figma:** N/A — the ticket states the justification in its Context: "No component and no stylesheet
change: the sheet, the dialog and the chip already render the snapshot, and only its freshness changes.
Nothing is redesigned, so there is no Figma section." No pixel moves in this diff, so the verifier's
visual-fidelity check is intentionally skipped.

## Context

The open chat is a snapshot taken at activation and never written again until another chat is opened, so
a rename that updates the sidebar row leaves the Channel info sheet, the rename prefill and the
empty-thread workspace chip showing the name the chat had when it was opened. pyrycode#2159 turns this
from an edge into the common case: the daemon will auto-name an unnamed chat from its first message, so
every new chat would spend the rest of the session saying `Untitled` to its own sheet.

The fix is one derived write: on each authoritative list reply, if the reply carries the open chat's row,
re-seed the snapshot from it.

No ADR is warranted. This adds no new decision — it applies `conversationArchivedBridge`'s shipped shape
(derive an active-conversation signal from the list reply) to a second signal.

## Design

A new module, `src/renderer/src/store/activeConversationReseedBridge.ts`, structured exactly like
`conversationArchivedBridge`: a pure decision function, a subscription over the injected `onDaemonEvent`,
and a React hook that is the thin glue. It owns no wire arm — it consumes the `conversationsReceived` arm
through `translateConversationsEvent`, imported from `conversationListBridge` rather than re-declared,
for the reason that bridge's docblock already gives.

**Why a sibling bridge and not the ticket's proposed seam.** The ticket's technical note put the reconcile
inside `subscribeConversations`, after `setConversations`. That function has 21 call sites in
`conversationListBridge.test.ts` plus its one production call, and the deps have to be REQUIRED (the
production wiring is a React effect, which `vitest.config.ts`'s `environment: 'node'` can never run, so
`tsc` is the whole safety net against a forgotten argument) — 22 call sites updated to land a change that
needs none. The reconcile also has no dependency on the list store at all: it is a pure function of the
reply's own rows and the current snapshot. `conversationArchivedBridge` is the same signal shape derived
the same way from the same arm and it is a separate module for the same reasons, including the one that
matters most here — reading rows off the EVENT removes any dependence on whether `ConversationListData`'s
listener happened to run first.

**The three pieces.**

- `reseededActiveConversation(rows, active): ConversationCreatedPayload | null` — the whole decision, pure.
  `null` means "write nothing", the `archivedActiveConversationId` shape. Four ways to get it, each a
  required behaviour: `rows === null` (not a list reply); `active === null` (no open chat — AC3's null
  case); no row in this reply carries the active id (AC3 — a chat deleted elsewhere, or a reply from
  another paired server that simply does not list it); and all six payload fields already equal (AC4).
  Ambiguity is the fifth and is refused rather than resolved: `filter` and a length check, never `find`
  (`serverIdForOpenConversation`'s discipline — see **Security review**).
- `subscribeActiveConversationReseed(onDaemonEvent, getActiveConversation, setActiveConversation)` — one
  listener, returns the off handle as the effect cleanup. Calls the setter only when the decision returns
  a payload.
- `useActiveConversationReseed(getActiveConversation, setActiveConversation)` — one empty-dep effect
  returning the off handle. Both deps are stable module-scope-backed arrows at the only call site and are
  deliberately NOT effect dependencies, the treatment `useArchivedActiveConversationExit` gives
  `getActiveConversationId`; no ref indirection is needed because neither is a per-render inline arrow.

**The mapper is a closed reconstruction, not a structural pass-through.** `ConversationSummary` is a
structural superset of `ConversationCreatedPayload` — PairedShell's `onOpen` relies on exactly that and
hands the clicked row straight to the store — but this path builds a fresh six-field literal (`id`,
`is_promoted`, `cwd`, `name`, `last_used_at`, `workspace_label`) instead. `is_archived` and
`last_message_ts` have no slot and are dropped, per the ticket; more importantly a fresh literal cannot
carry an unknown key from a daemon row into the snapshot, which is `stampRows`' spread-order concern one
layer up and `parseConversationSummary`'s closed-reconstruction discipline one layer down.

**`id` is invariant by construction.** The mapper runs only on a row whose `id` already equals the
snapshot's, so no re-seed can change the id the sheet's Archive and Delete actions send back to the
daemon. This is the property that keeps the reconcile non-destructive; a test asserts it directly.

**It is not `activateConversation`.** No timeline reset, no session-id clear, no run-config clear, no
last-read stamp, no config request, and no navigation. The id has not changed, so none of those is owed;
calling that helper here would reset the thread of the chat the operator is reading.

## State + concurrency model

One store write, `activeConversationStore.setActiveConversation`, on the renderer's single thread inside
a synchronous event dispatch. No async work, no timer, no `AbortController` — the whole reaction is
synchronous, so there is no check-then-act gap between reading the snapshot through the getter and
writing it. The subscription's only teardown is the off handle returned as the effect cleanup, so a
StrictMode double-mount nets exactly one live listener (the `useDaemonEventBridge` guarantee).

Ordering against `ConversationListData`'s own listener is deliberately unconstrained: the reconcile reads
the reply's rows, so the two subscriptions cannot disagree whichever runs first. Lifetime is PairedShell's
— a reply arriving while unpaired reaches no listener, which is right, because `clearPairingScopedState`
has already cleared the snapshot this would write.

AC4's equality check is also the re-render guard: `setActiveConversation` replaces the whole value, so an
unconditional write on every routine refresh would hand every `activeConversation` subscriber a new object
identity and re-render them all. Skipping the equal case makes the common refresh cost nothing.

## Error handling

No failure modes to surface. The path performs no I/O, sends no command, and parses nothing — the rows
have already been decoded main-side by `parseConversationSummary`. Every branch of
`reseededActiveConversation` is total over its inputs and returns `null` rather than throwing, so the
listener cannot throw into React. Nothing is logged: the only fields a diagnostic here could name are the
conversation `id`, `name` and `cwd`, which ADR 0007's content-free rule forbids, and there is no observed
failure to instrument.

## Testing strategy

Vitest, `src/renderer/src/store/activeConversationReseedBridge.test.ts`, framework-free with plain spies
and a captured-listener fake bridge (`conversationListBridge.test.ts`'s `fakeBridge` idiom). No e2e spec:
the four readers are pure views already covered, and nothing here is an interaction.

`reseededActiveConversation`:
- a row whose id matches, with a changed `name`, returns the mapped payload (AC1)
- the returned payload carries all six fields off the row — `is_promoted`, `cwd`, `last_used_at`,
  `workspace_label` included — and drops `is_archived` / `last_message_ts` (AC2)
- the returned payload's `id` equals the previous snapshot's id (the invariant above)
- rows not containing the active id return null (AC3), including a non-empty reply from another server
- `active === null` returns null (AC3)
- `rows === null` returns null
- every one of the six fields equal returns null (AC4), and each field changed on its own returns a
  payload — one case per field, so no field can be dropped from the comparison unnoticed
- an archived row (`is_archived: true`) whose id matches still re-seeds — `conversationArchivedBridge`
  owns that transition
- two rows sharing the active id return null (ambiguity refused, never `find`)

`subscribeActiveConversationReseed`:
- subscribes exactly once and returns the off handle as the cleanup
- a `conversationsReceived` carrying the renamed row calls the setter once, with the mapped payload
- an unchanged reply calls the setter zero times (AC4 at the seam)
- an unrelated event (`connecting`, `conversationUpdated`) calls neither dep
- the getter is read per event, not captured once — two replies in a row reconcile against the snapshot
  as it stands at each delivery

## Open questions

- Whether the re-seed should additionally require that the reply's server match the server the open chat
  is attributed to. Settled in the **Security review** below: rejected, with the reasoning recorded there.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The boundary is upstream and unchanged: `parseConversationSummary`
  in `src/main/transport/inboundMessage.ts` is the closed reconstruction that decodes every row main-side,
  and this bridge consumes the already-typed `conversationsReceived` event through
  `translateConversationsEvent`. The re-seed introduces **no new sink** for the untrusted fields it moves:
  `name`, `cwd`, `workspace_label` and `last_used_at` reach exactly the four readers that already render
  them, and every one is an auto-escaped React child (`ChannelInfoSheetView`'s title, its `cwd` and
  last-activity rows, the workspace chip) or a value read at click time into local state
  (`ChannelInfoSheet`'s `titleFor` prefill). None is an attribute, a URL, a filename, a cache key, a `Map`
  key or a React `key`, and `is_promoted` is a boolean branch condition. Verified by reading every
  `conversation.<field>` site in `ConversationScreen.tsx`, not assumed from the fields' prior contract —
  the freshness is new even though the sinks are not.
- **[Trust boundaries — the id]** No findings, and this is the load-bearing one. The mapper runs only on a
  row whose `id` already equals the snapshot's, so the id the sheet sends back with Archive and Delete
  cannot be steered by a re-seed. A daemon cannot use this path to make a destructive action target a
  different conversation, because the only conversation this path can name is the one already open.
- **[Hostile daemon response — cross-server id collision]** SHOULD FIX, addressed in the design; the
  residual is accepted. Two paired servers can both claim one conversation id — `serverIdForOpenConversation`
  documents that "the app does not otherwise prevent" it. Server B's list reply carrying the id of the chat
  open on server A would re-seed A's snapshot with B's name, cwd and workspace label. What ships against it
  is the within-reply half: **ambiguity is refused, `filter` plus a length check, never `find`**, so a reply
  listing the active id twice writes nothing rather than resolving to whichever row came first.
  What is deliberately NOT bought is the cross-server half — joining `conversationListStore`'s stamped
  union through `serverIdForOpenConversation` and comparing against the reply's origin. Two reasons, both
  concrete. First, proportionality, on `selectExclusiveConversationIdsFor`'s own stated line: that selector
  buys strictness because its consumer "costs destruction with no backfill", where an over-broad answer
  that merely "self-heals" does not earn it. This path is squarely the second kind — it navigates nothing,
  clears nothing, sends nothing, preserves the id, and the next reply from the real server corrects the
  text. Second, the join would introduce a live bug: a FAB-minted chat is active before any row for it
  exists in the union, so attribution would answer `null` and refuse the re-seed for exactly the
  first-message auto-name (pyrycode#2159) this ticket exists to fix — and whether it answered at all would
  depend on `ConversationListData`'s listener having run before this one, which is the ordering dependence
  `conversationArchivedBridge` deliberately designed out. Worst case as shipped: display text belonging to
  another paired machine, in four places, until that machine's next list reply. Named as residual, not
  hidden.
- **[Hostile daemon response — content]** No findings. Rows are `parseConversationSummary`-decoded before
  they reach the renderer, so shape and types are already enforced; this path adds no parse of its own,
  and copies six already-typed fields into a fresh literal without coercion, concatenation or truncation.
  An oversized `name` is a rendering concern owned by the four readers and unchanged by this ticket.
- **[Electron attack surface]** No findings. Renderer-only, no IPC channel added, no `contextBridge`
  member, no `webPreferences` touched; the module reaches `window.pyry.onDaemonEvent` inside an effect and
  nothing else. No keys, sockets, tokens or raw frames — the transport stays main-side.
- **[Tokens / file & storage / cryptography]** Not applicable, by design rather than by omission: this path
  holds no secret, writes no disk, generates no randomness and performs no comparison against a secret. The
  six values it moves are display text and one boolean, and they never leave renderer memory.
- **[Errors, logs, telemetry]** No findings. Nothing is logged on any branch — deliberate, since the only
  fields a diagnostic could carry (`id`, `name`, `cwd`) are exactly what ADR 0007's content-free rule
  forbids, and no failure has been observed to instrument. No error object crosses into the UI, because no
  branch throws.
- **[Concurrency]** No findings. One synchronous listener, no async, no timer, no in-flight request, so
  there is no cancellation path to thread and no check-then-act gap across an `await`. The single listener
  is torn down by the off handle returned as the effect cleanup; a StrictMode double-mount nets one live
  listener.
- **[Availability]** No findings. A hostile daemon can already rename a conversation for real inside the
  Noise session, so a spurious `conversation_updated` plus a doctored list reply changes text it is
  entitled to change. The re-seed cannot evict the operator from the thread, cannot clear the timeline and
  cannot loop: each reply produces at most one write, and an equal reply produces none.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
