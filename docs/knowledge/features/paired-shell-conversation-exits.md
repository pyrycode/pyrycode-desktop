# Paired shell — conversation exits and stamps

Conversation activation, configuration refresh and active exits. Legacy last-read and view stamps
are retired; navigation does not establish read evidence.

Part of [Paired shell (list/thread two-pane desktop shell)](paired-shell.md); see that document for what the package does, its edge cases and its links.

## Confirmed deletion

[Confirmed conversation deletion](paired-shell-conversation-deletion.md) owns the stamped-origin
callback and host-ownership decision. Only an owned active deletion runs
`exitActiveConversation`'s clear-before-navigation sequence. Inactive confirmation leaves the
legacy holder unchanged; authoritative item and pending-send removal has its own runtime boundary.
The archive predicate below continues using the gated active-exit helper directly.

## The archive exit (`conversationArchivedBridge.ts`, #653)

Before this, archiving the discussion currently open in the thread fired `archive_conversation` and
closed the Channel Info sheet — and nothing else happened. The row left the Channel List (#469's
`partitionActive` already filtered `is_archived` rows), but the thread stayed open, rendering rows for a
discussion filed away, still accepting input.

`exitActiveConversation` — the
[shared active exit](paired-shell-conversation-deletion.md#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652)
— is reused **unmodified**. Only the trigger is new,
and it can't be a dedicated wire event the way #652's `conversationDeleted` is: the daemon's
`conversation_updated` reply, as desktop decodes it, carries no archive flag at all
(`ConversationUpdatedPayload` is five fields, and `inboundMessage.ts` names `is_archived` as a
tolerated-but-not-copied key), and it fires identically on rename, promote and change-workspace — three
of which are reachable on the open discussion from inside its own thread. Gating on the event's mere
*occurrence* would bounce the operator out on a rename or a workspace change, trading this bug for a
worse one.

The signal is instead **derived from the daemon's authoritative conversation list**, in a new module,
`conversationArchivedBridge.ts` — the `conversationCreatedBridge`/`conversationDeletedBridge` shape, and
the first of the three that **owns no wire arm**:

```ts
export function archivedActiveConversationId(
  conversations: readonly ConversationSummary[] | null,
  activeConversationId: string | null
): string | null {
  if (conversations === null || activeConversationId === null) return null
  const row = conversations.find((conversation) => conversation.id === activeConversationId)
  return row !== undefined && row.is_archived ? activeConversationId : null
}
```

- **A level predicate, not an edge** — evaluated against every `conversationsReceived`, with no notion of
  "the operator clicked Archive." This is what makes the AC "becomes archived ⇒ returns to the list"
  trigger-agnostic for free: any refresh that reveals the flag fires the exit, whoever caused it,
  including a **second client's** archive — pyrycode#881 delivers `conversation_updated` correlated to
  the requester via `c.Reply`, not broadcast, so another client's archive produces no event on this client
  at all; the flag only surfaces on this client's own next `list_conversations`, and the level predicate
  picks it up then (eventually, not live — a daemon fan-out gap, not a client design choice).
- **Four `null` arms, each required rather than defensive:** not-loaded (`conversations === null`), no
  thread open (`activeConversationId === null`), the row absent (a **delete**, owned by #652's bridge —
  this predicate must not double-claim it), and the row present but `is_archived: false` (the rename /
  change-workspace regression-pin arm).
- **Rows are read off the event, not `conversationListStore`.** Both are written by the same
  `conversationsReceived` delivery, so they can't disagree, but reading the event removes any dependence
  on whether `ConversationListData`'s app-level listener happened to run first — the same
  no-ordering-contract arrangement `conversationListBridge.ts` already documents for `conversationCreated`.
  In practice the store write does land first, which means this exit has **no stale-row window at all**:
  by the time it fires, `partitionActive` has already dropped the archived row from the Channel List —
  strictly better than #652's delete path, where the nav precedes the re-list by a round trip.
- **`translateConversationsEvent` is imported from `conversationListBridge`, not re-declared.** This
  bridge and the list bridge key off the same `conversationsReceived` arm — unlike the created/deleted
  bridges, which each own a distinct one — so the switch has exactly one place to update.

`subscribeArchivedActiveConversation` and `useArchivedActiveConversationExit` use
`conversationDeletedBridge`'s subscription lifetime (ref-held latest callback, empty-dep subscribe effect,
off-handle cleanup, `window.pyry` dereferenced only inside the effect).

