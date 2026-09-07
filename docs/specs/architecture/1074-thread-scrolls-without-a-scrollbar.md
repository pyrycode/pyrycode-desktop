# #1074 — the thread scrolls without drawing a scrollbar

## Files read

- `src/renderer/src/screens/conversation/conversation.css` → the `.conversation__thread` rule and the
  `overflow-anchor` comment block above it — the one rule this ticket edits, and the comment that forbids
  the neighbouring declaration.
- `src/renderer/src/screens/conversation/conversation.css` → the `.composer__input` rule and its
  "PAST THE CEILING NOTHING IS DECLARED" note — the repo's only prose about a scrollbar, recording the
  composer textarea's bar as deliberate (#1056) and, crucially, recording that **this app was measured with
  a layout-taking bar** (`clientWidth` 616 → 601 when the bar appears). That measurement is why the
  geometry read is rejected as a detector below rather than merely doubted.
- `src/renderer/src/screens/channels/channels.css` → the `.channel-list` rule — the neighbouring
  `overflow-y: auto` region that must keep drawing what it draws today, and the one this plan turns into
  the *validity proof* for the thread's own assertion.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` → `Timeline` (the live thread render site,
  `scrollPin` ref + `onScroll`) and `MessageThread` (a second, legacy render site of the same class) — both
  emit `<div className="conversation__thread">` with no `tabindex` and no `role`, which is the state AC3
  freezes. Also the `useThreadLayoutEffect` comment block, which says in prose what the stylesheet's
  comment says: do not add `overflow-anchor` here.
- `e2e/thread-scroll-pin.spec.ts` → `primeOverflowingThread`, `readThreadMetrics`, `buildReplyFrames`,
  `settleScrollEvent` — the established way to drive an *actually overflowing* thread in the fake tier and
  read live scroll metrics off it. This plan's spec copies that primer's shape rather than inventing one.
- `e2e/thread-shadow.spec.ts` → the whole file — the nearest structural analogue: one launch, computed-style
  reads off elements of the message area, markup byte-identical before and after.
- `e2e/fixtures/launchPairedApp.ts` → `launchPairedApp`, `SEEDED_ROW`, `seedConversationsFrame` — the
  fixture navigates by clicking the single seeded row, so the conversation is open and the sidebar's
  `.channel-list` is on screen beside it at launch.
- `docs/knowledge/features/conversation-shell-chrome.md` § the layout tree — records `.conversation__thread`
  as `flex: 1 1 auto; min-height: 0; overflow-y: auto` and why `min-height: 0` is load-bearing.
- `docs/knowledge/features/conversation-shell-composer-message-box.md` → the #1056 ruling that the composer
  textarea's bar is a deliberate signal, which is the fifth criterion's named exception.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=132-4171

`Message area`, inside the chat screen's `Content` frame. The reference is an *absence*, and a measured
one: the node renders 780 × 1026 inside a `Content` frame of 820 with 20px insets, so the message column
runs the full inner width with no strip reserved on the right, and no scrollbar layer exists at any depth.
The screenshot confirms it — the rows run edge to edge and the last one (a tool row) is clipped mid-row at
the frame's bottom edge, which is overflow drawn with no bar. Nothing here is a colour, a type style or a
spacing value; the whole design content of this ticket is that the right-hand strip is not there.

## Context

`.conversation__thread` declares `overflow-y: auto` and the app declares no scrollbar property anywhere, so
the thread renders the platform's default bar. The design draws none. This changes exactly one scroll
region to match, and is a paint change only.

No ADR is warranted. This is one rule in one stylesheet, with no contract, no new module and no decision
that outlives the rule's own comment.

## Design

Two declarations, both flat, both on the thread's own selector, in `conversation.css`:

```css
.conversation__thread { … ; scrollbar-width: none; }
.conversation__thread::-webkit-scrollbar { display: none; }
```

Three properties of that shape are load-bearing and each is stated in the rule's comment:

1. **`scrollbar-width: none` is the operative declaration** on this engine (Electron 33 / Chromium 130),
   and once it is set the `::-webkit-scrollbar` pseudo-element is not consulted at all. The webkit rule is
   a fallback that is inert here. The comment must say which of the two is live, so a later reader does not
   read the inert rule as the working one and edit it expecting an effect.
2. **The webkit rule is a separate top-level rule**, never the nested `&::-webkit-scrollbar` form. There is
   no CSS nesting anywhere in this repo's nine stylesheets; the only `&` in any of them is an `&&` inside a
   JSX snippet quoted in a comment.
