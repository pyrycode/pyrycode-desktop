# #1046 — a thumbnail that loads late must not move the thread's scroll position

## Design source

**Figma:** N/A — echoed from the ticket. Scroll position is behaviour, not a drawn surface, and the design
has no node for it. The thumbnail whose late resolution causes the movement is node `120-3848`, drawn by
#1045; nothing about that drawing changes here, so there is no visual-fidelity check to make.

## Files read

- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `useThreadScrollPin` — the dep-free
  layout effect under discussion, and the header that already names this class of gap ("a known LATENCY
  gap, not a broken pin") and its two candidate closures. Also `Timeline`, which owns the
  `.conversation__thread` element the pin's ref attaches to.
- `src/renderer/src/screens/conversation/threadScrollPosition.ts` → `isAtBottom`,
  `AT_BOTTOM_TOLERANCE_PX` — the 4px band AC1 is measured against, imported by the spec rather than
  restated.
- `src/renderer/src/screens/conversation/BubbleAttachmentImage.tsx` → `AttachmentThumbnail`'s `pending`
  arm — returns `null`, so nothing is drawn and nothing reserved; its header records that the resulting
  scroll movement is this ticket and that a guessed placeholder box is rejected on the record.
- `src/renderer/src/screens/conversation/conversation.css` → `.conversation__thread` (the scroll region:
  `flex: 1 1 auto; min-height: 0; overflow-y: auto`, `overflow-anchor` unset ⇒ default `auto`) and
  `.bubble__image` (`max-height: 160px` + `margin-top: var(--space-3)`) — together the 0 → 172px growth.
- `e2e/thread-scroll-pin.spec.ts` → `primeOverflowingThread`, `readThreadMetrics`, `expectPinnedToBottom`,
  `settleScrollEvent`, the module-level `buildReplyFrames` and every frame builder — the infrastructure
  this ticket rides in place rather than re-deriving.
- `e2e/attachment-image-thumbnail.spec.ts` → `serveAttachmentFrame`, the `SERVED` map, the canonical
  UUID-shaped ids and the `pushCompleted` upload seam — the seeding shape for driving a fetch to
  completion, taken from here per the ticket.
- `e2e/attachment-file-row.spec.ts` — read only to confirm the ticket's claim that it is the wrong seam: it
  answers `request_attachment` with no frames on purpose and its `e2e-download-1` ids fail
  `resolveAttachmentPath`'s canonical shape.
- `docs/knowledge/features/conversation-shell.md` § "Thread scroll pin" — the #601 → #796 → #967 → #1009
  history, including the sentence this ticket falsifies: "`overflow-anchor` stays unset (closed as
  indifferent, confirmed on an observed e2e run)". Indifferent for the cases #601 tested; **decisive** for
  this one.
- `playwright.config.ts` — `testDir: './e2e'`, `workers: 1`, `fullyParallel: false`: tests in one file run
  serially in one worker process, which is why per-test capture state is composed into a per-launch
  `buildReplyFrames` rather than held at module scope.

Codegraph was not used: every `mcp__codegraph__*` call in this repo fails with "CodeGraph not initialized".
Read and Grep throughout.

## Context

`useThreadScrollPin` re-asserts `el.scrollTop = el.scrollHeight` in a layout effect with **no dependency
array**, so it runs after every render of `ConversationScreen`. A late-resolving thumbnail escapes it in a
way no dependency array could reach, and the ticket's own analysis is confirmed by reading the merged
#1045 code: there are **two** events and only the second one moves geometry.

1. `BubbleAttachmentImage`'s own `useState` flips `pending` → `ready`. That is a React render — of the
   leaf alone. `ConversationScreen` does not re-render, so the pin does not run. At that instant the
   `<img>` carries a `blob:` src and deliberately no `width`/`height` attributes, so it occupies nothing.
2. The browser decodes the bytes and lays the image out. The row grows by up to `160px` (`.bubble__image`'s
   `max-height`) plus `12px` of `margin-top`. **No React render happens anywhere.**

