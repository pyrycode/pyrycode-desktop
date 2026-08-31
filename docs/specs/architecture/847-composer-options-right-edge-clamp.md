# #847 — clamp the footer options panel inside the window's right edge

**Size: S.** One production file (`ComposerOptionsPanel.tsx`), one new e2e spec, one comment correction in an
existing unit test. No new exported symbol, no prop change, no consumer call site to update.

## Files to read first

Read these before writing anything. #839 and #840 left this ticket a recipe rather than a blank page, and
three of the entries below are decisions already made that this spec only carries forward.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/conversation/composerOptionsPlacement.ts:18-42` | **The wiring recipe, written for you.** Read it as the contract, not as background. |
| `src/renderer/src/screens/conversation/composerOptionsPlacement.ts:70-114` | `ComposerOptionsPlacementMetrics` + `composerOptionsShiftPx`. The three field names, and why `anchorLeft` (not the panel's measured left) is the idempotence guarantee. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:387-394` | ⭐ **`useThreadLayoutEffect` — the isomorphic-alias precedent.** The single most load-bearing entry here; see § "The layout effect" below. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx:151-155` | The three refs the container already holds — `anchorRef`, `triggerRef`, `panelRef`. This ticket adds none. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx:214-223` | The focus effect and its "plain `useEffect`, not `useLayoutEffect`" comment. The new effect sits next to it and must say why it differs. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx:233-245` | The outside-click listener: attached only while open, torn down by cleanup on close **and** unmount. The new listener copies this shape exactly. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx:247-272` | The anchor JSX. It gains **no** new attribute — see § "Imperative, not declarative". |
| `src/renderer/src/screens/conversation/conversation.css:3322-3358` | `.composer-options`'s `left: calc(-1 * var(--space-3) - var(--composer-options-shift, 0px))` — the hook, and the "must carry a unit" warning from the stylesheet's side. |
| `src/renderer/src/screens/conversation/conversation.css:3415-3442` | `.composer-options-anchor` — `position: relative; display: flex`, no padding, no border. Why the custom property goes on this element. |
| `src/renderer/src/screens/conversation/ComposerOptionsPanel.test.tsx:226-233` | ⭐ `expect(markup).toContain('<div class="composer-options-anchor">')` — the **existing** detector that forbids the declarative implementation. Its comment needs a one-line correction; the assertion itself stands. |
| `src/renderer/src/screens/conversation/composerOptionsPlacement.test.ts:33-80` | The arithmetic, already pinned at legal widths — including the exact-boundary case. **Do not re-prove any of it.** |
| `e2e/paired-shell-navigation.spec.ts:34-108` | ⭐ The window-geometry rig precedent: `setSize` / `getMinimumSize` through `app.evaluate`, why every post-resize geometry read polls, and why narrowing beats widening on a CI display. |
| `e2e/composer-actions.spec.ts:38-47` | The `Actions` trigger and panel locators, and the `exact: true` note (a non-exact `Actions` also matches `More actions`). Copy verbatim. |
| `e2e/composer-actions.spec.ts:83-97` | The launch + open idiom the new spec's first four lines reuse. |
| `e2e/fixtures/launchPairedApp.ts:120-140` | The fixture's return shape — `{ page, app }`. `app` is the `ElectronApplication` the rig drives. |
| `src/renderer/src/pairedShell.css:28-56` | Sidebar `flex: 0 0 400px` (never shrinks), pane `flex: 1 1 0; min-width: 0`. This is why the anchor's x is 468 at every window width, which is what makes the rig in § Testing work. |
| `src/main/index.ts:37-45` | `minWidth: 800` — the floor the e2e rig lifts and restores. |
| `vitest.config.ts:22-32` | `environment: 'node'`. Why no unit test can execute one line of this ticket. |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=121-3879

The shared options overlay: an 81×144 dark-navy rounded box holding five body-small rows in pale blue, with
the current row (`Max`) wearing a lighter navy fill. **No new drawing.** Every pixel of it shipped in #838
and #839; this ticket only decides where the box's left edge lands, and the design has nothing to say about
that beyond "on screen". The visual-fidelity check is a no-op here, deliberately.

## Context

