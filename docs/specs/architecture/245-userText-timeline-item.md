# Spec #245 — a `userText` item in the conversation-timeline model

**Size:** XS · **Split from #179** (the userText model prerequisite of the interactive flip).

Model-only slice: add a `userText` content kind to the timeline model and its reducer arm,
unit-tested in isolation. It ships **dormant** — no producer wires it (the producer, the real
render row, and the `MessageThread` retirement are all #179).

## Files to read first

- `src/renderer/src/store/threadTimeline.ts` (whole, 162 lines) — **the one file with real logic
  changes.** Extract: the `ThreadItem` union (24-35) and `ThreadEvent` union (42-49) you extend;
  the `toolUse` (117-131) and `turnEnd` (143-151) reducer arms — the **fresh tail-append** pattern
  you mirror; `appendDelta` (69-80) — the coalescing pattern you must **not** use; the
  `default: assertNever(event)` at 152-153 you must keep.
- `src/renderer/src/store/threadTimeline.test.ts` (whole, 192 lines) — the test idiom. Extract: the
  fixture-builder pattern (14-33), the `run(events)` fold helper (36-38), and the **turn-boundary
  append test** (141-150) — the closest analog to the userText append test you'll write.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:145-208` — the `TimelineRow` switch
  and its **deliberate no-`default` tripwire comment** (145-148). Extract: *why* the switch has no
  default, and the `turnBoundary` `return null` arm (203-206) — the exact shape of the placeholder
  arm you add. **This is the load-bearing surprise in this ticket — see "Deviation from AC5" below.**
- `src/renderer/src/store/timelineBridge.ts:35-89` — confirm it switches on the **`DaemonEvent`
  input**, not the `ThreadEvent` output, so your new `ThreadEvent` arm does **not** force a bridge
  change. `userText` is renderer-sourced (composer echo), so it correctly never flows through here.
- `docs/knowledge/decisions/0008-thread-timeline-model.md` — the Strangler-Fig rationale; confirms
  the model ships dormant alongside `sessionStore`.
- `CLAUDE.md` — Conventions: test-first, sealed discriminated-union event shapes, fresh-literal.

## Context

`threadTimeline.ts` holds the conversation timeline: a pure reducer `reduceTimeline` folding a
sealed `ThreadEvent` union into an ordered `ThreadItem[]` plus a coarse `phase` scalar. Today
`ThreadItem` models only daemon-sourced content (`assistantText`, `toolCall`, `turnBoundary`); the
user's own message lives in the separate coarse `sessionStore` / `MessageThread`.

#179 cuts the conversation thread over to this timeline as its single render surface and turns on
the daemon's structured interactive stream. For the user's message to appear in that unified thread,
the model needs a `userText` item first. This ticket adds it, unit-tested, dormant.

## Design

### 1. The item kind (AC1)

Add to the `ThreadItem` union in `threadTimeline.ts`:

```ts
| { kind: 'userText'; text: string }
```

**Minimal fields: `text` only.** No `turnId` — a user message is not a daemon turn; the daemon
assigns turn ids, and the composer echo has none at send time (this is the "confirm the minimal
shape rather than copy `assistantText`'s `turnId` blindly" call from the ticket's Technical Notes).
No `seq` either — `seq` is wire-fidelity for daemon deltas; a renderer-sourced user message has none.

### 2. The event arm + reducer (AC2)

Add the matching arm to the `ThreadEvent` union:

```ts
| { type: 'userText'; text: string }
```

Same name for event `type` and item `kind` — the ticket calls it "the matching arm," and the reducer
does a plain rename-free copy. Add the reducer case, mirroring `turnEnd`/`toolUse` (fresh tail-append,
`phase` untouched) — **not** `assistantDelta` (no `appendDelta`, no coalescing; a user message is one
whole message, never a stream of deltas):

```ts
case 'userText':
  return { items: [...state.items, { kind: 'userText', text: event.text }], phase: state.phase }
```

Always returns a new `items` array (a fresh append is always a change) and leaves `phase` by
reference — the same discipline as the `turnEnd` arm.

### 3. Exhaustiveness (AC4)

Keep the existing `default: return assertNever(event)`. Handle `userText` in its **own explicit
case** above the default — never via a catch-all. Typecheck enforces this: if the `userText` case
were removed, `event` at the `default` would no longer narrow to `never` and `assertNever` would be
a type error. No new runtime test is needed for AC4; it is a compile-time guarantee. Do **not** add a
`default: return null`-style catch-all anywhere.

## Deviation from AC5 — the render tripwire (READ THIS)

AC5 says "`ConversationScreen` … untouched." **This is not achievable as literally written, and the
spec deliberately deviates by exactly one line.** Here is why, and what to do.

`TimelineRow` in `ConversationScreen.tsx:149-208` is a `switch (item.kind)` with **no `default` and
no `assertNever`**, returning `JSX.Element | null`. Its comment (145-148) documents this as an
**intentional tripwire**: a fourth `ThreadItem` kind makes the switch non-exhaustive, so under
`strict` the function can fall through to `undefined`, which its `JSX.Element | null` return type
excludes → **TS2366** ("Function lacks ending return statement…"). The tripwire was built (by
#203/#218) to fire at exactly this moment and "force a render decision."

Consequence: **the instant `userText` joins `ThreadItem`, `npm run typecheck` and `npm run build`
fail in `ConversationScreen.tsx`.** The build is the QA/salvage gate, so "existing tests stay green"
and "ConversationScreen untouched" cannot both hold. The minimal, designed resolution:

Add one placeholder arm to `TimelineRow`, mirroring `turnBoundary`:

```ts
case 'userText':
  return null // Dormant placeholder — #179 replaces this with the user bubble when the producer lands.
```

- This is a **zero-footprint** change: it renders nothing, and no producer emits a `userText` item
  yet, so at runtime the arm is never hit and there is **no visual or behavioral change**. Every
  existing `ConversationScreen` test stays green. AC5's *intent* (no render, no producer, no visual
  change) holds; only its literal "untouched" wording relaxes to "gains one null placeholder arm."
- **`return null` is safe only because the item is unproduced.** It is a temporary stand-in, not a
  real render — a `userText` item, if it appeared, is *content* and must be drawn (unlike the
  structural `turnBoundary`). #179 owns replacing this `null` with the real user bubble in the same
  PR that adds the producer. Latent-hazard note for #179 (below) covers this.
- Everything else in AC5 holds unchanged: **no producer**, and `composerSend` and `sessionStore` are
  untouched (verified: neither imports the timeline model). `timelineBridge` and `timelineStore` are
  also untouched — the bridge's exhaustiveness guard is on the `DaemonEvent` input, and the store is
  a thin `reduceTimeline` pass-through.

The developer's PR description must cite this section so code-review sees the one-line
`ConversationScreen` touch is the tripwire's intended, documented outcome — not scope creep.

## State + concurrency model

None new. Pure synchronous reducer over renderer-local state; no IPC, transport, keys, sockets, async,
or React. `timelineStore.dispatch` (`set((s) => reduceTimeline(s, event))`) carries the new arm for
free; no store change.

## Error handling

None. A `userText` event is total — it always appends. No orphan/duplicate/no-op path (unlike
`toolResult`'s `fillResult`). No failure modes at this layer.

## Testing strategy

`npm test` (vitest), added to `threadTimeline.test.ts`. Follow the file's existing idiom: add a
`userText(text)` fixture builder next to `delta`/`toolUse`/`turnEnd`, and use the `run(events)` fold.
Scenarios (write as the project's test idiom, not copied bodies):

- **Append + text (AC3):** fold a single `userText('hello')` over `initialTimelineState` → `items`
  has length 1, `items[0]` deep-equals `{ kind: 'userText', text: 'hello' }`, `phase` is still
  `'idle'`.
- **Existing items untouched (AC3):** `run([delta('A', 'hi'), userText('you typed this')])` →
  `items.map(i => i.kind)` is `['assistantText', 'userText']`; the prior `assistantText` item is
  preserved (same reference inside the new array) and carries its original text; the `userText` is at
  the tail.
- **Phase untouched (AC3):** set `phase` to `'thinking'` via `turnState`, then a `userText` →
  `phase` stays `'thinking'` and the item appends.
- **Purity:** appending a `userText` returns a **new** `items` array (not the same reference) while
  leaving the input state's `items` array and its elements unmutated — mirror the existing
  turn-boundary / toolCall purity assertions.
- **Order across a mix (optional, cheap):** extend the existing "preserves arrival order" style with
  a `userText` interleaved to prove it lands in arrival order like the other fresh-append arms.

No `ConversationScreen.test.tsx` change: the placeholder returns `null` and no `userText` item is
produced, so there is nothing to assert and no existing test regresses. Typecheck (`npm run
typecheck` / `npm run build`) is the coverage that the placeholder arm satisfies the tripwire.

## Hand-off to #179 (not this ticket's work)

- **Producer:** dispatch `{ type: 'userText', text }` into the timeline store when the user sends
  (the composer echo). Out of scope here.
- **Render:** **replace** `TimelineRow`'s `case 'userText': return null` with the real user bubble
  (Figma-anchored) — do not add a second arm. The `null` placeholder from this ticket is the seam.
  Because the placeholder already satisfies exhaustiveness, the tripwire will **not** re-fire when the
  producer lands, so #179 must not rely on a compile error to remember the render — its own AC must
  require the user bubble.
- **`MessageThread` retirement:** out of scope here.

## Scope check

Production source files (`*.ts`/`*.tsx`, excluding tests/`*.md`) touched: **2** —
`threadTimeline.ts` and `ConversationScreen.tsx` (one line). Plus the test file
`threadTimeline.test.ts`. Under the ≥5-file gate. No red lines tripped. XS confirmed.

## Open questions

- **AC5 wording.** This spec knowingly contradicts AC5's literal "`ConversationScreen` untouched"
  with a single, zero-footprint null placeholder arm, because the deliberate #203/#218 tripwire makes
  the model addition un-shippable otherwise. Resolved in-spec (not routed to PO) because the deviation
  is minimal, deterministic, and exactly the tripwire's designed outcome. If PO/review prefers AC5 be
  formally re-worded, that is a doc edit at merge — it does not change the code.
