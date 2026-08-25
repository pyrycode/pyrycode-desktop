# Conversation activity store

The renderer's held copy of what **every** conversation is currently doing — turn-running, stalled,
api-retrying, compacting — keyed by `conversationId` rather than scoped to whichever conversation is
open, so a future sidebar can draw a dot on a row the user has never opened.

Introduced in [#747](../codebase/747.md), split from #674 alongside #748 (the bridge that writes it)
and #749 (the clears). This slice ships the holder only: no writer and no reader yet. The store is
populated by nobody and read by nobody — the same "populated and unread" posture the
[background-task roster store](background-task-roster-store.md) shipped for #573 before its first
reader (#568) landed. #748 is the first writer; the still-unbuilt sidebar is the first reader.

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
- No entry point yet — no writer subscribes to daemon events, and no screen or component imports this
  store. #748 wires the four daemon arms (`turnState`, `stallDetected`, `apiRetry`, `compacting` —
  `src/shared/ipc/events.ts:125,145,172,199`, each carrying a required `conversationId`) into the
  setters, deriving `turnRunning` via `isTurnRunning`. #749 adds the two clears (per-conversation on
  delete, all-conversations on pairing end) — there is no reset setter yet, and nothing here is
  registered in `clearPairingScopedState`.

## Edge cases and limitations

- **Not migrated:** [thread timeline](thread-timeline.md)'s existing chrome scalars (`phase`, `stalled`,
  `apiRetry`, `compacting`, `localSendPending`) are untouched and keep serving the open conversation.
  This store runs alongside them, not in place of them; migrating is explicitly out of scope here and in
  the two follow-up tickets.
- **No fifth fact for `localSendPending`.** That scalar is renderer-sourced, opened only by the open
  conversation's own composer send with no daemon involvement — it has no natural per-conversation
  reading and isn't held here.
- **Unbounded until #749 lands.** Growth is bounded by the number of distinct conversation ids the
  daemon has named since app start; in this slice it is exactly zero, since there is no writer yet. The
  eviction paths (delete-scoped and pairing-scoped clears) are #749's job, not this store's.
- **Log-free by construction.** No `console.*` on any path — the only value a diagnostic could carry is
  the untrusted `conversationId`, and the content-free diagnostics rule (#126) keeps it out. A read miss
  is silent by design, not a swallowed error.

## Related decisions

- [Background-task roster store](background-task-roster-store.md) — the direct precedent for the
  `ReadonlyMap` + copy-on-write + named-setters + `?? null` selector shape, reused rather than
  re-derived; also the earlier instance of shipping a store "populated and unread" ahead of its first
  writer/reader.
- [Thread timeline](thread-timeline.md) — the existing open-conversation chrome scalars this store sits
  beside without migrating.
- [Announced-model store](announced-model-store.md) — documents the same-name-different-shape trap this
  store's `apiRetrying` (vs. thread timeline's `apiRetry` counter record) deliberately avoids by naming.
- [#747 codebase notes](../codebase/747.md) — this ticket's implementation summary and lessons learned.
