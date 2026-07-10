# Spec #218 — render pending tool-call rows on the conversation thread

**Ticket:** [#218](https://github.com/pyrycode/pyrycode-desktop/issues/218) · size **S**, no split · not security-sensitive
**Split from:** #205 (render half; the `tool_use` transport half is #217, merged in PR #220)
**Blocks / pairs with:** #206 (the resolved success/error treatment, fills `result`) · dormant-until-#179 (the `interactive` flip)

## Context

The `tool_use` transport slice (#217) has landed: a `toolCall` `ThreadItem` (`result: null`) now
appears in the timeline in arrival order for each tool the daemon invokes. Today those items render
as a safe no-op — `TimelineRow`'s `case 'toolCall'` returns `null` — so the thread shows claude's text
but not the tools it ran between the text.

This slice renders the **pending** tool row: the tool name and its one-line input summary, in arrival
order, interleaved with the assistant-text bubbles, through the existing container-reads / pure-view
split (the #203 `Timeline` / `ConversationScreen` precedent). It is a **single-arm swap** inside
`TimelineRow` plus its CSS — no store, no bridge, no transport, no key-strategy change, no `interactive`
flip.

This is the pending (unresolved) state **only**. `result` stays `null` until the correlated
`tool_result` arrives and resolves the row in place — that is #206. `name` and `inputSummary` are
untrusted daemon-supplied strings; this slice renders them as inert React children (auto-escaped,
exactly like the assistant-text bubble #203) and never interprets them as markup or a path.

## Files to read first

- `src/renderer/src/screens/conversation/ConversationScreen.tsx:144-179` — **the file you edit.**
  `TimelineRow` is the discriminated-on-`kind` switch. Line 171-173 is the `case 'toolCall': return null`
  arm you replace. Lines 118-138 (`Timeline`) show the array-index key you must **not** touch.
- `src/renderer/src/store/threadTimeline.ts:24-34` — the `ThreadItem` union. The `toolCall` member's
  fields: `turnId`, `toolUseId`, `name`, `inputSummary`, `result: ToolResult | null`. You read only
  `name` and `inputSummary`; `toolUseId` stays on the item untouched (it is #206's correlation key).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:83-135` — the escaping test
  (83-89, the pattern to mirror for the two untrusted fields) and the **superseded** test
  (118-135, `"renders a toolCall as a safe no-op"`) you rewrite. Note `threadBubbleCount` (line 64-66)
  matches only `data-thread-role="assistant"`.
- `src/renderer/src/screens/conversation/conversation.css:144-207` — the `.message-row` / `.bubble--daemon`
  / `.bubble--thinking` treatments the tool row sits beside; add the new `.tool-row*` rules following
  this token-only discipline.
- `src/renderer/src/theme/tokens.css` — the tokens you reference: `--font-mono` (36-37),
  `--color-tertiary` / `--color-surface-container` / `--color-outline-variant` / `--color-on-surface-variant`
  (18-31), `--text-body-small-*` (60-63), `--space-2` / `--space-3` (77-78), `--radius-sm` = 12px (86).
  All exist; add nothing.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-28

A compact bordered **chip** (node `16:29`) — not a message bubble — left-aligned in the thread: a
monospace, tertiary-colored tool name (`16:30`, e.g. `read_file`) beside a muted body-small input
summary (`16:31`, e.g. `kitchenclaw/db/schema.ts · 184 lines`), separated by an 8px gap, inside a
`surface-container` fill with a 1px `outline-variant` border and a 12px radius. The whole row
(frame `16:28`) sits at **50% opacity** — the pending/unresolved dimming; #206 resolves it and owns
whether that dimming lifts. The `·` separator and `184 lines` are part of the daemon's `input_summary`
string, not chrome — the component renders `name` and `inputSummary` verbatim as two text runs.

## Design

### Production change — one switch arm (`ConversationScreen.tsx`)

Replace `case 'toolCall': return null` (lines 171-173) with a pending-row render. Contract:

```tsx
case 'toolCall':
  return (
    <div className="tool-row">
      <div className="tool-row__chip" data-thread-role="tool">
        <span className="tool-row__name">{item.name}</span>
        <span className="tool-row__summary">{item.inputSummary}</span>
      </div>
    </div>
  )
```

Load-bearing points:

- **`name` and `inputSummary` are React children** (auto-escaped) — never `dangerouslySetInnerHTML`,
  no `href`/`src`/path interpretation. This is the AC4 discharge, identical posture to the
  `assistantText` arm one case up (line 152-170).
- **`data-thread-role="tool"`** (not `"assistant"`) is deliberate: it gives the test a stable hook
  **and** keeps `threadBubbleCount` (which matches `"assistant"`) at 0 for tool rows — the ticket's
  "bubble-count for the daemon thread legitimately stays zero while the tool row is present" note.
- **`inProgress` is unused in this arm** and needs no guarding: `Timeline` computes it as
  `index === lastIndex && item.kind === 'assistantText'`, so it is always `false` for a `toolCall`.
  No cursor renders on a tool row — nothing to do.
- **Key strategy is unchanged.** Do **not** touch `Timeline`'s `.map((item, index) => <TimelineRow key={index} …>)`
  (line 123-135) and do **not** introduce a `toolUseId`-based key. `toolUseId` stays on the item for
  #206's result correlation but is never a React key here (AC2). This is the fix the #218 refine
  called out: array-index keying already keeps a pending row put as the stream grows and lets #206
  resolve it in place.
- **Update the two now-stale comments** so the file stays honest: the inline `case 'toolCall'` comment
  (currently "Deferred: #205 / #206 own the tool render") → the pending-render intent, deferring only
  the resolved treatment to #206; and the `TimelineRow` header comment (lines 140-143, "exhaustive over
  today's three kinds (two of them null)") → now only `turnBoundary` returns null.

### Styling — new rules in `conversation.css` (token-only, no new literals)

Add beside the existing thread rules. Every value is a token; the mapping to Figma is exact except the
two off-grid values called out (both follow the file's own established ±2px / ±1px tokenization
convention — see the `.status-row` and `.run-config__*` comments).

- **`.tool-row`** (frame `16:28`) — the wrapper: `display: flex; justify-content: flex-start;` (left,
  like `.message-row--daemon`) + `opacity: 0.5` (the pending dimming; opacity is a de-emphasis device
  here, not a color literal — the `.status-sheet-overlay__scrim` / `.status-sheet__handle` precedent).
  A child of `.conversation__thread`'s flex column, so it inherits the column's `gap`; no `flex`/margin
  of its own.
- **`.tool-row__chip`** (frame `16:29`) — the pill: `display: inline-flex; align-items: center;`
  `gap: var(--space-2);` `padding: var(--space-2) var(--space-3);` `background: var(--color-surface-container);`
  `border: 1px solid var(--color-outline-variant);` `border-radius: var(--radius-sm);` (12px, exact
  match) `max-width: 100%; min-width: 0; overflow: hidden;` (bound the chip so an arbitrarily long
  untrusted summary can't blow out the layout).
- **`.tool-row__name`** (`16:30`) — the tool name run: `font-family: var(--font-mono);`
  `color: var(--color-tertiary);` the `--text-body-small-*` quad for size/line/tracking/weight;
  `flex: 0 0 auto; white-space: nowrap;` (the identity — never shrinks or truncates). **Size note:**
  Figma is a raw `13px` (not a named M3 style); map to `--text-body-small-size` (12px) per the file's
  ±2px convention — monospace at 12px reads consistent beside the 12px sans summary and introduces zero
  type literals.
- **`.tool-row__summary`** (`16:31`) — the input summary run: `color: var(--color-on-surface-variant);`
  the full `--text-body-small-*` quad (Figma names body-small here explicitly); inherits `--font-sans`
  from `.conversation` (no explicit family needed); `min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap;` so a long summary ellipsizes rather than overflowing. (Figma models a hard
  `overflow-clip`; ellipsis is the friendlier desktop degrade for an untrusted, unbounded string —
  a deliberate, minor refinement.)

## State + concurrency model

**No change.** The `toolCall` items already flow `store → selectItems → ConversationScreen (container)
→ Timeline (pure view)`; this slice only teaches the view to draw the `toolCall` arm. No store slice,
no bridge, no transport, no async task, no subscription, no cancellation surface is touched. Inert in
production until #179 flips `interactive` — with it off, no `tool_use` frames arrive, the store stays
empty, and `Timeline` renders `null` (the same dormant-until-#179 posture as #203/#215). Tests exercise
the populated path by server-rendering the pure `Timeline` with an injected `ThreadItem[]` (the #203
idiom — the container's populated branch is unreachable under `renderToStaticMarkup`, which reads
zustand v5's `getInitialState()` = empty).

## Error handling

The only adversarial surface is the two untrusted daemon strings. Both are handled deterministically by
React auto-escaping (inert children, never `dangerouslySetInnerHTML`, no markup/path interpretation) —
identical to how #203 handles assistant-delta text, and asserted as such (below). `name` /
`inputSummary` are always-present strings on the item (the #121 reducer sets them from the `toolUse`
event; #217 already validated them as strings at the wire boundary), so no null-guard or fallback is
needed. `result: null` renders no result region at all — the success/error treatment is #206's, not a
failure mode here.

## Testing strategy

Vitest + `renderToStaticMarkup` of the pure `Timeline` with an injected `ThreadItem[]` — no DOM harness,
no store (the file's existing idiom). Rewrite the superseded case and add coverage:

- **Rewrite `"renders a toolCall as a safe no-op"` (lines 118-135)** → *"renders a pending tool row —
  the tool name and its input summary, not an assistant bubble"*: inject one `toolCall` item; assert the
  markup contains `item.name` and `item.inputSummary`; assert `threadBubbleCount(markup) === 0` (the tool
  row is not an assistant bubble); assert no `bubble__cursor`; assert the `tool-row__chip` /
  `data-thread-role="tool"` structure is present.
- **Add an escaping case** (mirror lines 83-89): a `toolCall` whose `name` and `inputSummary` each
  contain markup (e.g. `<b>x</b>`; keep apostrophe-free — `renderToStaticMarkup` escapes `'` → `&#x27;`,
  a prior desktop lesson) renders escaped (`&lt;b&gt;…`), never live markup. Discharges AC4 for **both**
  untrusted fields.
- **Add an interleaving case** (AC1): a mixed `[assistantText, toolCall, assistantText]` timeline renders
  the tool row **between** the two assistant bubbles in array order (`indexOf` ordering assertions, like
  the existing order test at lines 104-116), and still shows exactly one cursor on the tail
  assistantText — proving the tool row neither reorders nor steals the cursor.
- **AC2 (no key churn): no new test.** The key strategy is literally unchanged code — the `Timeline`
  `.map` is not touched. A key-churn test would re-assert #203's already-covered behavior; do not add
  one.

`npm run build` (typecheck + build) and `npm test` green closes AC5.

## Open questions

- **Tool-name size (resolved, flagged for visual confirmation).** Decision: `--text-body-small-size`
  (12px) for the mono tool name, per the ±2px convention. The developer should eyeball the result against
  the Figma screenshot; if the 1px delta reads wrong, a scoped `13px` literal with a comment is the
  fallback — but there is no ambiguity to resolve before implementing.
- **#206 handoff (informational, not a blocker).** The pending 50% dimming lives on `.tool-row`. When
  #206 fills `result`, it resolves the row in place and will need to lift/override that dimming (e.g. a
  `.tool-row--resolved` modifier keyed off `item.result !== null`) and add the success/error treatment.
  This slice deliberately owns only the `result === null` visual; #206 owns the rest.