3. **`overflow-y: auto` is untouched, `overflow-anchor` stays absent, and no `tabindex` or `role` is
   added.** All three are named in the existing comment block above the rule and in `ConversationScreen`'s
   own prose, and all three are behaviour, not paint. `overflow: hidden` would take wheel and keyboard
   scrolling with it; `overflow-anchor: none` costs a measured 172px of reader drift; `tabindex="0"` would
   make the keys work without a preceding click and change tab order with it.

Nothing else changes. The markup is byte-identical — no class is added at any call site, and both
`Timeline` and the legacy `MessageThread` keep emitting the element they emit today.

## State + concurrency model

None. This ticket adds no state, no effect, no subscription and no async work. The existing scroll-pin
mechanism (the tracked `following` flag, the layout-effect re-assert, the `ResizeObserver`) is untouched
and reads no scrollbar property, so it cannot observe this change.

## Error handling

None — a stylesheet declaration has no failure mode. The only reachable failure is an engine that does not
support `scrollbar-width`, in which case the computed value reads back as the empty string rather than
`none` and the spec below **fails loudly**. That is the correct direction: the detector cannot silently
degrade into a passing assertion.

## Testing strategy

**Only Playwright can see this.** Nothing in this repo screenshots (`toHaveScreenshot` appears nowhere in
`e2e/`), and renderer tests are `renderToStaticMarkup` under `environment: 'node'` with no stylesheet and
no layout at all, so no unit test can observe a computed style. One new fake-tier spec,
`e2e/thread-scrollbar.spec.ts`, one launch, four legs.

**The detector is a computed read, and a geometry read is rejected outright.** `offsetWidth - clientWidth
=== 0` proves nothing on a machine drawing overlay bars, where that gutter is already 0 with the new
declaration deleted — and this repo has measured the *other* case in its own composer, so neither platform
can be assumed. The computed `scrollbar-width` off `.conversation__thread` is platform-independent and
reddens when the declaration is removed. No geometry assertion is written.

**The neighbour read is what proves the detector discriminates, and it is the same assertion that
discharges the last criterion.** A bare `toBe('none')` could in principle pass on an engine that answers
`none` for every element; reading `.channel-list` and `.composer__input` in the *same run* and getting
`auto` back rules that out, and simultaneously proves the sidebar's scroll column and the composer's
deliberate #1056 bar are untouched. One read, two jobs.

The scenarios:

- **A thread primed to overflow computes `scrollbar-width: none`.** The primer is
  `thread-scroll-pin.spec.ts`'s: one composer send answered with a 20-turn stream, gated on
  `scrollHeight > clientHeight` before anything is measured, so the assertion runs in the state where a bar
  would actually be drawn.
- **Its two on-screen neighbours still compute `auto` in the same run** — `.channel-list` beside it and
  `.composer__input` below it.
- **Nothing else about the element moved** — one `evaluate` returning `overflow-y`, `overflow-anchor`, and
  the `tabindex` / `role` attributes; `auto`, `auto`, `null`, `null`.
- **It still scrolls, by wheel and by keyboard.** `page.mouse.wheel()` with the pointer over the thread
  moves `scrollTop` off the bottom; then a click into the thread's own left padding strip (16px of
  container, no row under it, no handler on any row or bubble — the copy affordance is a dedicated
  `Copy message` button) followed by `PageUp` / `PageDown` / `Home` / `End`, each asserted to move the
  offset in its own direction. The click is a raw-coordinate `page.mouse.click`, never a locator click,
  because a locator click auto-scrolls the target into view and would perturb the very offset under test.

**Trackpad momentum is not synthesizable in any tier.** That leg of AC2 is an operator eyeball on the built
app and the spec says so in a comment rather than pretending to cover it.

**The `overflow-anchor` half keeps its existing detector**: `thread-scroll-pin.spec.ts`'s three thumbnail
tests. They are not re-written here; they must stay green, which the verifier's full-tier run establishes.

## Open questions

- **Does keyboard scrolling actually reach the thread today?** AC2 asserts it works after a click inside
  the thread, via Chromium's sequential-focus starting point. This is stated in the ticket but not measured
  in this repo. The spec is written before the CSS change and run against the current tree, so the RED run
  answers it. If a key leg fails *before* the change it is pre-existing behaviour, not a regression this
  ticket introduces, and the answer is to record it — **not** to add the `tabindex` the ticket forbids.
- **Does `getComputedStyle().scrollbarWidth` read back as the keyword on Chromium 130?** Expected yes
  (supported since Chromium 121). The RED run confirms it by returning `auto` for the thread before the
  declaration lands; an empty string instead would say the property is not exposed and the detector would
  need re-siting. Resolved in the RED run either way.