#839 shipped both halves of the clamp except the one that touches the DOM:

- `composerOptionsShiftPx({ anchorLeft, panelWidth, windowWidth })` — a total function of three numbers,
  fully unit-tested, uncalled.
- `--composer-options-shift`, read by `.composer-options`'s `left` and defaulting to `0px`, unset by anyone.

The measuring half waited for an anchor with a real x-position. #680 shipped one: `ComposerActionsMenu`
mounts `ComposerOptionsMenu` in the footer, so `anchorRef.current.getBoundingClientRect()` finally returns
something. This ticket joins the two.

**It lands in the container, not in the consumer.** `ComposerOptionsMenu` owns `anchorRef` and `panelRef`
privately and exposes no `style` prop, so a consumer *cannot* set the custom property from outside even if
it wanted to. Wiring it once here is what stops #680, #682, #683 and #694 each re-deriving it — and is AC4
verbatim.

## Design

One module-scope alias and one effect, both inside `ComposerOptionsMenu` in
`src/renderer/src/screens/conversation/ComposerOptionsPanel.tsx`. Nothing else in `src/` changes.

### The layout effect

The effect gates on `open`, measures, writes, and subscribes to `resize`:

```
useComposerOptionsLayoutEffect(() => {
  if (!open) return
  // anchorRef.current and panelRef.current are both attached — React sets refs before layout effects,
  // and the panel mounts in the same commit that flips `open`. Optional-chain anyway, the focus
  // effect's posture: a missing node is a no-op, never a throw.
  // apply(): setProperty('--composer-options-shift', `${composerOptionsShiftPx({…})}px`) on the anchor.
  // Call apply() once, then window.addEventListener('resize', apply); cleanup removes the listener.
}, [open])
```

The three measurements are exactly the ones `composerOptionsPlacement.ts:26-28` names, and the argument is
built with the named fields so the transposition `panelWidth` ↔ `windowWidth` is impossible by inspection:

| Field | Source |
|---|---|
| `anchorLeft` | `anchorRef.current.getBoundingClientRect().left` |
| `panelWidth` | `panelRef.current.offsetWidth` |
| `windowWidth` | `window.innerWidth` |

**Deps are `[open]` and nothing else.** Not `focusedIndex` (changes on every arrow key, changes no
measurement). Not `options` — a consumer building its array inline would hand a fresh reference every
render, churning an add/remove listener pair per render for a re-measure nothing has asked for. Every
shipped and queued consumer's option list is fixed for the lifetime of one opening; re-measuring on a
content change is a future concern with no observed failure.

**The unit is not optional.** `` `${shift}px` ``, never the bare number. A unitless value makes the whole
`left` declaration invalid at computed-value time; the panel falls to `left: auto` and its static position,
which for an abs-positioned child of a flex container is the anchor's content-box start — 12px *right* of
resting, i.e. further into the overflow. The e2e in § Testing catches exactly this, by construction.

**Idempotence.** The panel is `position: absolute`, so shifting it moves neither the anchor (out-of-flow
children are not flex items) nor its own `max-content` width, and `window.innerWidth` is independent of
both. Every input is therefore invariant under the shift, so the `resize` re-read converges instead of
walking the panel left. This is #839's stated reason for naming `anchorLeft` rather than the panel's own
measured left — keep the inputs the ones the function names, and do not "improve" them.

**No cleanup of the property on close.** The listener is removed; the property is left set. The anchor is
the container's own private `<div>`, the panel that inherits the value is unmounted, and the next open
recomputes before paint — so a stale value is inherited by nothing and displayed never. Removing it would
be a second statement defending an unobservable state.

### The layout effect must be aliased, not raw

⭐ **This is the one place a literal reading of the ticket body breaks `npm test`.**

`ComposerOptionsMenu` is server-rendered under `renderToStaticMarkup` in three test files —
`ComposerOptionsPanel.test.tsx`, `ComposerActionsMenu.test.tsx`, and every one of the ~33
`<ConversationScreen` sites in `ConversationScreen.test.tsx`, which now reach it through
`ComposerActionsMenu`. React 18 logs *"useLayoutEffect does nothing on the server"* once per render site, so
a raw `useLayoutEffect` here adds ~40 lines of warning noise to every `npm test` run. That is the exact cost
`ConversationScreen.tsx:387-394` already measured and already solved:

```
const useComposerOptionsLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect
```

Module scope, immediately after the imports, mirroring the sibling's placement and its `typeof document`
guard verbatim. The name is feature-scoped the way `useThreadLayoutEffect` is.

**The alias does not weaken the pre-paint guarantee**, which is the whole point of the ticket's
`useLayoutEffect` requirement: in the window `document` exists, so it *is* `useLayoutEffect` and the panel
never paints unclamped. In vitest neither hook runs under `renderToStaticMarkup`, so the branch changes no
behaviour anywhere it could be observed. Restate that reasoning in the comment — a reviewer meeting
`useEffect` on one branch of a paint-critical effect will otherwise read it as a mistake.

**Duplicate the one-liner; do not extract it to a shared module.** That would mean editing
`ConversationScreen.tsx`, a ~2700-line declared merge hot-spot, to refactor code this ticket does not
otherwise touch. A third consumer is the moment to lift it out — the same "one consumer is not a pattern"
call `conversation.css:1626-1628` makes about the footer-button styles.

### Imperative, not declarative

Write the property with `anchor.style.setProperty('--composer-options-shift', …)`. Do **not** hoist the
shift into `useState` and pass a `style` prop on the anchor, notwithstanding the sketch at
`composerOptionsPlacement.ts:20-22` (which shows the *shape* of the CSS hook, not the mechanism — its own
next paragraph says "write the result onto the anchor's `--composer-options-shift`" in a layout effect).

Four reasons, in order of weight:

1. **An existing shipped test already forbids the declarative form.**
   `ComposerOptionsPanel.test.tsx:229` asserts `'<div class="composer-options-anchor">'` — the complete
   opening tag. A `style` prop appends `style="--composer-options-shift:0px"` and fails it. That assertion
   is the deterministic detector for this decision, which is why this spec does not add a new one.
2. No re-render on resize. A `useState` shift re-renders the whole menu subtree per resize event to write a
   value the DOM can hold directly.
3. No `as CSSProperties` cast. TypeScript's `CSSProperties` has no index signature for custom properties, so
   the declarative form needs the cast the sketch shows; `setProperty` takes a string key natively.
4. A `useState` copy is a second source of truth for a value the anchor already holds.

`ComposerOptionsPanel.test.tsx:229`'s *comment* does need one line corrected — it currently reads "wiring
the clamp belongs to #680". The clamp now lives in the container; the assertion's meaning becomes "the
property is written imperatively, so the resting markup is unchanged". Correct the comment, keep the
assertion.

### Placement in the file

Put the new effect **before** the focus `useEffect`, so the file reads paint-then-focus in the order the two
actually run. Its comment should name the difference explicitly: the focus effect is passive because focus
is not a paint concern; this one is a paint concern, and the alias is how it gets to be one without the
server-render noise.

### Not in scope, restated because the temptation is real

- `composerOptionsShiftPx` is not touched. Its single `Math.max`, its absent left clamp, its absent
  rounding, and its use of the window's right edge rather than the chat pane's are all reasoned out in
  place. A case that appears to need different arithmetic is **a finding to report on the issue**, not an
  edit here.
- `offsetWidth` rounds to an integer while the rect is fractional, so the computed shift can be off by up to
  half a pixel. That is #839's chosen input, named twice in its recipe; do not swap in
  `getBoundingClientRect().width`. The e2e tolerance below absorbs it.
- No left clamp, no `Math.min`, no second branch.

## State + concurrency model

No store, no async, no IPC. `ComposerOptionsMenu`'s state stays exactly what #840 gave it: `open` and
`focusedIndex` in component-local `useState`, three refs. The clamp reads the DOM and writes one custom
property on a node the component owns; it introduces no React state and no store slice.

The `resize` listener is the second document/window-level listener in this component and copies the first's
lifecycle verbatim: attached only while `open`, removed by the effect's cleanup on close **and** on unmount,
so no listener outlives an open menu. It is the first `resize` listener in `src/` — there is no other idiom
in the repo to match. The handler takes no event argument, so it needs no `WindowEventMap` read (the reason
the `mousedown` listener has one does not arise).

