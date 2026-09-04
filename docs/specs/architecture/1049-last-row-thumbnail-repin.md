# #1049 — a thumbnail resolving in the last row must leave a bottom-resting reader at the bottom

## Files read

Codegraph is not usable in this checkout (`mcp__codegraph__*` answers "CodeGraph not initialized" as a hard
error), so this list was built with Grep and Read rather than `codegraph_context`. Noted here because the
brief prescribes codegraph first and the gap is the reason the reading list is hand-assembled.

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin` — the whole change
  lands inside this hook. Its docblock is the record of what has already been ruled in and out here, and it
  names this ticket by number as the one case left open.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline`, `TimelineRow` — the rows are
  written directly into `.conversation__thread`'s children by `Timeline`'s `map`, with `TimelineRow` returning
  a single root element (`.message-row` / `.tool-row` / `.session-delimiter`) per item. That "rows are direct
  children, append-only, keyed by index" fact is what the observer's sync rule below rests on.
- `src/renderer/src/screens/conversation/threadScrollPosition.ts` → `isAtBottom`, `AT_BOTTOM_TOLERANCE_PX` —
  the flag's only writer reads through `isAtBottom`; the spec imports the tolerance rather than restating it.
- `src/renderer/src/screens/conversation/conversation.css` → the `.conversation__thread` rule — confirms the
  container is `flex: 1 1 auto; min-height: 0; overflow-y: auto` with the flex column, `gap` and `padding` all
  on the scroll container itself, and carries the standing prohibition on `overflow-anchor: none`. Read to
  decide whether a content wrapper was needed; the answer is no (see Design).
- `src/renderer/src/screens/conversation/BubbleAttachmentImage.tsx` → the `pending` and `ready` arms —
  confirms the two-event settle (a leaf-only `useState` flip, then a decode-and-layout with no React render)
  and that the `pending` arm reserves nothing. Not modified.
- `src/renderer/src/main.tsx` — the app mounts inside `React.StrictMode`, so every effect double-invokes in
  dev. Constrains the observer's setup/teardown shape.
- `e2e/thread-scroll-pin.spec.ts` → `withheldThumbnails`, `attachmentChunkFrame`, `sendWithThumbnail`,
  `resolveThumbnail`, `thumbnailBubble`, `rowPosition`, `distanceFromBottom`, `primeOverflowingThread`,
  `readThreadMetrics`, `expectPinnedToBottom`, `settleScrollEvent` — every helper the new test rides, plus
  the two existing thumbnail tests that must pass unmodified.
- `docs/knowledge/features/conversation-shell.md` § "Thread scroll pin" — the package overview's account of
  #601 → #602 → #603 → #1009 → #1046, including the two still-open latency-gap occupants
  (`ComposerErrorSlotControl`, `ComposerSlot`) and the "`ResizeObserver` over the whole region, covering every
  occupant at once" closure it names. This is where the design's generality requirement comes from.
- `tsconfig.web.json` — `lib` includes `DOM` and `DOM.Iterable`, so `ResizeObserver` types and iterating an
  `HTMLCollection` both typecheck without a lib change.

## Design source

**Figma:** N/A — echoed from the ticket. Scroll position is behaviour, not a drawn surface, and the design
has no node for it. The thumbnail whose late resolution causes the drift is node `120-3848`, drawn by #1045
and unchanged here. The visual-fidelity check is intentionally skipped.

## Context

A reader resting at the bottom of the thread sends a message whose image attachment is the **last** row. The
row mounts with `BubbleAttachmentImage`'s `pending` arm, which draws and reserves nothing, so the thread pins
to the bottom correctly. When the bytes arrive the browser lays the picture out and the content grows
**below** the reader by 172px, leaving them 172px short of the bottom until some unrelated render re-pins
them. Measured in the ticket: `scrollTop` 1540 → 1540, `scrollHeight` 2028 → 2200, distance from bottom
0 → 172, against an `AT_BOTTOM_TOLERANCE_PX` of 4.

Three constraints are already on the record and this plan honours all three. `useThreadScrollPin`'s docblock
records that a thumbnail settles in two events, neither of which a dependency array or #1009's hoist-the-read
fix can reach, and states the terms a new mechanism must meet: it must not fight anchoring and must keep the
idempotence the dep-free effect's two safety properties rest on. `.conversation__thread` leaves
`overflow-anchor` unset on purpose and `overflow-anchor: none` is the one line that defeats #1046's fix — it
is not added. `BubbleAttachmentImage`'s `pending` arm reserving a placeholder box is rejected on the record,
because an honest box needs the aspect ratio, which needs the bytes — the arm is untouched.

