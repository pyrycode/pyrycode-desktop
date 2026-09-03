# #1013 — stamp each text message with the time it was created

## Files read

- `src/renderer/src/store/threadTimeline.ts` → `ThreadItem` (`assistantText`, `userText` members), `ThreadEvent`
  (`assistantDelta`, `userText` arms), `appendDelta`, `reduceTimeline` — the two item-creation sites and
  the pure reducer that owns them.
- `src/renderer/src/store/timelineBridge.ts` → `translateTimelineEvent` (the pure choke point that builds
  the `assistantDelta` ThreadEvent), `subscribeTimeline`, `useTimelineBridge` — the assistant-side producer
  chain and its only production composition root. Its `subscribeTimeline` docblock records #756's
  arity-widening precedent: widen without adding a *required* parameter and every existing call site keeps
  compiling. (That docblock's "19"/"20" counts are stale — the file now holds 22 `translateTimelineEvent(`
  and 25 `subscribeTimeline(` call sites. Not this ticket's job to correct; not propagated into new prose.)
- `src/renderer/src/screens/conversation/composerSend.ts` → `ComposerSendDeps`, `submitMessage` — the sole
  `userText` producer, already built on an injected-effects deps object.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → the `Composer`'s `sendText`, which builds
  the `ComposerSendDeps` literal inside the handler body (never at render — `window.pyry` does not exist
  under `renderToStaticMarkup`).
- `src/renderer/src/store/conversationTimelineStore.ts` → `createConversationTimelineStore`'s `dispatchFor`,
  and `src/renderer/src/store/timelineStore.ts` → `createTimelineStore`'s `dispatch` — both call
  `reduceTimeline(state, event)` with exactly two arguments. **This is the measurement that decides the
  design** (see Context).
- `src/renderer/src/App.tsx` → `useTimelineBridge(openConversationId)`, the hook's single caller.
- `docs/knowledge/features/thread-timeline.md` § the `toolCall.input` (#643) and `result.resultDetail`
  (#773) widens — the repo's two precedents for adding an optional field to an item/event pair: the bridge
  and the reducer carry it **unconditionally and verbatim**, never through a conditional spread, and the
  slice ships dormant with the render as a sibling ticket. This ticket is the third of that shape.
- `docs/knowledge/features/composer-send.md` § the deps object — records that #756 made `dispatchFor`
  *required* because the cascade was six sites and a required field buys a compile error for "forgot to
  wire it." That trade is re-evaluated below and comes out the other way.
- Ticket #1014 (the render slice) — confirms the contract from the consumer side: "Under #1013 those
  existing fixtures carry no time, so they keep rendering the empty slot and stay unedited." No field name
  is fixed there, so this ticket picks one.

## Design source

**Figma:** N/A. Nothing this ticket lands is visible in the window — #969's meta row keeps rendering its
empty `bubble__meta-time` slot until #1014 fills it. The ticket body states this and carries no `## Figma`
section for that reason. The visual-fidelity check is intentionally skipped.

## Context

`ThreadItem`'s `assistantText` and `userText` members carry text and nothing else, so the meta row #969
landed has no time to show. This slice gives both a creation time; #1014 formats and renders it.

**The time is stamped in the renderer**, not carried from the envelope `ts`. The ticket's Context argues
this and the argument holds against the code: the `assistantDelta` IPC arm names four fields fail-closed,
so carrying `ts` across means widening the arm and its decode, and the timeline is in-memory and cleared on
exit and pairing end (#757), so nothing replays old messages that a fresh clock would mis-stamp. Reversible:
if backfill on reconnect ever lands, the envelope `ts` becomes the right source and this becomes a one-field
change on the arm.

### The injection choice — the arithmetic

The ticket names two candidate seams and two mechanical ceilings, and says to do the arithmetic before
concluding either is blocked. Done, and there is a **third** constraint the ceilings do not name, which is
what actually decides it.

AC4 requires the 19 `toEqual` expectation sites asserting on **reducer-built** items to pass unedited. Ten
of those sites are in `conversationTimelineStore.test.ts` and three in `ConversationScreen.test.tsx` —
they assert on items produced by the stores' own `dispatchFor`/`dispatch`, which **are** production paths.
So:

- **A clock parameter on `reduceTimeline` is not viable**, optional or not. To satisfy AC1 ("every item the
  production paths create carries one"), the two stores would have to pass a real clock; the moment they do,
  every item those 13 expectations assert on carries a *defined* `createdAt` and all 13 redden. The 55-call-site
  ceiling is a red herring — the store-is-production constraint kills this seam before the cascade count matters.
- **Carrying the time on the `ThreadEvent` is viable.** The stores stay untouched two-argument callers; a test
  that dispatches `{ type: 'userText', text: 'hi' }` gets an item whose `createdAt` is `undefined`, which
  `toEqual` ignores. This is also the shape the file already documents twice (`input` #643, `resultDetail`
  #773): the reducer is a **carrier**, not the source of the fact.

So: **the field rides the `ThreadEvent`, and the clock is injected at the two producers.**

### The clock is optional at every seam, with no wall-clock default

The same AC4 arithmetic then applies one level up, and this is the part worth stating explicitly because the
composer-send overview points the other way:

- `ComposerSendDeps` gaining a **required** `now` would be the #756 `dispatchFor` precedent — except that
  requiring it forces every existing deps literal to supply a clock, and then `composerSend.test.ts`'s three
  `toHaveBeenCalledWith({ type: 'userText', text: … })` assertions see a defined `createdAt` and fail. (The
  overview's "only 6 call sites" is also stale: the file now has 13.) So `now` is **optional** here, against
  that precedent, for a reason the precedent did not face.
- `subscribeTimeline` and `translateTimelineEvent` take an **optional trailing** `now` for the ordinary
  #756 reason — a required parameter cascades over 25 and 22 call sites respectively; an optional one over none.

The uniform rule, stated once and applied everywhere: **an absent clock means no stamp.** No seam defaults to
`Date.now`. A defaulting seam would silently stamp every existing test that goes through it, which is exactly
the failure AC4 fences off.

The cost is that the two production wirings are not compile-enforced — a forgotten `now` is silent. That is
accepted rather than overlooked: AC1's own shape ("optional on the type — an item built without one is valid
and carries none") makes an unstamped item legal by contract, #1014's AC3 renders it as the empty slot, and
both wirings get their own regression spec (Testing strategy). It is also the only shape AC4 admits.

### An ADR is not warranted

This is the third instance of a pattern `thread-timeline.md` already documents (#643, #773). The one thing
worth folding into that overview is the *inversion* recorded above — the deps-object precedent says "require
it," and this ticket declines for a reason the precedent did not face — which belongs in the package overview
the documentation phase owns, not in a new decision record.

## Design

### `threadTimeline.ts`

- `ThreadItem`'s `assistantText` member gains `createdAt?: number`; its `userText` member gains the same.
  Epoch milliseconds. Named `createdAt` rather than `occurredAt` so it does not read as a second instance of
  the `sessionBoundary` item's wire-supplied ISO **string** `occurredAt` — different provenance, different
  type, different name.
- `ThreadEvent`'s `assistantDelta` and `userText` arms gain the same optional field. Field-for-field with the
  item, so the reducer stays a carrier.
- `appendDelta` takes the delta's `createdAt` as a fourth parameter (module-private, one call site, so a
  required parameter is free here). **The grow branch keeps `tail.createdAt`; only the fresh-append branch
  uses the incoming one.** This is AC2, and it is one line in the object literal the function already rebuilds.
- `reduceTimeline`'s `userText` arm assigns `createdAt: event.createdAt` on the appended item —
  unconditionally, never a conditional spread, following the `input`/`resultDetail` discipline this file
  states twice.
- No other arm and no other item kind is touched (AC5). `sessionBoundary`'s `occurredAt` is not read, written,
  or mentioned by the change.

### `timelineBridge.ts`

- `translateTimelineEvent(event, now?)` — `now?: () => number`. The `assistantDelta` arm assigns
  `createdAt: now?.()`; every other arm is byte-identical. `now?.()` yields `undefined` when no clock was
  injected, which is the "absent ⇒ no stamp" rule expressed without a branch.
- `subscribeTimeline(onDaemonEvent, dispatch, now?)` — threads the clock into its `translateTimelineEvent`
  call. Optional trailing parameter, so all 25 existing call sites compile and run unedited.
- `useTimelineBridge` passes `Date.now` as the third argument. `Date.now` is referenced (not called) at the
  composition root, matching how `window.pyry.onDaemonEvent` is passed there.

### `composerSend.ts`

- `ComposerSendDeps` gains `now?: () => number`.
- `submitMessage` builds the echo as
  `{ type: 'userText', text: trimmed, createdAt: deps.now?.() }`. One `ThreadEvent` object, still handed to
  **both** write paths, so the flat store and the keyed holder record the same instant by construction —
  preserving the "built ONCE and handed to both" property the existing comment defends.

### `ConversationScreen.tsx`

- The `sendText` deps literal gains `now: Date.now`. One line, inside the handler body where the literal
  already lives (hoisting it would move `window.pyry` into the render path).

### Contracts

| symbol | before | after |
|---|---|---|
| `ThreadItem` `assistantText` / `userText` | `{ …, text }` | `{ …, text, createdAt?: number }` |
| `ThreadEvent` `assistantDelta` / `userText` | `{ …, text }` | `{ …, text, createdAt?: number }` |
| `appendDelta` | `(items, turnId, text)` | `(items, turnId, text, createdAt)` |
| `translateTimelineEvent` | `(event)` | `(event, now?: () => number)` |
| `subscribeTimeline` | `(onDaemonEvent, dispatch)` | `(onDaemonEvent, dispatch, now?: () => number)` |
| `ComposerSendDeps` | 4 effects | + `now?: () => number` |
| `reduceTimeline` | `(state, event)` | **unchanged** |

## State + concurrency model

No new state slice, no new async work, no new subscription, no teardown surface. The timeline stores keep
their existing shape and their existing two-argument `reduceTimeline` calls; `subscribeTimeline` keeps
returning the same unsubscribe handle it does today, so `useTimelineBridge`'s effect cleanup is unchanged
and the StrictMode double-mount behaviour is untouched.

The clock is read synchronously inside the already-synchronous produce path — at `submitMessage`'s echo
construction and inside `subscribeTimeline`'s listener — so no ordering, cancellation or interleaving
question arises. `reduceTimeline` stays pure: the impurity is entirely upstream of it, in the injected
producer, which is what makes the reducer's specs able to assert exact values with no clock at all.

## Error handling

Nothing here can fail. `now?.()` is total: absent clock → `undefined` (a legal item per AC1), present clock
→ a number. There is no parse, no I/O, no boundary crossed, so no result type and no new failure mode. The
value is a number in the store and is not formatted, compared, or turned back into a date here — formatting
is #1014's.

No logging is added: this slice crosses no lifecycle boundary and classifies no error, and a per-message log
line would be a content-adjacent record of when the operator typed.

## Testing strategy

All vitest, node environment. Nothing here is interactive and nothing renders, so no Playwright spec.

**`threadTimeline.test.ts`** — the reducer contract, driven with explicit numeric literals, no clock:

- a `userText` event carrying `createdAt` produces an item carrying it;
- a `userText` event with no `createdAt` produces an item whose `createdAt` is `undefined` (asserted as
  `=== undefined`, never `'createdAt' in item` — the standing desktop lesson about presence probes);
- a first `assistantDelta` stamps the fresh bubble;
- **AC2: three deltas for one `turnId`, each carrying a *different* `createdAt`, coalesce into one item whose
  `createdAt` is the first delta's value** and whose text is the concatenation;
- a delta for a *new* `turnId` after a coalesced run starts a fresh bubble at its own time (proving the
  preservation is tail-scoped, not global);
- AC5 fence: a `sessionBoundary` event's item still carries its wire `occurredAt` and gains no `createdAt`.

**`timelineBridge.test.ts`** — the producer seam:

- `translateTimelineEvent(assistantDeltaEvent, () => 1_700_000_000_000)` returns an event carrying that exact
  value;
- called with **no** clock, the returned event's `createdAt` is `undefined` (the no-stamp rule, and the
  standing-fixture guarantee stated as an assertion);
- `subscribeTimeline(onDaemonEvent, dispatch, clock)` dispatches a stamped event — the regression guard for
  the threading, since `useTimelineBridge` itself runs no effect under `renderToStaticMarkup` and cannot be
  driven directly.

**`composerSend.test.ts`** — the echo seam:

- with `now` injected, `dispatch` and `dispatchFor` both receive an echo carrying that exact value, and it is
  the **same** value in both (the built-once property);
- with `now` omitted, the echo's `createdAt` is `undefined`.

**Fixtures, mocks, fakes.** Plain arrow-function clocks (`() => 1_700_000_000_000`), not `vi.useFakeTimers`:
the clock is an injected parameter, so there is no global timer to fake and no spec depends on the machine's
wall clock (AC3). No existing fixture is edited, no `toEqual` is loosened to `toMatchObject`, and no
assertion is converted to `toStrictEqual` (AC4) — `toStrictEqual` would fail on the `undefined`-valued
property for the opposite reason. Verified against this repo's own `@vitest/expect` (vitest 2.1.9) before
this plan was committed: `toEqual`, its array-nested form, and `toHaveBeenCalledWith` all ignore an
extra property whose value is `undefined` and all fail on a defined one.

## Open questions

1. **Field name `createdAt`.** #1014 does not fix a name, so this ticket picks one. Resolve by shipping it;
   if #1014 wants another, the rename is one symbol across two files.
2. **Is `Date.now` the right clock at `useTimelineBridge`, given the arrival-time semantics?** The ticket
   rules first-delta arrival is the moment, and `Date.now` at the listener *is* that moment. Recorded as
   settled, not open — noted here only because the ticket flags the which-end choice as reversible.
3. **Whether the two production wirings deserve a compile-time guard.** Ruled no above (AC4 forbids the
   required-parameter shapes that would provide one). If a wiring is ever found missing in practice, that is
   the observed failure that would justify escalating; there is none today.