## Error handling

There is no failure mode to surface. Every input is a plain property read that cannot throw; a detached ref
is a no-op via optional chaining; a zero-width panel yields a shift of `0`, which
`composerOptionsPlacement.ts:96-99` already covers as a consequence of the arithmetic rather than a branch.
No result type, no banner, no log, no guard.

## Testing strategy

### Unit (`npm test`) — none, and that is the finding

Not one line of this ticket is executable under vitest: `environment: 'node'`, no jsdom, no layout, no
`getBoundingClientRect`, and effects do not run under `renderToStaticMarkup`. The arithmetic already has
complete unit coverage in `composerOptionsPlacement.test.ts` and this ticket adds nothing to it. The only
unit-tier change is the one-line comment correction at `ComposerOptionsPanel.test.tsx:229` described above.

The existing static assertions are not decoration here — they are this ticket's regression net for the
implementation shape, since the anchor's server markup must come out byte-identical.

### e2e (`npm run e2e`) — the whole proof

**Path decision.** The ticket offers two ways to obtain an overflow and leaves the choice here. **Take
path 1: build the overflow in the spec's own rig.** Path 2 parks a finished-by-inspection change behind
#561 / pyrycode#1646 / pyrycode#1687 — daemon work with no near-term date — and then hands the overflow to
whichever of #682/#683 lands first, which is precisely the "four consumers each re-derive it" outcome this
ticket exists to prevent. Path 1 costs one spec with a documented, restored rig.

**What the rig is honest about.** It drives the window to a width a user cannot reach (the app floors at
800). That is sound because the clamp is geometry-independent — it does not care *why* the panel overflows —
and because the arithmetic is already pinned at legal widths at the unit tier. What this spec proves is the
**wiring**: that three measured values reach the function, that the result reaches the custom property *with
a unit*, and that `resize` re-runs it in both directions. Say that in the spec's header comment.

**Why an overflow needs the rig at all.** The footer holds exactly one control and it is the leftmost; the
sidebar never shrinks, so the anchor's left edge is x≈468 at every window width. The panel's longest label
(`Knowledge capture`, body-small + 24px row padding) puts its resting right edge near 586 — over 200px
inside the narrowest window the app permits.

New file: **`e2e/composer-options-clamp.spec.ts`**. Its own file rather than an addition to
`composer-actions.spec.ts`: the clamp is the *shared* container's property and Actions is merely the only
host that exists, so this is the file #682 and #683 extend later. One `test()` block, one launch, one
continuous drive — the `paired-shell-navigation.spec.ts` shape, and each launch pays a full handshake.

Scenarios, as one drive:

- **Open at the launch width (1100) and read the resting position.** Assert the panel's left edge sits
  exactly `COMPOSER_OPTIONS_LABEL_INSET_PX` left of the anchor's — i.e. a shift of 0. **AC2.**
- **Lift the floor and narrow.** Through `app.evaluate`: read `getMinimumSize()`, call `setMinimumSize` with
  a width below the target (keep the height as read — pass a small positive width rather than `0`, whose
  meaning varies by platform), then `setSize(520, height)`. 520 leaves the pane 60px and puts the window
  edge ~66px inside the panel's resting right edge. The panel stays open throughout: nothing here generates
  a `mousedown`, and `src/` holds no other `resize` listener that could remount the screen.
- **Assert the clamp.** The panel's right edge lands on the window's right edge, and it has genuinely moved
  (its left edge is now left of `anchorLeft − 12`). **AC1.** This same assertion is the unit detector: a
  unitless value drops the panel to its static position at `anchorLeft`, right edge ≈598 > innerWidth, and
  it fails here.
