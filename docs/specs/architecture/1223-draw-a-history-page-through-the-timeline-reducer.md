# #1223 — draw a page of history through the timeline reducer, the operator's own messages included

## Files read

- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent` — the live-lane mapping this
  ticket reuses over a page's entries rather than writing a second one; its `messageReceived` /
  `messagesReceived` fall-through group is the one gap. Also `timelineTargetFor` and
  `timelineWriteTarget` (the routing contract this ticket must not disturb) and `subscribeTimeline`,
  whose docblock records why a required new parameter cascades over 20 call sites and an optional one
  over none.
- `src/renderer/src/store/threadTimeline.ts` → `reduceTimeline` — append-only in every arm, which is
  what makes an in-place page merge impossible and unnecessary; `initialTimelineState`, the scratch
  seed; the `userText` arm, whose `localSendPending: true` its own comment says must be re-examined
  against a history backfill; `removeUserEcho`, whose `messageId` key AC4 reuses; `TimelineState`'s
  five chrome scalars, which AC3 is about.
- `src/renderer/src/store/conversationTimelineStore.ts` → `dispatchFor` (the per-conversation fold),
  `withNewSliceAtHead` (the absent-key creator this ticket reuses), `clearTimelineFor` /
  `clearAllTimelines` (the write-path shape and same-reference discipline), `selectTimelineFor` (the
  only read surface).
- `src/shared/ipc/events.ts` → `HistoryTimelineEvent` and `HistoryTimelineEntry` (#1227's decoded
  shapes — the input to this ticket), the `historyPageReceived` arm (`conversationId` required and
  client-owned; `entries` named the most untrusted payload on the union), `DaemonEvent`'s
  `messageReceived` arm (`message: MessagePayload`, the live twin of the history arm's `Omit`ped one).
- `src/shared/wire/types.ts` → `MessagePayload` (`message_id` / `role` / `text`), `WireRole`
  (`'user' | 'assistant'` — the arm must not draw an assistant `message` as a user row).
- `src/main/transport/inboundMessage.ts` → `DecodedHistoryEvent` / `decodeHistoryEntry` — the decode
  whose skip set means no `modal_shown` or `question_shown` can reach the window from a page, which
  this ticket inherits rather than re-implements.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `selectTimelineFor` read that
  draws `items`, and its `useTimelineStore` import, which is a `dispatch` handle only — so the flat
  `timelineStore`'s `items` have no production reader and a new arm reaching it draws nothing.
- `src/renderer/src/App.tsx` → the bridge composition root, where a new independent subscriber is wired.
- `docs/knowledge/features/thread-timeline.md` — the reducer's page: the `ThreadItem` / `ThreadEvent`
  catalogue and ADR 0008's normative reducer contract (purity, same-reference-on-no-change).
- `pyrycode/docs/protocol-mobile.md` § Conversation history (v2) → `entries` is **newest-first**
  (`history_page` row, and the field table), which is the fact AC1's reversal rests on.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

`Message area` is a single vertical column of message containers: assistant rows left-aligned on a dark
translucent surface, the operator's own rows right-aligned in a filled blue bubble, each closing with a
small timestamp and a copy affordance, with a centred `Session reset` divider between sessions and
tool-use rows below. Read on 2026-09-07, nothing in the node tree marks a row as replayed — there is no
"loaded from history" treatment — so **this ticket adds no new visual and no new component**: a history
row is the existing `userText` / `assistantText` / `toolCall` / `sessionBoundary` row, drawn by the
existing render slice, which is what keeps the live lane's escaping in force by construction. The one
visible consequence of AC5 is that a replayed row carries no `createdAt`, so its bubble draws without the
timestamp line — the same absence every pre-#1013 row already renders.

## Context

#1222 built the ask, the correlation and the page transport; #1227 turned each stored `{type, payload}`
entry into a typed `HistoryTimelineEvent`. Nothing draws the result. This is the drawing half: a page
event in, rows on the conversation's held timeline out.

Two facts shape it. `reduceTimeline` **only ever appends**, so a page cannot be merged into a held
timeline in place — and does not want to be, since a page's rows belong ahead of the held ones. And the
desktop has no arm for the operator's own turn: the daemon stores it as a `message` frame with role
`user` (pyrycode#2115) and pushes no such frame on the interactive lane, so `messageReceived` sits in
`translateTimelineEvent`'s fall-through group and a page of the operator's own questions would render
nothing.

No ADR is warranted: this adds no new architectural seam, it composes two existing pure functions.

## Design

Four production files, no change to `reduceTimeline` at all.

### 1. `timelineBridge.ts` — widen the translator, claim `messageReceived`

`translateTimelineEvent`'s parameter widens from `DaemonEvent` to `DaemonEvent | HistoryTimelineEvent`.
This is a **widening, not a signature change**: every existing call site still compiles, and every arm
already reads only the render fields (the "filter + fresh literal" discipline the function's docblock
states), so no case body changes. Each `HistoryTimelineEvent` arm's `type` tag already has a case, so
the `assertNever` guard stays total; the narrowed union in each case gains a second member that is the
first minus `conversationId`, which no arm reads.

`messageReceived` moves out of the fall-through group into an owned arm:

```ts
case 'messageReceived':
  // → { type: 'userText', text, messageId } for role 'user'; null otherwise.
