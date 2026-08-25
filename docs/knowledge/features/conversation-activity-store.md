# Conversation activity store

The renderer's held copy of what **every** conversation is currently doing — turn-running, stalled,
api-retrying, compacting — keyed by `conversationId` rather than scoped to whichever conversation is
open, so a future sidebar can draw a dot on a row the user has never opened.

Introduced in [#747](../codebase/747.md), split from #674 alongside #748 (the bridge that writes it)
and #749 (the clears). #747 shipped the holder alone — no writer, no reader — the same "populated and
unread" posture the [background-task roster store](background-task-roster-store.md) shipped for #573
before its first reader (#568) landed. [#748](../codebase/748.md) then shipped the first writer: a
second, independent daemon-event subscriber, `conversationActivityBridge.ts`. [#749](../codebase/749.md)
closed the store out — `dropConversation` on a `conversationDeleted` arm and `clearAllActivity` on the
`connected` edge — so the map is now bounded across both a single deletion and a pairing change. It is
still read by nobody — the still-unbuilt sidebar (#676) is the first reader.

## What it does

Holds, per conversation id, the four booleans in `ConversationActivityEntry`:

- `turnRunning` — a turn is in flight for this conversation.
- `stalled` — the turn has stalled.
- `apiRetrying` — the daemon is retrying against an API error. Liveness only, not the retry counter:
  [thread timeline](thread-timeline.md)'s richer `ApiRetryStatus` (`current`/`total`) stays put and
  keeps serving the open conversation's chrome.
- `compacting` — the conversation is compacting.

A key **absent** from the map means "no frame has ever arrived for this conversation" and is a state
distinct from a **present, all-false** entry ("observed; nothing is happening"). `selectActivityFor`
preserves that distinction rather than collapsing it — the same three-way reading
[background-task roster store](background-task-roster-store.md)'s `selectRosterFor` established, reused
here rather than re-derived.

## How it works

- **Shape:** the house four-part store (`zustand/vanilla` DI factory → app-wide singleton → `useStore`
  hook → selector factory bound to one id), the same shape as `relayLinkStore` and the background-task
  roster store. State is `{ entries: ReadonlyMap<string, ConversationActivityEntry> }`.
- **Write path:** four named setters (`setTurnRunning`, `setStalled`, `setApiRetrying`,
  `setCompacting`), never a reducer or a generic `setFact(id, name, value)`. Each is a same-value guard
  (`s.entries.get(id)?.field === value ? s : writeEntry(...)`) composed onto one private
  `writeEntry` helper that clones the outer map and replaces the one key — never mutates in place. The
  guard is written per-setter against its own named field rather than a shared multi-field comparison,
  so a future fifth fact needs only a fifth setter with its own guard, and can't silently stop an
  existing setter from writing.
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
- **Eviction path** ([#749](../codebase/749.md)): two members beside the four setters.
  `dropConversation(conversationId)` removes exactly one key — guards on `entries.has`, returning the
  state object itself (waking no subscriber) when the key is absent, otherwise cloning the outer map and
  deleting on the clone so every surviving entry stays `Object.is`-identical to what was held before.
  `clearAllActivity()` drops every key, shaped after `backgroundTaskRosterStore.ts`'s `resetRosters`
  (`size === 0` guard, else a fresh empty `Map` — never the module-shared `initialConversationActivityState`
  constant, which would alias every cleared instance to one object).
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
- **Writer:** `src/renderer/src/store/conversationActivityBridge.ts` ([#748](../codebase/748.md)). A
  second, independent subscriber on the daemon-event channel — reactive-only, no command sent, in the
  `queueBridge` / `backgroundTaskRosterBridge` posture — that translates each of the four owned arms
  (`turnState`, `stallDetected`, `apiRetry`, `compacting` — `src/shared/ipc/events.ts:125,145,172,199`,
  each carrying a required `conversationId`) into one or more named-field writes and applies them to the
  store's setters, keyed by **the event's own** `conversationId`, never the open conversation's.
  `turnState` fans out to two writes: `turnRunning`, derived by reusing `isTurnRunning`
  (`ConversationScreen.tsx:1343` — the store's own import ban is scoped to the store module, not to
  this bridge), and an unconditional `stalled: false` clear on any phase including `idle`, reused
  verbatim from `threadTimeline.ts:356-359`. `apiRetrying` and `compacting` clear only on the wire's own
  `active: false` edge, mirroring `threadTimeline.ts:196-205` — turn activity does not clear them.
  Mounted as `ConversationActivityData`, the eighth headless leaf in `App.tsx`, unconditional and
  app-lifetime rather than screen-scoped. `timelineBridge.ts` keeps writing the open conversation's
  existing chrome scalars unchanged; the two paths don't overlap.
- **Known gap:** a stall in a conversation that isn't open can only clear on that conversation's next
  `turnState`, not on the finer-grained `assistantDelta`/`toolUse`/`toolResult`/`userText` clears the
  open conversation's chrome gets — those four arms carry no `conversationId` at the emit
  (`events.ts:109-110`, `:459-466`, `:467-472`), so there's no id to key a write on. Bounded (every turn
  ends with a `turnState`), not latched, but coarser than the open conversation. Closing it needs the
  transport widening in #675, out of scope for #748.
- **Eviction wiring** ([#749](../codebase/749.md)): two early-return branches in
  `subscribeConversationActivity`, ahead of the translator switch — `conversationDeleted` →
  `dropConversation(event.id)` (no truthiness guard; `''` is a real id) and `connected` →
  `clearAllActivity()`. Deliberately **not** registered in `clearPairingScopedState`: on that file's own
  discriminator ("does a reconnect to the SAME daemon need to clear it?") the answer is yes, since a
  turn running when the socket dropped may have finished while it was down — so the `connected` edge is
  the enforcement instead, matching the `backgroundTaskRosterBridge.ts` precedent. Because the bridge is
  mounted App-level (outside `PairedShell`) and every pairing change re-handshakes, one listener covers
  both the unpair route flip and the pair-another-server transition that never unmounts the shell. The
  delete seam is a third, independent listener on the `conversationDeleted` arm — deliberately not
  folded into `PairedShell.tsx`'s existing `useConversationDeletedExit`, whose callback gates on the id
  matching the *open* conversation, where eviction must be ungated.

## Edge cases and limitations

- **Not migrated:** [thread timeline](thread-timeline.md)'s existing chrome scalars (`phase`, `stalled`,
  `apiRetry`, `compacting`, `localSendPending`) are untouched and keep serving the open conversation.
  This store runs alongside them, not in place of them; migrating is explicitly out of scope here and in
  the two follow-up tickets.
- **No fifth fact for `localSendPending`.** That scalar is renderer-sourced, opened only by the open
  conversation's own composer send with no daemon involvement — it has no natural per-conversation
  reading and isn't held here.
- **Bounded across a delete and a pairing change, not within one.** [#749](../codebase/749.md) closed
  the two eviction paths named above, so growth no longer survives a conversation delete or a pairing
  change. The residue *between* handshakes — a long-lived pairing that names many conversations without
  deleting any — is still uncapped by design; #676, the first reader, is the natural place to add a real
  ceiling if one is ever wanted.
- **Log-free by construction.** No `console.*` on any path — the only value a diagnostic could carry is
  the untrusted `conversationId`, and the content-free diagnostics rule (#126) keeps it out. A read miss
  is silent by design, not a swallowed error.

## Related decisions

- [Conversation timeline holder](conversation-timeline-holder.md) — the direct structural descendant
  (#755): the same `ReadonlyMap` + copy-on-write + selector-factory shape applied to a whole
  `TimelineState` per conversation instead of four booleans, adding a bound (`MAX_RETAINED_TIMELINES`)
  and least-recently-viewed eviction that this store's own header explicitly declines.
- [Background-task roster store](background-task-roster-store.md) — the direct precedent for the
  `ReadonlyMap` + copy-on-write + named-setters + `?? null` selector shape, reused rather than
  re-derived; also the earlier instance of shipping a store "populated and unread" ahead of its first
  writer/reader.
- [Thread timeline](thread-timeline.md) — the existing open-conversation chrome scalars this store sits
  beside without migrating.
- [Announced-model store](announced-model-store.md) — documents the same-name-different-shape trap this
  store's `apiRetrying` (vs. thread timeline's `apiRetry` counter record) deliberately avoids by naming.
- [#747 codebase notes](../codebase/747.md) — the holder's implementation summary and lessons learned.
- [#748 codebase notes](../codebase/748.md) — the writer's implementation summary, the
  `store/` → `screens/` import argument, and lessons learned.
- [#749 codebase notes](../codebase/749.md) — the eviction paths' implementation summary, the
  positional-effects-list hazard that motivated the `ConversationActivityDeps` object, and lessons
  learned.