So the closure cannot be a state hoist (#1009's fix): a hoisted read lands its render at event 1, before
the image has decoded, and event 2 stays unobserved. Whatever holds the position has to react to layout.

**It already does, and the mechanism is not this app's.** Chromium's scroll anchoring is live —
`overflow-anchor` is unset app-wide, which is the default `auto` — and holding a stable node's visual
position when content above it grows is exactly its job. The ticket asks for this to be verified before
building, and it was: **measured, not reasoned about.**

### The measurement

An `e2e/`-local probe (built from `thread-scroll-pin.spec.ts`'s primer plus
`attachment-image-thumbnail.spec.ts`'s serving helper, run against the built app, then deleted) withheld an
`attachment_chunk` from `buildReplyFrames`, let the thread settle, took a reading, then pushed the
correlated frame out of band with `daemon.pushFrame`. Every run grew the content by exactly **172px**
(160 + 12), against a 488px viewport. Each scenario was run twice: once as shipped, once with the single
line `overflow-anchor: none` added to `.conversation__thread` and the app rebuilt.

| scenario | as shipped | with `overflow-anchor: none` |
|---|---|---|
| **A** — reader at the bottom, thumbnail above them | scrollTop 1540 → 1712, distance from bottom **0** | scrollTop 1540 → 1540, distance from bottom **172** |
| **B** — reader parked mid-thread, thumbnail above them | scrollTop 1014 → 1186 (+172); a reference bubble's viewport top **218 → 218** | scrollTop 1014 → 1014 (+0); the same bubble's top **218 → 390** |
| **C** — reader parked mid-thread, thumbnail below them | scrollTop **406 → 406** | scrollTop **406 → 406** |
| **D** — reader at the bottom, thumbnail in the **last** bubble | distance from bottom **172** | distance from bottom **172** |

Scenarios A, B and C are AC1 and AC2, and they hold as shipped. **No production change ships**, per the
ticket's own instruction for this outcome. Scenario D is a distinct gap this measurement turned up and is
out of scope — see "Out of scope" below.

**Row B is why AC2's literal wording cannot be taken literally, and the plan says so rather than
quietly picking one reading.** AC2 asks that a scrolled-up reader's "scroll offset [is] left exactly where
it was". For a thumbnail **below** them (row C) that is literally true: `scrollTop` does not move by a
pixel. For a thumbnail **above** them (row B) it is unsatisfiable in that form — the only way to leave the
reader looking at the same content when 172px is inserted above the viewport is to move `scrollTop` by
those 172px, which is precisely what anchoring does and precisely what a mechanism satisfying AC1 must do.
The criterion's stated purpose is the over-reach guard ("a mechanism that re-pins on any content growth
would yank a scrolled-up reader to the bottom, and this criterion is what reddens if it does"), so the
spec asserts the reader-facing fact — a stable row's **viewport-relative** position is unchanged — plus,
explicitly, that the thread is still nowhere near the bottom. Both readings are asserted where both are
true; row C carries the literal `scrollTop` equality.

No ADR is warranted. This records a dependency on a browser default, which belongs in the package overview
the documentation phase owns, not in a decision record.

## Design

**No production behaviour changes.** The deliverable is the spec, plus two comment-only edits that record
the invariant the spec now depends on.

### The spec

Added **in place** to `e2e/thread-scroll-pin.spec.ts` rather than extracted, per the ticket: that file
already owns `primeOverflowingThread` (with its non-vacuity overflow gate), `readThreadMetrics`,
`expectPinnedToBottom`, `settleScrollEvent` and a module-level `buildReplyFrames` dispatching on the
decoded inbound type. Extraction would mean a new fixture module, a rewrite of the imports in a 627-line
file this ticket otherwise does not touch, and a third file — three files where one does.

New module-level surface, all of it additive:

- One canonical UUID-shaped attachment id per image (two ids), and one base64 PNG. Canonical shape is
  load-bearing, not cosmetic: `resolveAttachmentPath`'s id pattern gates the store write and the read
  back, so a non-canonical id turns the picture into the fallback and the growth never happens.
- `attachmentChunkFrame(requestId, ask)` — one `attachment_chunk` sealed through the production codec,
  carrying the whole file in one chunk, with a **computed** SHA-256 (`attachmentReassembler` compares an
  exact lowercase-hex digest, so a hand-written one fails closed) and `in_reply_to` set to the request id
  the client minted (`daemonConnection` routes retrieval chunks by that field and silently drops a frame
  matching no live retrieval).
- `withheldThumbnails()` — a per-test factory returning a `buildReplyFrames` that intercepts
  `request_attachment`, records the request id and payload **keyed by attachment id**, returns no frames,
  and delegates every other inbound to the file's existing module-level `buildReplyFrames`. It also
  returns a `serve(id)` that builds the correlated frame for a recorded ask. Per-test rather than module
  scope: `workers: 1` and `fullyParallel: false` mean the four existing tests share this module's state,
  and capture state at module scope would leak between them.
- A `pushCompletedUpload(app, event)` helper sending one settled `AttachmentUploadEvent` on
  `ATTACHMENT_UPLOAD_EVENT_CHANNEL` — `composer-attach.spec.ts`'s established seam, since the alternative
  is a native file dialog no locator can dismiss.

Two tests, each a full launch:

1. **AC1** — *a thumbnail resolving above a bottom-resting reader leaves the thread at the bottom.* Send a
   message carrying the image (answered with no frames; the optimistic echo is the whole mutation), then
   run `primeOverflowingThread` so 20 assistant turns pile below it and the image bubble is far above the
   viewport. `expectPinnedToBottom` first, as the precondition. Read metrics, push the withheld chunk,
   poll the `<img>`'s `naturalWidth` for the served image's own intrinsic width (the round-trip proof —
   a source that never decoded reads 0), then `settleScrollEvent` and assert: the content **grew** by at
   least the thumbnail's drawn height (non-vacuity — without it the test passes against an app where
   nothing ever resolved), and `expectPinnedToBottom` again, **with no frame pushed in between**, which is
   AC1's "no intervening render to snap them back".
2. **AC2** — *a thumbnail resolving leaves a scrolled-up reader exactly where they were, above or below.*
   Two images in one thread: one sent before the primer (ends up above), one after (ends up below).
   Park the reader mid-thread programmatically and `settleScrollEvent` so the flag actually clears, then
   guard the precondition (the parked offset is neither 0 nor the bottom — 0 is the one offset at which
   scroll anchoring does not run, so parking there would make the test vacuous). Resolve the **below**
   one first and assert `scrollTop` is exactly unchanged; resolve the **above** one and assert a stable
   reference row's `getBoundingClientRect().top` is unchanged within a sub-pixel tolerance, that
   `scrollTop` advanced by the growth, and that the distance from the bottom is still far outside
   `AT_BOTTOM_TOLERANCE_PX` — the yank guard, stated as its own assertion rather than implied.

Neither test reads an image-bearing bubble through `bubbleTextExactly`: it is an anchored whole-bubble
matcher and these bubbles carry a non-text child. The existing calls in this file are on **assistant**
bubbles, which gain no child, so they are untouched.

### The two comment-only edits

Both record one invariant: `.conversation__thread` must keep `overflow-anchor` at its default.

- `useThreadScrollPin`'s header — its inventory of "leaves whose height changes reach their own leaf only"
  now has a member that is measured and under test, and whose closure is the browser's rather than this
  app's. The header currently offers a `ResizeObserver` as a candidate closure with no note that one of
  its cases is already closed; a future reader acting on that would be building a second mechanism over a
  working one, with the feedback-loop hazard the ticket names.
- `.conversation__thread`'s rule in `conversation.css` — the place someone would actually type
  `overflow-anchor: none`, and the one line that defeats the whole behaviour.

Both are comments. No declaration, no behaviour, no markup changes.

## State + concurrency model

Unchanged — nothing is added to any store, and no async work is introduced. What the spec drives is
existing machinery: `BubbleAttachmentImage`'s per-leaf `useState` and its `attachmentImageSources.request`
subscription (whose release handle is the effect cleanup), the main-side retrieval, and the fake daemon's
`pushFrame` control surface. The `following` ref in `useThreadScrollPin` keeps its single writer (the
container's own scroll events) and its one documented exception (`followBottom`).

The one ordering fact the spec depends on: the withheld chunk is pushed **after** the thread has settled
and the reader has taken their position, so the growth is genuinely late. `settleScrollEvent` is used after
every programmatic `scrollTop` assignment, for the reason its own docblock gives — without it the flag has
not been cleared by the queued scroll event and a broken app would pass.

## Error handling

Not applicable to a spec-only change; nothing new can fail at runtime. The failure modes that matter are
the spec's own vacuity modes, and each has a guard:

- The image never resolves ⇒ the `naturalWidth` poll times out loudly, and the growth assertion would fail
  after it.
- The thread does not overflow ⇒ `primeOverflowingThread`'s existing `scrollHeight > clientHeight` gate.
- The reader was never actually scrolled away ⇒ the parked-offset precondition guard.
- Nothing grew ⇒ the explicit growth assertion.
- The reader was already at the parked position for the wrong reason (offset 0) ⇒ excluded by the
  precondition, and called out because 0 is exactly where anchoring does not run.

## Testing strategy

`npm run e2e` only. Renderer specs are `renderToStaticMarkup` under `environment: 'node'` — no DOM, no
layout, no image loading, no scrolling — so nothing here is expressible in vitest, and no vitest file is
touched. No unit test is added, and none is possible: the behaviour under test is Chromium's layout
response to a decoded image.

**AC3's detector, measured.** With `overflow-anchor: none` present on `.conversation__thread` and the app
rebuilt, test 1's final `expectPinnedToBottom` reads a distance from the bottom of 172px against a 4px
tolerance, and test 2's reference-row assertion reads a viewport top of 390 where it was 218. Both were
measured on the probe before the spec was written and will be re-measured with the shipped spec present,
with the numbers stated in the PR body. Scenario C (the below case) is unaffected by that line and is not
claimed as a detector — it is the over-reach guard, and its job is to stay green.

## Out of scope

**Scenario D — a thumbnail resolving in the reader's own last bubble.** Measured at 172px of drift, and
unaffected by `overflow-anchor`: anchoring holds a node's position against growth **above** it, and this
growth is below. It is outside AC1, which is scoped to "a thumbnail above them", and outside the user
story, which is about "a picture that finishes loading further up the thread". It is the same class the
`useThreadScrollPin` header already names — a drift that the next unrelated render snaps back, not a broken
pin — and closing it needs the `ResizeObserver` the header proposes, which is a production change this
ticket's verify-first instruction rules out. Filed as
[#1049](https://github.com/pyrycode/pyrycode-desktop/issues/1049), with the measurement above, and named
in the comment added to `useThreadScrollPin`'s header.

Also out of scope and deliberately untouched: `BubbleAttachmentImage`'s `pending` arm (reserving a
placeholder box is rejected on the record in #1045's merged header), narrowing the existing effect to a
dependency array (its header records that as the thing to avoid), and the two other leaves the header lists
as uncovered latency gaps.

## Open questions

1. **Is `overflow-anchor`'s default the load-bearing mechanism, or does something else hold the position?**
   Resolved before the plan was committed, by measurement: it is the mechanism. Adding the one line that
   disables it moves scenario A from 0px to 172px off the bottom and scenario B's reference row from
   218 to 390.
2. **Does AC2's "scroll offset left exactly where it was" mean `scrollTop`?** Resolved: for a thumbnail
   below the reader, yes, and it is asserted as an exact equality. For one above, no — that reading is
   unsatisfiable alongside AC1, and the criterion's own stated purpose is the yank guard, which is asserted
   directly. Recorded above under "The measurement".
3. **Add to `thread-scroll-pin.spec.ts` or extract the helpers?** Resolved: added in place, for the
   ticket's stated reason — reuse in place is what makes this ticket small, and extraction would churn a
   file this change otherwise does not touch.
