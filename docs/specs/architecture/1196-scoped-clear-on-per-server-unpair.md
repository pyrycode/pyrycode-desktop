# 1196 — an unpair drops the departed server's conversation rows, threads and open chat

## Files read

- `src/renderer/src/screens/settings/unpairServerAction.ts` → `UnpairServerDeps`, `runUnpairServer` — the
  one copy both unpair paths compose with, and the single line (`if (remaining.length === 0)
  deps.onLastServerUnpaired()`) that is the whole of the bug. AC4 lands here.
- `src/renderer/src/screens/conversation/unpairAction.ts` → `UnpairDeps`, `runUnpair`,
  `serverIdForOpenConversation` — the composer's one hop out. `UnpairDeps extends UnpairServerDeps`, so a
  new member is inherited rather than re-declared, and `serverIdForOpenConversation` is the premise below.
- `src/renderer/src/store/conversationListStore.ts` → `selectConversationIdsFor`,
  `selectConversationsFor`, `clearAllConversations`, `flattenByServer`, `stampRows` — the departed set's
  only source, the nullary clear whose docblock argues the shape, and the union recompute a keyed drop
  must reuse.
- `src/renderer/src/exitActiveConversation.ts` → `exitActiveConversation`,
  `ExitActiveConversationDeps` — AC3's precedent, and the gate this design delegates to rather than
  re-deriving. Its docblock's "five clears, not thirteen" argument is why AC3 gets `clearSessionId` and
  `clearRunConfig` for free.
- `src/renderer/src/clearPairingScopedState.ts` → `clearPairingScopedState`,
  `ClearPairingScopedStateDeps` — the last-server path, untouched by this ticket, and the UUIDv4 argument
  that makes retaining the surviving server's keyed state safe.
- `src/renderer/src/PairedShell.tsx` → `exitConversationDeps`, `clearPairingDeps`, `PairedShellView` —
  the `getState()`-inside-the-arrow wiring idiom this ticket copies, and the proof that neither of this
  ticket's two call sites can reach a shell-level nav.
- `src/renderer/src/pairedRoute.ts` → `nextPairedRoute` — `back` is absolute to `list`, which is why the
  Settings path needs no navigation of its own.
- `src/renderer/src/screens/settings/ServerRow.tsx` → `ServerRowControl` — deps literal #1.
- `src/renderer/src/screens/settings/SettingsScreen.tsx` → `SettingsScreen` — read only, to confirm
  `ServerRowControl` is mounted with `onLastServerUnpaired` alone. Deliberately NOT edited (see § Design).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `ComposerErrorSlotControl` — deps
  literal #2, and the one place `onBack` has to reach.
- `src/renderer/src/store/conversationTimelineStore.ts` → `clearTimelineFor`, `clearAllTimelines` — the
  single-key thread clear AC2 loops, and the eviction-order invariant a delete does not disturb.
- `src/renderer/src/store/conversationLastReadBridge.ts` → `conversationLastReadDeps` — the precedent
  for a module that exports a pure helper AND its one production wiring const.
- `e2e/settings-per-server-unpair.spec.ts` and `e2e/fixtures/launchPairedApp.ts` →
  `FIRST_SERVER_ID` / `SECOND_SERVER_ID` / `SEEDED_ROW` / `SECOND_SEEDED_ROW` / `secondServer` — the
  existing two-server drive to extend, and the substring trap its header documents.
- `docs/knowledge/features/conversation-list-store.md` § "Edge cases and limitations" — names per-server
  eviction as "a later ticket's" (this one), and records that `refreshOnChange` re-requests the list on
  `conversationUpdated` / `conversationCreated` / `conversationDeleted`. That is the only mechanism that
  could refill a dropped slot, and it cannot: `registry.reconcile()` has already dropped the departed
  server's connection, so no event carrying its stamp can arrive again.
- `docs/knowledge/features/unpair-channel.md` § "Edge cases and limitations" — states this exact gap
  ("After a Re-pair that leaves other servers paired, the unpaired server's rows stay in the sidebar")
  and confirms it is a stale-display gap only: no credential and no live connection survive.

## Design source