No ADR is warranted. This is the closure of a gap an existing docblock already names by number, inside the
hook that already owns the behaviour; the design decision is recorded in that docblock, which this ticket
amends.

## Design

**One mechanism, one write, one flag.** `useThreadScrollPin` gains a `ResizeObserver` whose callback runs the
*same* guarded write the dep-free layout effect already runs. The hinge is the existing `following.current`
flag, exactly as the ticket requires: growth re-pins when the reader is at the bottom and changes nothing when
they are scrolled up, which is one condition on an existing value rather than a second mechanism.

### The write becomes a named function shared by both callers

The effect's body today is `if (el === null || !following.current) return; el.scrollTop = el.scrollHeight`.
That write moves to a module-level function beside the hook, taking the element and the flag ref:

```ts
function reassertPinnedToBottom(el: HTMLElement, following: { readonly current: boolean }): void
```

Module-level rather than a closure inside the hook, and deliberately: the observer is created once and would
otherwise capture the first render's closure forever, which is a stale-closure trap the next editor would have
to know about. A module-level function that takes everything it reads has no such trap. `following` is typed
read-only at this seam so the shared write can never become a second writer of the flag — the hook's contract
is that only the container's own scroll events and `followBottom` write it.

Both properties the docblock relies on are structural consequences of routing both callers through this one
function. It is IDEMPOTENT because it writes only while following and assigns `scrollTop` a value it already
holds, which fires no scroll event; and the observer therefore *inherits* that idempotence rather than having
to re-earn it — which is precisely what the docblock says "a handler writing unconditionally does not
inherit".

### What the observer observes

`ResizeObserver` on `.conversation__thread` itself does not fire on content growth: it is `flex: 1 1 auto;
min-height: 0; overflow-y: auto`, so its border box is fixed by the parent's layout. The rows are direct
children of the scroll container with no content wrapper between them.

**The observer observes the container and each of its direct children.** No new wrapper element, and that is
a deliberate rejection rather than an oversight — see Rejected below.

- **Each direct child row** is what closes this ticket. When the picture decodes, the `.message-row` holding
  it grows by 172px and its own border box changes, so the observation fires with layout already final.
- **The container itself** is one extra line and covers the complementary direction: the container's border
  box *does* change when chrome mounting between the thread and the composer shrinks the flexible middle
  region, or when the window resizes. That is a free consequence of the same mechanism, not a second one.

### How the observed set stays in sync, with no bookkeeping structure

The existing dep-free layout effect is already the exact sync point, because it runs after every render of the
screen and rows can only appear via a render of the screen. So the effect gains, before its existing write:

1. Lazily create the observer on first run (so `ResizeObserver` is never referenced under vitest's `node`
   environment, where neither hook runs at all).
2. If the container node identity has changed since the last sync, `disconnect()` first and record the new
   node. `.conversation__thread` unmounts whenever the timeline empties (`Timeline` renders `<EmptyThread />`
   at zero items) and a fresh node mounts when items return, so this is the one and only way rows leave the
   observed set — within a single container's lifetime the timeline is append-only with tail mutation and
   index keys, so rows are updated in place and never removed.
3. `observe()` the container and every direct child. Calling `observe()` on an already-observed target with
   the same box is a no-op, so this is a cheap O(rows) loop of early returns per render, and re-observing
   unconditionally is also what makes the mechanism self-healing after a StrictMode teardown.

Teardown is a separate mount-scoped `useEffect` whose only body is a cleanup that disconnects the observer and
clears the recorded node. It cannot live in the dep-free effect's cleanup, which runs after every render.

### Why this does not fight anchoring (AC4)

For a picture **above** a bottom-resting reader, Chromium's anchoring runs during layout and has already
advanced `scrollTop` by the inserted height by the time resize observations are delivered — so the distance
from the bottom is already zero and the shared write assigns `scrollTop` the value it already holds. The two
mechanisms agree rather than compete, and the write is a literal no-op in that case. For a **scrolled-up**
reader in either direction, `following.current` is `false` and nothing is written at all. Nothing in the
change touches `overflow-anchor`, and `conversation.css` is not modified.

### Why there is no feedback loop

The callback's only effect is a `scrollTop` assignment. Scrolling resizes no element, so no observation is
re-triggered; the guard means a scrolled-up reader is written to zero times; and when the write does move the
offset, the scroll event it fires computes at-bottom → `true`, which is the value the flag already holds.

### Rejected

- **A content wrapper inside the scroll container**, observed as a single element. It would move the flex
  column, the `gap` and the `padding` off `.conversation__thread`, change the markup run every renderer test
  asserts against, and put a new element between the rows and a container that several CSS rules describe
  themselves as stretch items of. All of that to save an O(rows) loop of no-op calls.