Wired in `PairedShell`, directly beneath the #652 wiring, with **no new deps object**:

```ts
useArchivedActiveConversationExit(
  () => exitConversationDeps.getActiveConversation()?.id ?? null,
  (conversationId) =>
    exitActiveConversation(
      { ...exitConversationDeps, navigateToList: () => dispatch({ type: 'back' }) },
      conversationId
    )
)
```

`exitConversationDeps` (#652's module-scope deps object) supplies both the bridge's id getter and the
helper's own gate from the same source, so the two structurally cannot disagree about which conversation
is on screen — a double gate (bridge decides, helper re-checks) kept deliberately redundant so
`exitActiveConversation` ships unmodified.

**Inherits #652's absolute-`back` limitation, and the window is wider here.** The confirmation this
trigger waits on costs two round trips (archive → `conversation_updated` → `list_conversations` →
`conversations`) rather than #652's one, and "archive, then go check the Archive screen" is a more
natural operator flow than its delete equivalent — so a delayed archive confirmation landing while the
operator has stepped into Settings, Archive or Pair-server is more likely to yank them there than the
delete case is. Unobserved, every move is a clear, and this was explicitly left unfixed — a route-aware
`back` is its own ticket covering both halves. See [#653 codebase notes](../codebase/653.md) for the full
design rationale, the security review, and code review.

## The list reseed (`activeConversationReseedBridge.ts`, #1184)

Before this, `activeConversationStore`'s snapshot was written once — at activation — and never again.
A list refresh replaced the sidebar's rows (`setConversations`, driven from `subscribeConversations` on
every `conversation_updated`), but the open chat's own snapshot kept the name, `cwd` and
`workspace_label` it had when it was opened. Four surfaces read that snapshot: the [Channel Info
sheet](conversation-shell-session-and-channel-info.md#channel-info-sheet-365)'s title and About rows,
its rename prefill, and the [Workspace chip](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278)/[Workspace
Picker sheet](conversation-shell-workspace-chip-and-picker.md#workspace-picker-sheet-383). A sidebar
rename updated the row while every one of those kept the old name — and
[pyrycode#2159](https://github.com/pyrycode/pyrycode/issues/2159) makes this the common case
rather than an edge: the daemon auto-names an unnamed chat from its first message and pushes a
`conversation_updated`, so every new chat would say `Untitled` to its own sheet for the rest of the
session.

`activeConversationReseedBridge.ts` is the fix, and it copies `conversationArchivedBridge` wholesale —
same `translate* → subscribe* → use*` shape, same choice to own **no wire arm** and derive the signal
from `conversationsReceived` instead:

```ts
export function reseededActiveConversation(
  conversations: readonly ConversationSummary[] | null,
  active: ConversationCreatedPayload | null
): ConversationCreatedPayload | null {
  if (conversations === null || active === null) return null
  const matches = conversations.filter((conversation) => conversation.id === active.id)
  if (matches.length !== 1) return null
  const row = matches[0]
  if (/* all six mutable fields === active's, agent since #1649 */) return null
  return { id: row.id, is_promoted: row.is_promoted, cwd: row.cwd, name: row.name,
           last_used_at: row.last_used_at, workspace_label: row.workspace_label,
           ...(row.agent === undefined ? {} : { agent: row.agent }) }
}
```

- **A level over an equality diff, not a presence check** — the point where this predicate departs from
  `archivedActiveConversationId`'s shape (a level over a *flag*). "The daemon's list describes the open
  chat differently from the snapshot" covers a sidebar rename, a Save as channel, a change-workspace and
  the auto-name with one rule and no trigger list, evaluated fresh on every `conversationsReceived` with
  no notion of who caused the difference.
- **Ambiguity is refused, never resolved** — `filter` and a length check, the
  [`serverIdForOpenConversation`](unpair-channel.md#the-two-renderer-callers) discipline, never `find`. Two rows carrying the
  open chat's id write nothing rather than picking whichever came first.
- **`id` is the match key and is invariant by construction** — it is excluded from the equality
  comparison (it is equal by construction, not compared) and the mapper can only ever run on a row
  already carrying the open chat's id. That is what keeps the reconcile non-destructive: the sheet sends
  `id` back with Archive and Delete, and no re-seed can retarget those actions.
- **A closed six-field reconstruction (seven with a tagged row's `agent`, #1649), never the row passed
  through.** `ConversationSummary` is a
  structural superset of `ConversationCreatedPayload` — a sidebar `onOpen` hands the clicked row straight
  to the store (see [Workspace chip § `activeConversationStore.ts`](conversation-shell-workspace-chip-and-picker.md#workspace-chip-278)
  for that store's writer history) — but a fresh six-field literal here cannot carry an unknown key from
  a daemon row into the snapshot the four surfaces read. `is_archived` and `last_message_ts` are dropped;
  a reply moving only those is an unchanged refresh by the rule above.
- **The equality guard is the re-render guard.** `setActiveConversation` replaces the whole value, so an
  unconditional write on every routine list refresh would hand every `activeConversation` subscriber a
  new object identity. Comparing all six mutable fields (`agent` since #1649) with `===` (all primitives)
  before writing means a routine refresh that changes nothing costs nothing.
- **`conversationUpdated` is deliberately not consumed**, even though its payload carries every field the
  snapshot holds and reading it would be one line shorter. That frame is the daemon's *announcement*; the
  `conversations` reply is its *authoritative answer*, decoded through the same main-side path every
  other reader of this snapshot trusts. Reading the announcement instead would put unvalidated daemon
  text into the snapshot, bypassing that path.
- **Reseeding changes only the active payload.** It neither clears session/configuration nor
  navigates or requests configuration. Calling `activateConversation` here would cause unnecessary
  configuration requests on list refresh, even though same-ID activation preserves held settings.

Wired in `PairedShell` beside the archive-exit bridge, through `activateDeps`'s own getter/setter — no
new deps object:

```ts
useActiveConversationReseed(activateDeps.getActiveConversation, activateDeps.setActiveConversation)
```

**Two independent subscriptions on the same arm, deliberately.** This bridge and
`conversationArchivedBridge` both read `conversationsReceived` through the same
`translateConversationsEvent`, but neither reads the other's output or `conversationListStore` — each
reads the reply's own rows. That is what makes AC3 ("a reply from another paired server leaves the
snapshot alone") hold structurally: the app-wide union across servers is never consulted, only the one
reply currently being handled.

**Security residual, accepted rather than fixed: a cross-server id collision.** Two paired servers can
both claim one conversation id
([`selectExclusiveConversationIdsFor`](conversation-list-store.md#the-per-server-drop-and-its-stricter-sibling-selector-since-1196)
is the precedent for that threat). Server B's list reply carrying server A's open chat's id would re-seed A's snapshot with
B's name, `cwd` and `workspace_label` — this bridge refuses ambiguity only *within* one reply, not across
two. The obvious tightening — joining the reply's origin against the id's attributed server before
re-seeding — was considered and rejected: a FAB-minted chat is active before any row for it exists in
`conversationListStore`'s union, so that join would answer "unattributed" and refuse the re-seed for
exactly the first-message auto-name case this bridge exists to fix, and whether it answered at all would
depend on which of two independently-ordered subscriptions ran first. The accepted worst case is display
text belonging to another paired machine, self-healing on that machine's next list reply, with no
destructive effect — `id` stays invariant, so no action is retargeted.

**That residual's sink enumeration reaches one command payload, not only screen text — found in code
review.** `conversation.cwd` is not only rendered: [`CreateFolderDialog` sends it verbatim as the
`parent` argument of an outbound `create_workspace_folder`
command](conversation-shell-workspace-chip-and-picker.md#workspace-picker-sheet-383). The decision this
residual rests on is unchanged (the daemon polices `cwd` server-side, the value is shown to the operator
before they act, and `id` cannot be retargeted) — what code review corrected was the claim that the
residual was screen-text-only.

**Known coverage gap, flagged in code review rather than fixed.** The decision function
(`reseededActiveConversation`) and its subscription seam are covered by a full unit table, one case per
field plus the ambiguity and null arms. The `PairedShell` mount itself has no automated proof — the same
category of blind spot a deleted bridge mount left invisible to every gate but e2e once before:
`environment: 'node'` cannot run the effect, so an accidental deletion of the
`useActiveConversationReseed` call would pass `npm test` and `npm run build` and only surface, if at all,
in a manual drive. `e2e/conversation-create-rename.spec.ts` already renames through the Channel Info
sheet and already applies the rename to its fake daemon's held state; asserting the sheet's own title
after that round trip — not just the re-listed row — would close the gap cheaply, but was left for a
follow-up rather than added here. Whoever picks it up should also correct
`e2e/conversation-create-rename.spec.ts`'s own comment, which still reads "activeConversationStore is not
rewritten by `conversation_updated`" — true before this bridge, false since.

## The last-read stamp (`conversationLastReadBridge.ts`, #777)

The local item-count writer and `conversationTimelineStore` subscription were removed in
[#2028](https://github.com/pyrycode/pyrycode-desktop/issues/2028), including `stampLastReadFor`
and its dependency wiring. Opening, reopening and incoming legacy timeline changes no longer
record local read counts. The former teardown re-stamp of a missing slice as `0` is unreachable.

`useConversationLastRead()` remains mounted in `PairedShell` and calls only `useReadPublication()`.
Removing the entire hook would also remove authoritative publication. That publisher still requires
[committed visible content](conversation-shell.md#authoritative-thread-read-publication); navigation
itself supplies no read evidence. The local count store, persistence and pairing/per-server clears
remain for other consumers; see [the retained store](conversation-last-read-store.md).

## The view stamp (`activateConversation.ts`, #786)

`activateConversation` no longer calls `markViewed`, resets the flat timeline or creates a keyed
slice. Creation likewise no longer calls `initializeCreatedTimeline`. The legacy holder's standalone
methods and tests remain until #2030; their eviction policy is not production navigation policy.
Production creation and opening use the host-qualified [thread runtime](thread-runtime.md).

## The run-configuration and model-list ask (`activateConversation.ts`, `modelListBridge.ts`, #1166)

Opening a conversation crosses neither of [Run configuration store](run-config-store.md)'s two refresh
edges (the `connected` edge, each turn-end transition) nor [Model-list
store](model-list-store.md)'s two push lanes (a conversation's `initialize` reply, the connect-time
reconcile) — so a chat that has never had a turn, or was created after this app connected, sat with an
inert footer until one of those edges eventually fired. Since pyrycode#2085 the daemon answers
`request_session_settings` for a never-messaged conversation with that conversation's own bound
`session_id` and its stored model, effort and permission mode (rather than the old all-zero reply), which
is what makes asking immediately on open worth doing.

`ActivateConversationDeps.requestConversationConfig` runs last and outside the
id-change gate. Every activation reaches it, including re-opening the same chat;
requests require the unique owning host to be connected:

```
previous = getActiveConversation()
if (previous?.id !== conversation.id) { clearSessionId(); clearRunConfig() }
setActiveConversation(conversation)
requestConversationConfig(conversation.id)
```

`PairedShell.activateDeps.requestConversationConfig` checks current unique ownership and
host status before requesting settings, context usage, the model list and system prompt.
The [context ask](reported-context-store.md#how-it-works) runs once beside the settings ask,
including on same-chat reopening, never on a sheet open or settings refresh. Offline activation
updates the active payload without a local view/read stamp. Content recovery belongs separately to
the thread runtime. Replies land through app-lifetime subscribers; none of these activation asks retries.

Creation confirmation can arrive before its list row. The shell preserves local activation
and waits for the creating host's first authoritative list update before initializing once.
The main-stamped origin constrains the wait; only unique matching list ownership and current
connected status authorize requests. Disconnect, active-chat change, replacement creation
or unmount cancels it, with no reconnect replay. Ordinary held opening installs no wait.
See [created-chat initialization](conversation-shell.md#created-chat-initialization).

**`requestSystemPrompt` has no unsolicited counterpart.** `runConfigReceived`, `contextUsage` and
`modelListReceived` are also pushed on other edges, so a dropped ask there costs freshness
only; `system_prompt` has no pushed half at all — with no ask the event never fires, and [System-prompt
store](system-prompt-store.md) stays permanently at its not-yet-loaded state. That is why its sender's
falsy-id guard is a correctness boundary rather than tidiness: this verb has no error frame, so an
unroutable id would draw an ordinary-looking `no_session` reply nothing downstream can tell from a true
reading. See [System-prompt store § The ask](system-prompt-store.md#the-ask-srcrenderersrcpairedshelltsx-activatedepsrequestconversationconfig).

**Last, and the ordering is load-bearing in one direction.** `clearSessionId` (inside the gate, above)
wipes the very value the run-configuration reply refills — the ask must follow it, or a reply landing in
the same tick would be blanked by the clear it was sent to repair. Nothing downstream of the request
needs the store writes to have completed first.

All four senders reject null/empty conversation ids, so `activateConversation` needs no id-validation
branch of its own. The notification-activated `open` dispatch (#393) carries no conversation and does
not call `activateConversation`, so it sends no activation requests.

**The four comments this made false.** Before #1166, `modelListBridge.ts`, `modelListStore.ts`,
`App.tsx`'s `ModelListData` leaf and `clearPairingScopedState.ts` each stated that the model-list path had
no request half — two of them as a standing prohibition ("none may be added"). #1166 corrected all four in
place, without touching the no-retry rule underneath any of them: a one-shot ask fired only on activation
is not a retry, delivery is still best-effort, and no consumer may block a model menu on this frame. See
[Model-list store § The request half](model-list-store.md#the-request-half-requestmodellist-1166) for the
corrected reasoning.

**Late-reply attribution gap, closed by #1176 client-side.** Neither `SessionSettingsPayload` nor the
`runConfigReceived` event carries a `conversation_id` — that stayed true, since a wire change was out of
scope (ADR 0002) — so #1166 made every switch a fourth request occasion without being able to stop a
reply still in flight when the operator switches A → B from landing wherever `runConfigStore` /
`sessionIdStore` are listening when it arrives. #1176 closed it without touching the wire: the background
process now records each `request_session_settings`' envelope id against the conversation it named,
matches the reply by `Envelope.in_reply_to`, and carries the resolved id on `runConfigReceived`;
`subscribeRunConfig` drops a reply describing anything but the open conversation. See [Run config store §
Conversation-attributed since #1176](run-config-store.md#conversation-attributed-since-1176) for the
mechanism.

**What #1176 did not reach.** `sessionIdStore` has a second, unsolicited writer —
`sessionIdBridge`'s `session_transition` marker, which carries no conversation id and answers no
request, so there is nothing to correlate against. Filed as
[#1192](https://github.com/pyrycode/pyrycode-desktop/issues/1192).

## The run-configuration clear (`activateConversation.ts`, `exitActiveConversation.ts`, both stores, #1167)

The snapshot half of the run-configuration defect is bounded by #1166 (asks on every activation) and
\#1176 (refuses a reply naming a chat other than the open one, § above) — stale for at most one round
trip. Neither sibling touches the **write** half: a `set_session_settings` ack carries only `session_id`
and never rewrites the snapshot, so a `confirmed` override made in one chat composed over every later
chat's [Run configuration store](run-config-store.md) snapshot **permanently**, through
[Run configuration write store](run-settings-write-store.md)'s `selectEffectiveSettings` — no reply could
ever displace it. `clearPairingScopedState` deliberately left the snapshot store alone ("re-requested",
its own comment said) and never reached the write store at all; neither `activateConversation` nor
`exitActiveConversation` reset either one. That permanent half is what #1167 closes, and the ticket names
it as the half a detector should be built on — a drive that only shows the snapshot going stale races
\#1166's round trip instead.

Both `ActivateConversationDeps` and `ExitActiveConversationDeps` gain one shared, required, nullary
member, `clearRunConfig` — since [#1250](https://github.com/pyrycode/pyrycode-desktop/issues/1250) a
fourth arrow wide:

```ts
clearRunConfig: () => {
  runConfigStore.getState().clearSnapshot()
  runSettingsWriteStore.getState().dispatch({ type: 'conversationSwitched' })
  systemPromptStore.getState().clearReading()   // #1231
  systemPromptWriteStore.getState().dispatch({ type: 'conversationSwitched' })   // #1250
}
```

**One member for four stores, not four members** — the `requestConversationConfig` precedent from
[§ The run-configuration and model-list ask](#the-run-configuration-and-model-list-ask-activateconversationts-modellistbridgets-1166)
above, applied to the opposite direction: the clears are one act ("this chat's run configuration is no
longer the one to show"), they always fire together, and none is sufficient alone — clearing only the
snapshot store would leave a confirmed override standing over the newly opened chat's snapshot,
clearing only the write store would leave the departing chat's raw snapshot on display until a reply
arrived, leaving [System-prompt store](system-prompt-store.md) standing would show the departed chat's
system prompt, offered for edit by #1078, against the newly opened chat's thread, and leaving
[System prompt write](system-prompt-write.md)'s window-side store (`systemPromptWriteStore`) standing
would report a save made in the departed chat as still in flight, confirmed or refused against the
newly opened one — the one arrow of the four that never self-heals, since nothing asks for it and
nothing pushes it unsolicited. **The member is not renamed** for the fourth store it now covers — it
names the act, not the store list, and its signature stays `() => void` at both declaration sites.

`activateConversation` clears session and configuration only on an ID change, then records the
fresh payload and requests configuration on every activation, as shown above. Same-chat reopening
preserves held configuration while refreshing it.

**Placement differs between the two helpers, and each placement is load-bearing:**

- **`activateConversation`** calls it *inside* the id-change gate, alongside `clearSessionId` — so a
  re-open of the chat already open leaves the run configuration and session id standing. Being
  inside the gate also puts it ahead of `requestConversationConfig`, which
  sits last and outside the gate: the ordering #1166 documents for `clearSessionId` applies unchanged
  here — the clear must precede the ask, or a reply landing in the same tick would be blanked by the
  clear sent to repair it.
- **`exitActiveConversation`** calls it unconditionally past its own id gate, after `clearSessionId` and
  before `navigateToList` — there is no successor chat to preserve it for, so unlike the activate path
  there is no gate to sit inside.

**Nullary dependency swaps still compile.** `clearRunConfig` is nullary, so on
`ActivateConversationDeps` it is swappable with
`clearSessionId`, and on `ExitActiveConversationDeps` with `clearSessionId`, `clearActiveConversation`
and `navigateToList` — every swap compiles, and a bare `toHaveBeenCalled()` passes for both halves. The
defence uses existing real-store dependency factories: activation and exit tests check actual
session/configuration state, and confirmed-deletion tests include settings and both prompt stores.
Spy call counts alone cannot prove that the right store was cleared.

**Consequence, already carried by the session-id clear and now widened by one more reading.** Clearing
the snapshot drops `usedTokens`/`windowTokens` with it, so the footer's context-usage reading unmounts
until the newly opened (or, on exit, never-reopened) chat's own reply lands. That is the intended widened
window, not a regression — see [Run configuration store § Scoped to the open chat since
\#1167](run-config-store.md#scoped-to-the-open-chat-since-1167).

**`clearPairingScopedState` stays out of scope, on the ticket's own rule — and #1231's and #1250's
stores inherit the same reasoning rather than re-arguing it.** An unpair leaves all four stores held,
but no footer renders until a chat is opened, and that open clears them by construction through
`activateConversation` — a member there would guard state nothing can read. That mirrors this document's
[conversation-boundary exclusions](paired-shell-conversation-deletion.md#the-delete-exit-exitactiveconversationts-conversationdeletedbridgets-652) for `exitActiveConversation`'s retained clears.

The Playwright drive this ticket added, `e2e/run-config-scoped-to-conversation.spec.ts`, is deliberately
not the shape of the sibling `run-config-cross-conversation.spec.ts` that [Run configuration
store](run-config-store.md) links: it seeds chat A's configuration *and confirms a change in it* before
switching to chat B, because the fake
tier pushes no snapshot unprompted — a drive that skips the seeded confirm asserts "B draws nothing"
against a state that draws nothing anyway, and passes with the clear deleted. It mutation-checks the
effort label locator down to a count of 0 immediately after the switch (the durable defect, caught before
any reply), then checks it again after pushing B's own correlated reply (a second, independent detector:
with the clear deleted, A's confirmed override would still beat B's snapshot and the label would read
A's value instead of B's).