**Figma:** N/A — no component, layout or styling change. The sidebar and the chat pane render their
existing designs against less data, so the visual-fidelity check is intentionally skipped.

## Context

Both unpair paths compose with `runUnpairServer`, and that helper reaches renderer state through exactly
one conditional line: the whole-app `clearPairingScopedState` fires only when the erase left nothing
paired. Forgetting one of several servers therefore clears nothing. `serverInfoStore` is refreshed and
main drops the connection, but every slice the departed daemon authored stays.

Since #1070 and #1199 the sidebar draws one subtree per paired machine from `selectServers`, so the
departed host row leaves by itself while `groupByServer` finds its still-present rows stamped with a
server no longer on that list and sends them to the `unattributed` bucket — rendered last, under no host
row at all. Same one bug, same one fix; it only sharpens what the e2e must assert (§ Testing strategy).

**The premise the whole fix rests on, confirmed rather than assumed.** The `serverId` handed to
`runUnpairServer` IS the key `conversationListStore` slots by. The Settings row passes
`ServerInfoValue.serverId`, read back from main's paired collection by `loadServerInfo`; the composer
passes `serverIdForOpenConversation`'s return, which is the row's own `serverId` stamp narrowed to a
string; and that stamp is applied main-side by `bindServerOrigin` off the same registry key. All three
are client-held ids from this client's own paired record — never a daemon-supplied field. Verified by
reading each of the three routes. If they were different identifier spaces the fix would silently no-op.

**No ADR is owed.** This adds a keyed sibling to an existing clear and changes no boundary, no wire type
and no process placement. `clearPairingScopedState.ts`'s and `conversationListStore.ts`'s own docblocks
are where the argument belongs, and both already carry the paragraph this ticket extends.

## Design

Four edits and one new module.

### 1. `conversationListStore.clearConversationsFor(serverId: string)`

The keyed sibling of the nullary `clearAllConversations`. Copy-on-write: `new Map(held)`, `delete`,
recompute the union through the existing `flattenByServer`. Every surviving slot comes back BY REFERENCE,
so a component watching another server sees `Object.is` true and does not re-render — the property
`setConversations` already documents.

It carries the SUBSCRIBER SHORT-CIRCUIT its nullary sibling has: a key that is not held hands the state
object straight back, so a redundant clear wakes no listener.

**Typed `string`, not `ConversationListOrigin`.** The parameter is narrower than the store's key domain on
purpose: only a paired server can be forgotten, so the `null` (bound, no paired record) and `undefined`
(never bound) slots are unreachable from this entry point by the type, not by a rule. This is the keyed
counterpart of the nullary argument its sibling makes — `clearAllConversations` refuses an id so that no
daemon-supplied id can steer which server's rows survive; this one accepts an id but only one this client
minted, and the "CALL IT WITH A CLIENT-HELD ID" rule `selectConversationsFor`'s docblock states carries
forward verbatim.

Dropping the last held slot flattens to `conversations: null` — the store's not-yet-loaded state, which is
exactly right: the surviving server has not answered yet, and `ChannelList` shows its loading affordance
rather than a false "zero conversations".

### 1b. `selectExclusiveConversationIdsFor(origin)` — the departed set, minus what another server claims

A second selector beside `selectConversationIdsFor`, and the answer to the one MUST FIX the security pass
below found. The departed conversation ids are the only DAEMON-SUPPLIED input on this path: they arrive in
the departing server's own `conversationsReceived` reply, and nothing prevents a confused or hostile
daemon from listing ids that belong to ANOTHER paired machine. Fed to `clearTimelineFor` unfiltered, that
turns "forget machine A" into "destroy machine B's retained threads", and — through
`exitActiveConversation`'s id gate — into "close the chat the operator is reading on machine B". There is
no backfill for either timeline store, so the rows do not come back.

The selector answers the ids held for `origin` that appear under NO other slot. Honest daemons are
unaffected: the daemon mints conversation ids as UUIDv4 from the system random source, so a real
collision cannot occur and the exclusive set equals the full set. A claimed id is simply not dropped.

