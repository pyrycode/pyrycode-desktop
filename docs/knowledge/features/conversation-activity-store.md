# Conversation activity store

The renderer's held copy of what **every** conversation is currently doing — turn-running, stalled,
api-retrying, compacting, resetting — keyed by `conversationId` rather than scoped to whichever
conversation is open, so a future sidebar can draw a dot on a row the user has never opened.

Introduced in [#747](../codebase/747.md), split from #674 alongside #748 (the bridge that writes it)
and #749 (the clears). #747 shipped the holder alone — no writer, no reader — the same "populated and
unread" posture the [background-task roster store](background-task-roster-store.md) shipped for #573
before its first reader (#568) landed. [#748](../codebase/748.md) then shipped the first writer: a
second, independent daemon-event subscriber, `conversationActivityBridge.ts`. [#749](../codebase/749.md)
closed the store out — `dropConversation` on a `conversationDeleted` arm and a whole-map
`clearAllActivity` on the `connected` edge — so the map was bounded across both a single deletion and a
pairing change. [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145) then split that second
half in two: since [#1117](daemon-connection-routing.md) the app holds one live connection per paired
server and since #1068 every event carries the id of the server it came from, so a `connected` edge
firing for server B was blanking every OTHER server's dots too, with nothing to re-assert one until that
conversation's own next `turnState`. The `connected` edge now runs a new setter,
`resetActivityFor`, scoped to the reconnecting server's own conversations; `clearAllActivity` moved to
the pairing boundary instead, joining `clearPairingScopedState` as its fourteenth member (see [Paired
shell](paired-shell.md)). It is still read by nobody — the still-unbuilt sidebar (#676) is the first
reader.

[Conversation status resolver](conversation-status.md) (#799) is the first module to consume
`ConversationActivityEntry` as a type — the only symbol it imports, and only via `import type`, so this
store's runtime singleton is never dragged into the resolver's test graph. It does not call
`selectActivityFor` itself; that lookup is #801's, unbuilt.

## What it does

Holds, per conversation id, the five booleans in `ConversationActivityEntry`:

- `turnRunning` — a turn is in flight for this conversation.
- `stalled` — the turn has stalled.
- `apiRetrying` — the daemon is retrying against an API error. Liveness only, not the retry counter:
  [thread timeline](thread-timeline.md)'s richer `ApiRetryStatus` (`current`/`total`) stays put and
  keeps serving the open conversation's chrome.
- `compacting` — the conversation is compacting.
- `resetting` — the conversation's session is resetting ([#1516](https://github.com/pyrycode/pyrycode-desktop/issues/1516)).
  Liveness only, the same way as `apiRetrying`: the wire's `resetting` arm also carries `phase` and
  `handoff`, and neither crosses into this entry — they serve [#1517](https://github.com/pyrycode/pyrycode-desktop/issues/1517)'s
  composer status row on the open conversation instead.

A key **absent** from the map means "no frame has ever arrived for this conversation" and is a state
distinct from a **present, all-false** entry ("observed; nothing is happening"). `selectActivityFor`
preserves that distinction rather than collapsing it — the same three-way reading
[background-task roster store](background-task-roster-store.md)'s `selectRosterFor` established, reused
here rather than re-derived.

## How it works

- **Shape:** the house four-part store (`zustand/vanilla` DI factory → app-wide singleton → `useStore`
  hook → selector factory bound to one id), the same shape as `relayLinkStore` and the background-task
  roster store. State is `{ entries: ReadonlyMap<string, ConversationActivityEntry> }`.
- **Write path:** five named setters (`setTurnRunning`, `setStalled`, `setApiRetrying`,
  `setCompacting`, `setResetting`), never a reducer or a generic `setFact(id, name, value)`. Each is a
  same-value guard (`s.entries.get(id)?.field === value ? s : writeEntry(...)`) composed onto one
  private `writeEntry` helper that clones the outer map and replaces the one key — never mutates in
  place. The guard is written per-setter against its own named field rather than a shared multi-field
  comparison, so a new fact needs only its own setter with its own guard, and can't silently stop an
  existing setter from writing — [#1516](https://github.com/pyrycode/pyrycode-desktop/issues/1516)'s
  `setResetting` is the case this argument was written for, added with no change to the other four.
  `setResetting`'s guard also absorbs the reset arm's re-fire as the phase advances (`wrapping_up` →
  `restarting`): both edges write the same `true`, so the guard returns the state object on the second
  and no subscriber wakes — no dedup needed upstream, and none may be added there, since a suppressed
  repeat would eat the signal that the phase moved.
  - Because `undefined` is never `===` a boolean, a **first write of `false` still creates the entry** —
    the create path is not skippable by writing the same value the seed already holds.
  - A verbatim repeat (the upstream daemon arms are not deduped) returns the state object itself, so
    `zustand`'s `Object.is` short-circuit fires and no subscriber wakes.
  - A write to one conversation leaves every other conversation's held entry object referentially
    identical (`new Map(s.entries)` copies references), so a component watching a different
    conversation does not re-render.
- **Read path:** `selectActivityFor(conversationId)` is the only read surface — a selector factory, not
  a hook-bound accessor. Returns `entries.get(id) ?? null`. `null` is a stable reference, so no
  `EMPTY_*` constant is hoisted and no object is built per call. There is no whole-map selector; nothing
  in this store or its two sibling tickets reads the map wholesale.
- **Eviction path** ([#749](../codebase/749.md), split by
  [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145)): three members beside the five
  setters. `dropConversation(conversationId)` removes exactly one key — guards on `entries.has`,
  returning the state object itself (waking no subscriber) when the key is absent, otherwise cloning the
  outer map and deleting on the clone so every surviving entry stays `Object.is`-identical to what was
  held before. `resetActivityFor(conversationIds: ReadonlySet<string>)` — added by #1145 as the
  reconnect reset — iterates the HELD keys (bounded by what this store holds, not by the server's
  conversation count) and drops the ones present in the given set, the `resetBacklogsFor` /
  `resetRostersFor` shape reused verbatim: no held key listed ⇒ the state object comes back, so a first
  connect, a reconnect of a server holding nothing here, and an already-empty map all wake no listener.
  A `ReadonlySet` membership test rather than a `Record` lookup, so `'__proto__'` stays an ordinary key
  on both the held side and the listed side. `clearAllActivity()` drops every key, shaped after
  `backgroundTaskRosterStore.ts`'s `resetRosters` (`size === 0` guard, else a fresh empty `Map` — never
  the module-shared `initialConversationActivityState` constant, which would alias every cleared instance
  to one object). Since #1145 this is no longer wired to the `connected` edge — see below.
- **Hostile keys:** `ReadonlyMap` is mandated over `Record<string, …>` specifically so `'__proto__'`,
  `'constructor'` and `''` are ordinary keys by construction rather than by validation —
  `Map.prototype.get`/`.set` never touch the prototype chain. The write path uses no computed object
  keys anywhere (every fact is a property shorthand at a named call site), so there is no `{ [x]: v }`
  whose key provenance needs tracing.
- **Turn-running derivation:** `setTurnRunning` takes a plain `boolean`; this store does not derive it
  from `TurnPhase` itself. `isTurnRunning` — the existing predicate the body asks to reuse — is exported
  from `ConversationScreen.tsx:1343`, a React screen module, so importing it here would drag React, JSX
  and that screen's import graph into a store whose tests run with no React and no DOM. The derivation
  is #748's job; this file's only imports are `zustand/vanilla` and `zustand`, a hard, grep-checkable
  constraint stated in the module header.

## Configuration and usage

- File: `src/renderer/src/store/conversationActivityStore.ts`.
- Singleton: `conversationActivityStore`. Hook: `useConversationActivityStore(selector)`.
- Read one conversation: `useConversationActivityStore(selectActivityFor(conversationId))`.
- **Writer:** `src/renderer/src/store/conversationActivityBridge.ts` ([#748](../codebase/748.md),
  [#1516](https://github.com/pyrycode/pyrycode-desktop/issues/1516)). A second, independent subscriber
  on the daemon-event channel — reactive-only, no command sent, in the `queueBridge` /
  `backgroundTaskRosterBridge` posture — that translates each of the five owned arms (`turnState`,
  `stallDetected`, `apiRetry`, `compacting`, `resetting` — `src/shared/ipc/events.ts:125,145,172,199`
  plus the `resetting` arm added for [#1515](https://github.com/pyrycode/pyrycode-desktop/issues/1515),
  each carrying a required `conversationId`) into one or more named-field writes and applies them to the
  store's setters, keyed by **the event's own** `conversationId`, never the open conversation's.
  `turnState` fans out to two writes: `turnRunning`, derived by reusing `isTurnRunning`
  (`ConversationScreen.tsx:1343` — the store's own import ban is scoped to the store module, not to
  this bridge), and an unconditional `stalled: false` clear on any phase including `idle`, reused
  verbatim from `threadTimeline.ts:356-359`. `apiRetrying`, `compacting` and `resetting` clear only on
  the wire's own `active: false` edge, mirroring `threadTimeline.ts:196-205` — turn activity does not
  clear them. `resetting` is sharper than its two peers about this: the reset's wrap-up turn runs
  *inside* the reset, so `resetting` is deliberately kept out of `turnState`'s clear set, or that turn's
  own transitions would clear the very fact they are part of. Only the arm's `active` token crosses into
  the write — `phase` and `handoff` are read by nothing here and serve
  [#1517](https://github.com/pyrycode/pyrycode-desktop/issues/1517)'s composer status row instead, kept
  out by a fresh named-field literal rather than a spread, the same rule that keeps `apiRetry`'s counter
  out of this store. Mounted as `ConversationActivityData`, the eighth headless leaf in `App.tsx`,
  unconditional and app-lifetime rather than screen-scoped. `timelineBridge.ts` keeps writing the open
  conversation's existing chrome scalars unchanged; the two paths don't overlap.
- **Known gap:** a stall in a conversation that isn't open can only clear on that conversation's next
  `turnState`, not on the finer-grained `assistantDelta`/`toolUse`/`toolResult`/`userText` clears the
  open conversation's chrome gets — those four arms carry no `conversationId` at the emit
  (`events.ts:109-110`, `:459-466`, `:467-472`), so there's no id to key a write on. Bounded (every turn
  ends with a `turnState`), not latched, but coarser than the open conversation. Closing it needs the
  transport widening in #675, out of scope for #748.
- **Eviction wiring** ([#749](../codebase/749.md), rescoped by
  [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145)): two early-return branches in
  `subscribeConversationActivity`, ahead of the translator switch — `conversationDeleted` →
  `dropConversation(event.id)` (no truthiness guard; `''` is a real id) and `connected` →
  `resetActivityForServer(originOf(event))`. On `clearPairingScopedState`'s own discriminator ("does a
  reconnect to the SAME daemon need to clear it?") the answer is yes and stays yes — a turn running when
  the socket dropped may have finished while it was down — but until #1145 the `connected` branch called
  the nullary `clearAllActivity()`, so it was scoped to "the app's one connection," which since
  [#1117](daemon-connection-routing.md) each paired server holds its own live connection of stopped being
  true: server B's reconnect was blanking every OTHER paired server's dots, with nothing to re-assert one
  until that conversation's own next `turnState` (a running turn's end). `originOf`, a local copy of the
  `'serverId' in event` idiom six other bridges already carry, reads #1068's client-bound stamp — never
  `event.ack.server_id` — and the bridge stays store-free: turning that origin into the conversation ids
  to drop is `ConversationActivityData`'s job, resolving it through
  [conversation list store](conversation-list-store.md)'s shared `selectConversationIdsFor` at reset
  time (not subscribe time), the `QueueData` composition-root shape reused verbatim. Scoping the edge
  retired the self-heal it was incidentally providing at the pairing boundary, so `clearAllActivity` now
  runs instead from `clearPairingScopedState` — see [Paired shell](paired-shell.md) — as its fourteenth
  member; a re-pair to the same box would otherwise show a finished turn's working dot until that
  conversation's next `turnState`, which for a turn that ended while unpaired never arrives.
  [#1516](https://github.com/pyrycode/pyrycode-desktop/issues/1516) added a fifth fact after this eviction
  design was set, and changed nothing about it: `clearAllActivity` drops whole entries, so the new fact
  is cleared by the pairing boundary with no edit, the same way `dropConversation` and
  `resetActivityFor` already covered it for free. Because the
  bridge is mounted App-level (outside `PairedShell`) and every pairing change re-handshakes, the
  `connected` branch still covers both the unpair route flip and the pair-another-server transition that
  never unmounts the shell — that part of the `backgroundTaskRosterBridge.ts` precedent is unchanged. The
  delete seam is a third, independent listener on the `conversationDeleted` arm — deliberately not
  folded into `PairedShell.tsx`'s existing `useConversationDeletedExit`, whose callback gates on the id
  matching the *open* conversation, where eviction must be ungated.
  `ConversationActivityDeps`' `resetActivityForServer: (origin: ConversationListOrigin) => void` is the
  first member of that named-object dep set (#749) that does not fully collapse onto the five
  `(id, boolean)` setters — a two-parameter setter can no longer be assigned *into* its one-parameter
  slot — which narrows, rather than retires, the cross-wire hazard the object shape was chosen against;
  it still collapses the other way, since a single-parameter function is assignable to a two-parameter
  slot and `ConversationListOrigin` admits a bare `string`.

## Edge cases and limitations

- **Not migrated:** [thread timeline](thread-timeline.md)'s existing chrome scalars (`phase`, `stalled`,
  `apiRetry`, `compacting`, `localSendPending`) are untouched and keep serving the open conversation.
  This store runs alongside them, not in place of them; migrating is explicitly out of scope here and in
  the two follow-up tickets.
- **`localSendPending` still holds no reading here, and [#1516](https://github.com/pyrycode/pyrycode-desktop/issues/1516)
  didn't weaken that argument — it's about a different fact.** That scalar is renderer-sourced, opened
  only by the open conversation's own composer send with no daemon involvement, so it has no natural
  per-conversation reading. A daemon-sourced fact carrying its own `conversationId`, as `resetting` does,
  is the opposite case and belongs here; `localSendPending`'s owner is a screen, not a wire frame, which
  is the reason it stays out, not a headcount.
- **Bounded across a delete and a pairing change; the reconnect bound widened at #1145.** [#749](../codebase/749.md)
  closed the two eviction paths named above, so growth no longer survives a conversation delete or a
  pairing change. Growth used to also be bounded *since the last handshake*, on the ground that
  `clearAllActivity` emptied the whole map on every `connected` edge; since
  [#1145](https://github.com/pyrycode/pyrycode-desktop/issues/1145) scoped that edge to the reconnecting
  server's own listed conversations, an entry for a conversation that appears in **no** server's
  conversation list — reachable, since any of the five daemon arms can arrive before that conversation's
  list has landed — survives every reconnect and is collected only by `clearAllActivity` at the next
  pairing boundary. The residue *within* one pairing is still uncapped by design, the same widening
  [queue store](queue-store.md), [background-task roster store](background-task-roster-store.md) and
  [modal store](modal-store-bridge.md) each took while holding far larger per-entry payloads than this
  store's five booleans; #676, the first reader, is the natural place to add a real ceiling if one is
  ever wanted.
- **A fact whose falling edge may never arrive is discharged by the eviction paths, not by a timer.**
  [#1516](https://github.com/pyrycode/pyrycode-desktop/issues/1516)'s `resetting` is fed by a daemon arm
  ([#1515](https://github.com/pyrycode/pyrycode-desktop/issues/1515)) whose own contract warns a
  consumer not to rely on the falling edge: a daemon killed mid-reset sends no `active: false`, so a fact
  cleared only by that frame would pin on forever. Nothing new was added to discharge it — the three
  independent clears this store already owned (`dropConversation`, the scoped `resetActivityFor`, and
  `clearAllActivity` at the pairing boundary) already cover it, the same way they cover a `turnRunning`
  left `true` by a daemon that dies mid-turn. Any future fact fed by an arm with the same caveat is
  already covered for free.
- **The reconnect reset rides the shared, non-exclusive resolution — a hostile server can widen its own
  reconnect's blast radius, never destructively.** `resetActivityFor` is fed by
  [conversation list store](conversation-list-store.md)'s `selectConversationIdsFor`, not the stricter
  `selectExclusiveConversationIdsFor` [`clearServerScopedState`](paired-shell.md) uses — a deliberate
  choice, not an oversight (#1145 security review). A confused or hostile server B that lists server A's
  conversation ids in its own reply can make its own reconnect drop A's entries for those ids, but the
  worst outcome is a missing dot that A's own next `turnState` restores; nothing is destroyed and nothing
  is unrecoverable, which is exactly the case the shared selector is for. The exclusive sibling exists
  for `clearServerScopedState` instead, where an over-broad answer would destroy another machine's
  retained threads with no backfill.
- **Log-free by construction.** No `console.*` on any path — the only value a diagnostic could carry is
  the untrusted `conversationId`, and the content-free diagnostics rule (#126) keeps it out. A read miss
  is silent by design, not a swallowed error.

## Related decisions

- [Conversation timeline holder](conversation-timeline-holder.md) — the direct structural descendant
  (#755): the same `ReadonlyMap` + copy-on-write + selector-factory shape applied to a whole
  `TimelineState` per conversation instead of a handful of booleans, adding a bound
  (`MAX_RETAINED_TIMELINES`) and least-recently-viewed eviction that this store's own header explicitly
  declines.
- [Background-task roster store](background-task-roster-store.md) — the direct precedent for the
  `ReadonlyMap` + copy-on-write + named-setters + `?? null` selector shape, reused rather than
  re-derived; also the earlier instance of shipping a store "populated and unread" ahead of its first
  writer/reader.
- [Thread timeline](thread-timeline.md) — the existing open-conversation chrome scalars this store sits
  beside without migrating.
- [Announced-model store](announced-model-store.md) — documents the same-name-different-shape trap this
  store's `apiRetrying` (vs. thread timeline's `apiRetry` counter record) deliberately avoids by naming.
- [Queue store](queue-store.md) / [Background-task roster store](background-task-roster-store.md) /
  [Modal store](modal-store-bridge.md) — the three worked precedents for #1145's reconnect-reset shape:
  each scoped its own `connected`-edge whole-map clear to the reconnecting server's own conversations via
  `selectConversationIdsFor`, then moved its nullary whole-map clear into `clearPairingScopedState`. This
  store is the fourth and — per that ticket's estimate — the cheapest of the four, since `clearAllActivity`
  already existed in exactly the shape the pairing-boundary set wanted.
- [Conversation list store](conversation-list-store.md) — the source of `selectConversationIdsFor` /
  `EMPTY_CONVERSATION_IDS` (#1138) this store's reconnect reset consumes as its fourth caller, and of the
  stricter `selectExclusiveConversationIdsFor` it deliberately does not.
- [Paired shell](paired-shell.md) — `clearAllActivity` is `clearPairingScopedState`'s fourteenth member
  since #1145, wired in `PairedShell`'s `clearPairingDeps`, ahead of `clearAllLastRead`.
- [Conversation status resolver](conversation-status.md) — the sole consumer of
  `ConversationActivityEntry`; its `isWorking` gained a fifth named read for `resetting` at
  [#1516](https://github.com/pyrycode/pyrycode-desktop/issues/1516), reading only the store's boolean and
  never the arm's `phase`/`handoff`.
- [#747 codebase notes](../codebase/747.md) — the holder's implementation summary and lessons learned.
- [#748 codebase notes](../codebase/748.md) — the writer's implementation summary, the
  `store/` → `screens/` import argument, and lessons learned.
- [#749 codebase notes](../codebase/749.md) — the eviction paths' implementation summary, the
  positional-effects-list hazard that motivated the `ConversationActivityDeps` object, and lessons
  learned.