- **An `onLoad` handler on the thumbnail's `<img>`**, delegated through the container's capture phase. Image-
  specific (which the ticket permits) but strictly weaker: it fires on decode, before layout, so the write
  would depend on `scrollHeight` forcing a synchronous reflow, and it closes none of the other occupants.
- **Reserving a placeholder box in the `pending` arm** — rejected on the record in `BubbleAttachmentImage`'s
  own header, for a reason that still holds.
- **Narrowing the existing effect's (absent) dependency array** to make room for a new trigger — the docblock
  names this as the thing to avoid, and no array can reach a leaf that re-renders alone.

## State + concurrency model

No store slice changes and no IPC. All state stays hook-local refs: `following` (unchanged, still written only
by the container's scroll events and `followBottom`), plus two new refs holding the observer and the container
node it is currently synced against. Refs rather than state for the reason the docblock already gives — nothing
renders these values, and a resize can fire at frame rate.

The one long-lived resource is the `ResizeObserver`, and its cancellation path is explicit: a mount-scoped
effect's cleanup calls `disconnect()` on unmount, and a container-identity change disconnects mid-life. Under
StrictMode's simulated unmount the cleanup disconnects and clears the recorded node; the next layout effect
re-creates the observed set from scratch, so a double-invoke converges rather than accumulating.

## Error handling

No new failure modes: no I/O, no IPC, no parsing, nothing that can reject. `ref.current` is re-read inside the
callback and the null case returns without writing, which covers an observation delivered in the same frame as
an unmount. `ResizeObserver` is unconditionally present in the renderer's Chromium and is never referenced in
the `node` test environment, so no capability guard is added — a guard nothing can exercise is the branch this
file's own conventions argue against.

## Testing strategy

**Playwright only.** Renderer specs are `renderToStaticMarkup` under `environment: 'node'` — no DOM, no
layout, no image loading, no scrolling — so nothing here is unit-testable, exactly as every prior member of
this family. `threadScrollPosition.test.ts` continues to cover the pure arithmetic and is untouched.

One new test appended to `e2e/thread-scroll-pin.spec.ts`, riding the helpers that file already owns
(`withheldThumbnails`, `sendWithThumbnail`, `resolveThumbnail`, `thumbnailBubble`, `rowPosition`,
`readThreadMetrics`, `distanceFromBottom`, `expectPinnedToBottom`, `primeOverflowingThread`), plus one new
canonical UUID-shaped attachment id, one new message text, and one small locator helper for "this bubble's row
is the thread's last child".

Scenario, in order — the staging order is the reverse of #1046's above-test, so the picture-bearing row is
genuinely last:

- Prime the thread with the twenty-turn overflow stream, then send the message carrying the withheld picture.
- Precondition: the reader is at the bottom, and the picture's row is the thread's final child. `rowPosition`
  is asserted as `'overlapping'`, not `'below'` — the last row of a bottom-resting thread is on screen, and
  `'below'` would fail as a precondition rather than as a finding.
- Read the metrics, release the correlated `attachment_chunk` out of band, wait through `resolveThumbnail`'s
  two gates (decode, then drawn box height), read the metrics again.
- Non-vacuity: assert the content grew by at least `THUMBNAIL_GROWTH_PX` first. At the bottom, "the thumbnail
  never resolved" is indistinguishable from "the fix worked", so without this the test passes against an app
  with no fix in it.
- The criterion: `expectPinnedToBottom`, with no send, no pushed timeline frame and no other screen render in
  between.

The two existing thumbnail tests are the guards and are **not modified**: the picture-below arm of the second
one reddens if the mechanism re-pins on content growth unconditionally, and the picture-above test reddens if
anchoring is replaced or fought. The new test is shown red against `main` and the measured distance from the
bottom on both sides of the fix goes in the PR body.

Verification: `npm run e2e -- e2e/thread-scroll-pin.spec.ts` and `npm run build`. `e2e/` is outside both
tsconfig projects and Playwright strips types with esbuild, so a type error in the spec surfaces in no gate —
the spec is typechecked by hand with an ad-hoc `tsc --noEmit` and the result read by filename.

## Open questions

- **Does re-`observe()`ing an already-observed target deliver a redundant initial notification?** It is a
  no-op in Chromium and per the current spec, but even if a notification were delivered it is harmless: the
  callback is the same idempotent guarded write the effect on that very render already performs. Resolve by
  observation during implementation; nothing in the design depends on the answer.
- **Does the container observation change any existing e2e expectation?** It should not — every test that
  parks a reader mid-thread leaves `following.current` false, and every test that rests at the bottom already
  expects to stay there. Confirm by running the fake-transport tier's scroll-adjacent specs, and if any
  disagrees, drop the container from the observed set rather than weakening the guard.