This is `serverIdForOpenConversation`'s shipped discipline applied to a set instead of a single id — that
function refuses an ambiguous match with `filter` and a length check rather than `find`, for this exact
reason, and its docblock states that two servers reporting the same conversation id "is a condition the
app does not otherwise prevent". It costs one pass over the held slots and turns a cross-machine erase
into a no-op.

A SIBLING of `selectConversationIdsFor` rather than a widening of it: that selector is the shared
"which conversations belong to this server" answer three reconnect-reset bridges ride, where the
consequence of an over-broad set is a reset that self-heals, and changing it under them is out of this
ticket's scope. Here the consequence is destruction with no backfill, so this path buys the stricter
answer for itself. Both return the shared `EMPTY_CONVERSATION_IDS` reference for a not-loaded, empty or
fully-claimed slot, and neither is a `useConversationListStore` read surface — a non-empty result is a
fresh `Set` per call, so consumers call it once inside an event handler against `getState()`.

### 2. `src/renderer/src/clearServerScopedState.ts` (new)

```ts
interface ClearServerScopedStateDeps extends ExitActiveConversationDeps {
  getDepartedConversationIds: (serverId: string) => ReadonlySet<string>
  clearConversationsFor: (serverId: string) => void
}
function clearServerScopedState(deps: ClearServerScopedStateDeps, serverId: string): void
const serverScopedClearDeps: Omit<ClearServerScopedStateDeps, 'navigateToList'>
```

Behaviour, in this order:

1. Read the departed conversation ids through `selectExclusiveConversationIdsFor` — **before** the slot is
   dropped. That ordering is the one place this can silently half-work: the ids are reachable only through
   the slot being dropped, and the exclusivity filter additionally needs every OTHER slot still in place
   to know what another machine claims.
2. Drop the slot (AC1).
3. For each departed id: `clearTimelineFor(id)` (AC2 — every departed thread, not only the open one) and
   `exitActiveConversation(deps, id)` (AC3).

`exitActiveConversation` is **composed, not re-derived**, which is why the deps interface extends its
own. Its id gate means at most one call in the loop does anything, and delegating the gate keeps exactly
one place in the app that decides "this id names the conversation on screen". The consequence is that AC3
inherits its whole established clear set — the flat timeline reset, `clearActiveConversation`,
`clearSessionId` and `clearRunConfig` — including the security payload that docblock argues for: an
inert Run-configuration surface rather than one addressing a session on a machine the operator has left.
The matching id's timeline is cleared twice (once by the loop, once inside the exit); both calls are
idempotent, and paying that over re-deriving the gate is deliberate.