- **Widen back to 900 and assert the shift is released** — the panel returns to `anchorLeft − 12`. **AC3's
  second direction**, the one a one-way drive would miss. Widen to 900 rather than back to 1100: the drive
  only ever narrows relative to launch, so a small CI display cannot clamp the `setSize` and fail for a
  reason unrelated to the clamp (`paired-shell-navigation.spec.ts:34-38`'s reasoning).
- **Restore `setMinimumSize` to the value read at the start.** The floor is a shipped constraint and this
  spec only borrows it. (Each test launches its own app, so a mid-drive failure strands nothing — the
  restore is intent, made explicit.)

Mechanics the developer should not have to re-derive:

- **Every geometry read after a `setSize` polls.** `setSize` resolves in the main process before the
  renderer has laid out the new viewport; `expect.poll` is the sibling spec's answer and the reason its
  `boundingBox()` helpers use a `?? -1` sentinel rather than throwing on a detached node.
- **Compare against the page's own `window.innerWidth`**, read via `page.evaluate`, never against the number
  passed to `setSize` — that is the outer size, and the relationship to the inner width is platform chrome.
- **Poll a single rounded scalar per checkpoint** rather than two bounds: e.g. poll
  `Math.round(panelRight − innerWidth)` and expect `0`. Rounding absorbs the sub-pixel drift from
  `offsetWidth`'s integer rounding and fractional layout, and the failure message still reports the real
  pixel gap. Two separate bound assertions would let the second one settle on a stale frame.
- **Import `COMPOSER_OPTIONS_LABEL_INSET_PX`** from `composerOptionsPlacement.ts` rather than writing `12`.
  This is not the load-bearing-locator rule (`composer-actions.spec.ts:34-38`), which duplicates *strings*
  on purpose so a reword breaks the spec; the inset is one quantity #839 documents as coupled across three
  files, and importing keeps that honest. `composerOptionsPlacement.ts` is React-free, so the import is safe
  in a Playwright spec — `composer-actions.spec.ts` already imports from `src/main/transport/codec`.
- Reuse `composer-actions.spec.ts:44-47`'s locators verbatim, `exact: true` included: a non-exact `Actions`
  also matches the thread's `More actions` trigger and trips Playwright's strict mode.
- Secret hygiene, per every sibling: assertions read geometry and roles only; nothing serialises a token,
  key, or plaintext.

### What has no detector, deliberately

- **`useLayoutEffect` over `useEffect`.** No tier can observe it — Playwright measures after paint and reads
  the panel as clamped under either, and catching the single unclamped frame is a race, not an assertion. It
  carries no AC and stands as a **review-enforced note**, exactly as the ticket states.
- **The property is written on the anchor rather than on the panel.** Both work, because
  `.composer-options` reads the `var()` itself and inheritance carries it down either way — so geometry
  cannot distinguish them. The anchor is what #839 specified and what `conversation.css:3431-3434`
  documents, for a reason (it keeps the panel's four-prop surface closed to four queued consumers). Also
  review-enforced.
- **AC4 — "applied inside the shared container".** Structural, and proved by the shape rather than by an
  assertion: `ComposerActionsMenu` passes no placement prop, `ComposerOptionsMenu`'s prop list is unchanged,
  and the e2e drives the clamp through that unchanged consumer.

## Acceptance criteria → detector

| AC | Detector |
|---|---|
| 1. An overflowing panel is pulled left by exactly its overflow | `e2e/composer-options-clamp.spec.ts`, the narrowed checkpoint |
| 2. A panel that already fits is not moved | same spec, the launch-width checkpoint |
| 3. Recomputed on resize, in both directions | same spec, the narrow → widen pair |
| 4. Applied inside the shared container | structural — no prop added, no consumer change; the e2e drives it through the unmodified `ComposerActionsMenu` |

## Open questions

1. **Does 520px hold as the narrow width on every platform's CI runner?** The derivation (anchor at 468,
   panel ≈130 wide) is measured off the current tree; if the panel's longest label changes, the target
   should move with it. The assertion is written against the *measured* `innerWidth` and anchor rect rather
   than against literals, so a drift shows up as a clean failure rather than a silent pass. If the pane at
   60px turns out to render something the drive trips over, narrow further — the clamp holds at any width,
   and even a 0-width pane leaves the anchor at 468.
2. **Should the alias be shared with `ConversationScreen.tsx` now rather than duplicated?** This spec says
   no — one duplicated line beats editing a 2700-line merge hot-spot for a refactor this ticket does not
   need. Flagged because the next consumer makes it three copies, and three is the threshold this codebase
   uses elsewhere.