```

Three deliberate omissions, each with a reason recorded at the arm:

- **Role gates the arm.** `role: 'assistant'` returns `null`. An assistant `message` is not a user row,
  and assistant content reaches the timeline through `assistantDelta` entries anyway.
- **No `createdAt`.** The clock is read on `assistantDelta` and nowhere else, and a page is translated
  with no clock at all (below) — AC5 by construction at two independent points.
- **No `attachments`.** The wire `MessagePayload` has no attachment field; there is nothing to carry.

`timelineTargetFor` and `timelineWriteTarget` are **not** touched, so a live `messageReceived` — which
this daemon does not send — now translates but resolves to no keyed target and reaches the flat
`timelineStore` only. That store's `items` have no production reader (`ConversationScreen` draws from
`selectTimelineFor`; its `useTimelineStore` use is a `dispatch` handle), so the live lane draws exactly
what it drew before. Routing a live `message` frame by its daemon-asserted `message.conversation_id` is
a separate decision with its own detector and is explicitly not made here.

### 2. `historyPageBridge.ts` (new) — the page-to-rows mapping and its subscriber

One module holding a pure function and its React-free subscriber, following `timelineBridge.ts`'s own
shape rather than splitting them.

```ts
export function reduceHistoryPage(entries: readonly HistoryTimelineEntry[]): readonly ThreadItem[]
```

Reverses the page into arrival order (the wire serves it newest-first), translates each entry's `event`
through `translateTimelineEvent` **with no clock**, folds the non-null results through `reduceTimeline`
starting from `initialTimelineState`, and returns **`items` only**.

This is the answer to the question `threadTimeline.ts`'s `userText` arm asks, and it is a third answer
the Technical Notes did not enumerate: **neither a distinct event nor a flag on the arm — the page never
reaches the held state's reducer at all.** The fold runs against a scratch state that is discarded, so
`localSendPending`, `phase`, `stalled`, `apiRetry` and `compacting` are structurally unable to escape it,
whatever a stored `turn_state`, `stall`, `api_retry` or `compacting` entry among the page's rows says.
AC3 covers five fields and this covers all five with no per-field code; a flag would have needed one
clause per field and left the next chrome scalar to be remembered. `reduceTimeline` is untouched, which
is the strongest available statement that a page produces the rows the live stream would have.

```ts
export function subscribeHistoryPage(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  applyPage: (conversationId: string, items: readonly ThreadItem[]) => void
): () => void
export function useHistoryPageBridge(): void
```

A **fifth independent subscriber** on the daemon-event channel (beside the session, timeline, modal and
question bridges), not a widening of `subscribeTimeline`'s injected dispatch — that would cascade over
its 20 existing call sites to buy nothing, the arithmetic its own docblock records. It owns exactly the
`historyPageReceived` arm and ignores every other, so `translateTimelineEvent`'s `historyPageReceived`
case stays `null` and needs no edit. `historyRequestFailed` is **not** claimed: a refusal drives the walk,
which is #1224's, and AC1 asks for no error banner.

The hook wires `applyPage` to the store's new write path and returns the off handle as its effect
cleanup, so a StrictMode double-mount nets one live listener. `App.tsx` gains one call beside
`useQuestionBridge()`.

### 3. `conversationTimelineStore.ts` — `prependHistoryFor`

```ts
prependHistoryFor: (conversationId: string, items: readonly ThreadItem[]) => void
```

A fifth store-owned write path beside `dispatchFor` / `markViewed` / `clearAllTimelines` /
`clearTimelineFor`, taking already-reduced rows rather than events — the store folds events, and a page
is not one event. Branches:

- **`items` empty** → the state object itself, so zustand's `Object.is` short-circuit fires and no
  subscriber wakes. An empty page adds no rows (AC1).
- **key absent** → create through the existing `withNewSliceAtHead` with
  `{ ...initialTimelineState, items }`. Consistent with `dispatchFor`'s unconditional-create branch: a
  page for a conversation the client has never opened creates that slice rather than dropping it.
- **key present** → `{ ...held, items: [...fresh, ...held.items] }`, where `fresh` is `items` minus the
  duplicates below. Every chrome scalar is carried by the spread, never recomputed (AC3). If `fresh` is
  empty, return the state object — same-reference, no churn.

The prepend is what "ahead of the rows already held" means, and it is why the reducer's append-only
shape needs no change: the two orderings never meet inside it.

**AC4 — the echo dedup.** A module-private helper drops from the page's rows any `userText` whose
`messageId` matches a `userText` already held. Direction is deliberate: **the held echo wins and the
page row is dropped.** The echo sits at its live position with the operator's own `createdAt` stamp and
its `attachments`; the replayed row has neither and would move the message earlier in the transcript.
Matched on a **non-empty string** `messageId` only, so two id-less rows never match each other and
nothing dedups on text (AC4's second half is then true by construction).

**The match is a strict-equality scan over the held rows, never a `Set` or a `Map` of ids**, and that is
a constraint rather than a preference. A page's `messageId` is the id the *sending* client minted,
stored by the daemon and replayed — untrusted, unlike the held echo's, which this window minted. The
field's inherited contract (`threadTimeline.ts`, on the `userText` item's `messageId`) binds it to
"strict string equality only — never a lookup path, a cache key, a filename, a URL, a Map key or a React
key", and a `Set` of them is a keyed collection whatever its prototype safety. `removeUserEcho` already
matches this way; this helper is its shape one array over. The scan is O(page × held), both bounded and
small, and the reducer already scans linearly per tool result (`fillResult`).

One consequence of prepending worth stating, since it looks like a bug and is not: the render slice keys
timeline rows **by index**, so rows landing at the head shift every held row's key and React re-renders
the list. The rows are pure functions of their props, so the output is correct; only the reconciliation
work changes. Re-keying the list is a separate change with its own detector and is not made here.

## State + concurrency model

One synchronous zustand `set` per page, under the store's own lock with no `await` inside it, so there is
no check-then-act gap for a concurrent handler to interleave into — the property every existing write
path here has. The only long-lived resource is the channel subscription, owned by `useHistoryPageBridge`'s
effect and torn down by the off handle it returns as cleanup. No timers, no promises, no `AbortController`:
`reduceHistoryPage` is synchronous and pure.

Purity is load-bearing where it already was: `withNewSliceAtHead` seeds from the shared
`initialTimelineState` reference, which is safe only because `reduceTimeline` never mutates `items` in
place. `reduceHistoryPage` inherits that and adds none of its own — it copies before reversing rather than
reversing the caller's array.

## Error handling

There is no failure mode to surface. `reduceHistoryPage` is total over its input: `translateTimelineEvent`
returns `null` for anything it does not own and the fold skips it; a page whose every entry translated to
nothing yields `[]` and takes the empty branch. Malformed content cannot arrive — #1227 decoded it
main-side and fail-closed, and this ticket parses nothing. A page naming a conversation the store does not
hold **creates** that slice rather than guessing; `conversationId` is required and client-owned, so there is
no absent-key case and no `?? openConversation` anywhere. `historyRequestFailed` is #1224's.

## Testing strategy

Vitest only — no DOM is needed, and the ticket's own note says to keep the mapping a pure function of the
page so it stays unit-testable. No Playwright spec: nothing asks for a page yet (#1224), so there is no
interaction to drive.

- `historyPageBridge.test.ts` (new) — `reduceHistoryPage`: a newest-first page reduces oldest-first (two
  assistant deltas of one turn arriving as one grown bubble in the right order); a page whose entries
  split a turn produces the same items the same events produce through `reduceTimeline` on the live path;
  a stored `message` with role `user` becomes a `userText` row and one with role `assistant` becomes no
  row; a page carrying `turn_state` / `stall` / `api_retry` / `compacting` entries yields rows and nothing
  else; an empty page and an all-skipped page yield `[]`; **no row carries a `createdAt`**, and the same
  page reduced twice is deep-equal (AC5). Plus `subscribeHistoryPage`: it calls `applyPage` with the
  event's own `conversationId`, ignores every non-`historyPageReceived` arm, and returns the off handle.
- `timelineBridge.test.ts` — the `messageReceived` arm for both roles, over both the `DaemonEvent` and the
  `HistoryTimelineEvent` shape; `messagesReceived` still maps to `null`; a spot-check that a
  `HistoryTimelineEvent` translates identically to its live twin.
- `conversationTimelineStore.test.ts` — `prependHistoryFor`: rows land ahead of held rows with chrome
  untouched; an empty page is a same-reference no-op; an absent key creates the slice; a page row and a
  held echo sharing a `messageId` collapse to one row while two rows with different ids and identical
  text stay two; a page row whose `messageId` is absent never collapses.

Fakes over mocks: the subscriber takes an injected `onDaemonEvent` and an injected `applyPage`, so it is
driven with plain functions and no `vi.mock`.

## Open questions

1. **Should a live `messageReceived` be routed to the keyed store?** Resolved as **no** — see § 1. If a
   daemon ever pushes a `message` frame on the interactive lane, that is a routing decision with its own
   detector and belongs to the ticket that observes it, not here.
2. **Does `prependHistoryFor` belong on this store or on a page-holder of its own?** Resolved as **this
   store**: #1225 joins a page to the live stream, which only has meaning if both live in one slice.

## Security review

**Verdict:** PASS (second pass — the first found a MUST FIX, now fixed in § 3 above)

**Findings:**

- **[Trust boundaries] MUST FIX — FIXED IN THE PLAN.** The first draft's AC4 dedup built a
  `Set<string>` of `messageId`s. A page's `messageId` is the id the *sending* client minted, stored and
  replayed by the daemon — untrusted, and structurally unlike the held echo's, which this window minted.
  The field's inherited contract on the `userText` item in `threadTimeline.ts` binds it to "strict string
  equality only — never a lookup path, a cache key, a filename, a URL, a Map key or a React key", so the
  plan's own Design section specified a sink the contract denies. `Set` would in fact have been safe
  (`Set.prototype.has` walks no prototype chain), which is exactly why this reads as fine on a skim.
  Fixed: § 3 now specifies a strict-equality scan, `removeUserEcho`'s own shape. The other denied sinks
  were checked in the code rather than assumed — timeline rows are keyed by **index** in
  `ConversationScreen`, not by `messageId`, and no filename, URL or cache key exists on this path.
  Otherwise the boundary is explicit and single: #1227's main-side decode, which makes the SHAPE trusted
  and never the content, and everything downstream of it here is a closed union of scalars.
- **[Trust boundaries] No further findings.** Every replayed string reaches the DOM only through the
  existing bubble/tool/boundary rows via the reused `translateTimelineEvent` → `reduceTimeline` path —
  escaped React children, no `innerHTML` / `dangerouslySetInnerHTML`, no attribute, no URL. Reusing the
  live lane's own mapping is what makes that true by construction rather than by review;
  `sessionTransition.workspaceCwd` arrives by this route as a daemon-supplied path and is rendered as
  text, never resolved, joined or opened.
- **[Tokens] Not applicable.** No token, key or raw frame can ride `historyPageReceived` — every field is
  a scalar or a string→string map built from a decoded payload — and this ticket adds no storage, no
  credential and no `safeStorage` interaction.
- **[File / storage] Not applicable.** No filesystem path, no read, no write, no temp file. Nothing here
  touches disk.
- **[Electron / IPC surface] No findings.** No new IPC channel, no new `contextBridge` API, no
  `ipcMain.handle`, no `BrowserWindow` or `webPreferences` change. `useHistoryPageBridge` subscribes to
  the existing `DAEMON_EVENT_CHANNEL` through the existing preload bridge and exposes no new capability
  to the renderer. Process placement is unchanged: no crypto, socket, key or raw byte enters the window,
  and this ticket adds nothing to the main side at all.
- **[Cryptographic primitives] Not applicable, with one decision recorded.** No RNG, no hashing, no key
  handling. The `messageId` comparison is `===` by design and `crypto.timingSafeEqual` would be wrong
  here: it is a local dedup decision between two values the client already holds, not a secret compared
  against an attacker's guess — the `modalId` precedent in `events.ts`.
- **[Network & I/O] Not applicable.** No socket, no URL, no timeout, no reconnect. The relay leg,
  its `maxPayload` cap and the envelope size cap are #1222's and are inherited unchanged; a page is
  already bounded main-side before it crosses.
- **[Logs] No findings, and the omission is deliberate.** This ticket emits no log call. A page's entries
  are replayed operator- and claude-authored content and may never reach a log sink; the remaining
  candidates are an entry count and a conversation id, which together are a size signal about the
  operator's own conversation for no diagnostic gain. There is also no classified error to report — see
  § Error handling, where the mapping is total over its input. The renderer stores in this repo log
  nothing, and this follows them.
- **[Concurrency] No findings.** One synchronous zustand `set` per page under the store's own lock with
  no `await` inside it, so there is no check-then-act gap. The single long-lived resource is the channel
  subscription, owned by the effect and torn down by the off handle returned as its cleanup — a
  StrictMode double-mount nets one listener.
- **[Concurrency] OUT OF SCOPE — `prependHistoryFor` is not idempotent.** Applying the same page twice
  prepends its rows twice; only `userText` rows would be suppressed, by the AC4 dedup, while assistant
  and tool rows would double. Not reachable today — nothing asks for a page, and #1222's correlation
  settles each outstanding request once — but it is a real property of this write path and the walk must
  not re-apply a page. Named for **#1224** (the walk) and **#1225** (which owns the entry-level join key
  a general answer would need). Deliberately not defended here: an id-level guard would be #1225's join
  built early and wrong.
- **[Threat model — hostile daemon] OUT OF SCOPE, inherited.** A daemon inside the Noise session
  controls a page's entries entirely, so it can plant a stored `message` with role `user` and arbitrary
  text that draws as a bubble the operator appears to have written. This is worth naming rather than
  glossing, because AC2 is precisely what makes the row drawable. It is not newly introduced and is not
  closable here: the wire carries no authenticator for a stored message, so no client-side check can
  separate a genuine stored operator turn from a planted one, and a hostile daemon can already put
  arbitrary text on screen through `assistantDelta` on the live lane. Upstream § Security model threat 1
  covers it; an attestation would be a daemon + mobile wire change.
- **[Threat model — hostile daemon] No finding on prompts, by inheritance.** No `modal_shown` or
  `question_shown` can reach the window from a page — #1227's decode has no arm for either, so nothing
  answerable exists to re-raise, for a future daemon that starts logging one and a hostile one alike.
  This ticket adds no arm for them and must not.
- **[Threat model — unbounded growth] OUT OF SCOPE.** `MAX_RETAINED_TIMELINES` bounds the number of
  retained slices, not one slice's `items` length, and a walk can grow a single timeline far faster than
  live traffic can. Pre-existing (the live lane is unbounded too) and not made worse per page, but the
  walk is what would exercise it. Named for **#1224**, which owns the stop condition.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-07