**`serverScopedClearDeps` lives in this module, beside the pure function** — the
`conversationLastReadDeps` precedent. Every member reaches its singleton through `getState()` inside the
arrow body, so nothing is dereferenced at module load and nothing is read during render; the object closes
over no per-render value. It is here rather than at the two call sites because there are TWO containers
and neither owns the other: a literal at each site is two enumerations of one clear set, and a drift
between them is precisely the half-fix AC4 exists to catch. `navigateToList` is the one member that
cannot live here (it needs the container's nav), so the `Omit` makes the missing field explicit — the
`exitConversationDeps` shape in `PairedShell`.

**`navigateToList` differs legitimately between the two callers, and the Settings row's no-op is a
decision, not a gap.** `nextPairedRoute`'s only exit from `settings` is `back`, which is absolute to
`list`, so the operator's own next move already lands on the Channel List with the departed rows gone;
and `settings-per-server-unpair.spec.ts` pins Settings STAYING VISIBLE after a non-last unpair, so
navigating from that path would redden a shipped assertion and eject the operator from a screen they are
still using. The composer's Re-pair is the opposite case — it is pressed inside the very thread being
invalidated, and `serverIdForOpenConversation` means the open conversation ALWAYS belongs to the departed
server there — so it supplies the real nav. The clears fire on both paths; only the navigation is
route-dependent.

### 3. `UnpairServerDeps.clearServerScopedState: (serverId: string) => void`

Added to `UnpairServerDeps`, so `UnpairDeps extends UnpairServerDeps` inherits it and the composer path
gets the fix from the same one implementation (AC4). `runUnpairServer`'s tail becomes an `if/else`:

```
if (remaining.length === 0) deps.onLastServerUnpaired()
else deps.clearServerScopedState(serverId)
```

`else`, not a second statement: the last-server path stays byte-identical, runs the existing whole-app
clear alone, and the two clears can never both fire (AC5). The member **takes the id** rather than being
nullary like `PairingChangeDeps.clearPairingScopedState`, and that is the stronger property here — the
server whose state is cleared is by construction the server `runUnpairServer` just erased, rather than
whatever the call site closed over.

Naming it after the helper it reaches is `applyPairingChange`'s own convention.

### 4 & 5. The two deps literals

- `ServerRowControl` (`ServerRow.tsx`): one member added, `navigateToList` a documented no-op.
- `ComposerErrorSlotControl` (`ConversationScreen.tsx`): one member added, `navigateToList: () =>
  onBack?.()`. `ComposerErrorSlotControl` gains an optional `onBack` prop and `ConversationScreen` passes
  its own down — a single hop inside one file, at the mount already carrying `onUnpaired`. Optional and
  gated exactly like `onUnpaired`, so a bare `<ConversationScreen />` outside the shell still navigates
  nowhere.

**`SettingsScreen.tsx` and `PairedShell.tsx` are NOT edited.** Threading `onBack` into `ServerRowControl`
would buy a nav the Settings route must not perform, at the cost of a sixth production file.

## State + concurrency model

Stores touched: `conversationListStore` (one slot dropped), `conversationTimelineStore` (one key per
departed conversation), and — only when the open conversation is departed — `timelineStore`,
`activeConversationStore`, `sessionIdStore`, `runConfigStore` and `runSettingsWriteStore` through
`exitActiveConversation`.

Every effect is a synchronous in-memory store write. `clearServerScopedState` is fully synchronous with no
`await` inside it, so on the renderer's single thread no observer can see a half-cleared set and React
batches the writes into one commit. There is no check-then-act across an await: the id read and the slot
drop are adjacent statements in the same synchronous body.

The one asynchronous boundary is upstream and unchanged — `runUnpairServer` awaits the erase and the
refresh before any of this runs, and everything downstream of the erase still runs ONLY on `result: 'ok'`,
so a failed or rejected erase clears nothing.

No new subscription, timer, socket or long-lived task, so there is nothing to cancel and no teardown
handle to own. `clearConversationsFor` reads the held map INSIDE the zustand `set` updater, the
copy-on-write discipline `setConversations` already documents, so two writes cannot interleave.

Nothing here can refill the dropped slot afterwards: `conversationListBridge`'s `refreshOnChange`
re-requests the list on daemon events, and the departed server's connection is already gone
(`registry.reconcile()`), so no event carrying its stamp can arrive.

## Error handling

No new failure modes. Every effect is an in-memory store write that cannot throw — unlike
`clearAllLastRead`, nothing on this path reaches outside memory — so there is no ordering constraint of
the kind `clearPairingScopedState` carries, no try/catch, and no partial-clear state to recover from.

`clearServerScopedState` is total: no return value, no gate of its own, no throw path. A server with no
held slot resolves to `EMPTY_CONVERSATION_IDS`, loops zero times, and short-circuits the drop.

**Nothing is logged**, extending the log-free-by-construction property `unpairHandler`, `runUnpairServer`,
`exitActiveConversation` and `clearPairingScopedState` all hold. A diagnostic here would want the
`serverId` or the conversation ids to be useful, which ADR 0007's content-free rule forbids, and there is
no observed failure to instrument. Even a content-free count of what was dropped stays unwritten — the
posture `clearPairingScopedState` states in as many words.

## Testing strategy

**vitest (node, static renders — nothing in this repo can click):**

- `conversationListStore.test.ts` — `clearConversationsFor` drops the named slot and leaves every other
  slot BY REFERENCE; the union is recomputed and no longer carries the departed rows; dropping the only
  held slot returns the not-loaded shape; an unheld key hands the SAME state object back (the subscriber
  short-circuit). `selectExclusiveConversationIdsFor` answers the whole slot when no other server claims
  an id, EXCLUDES an id another slot also holds (the cross-machine erase the security pass found), and
  returns the shared `EMPTY_CONVERSATION_IDS` reference for a not-loaded, empty or fully-claimed slot.
- `clearServerScopedState.test.ts` (new) — the ids are read BEFORE the slot is dropped (asserted on spy
  call ORDER, since this is the one ordering that can silently half-work); every departed conversation's
  timeline is cleared, including ones that are not the open conversation (AC2's whole point); an open
  conversation belonging to the departed server is exited and the nav fires; one belonging to a surviving
  server is left alone and the nav does NOT fire (AC3, both halves); a server with no held rows is a total
  no-op.
- `unpairServerAction.test.ts` — the scoped clear fires with the ERASED id when servers remain; it does
  NOT fire on the last-server arm, where `onLastServerUnpaired` still does (AC5); neither fires on the
  `result: 'error'` or rejected-invoke arms.
- `unpairAction.test.ts` — the composer's `runUnpair` forwards the inherited member, so AC4 is pinned on
  both sides of the one hop rather than only inside the shared helper.

**Playwright, fake tier (`e2e/settings-per-server-unpair.spec.ts`, extended):** interaction is the only
way to prove the criteria end to end, and the `secondServer` fixture already seeds both halves — with it
on, the fixture clicks the FIRST server's seeded row as its connected gate, so at launch the open
conversation belongs to the server the drive unpairs.

- **AC1 is asserted against the APP-WIDE `.channel-list__row` set**, never against the departed machine's
  subtree. Since #1070 the departed host row goes away with or without this fix and its rows merely move
  to the `unattributed` run, so a subtree-scoped assertion would pass vacuously. After the fix that run is
  empty, which makes the whole-sidebar row set the real detector.
- Rows and Settings rows are addressed by POSITION or by the ARRAY form of `toHaveText`, never by a text
  filter: `fake-daemon` is a substring of `fake-daemon-2` and Playwright's `hasText` is a
  case-insensitive substring match. `SECOND_SEEDED_ROW`'s name shares no substring with `SEEDED_ROW`'s
  for the same reason.
- AC3's surviving half is driven by re-opening the second server's row after the unpair and asserting its
  thread still renders.
- The spec's "WHAT THIS SPEC DELIBERATELY DOES NOT ASSERT" header is REWRITTEN rather than deleted: it
  names the channel list as unasserted, attributes the scoping to #1150 (since split), and claims the
  surviving rows depend on "a session-status re-assertion this slice neither owns nor drives" — which the
  Context above shows is not needed. #1070 gives it a second reason to be rewritten: what the list does
  after an unpair is now a server-grouped question. No identifier grep finds this paragraph.

**`npm run build`, not just `npm test`.** Both dep-literal test files funnel through a local `deps()`
factory that casts `as never`, so a new required member on `UnpairServerDeps` produces no type error
there and no fixture cascade. The exposure is the two PRODUCTION call sites, where a missing member is a
real type error that vitest's esbuild strips and never reports. Nothing typechecks `e2e/` at all.

## Named carve-out — what this deliberately does not widen

`queueStore.resetBacklogsFor`, `backgroundTaskRosterStore.resetRostersFor` and `modalPrompts`' scoped
reset all take a conversation-id set today, so a departed server's queued backlogs, background-task
rosters and outstanding permission prompts ARE scopeable with the same departed set this design already
computes. They are left out because of SCOPE, not impossibility — #1090's Ask scopes this ticket to the
departed server's threads, its open chat, its last-read marks and its list slot, and the marks are a
deliberately separate sibling ticket. This is a known remaining gap, and the roster is the sharpest of
the three: a held `local_bash` task's `description` IS the literal command line claude ran.
`announcedModelStore`, `sessionIdStore`, `slashCommandListStore` and `modelListStore` are app-wide single
slots with no server key at all; keying them is the separate migration #1145 and #1146 are the open bugs
on. **Do not key a store here to make its clear scopeable.**

## Open questions

1. Does `ConversationScreen` render acceptably in the instant between `clearActiveConversation` and the
   `back` nav on the composer path? Both are synchronous inside one React batch, so the expectation is
   that no intermediate paint exists — to be confirmed in Phase B and recorded under `## Revisions` if it
   turns out otherwise.
2. Which selector the e2e uses for a row's title text (`.channel-list__row-open` versus a title span) —
   resolved by reading `ChannelList`'s row markup during implementation, not a design question.

## Security review

**Verdict:** PASS (after one MUST FIX was addressed in the design above — § Design 1b).

**Findings:**

- **[Trust boundaries] MUST FIX — ADDRESSED IN THE DESIGN.** The design has two inputs and they sit on
  opposite sides of the boundary. The `serverId` is CLIENT-HELD on all three routes into
  `runUnpairServer` — `ServerInfoValue.serverId` read back from main's paired collection, the row stamp
  `bindServerOrigin` applies main-side off the registry key, and `stampRows`' spread-first/stamp-last
  order that stops a daemon's own `serverId` field from overwriting it — so nothing a daemon sends can
  steer WHICH server is cleared. The conversation-id SET is not: it is whatever the departing daemon
  listed in its own `conversationsReceived` reply. The first draft fed that set straight to
  `clearTimelineFor` and to `exitActiveConversation`, so a confused or hostile paired daemon could list
  another machine's conversation ids and turn "forget machine A" into "destroy machine B's retained
  threads and close the chat the operator is reading on B" — destructive with no backfill, since neither
  timeline store has any history refill. Fixed by `selectExclusiveConversationIdsFor`: an id another
  slot also holds is not dropped. This is `serverIdForOpenConversation`'s shipped ambiguity refusal
  applied to a set, and it costs nothing against honest daemons (UUIDv4 ids never collide).
- **[Tokens, secrets, credentials] No findings.** Nothing on this path reads, writes, derives or compares
  a credential. The record erase is `unpairHandler`'s and is unchanged; this ticket runs strictly AFTER
  it and only on `result: 'ok'`. The clear moves in the safe direction — it removes a departed daemon's
  authored state from the renderer rather than retaining it. `clearSessionId` is inherited through
  `exitActiveConversation` and keeps that helper's security payload intact: the Run-configuration
  controls go inert rather than addressing a YOLO / auto-approval write to a session on a machine the
  operator has left.
- **[Tokens — a residual, named rather than fixed] OUT OF SCOPE.** `sessionIdStore` is an app-wide single
  slot with no server key, so a departed server's session id is dropped only when its conversation was
  the one on screen. Keying that store is the separate migration #1145 and #1146 are the open bugs on;
  this ticket must NOT key a store to make its clear scopeable (the ticket's own carve-out).
- **[File / storage operations] No findings, one named residual.** Nothing here touches the filesystem,
  and no path, filename or cache key is built from any input. The only store in the pairing-scoped family
  that reaches disk is `conversationLastReadStore` (`localStorage`), and it is deliberately NOT in this
  clear — the marks are the sibling ticket #1090 split off. Consequence, stated rather than hidden: a
  departed server's last-read marks survive on disk after its rows are gone. A mark is a conversation id
  and an integer count, so the residue is content-free.
- **[Inter-process / Electron attack surface] No findings.** No new IPC channel, no `contextBridge`
  addition, no preload edit, no `BrowserWindow` or `webPreferences` change, no protocol handler, no
  navigation. `window.pyry.unpairServer` is the existing per-server channel and is dereferenced only
  inside a click handler. Every line this ticket adds is renderer-local store state; nothing crosses to
  main. The transport, keys and Noise session are untouched.
- **[Cryptographic primitives] No findings — none used.** No RNG, no hashing, no comparison against a
  secret. The design does LEAN on the daemon's UUIDv4 conversation ids, but only as the safety argument
  for retaining a surviving server's keyed state — and the MUST FIX above is precisely the defence for
  what happens when that property is violated, so the design does not depend on it holding.
- **[Network & I/O] No findings — nothing added.** No socket, no fetch, no timeout, no reconnect. The
  departed server's connection is already gone (`registry.reconcile()`), which is also why nothing can
  refill the dropped slot: `conversationListBridge`'s `refreshOnChange` only re-requests on an event, and
  no event carrying the departed stamp can arrive again.
- **[Error messages, logs, telemetry] No findings.** Log-free by construction, extending the property
  `unpairHandler`, `runUnpairServer`, `exitActiveConversation` and `clearPairingScopedState` all hold. No
  `serverId`, no conversation id, no caught object and no count reaches a log line — ADR 0007's
  content-free rule forbids the ids that would make a diagnostic useful, and there is no observed failure
  to instrument. No user-facing error string is added; the existing `UNPAIR_FAILED_ERROR` on the composer
  path is unchanged and carries no daemon text.
- **[Concurrency] No findings, one pre-existing window named.** `clearServerScopedState` is fully
  synchronous with no `await` in its body, so the read-then-drop pair cannot interleave and React batches
  every write into one commit; `clearConversationsFor` reads the held map inside the zustand `set`
  updater. No timer, listener, socket or long-lived task is created, so there is nothing to cancel. The
  one reentrancy to check is #779's re-mint: clearing a timeline synchronously notifies
  `useConversationLastRead`, which samples the OPEN conversation's slice. Clearing a NON-open departed
  conversation's slice leaves that sample correct, so the loop introduces no new window; the only 0-mark
  case is inside `exitActiveConversation`, where it is pre-existing and entered identically by delete and
  archive today.
- **[Threat model alignment] Addressed.** *Hostile / compromised paired daemon* — the MUST FIX above is
  this threat, and it is the only one this renderer-local change can express; a daemon cannot influence
  which slot key its events carry (`bindServerOrigin` binds it from the registry), so it cannot mint a
  slot or spare its own. *Malicious relay* — content-blind and on-path only; it can drop or delay, and a
  delayed `conversationsReceived` for an unpaired server cannot arrive because the connection is gone.
  *Renderer compromise reaching the transport* — surface unchanged; this ticket adds no capability to the
  renderer, only state removal. *Token theft from disk* — not touched by this path.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07

## Revisions

### 2026-09-07 — the e2e cannot drive AC3's surviving half, and no spec may interact after the unpair

**What changed.** § Testing strategy planned to prove AC3's second half by re-opening the second
server's row after the unpair and asserting its thread. That is not drivable in this fixture, and the
constraint is broader than one assertion: **no post-unpair interaction that sends a command can be
followed by a sidebar read.**

**Why.** `launchPairedApp` starts BOTH fake servers through the same `startFakeServer`, which sets
`buildReply: () => seedConversationsFrame()` — a one-row `conversations` frame built from `SEEDED_ROW`.
The second server's own row reaches the app only through `pushFrame`, never through a reply. So any
request answered by the surviving server — opening a conversation fires `requestSessionSettings` and
`requestModelList` — draws a reply that overwrites the SURVIVOR's slot with the DEPARTED row's name.
Measured: the first draft of the spec re-opened the survivor's row and then read `Seeded discussion`
back out of the sidebar, with nothing wrong in the app.

**What it is now.** The spec asserts AC1 and AC3's first half (the app-wide `.channel-list__title` set,
plus `aria-current` count 0) and then stops interacting. AC3's second half moved to
`clearServerScopedState.test.ts`, which drives it directly with the open conversation belonging to a
server that is not the one departing — a case the e2e could not have reached cleanly anyway. The spec's
header records the trap.

**The assertion was mutation-checked**, because a sidebar read after an unpair is exactly the shape that
passes vacuously: with `runUnpairServer`'s new `else` arm disabled and the app rebuilt, the drive fails on
the title set (two rows instead of one) and passes again when it is restored.

### 2026-09-07 — Open questions resolved

1. **No intermediate paint between the active-conversation clear and the nav.** `clearActiveConversation`
   and `navigateToList` are adjacent synchronous calls inside `exitActiveConversation`, reached from
   `runUnpairServer`'s post-await continuation — a microtask, which React 18 auto-batches exactly as it
   does an event handler, so both land in one commit. Not driven end to end: no fake-tier spec forces the
   composer's terminal-error state with a second server paired AND a departed open chat, and
   `unpair-repair.spec.ts`'s two-server drive (which does press Re-pair) still passes unchanged.
2. **The e2e reads a row's title from `.channel-list__title`**, the `<span>` inside
   `.channel-list__row-open`. Rows are addressed for clicking by the button, and read by the array form of
   `toHaveText` over the title span.
