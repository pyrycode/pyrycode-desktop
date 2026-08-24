# #718 — Relay and host connection dots on the sidebar host row

**Size:** S · **Label:** `enhancement` (not `security-sensitive` — pure render, downstream of #328's transport
and #329's store, matching the unlabelled #329/#330/#710 precedent).

Split from #672. The initial not-yet-known relay state is **#719** and is out of scope here.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-4 — host row `106:3094`.

The row is a single 28px-tall flex line: the 12px server-rack glyph at the left inset, the machine's name
beside it, and — pushed to the trailing edge — two 6px circles sitting 6px apart, the **host** leg's dot
first (`110:3499`) and the **relay** leg's second (`106:3114`). The dots carry no text and no border; they
are pure colour chips. The existing `.channel-list__host` row already draws the glyph and the label, so the
whole visual delta of this slice is the trailing dot pair.

**What does NOT transfer from the design.** Two things, both deliberate:

1. **The absolute x coordinates.** `get_metadata` returns a **360**-wide design row; the shipped sidebar is
   **400** (CLAUDE.md). `x=341` / `x=353` are therefore not implementable literals, and read literally the
   trailing dot's right edge lands at 359-in-360 — a **1px** trailing inset, which contradicts the 16px
   right inset `channels.css` uses and that #703's comment explicitly preserves ("The right inset stays
   16px, so the row's trailing edge lines up with the host row's"). Take the **relative** geometry only:
   6px diameter, 6px gap, host leg first, inside the row's existing 16px inset. (The left edge does
   transfer — the glyph frame at `x=16` matches the shipped left padding. Left transfers, right does not,
   in the same frame.)
2. **The palette.** Both dot instances resolve `Schemes/Success` (#2fc038) and `Schemes/Inverse Primary`
   (#32628d) and the file carries **no red** — it locked 2026-05-08, before the two-dot indicator existed.
   Use #330's shipped `up → --color-success` / `in-progress → --color-warning` / `down → --color-error`
   contract, the precedent #330 already set for this exact gap. The mismatch is flagged to the operator
   separately and is not this ticket's to resolve.

---

## Files to read first

Codegraph is wired for this repo but **not indexed** (`.codegraph/` holds config only, no DB); every
`codegraph_*` call returns "CodeGraph not initialized". This list was built by grep + Read instead.

| Path | What to extract |
|---|---|
| `src/renderer/src/screens/channels/ChannelList.tsx:238-288` | `HOST_ROW_LABEL` + `HostRow` — the row this slice extends, and the comment block recording why it has no trailing element and why `#672` was told to add one here. |
| `src/renderer/src/screens/channels/ChannelList.tsx:39-105` | The container/pure-view split (`ChannelList` reads stores → `ChannelListView` renders). Read the doc comment: this slice deliberately deviates from it (§ Design D5). |
| `src/renderer/src/screens/channels/ChannelList.tsx:426-517` | `renderBody` — where `HostRow` is rendered **twice**, once per tree, both inside the `length > 0` gate. Its 5 positional args are why the legs are not prop-drilled. |
| `src/renderer/src/screens/conversation/ConversationScreen.tsx:2109-2200` | The whole of #330: `LegCategory`, `ConnectionLeg`, `relayLeg`, `daemonLeg`, `ConnectionStatusIndicator`, `ConnectionStatusIndicatorControl`. The three symbols this slice imports, and the leaf-control posture it copies. Note `ConnectionStatusIndicator(relay, daemon)` — relay first, the **reverse** of the design's order. |
| `src/renderer/src/screens/conversation/conversation.css:1359-1396` | `.conn-dot` (8px, do **not** wear) vs `.conn-dot--up/--in-progress/--down` (`background` only — the colour contract this slice reuses in place). |
| `src/renderer/src/screens/channels/channels.css:46-74` | `.channel-list__host` / `__host-icon` / `__host-label` — the flex row (`gap: var(--space-3)`, `padding: var(--space-1) var(--space-4)`) that gains the dots, and the icon rule the dot rule mirrors. |
| `src/renderer/src/screens/channels/channels.css:76-146` | #703/#704's workspace row — how an off-scale design measurement is reasoned about (the 10px→12px tie-break) and how the 16px right inset is treated as load-bearing. |
| `src/renderer/src/screens/channels/ChannelList.test.tsx:1-120` | The `renderToStaticMarkup(<ChannelListView …/>)` harness, `countOf`, and the **exact attribute-value substring** marker idiom (`HOST_ROW_MARKER` and the line 62-65 comment explaining why the closing quote matters). § Testing's landmine is about exactly this. |
| `src/renderer/src/store/relayLinkStore.ts:36-61` | `initialRelayLinkState = { status: null }`, `useRelayLinkStore`, `selectRelayLinkStatus` — the relay leg's read surface. |
| `src/renderer/src/store/sessionStore.ts:16-23, 139-142, 170-176` | `ConnectionStatus` union, `initialSessionState.status = { type: 'disconnected' }`, `useSessionStore`, `selectStatus` — the host leg's read surface and the initial value the server-render tests will see. |
| `src/renderer/src/theme/tokens.css:39-45, 100-119` | `--color-success` / `--color-warning` / `--color-error`, the 4px `--space-*` scale (no 6px slot), `--radius-full`. |
| `CLAUDE.md` § Conventions, § Don't | Unidirectional state; sealed event shapes; "don't refactor adjacent code while you are there". Both rejected alternatives in § Design lose to that last one. |

---

## Context

The sidebar's host row (#710) currently shows a server glyph and the machine's name. The design ends it
with two connection dots. Both underlying values, **and the mapping that turns them into a display state**,
already exist in the renderer: #329 shipped `relayLinkStore`, #330 shipped `relayLeg` / `daemonLeg` /
`LegCategory` / `ConnectionLeg` plus a category → colour contract, rendering the pair as two *labelled*
dots on the conversation status row.

So this slice is **a second presentation of an existing mapping**, not a new indicator. Nothing crosses
IPC, no wire type moves, no store is added. The single thing worth designing carefully is the reuse seam —
because the contract exists at **two levels** (a TypeScript mapping and a CSS token binding) and AC2's
"not a second copy of it" has to hold at both, not just the one that is easy to see.

---

## Design

Everything lands in `src/renderer/src/screens/channels/` except one comment-only edit.

### D1 — Reuse the TS mapping by cross-screen import

`ChannelList.tsx` imports three symbols from `../conversation/ConversationScreen`:

```ts
import { relayLeg, daemonLeg, type ConnectionLeg } from '../conversation/ConversationScreen'
```

Cross-screen import is the established idiom here — four existing sites do it
(`archive/ArchiveScreen.tsx`, `conversation/WorkspacePickerSheet.tsx`, `conversation/ConversationScreen.tsx`
→ `channels/channelListViewModel`; `settings/DefaultWorkspaceRow.tsx` imports a *component* out of
`conversation/`).

**Rejected: lifting the three symbols into a shared module first.** It takes the diff from four files to
seven for no behaviour change, and CLAUDE.md forbids refactoring adjacent code in passing. If a third
consumer ever appears, that is the ticket to do it in.

**No import cycle.** `ConversationScreen.tsx` imports only `channels/channelListViewModel` (which imports
one `@shared` type) and `channels/RenameConversationDialog` (two `@shared` types). Neither reaches back to
`ChannelList.tsx`, so `ChannelList → ConversationScreen → {viewModel, RenameDialog}` is a DAG. Verified by
reading the import headers of both.

### D2 — Reuse the CSS colour contract in place, by wearing the modifier without its base

#330 already separated colour from geometry into different classes: `.conn-dot` sets the status row's
**8px** box, and `.conn-dot--up` / `--in-progress` / `--down` set `background` and nothing else. That
decomposition *is* the seam this ticket needs. The sidebar dot therefore wears:

```
class="channel-list__host-dot conn-dot--<category>"
```

`.channel-list__host-dot` (new, in `channels.css`) carries the 6px geometry; the `.conn-dot--*` modifier
carries the colour. The 8px `.conn-dot` base is deliberately **not** worn. There is exactly one copy of the
category → token binding in the renderer after this slice, and `grep -rn "color-success" src/renderer
--include='*.css'` proves it in one call.

This is a modifier without its base class, which reads as a mistake unless the CSS says otherwise — so the
new rule's comment must state that the colour comes from `.conn-dot--*` in `conversation.css` and must not
be re-declared here.

**The dependency is module-graph-enforced, not incidental.** `ConversationScreen.tsx:13` is
`import './conversation.css'`, so D1's import means any module graph containing `ChannelList.tsx` also
contains `conversation.css`. (The renderer has no `React.lazy`, no `Suspense` and no dynamic import, so it
is one CSS bundle regardless — but the import makes it true by construction rather than by coincidence.)

**Rejected: lifting `.conn-dot--*` into a shared stylesheet.** Correct in the abstract — extract the three
rules to e.g. `theme/connection.css` and `@import` it from `index.css`, which already `@import`s
`theme/tokens.css`. But it takes the diff from four files to six, edits another screen's stylesheet to move
working code, and puts component classes in `theme/`, which today holds design tokens only. This is the
same three-files-to-six arithmetic the ticket body uses to reject lifting the TS symbols; rejecting both
keeps the two halves of the same decision consistent.

**One defensive edit follows from rejecting it.** The ticket body records that removing the conversation
status row's indicator is a live operator decision (and #679 is separately rebuilding a footer status row).
If that happens, `.conn-dot--*` is the natural thing to delete alongside it — and the sidebar's dots would
go transparent **silently**, because vitest runs `environment: 'node'` and asserts markup, never computed
colour. So add a comment (no rule change) above `.conn-dot--up` in `conversation.css` naming the sidebar
host row as a second consumer. Comment only: this file's rules are not touched.

### D3 — The accessible name is `leg.label`, verbatim

`ConnectionLeg.label` is already "leg name + status word" built from client-owned constants — exactly what
AC3 asks for. The dot's accessible name is that string unchanged: `"Pyrycode Connected"`, `"Pyrycode
Connecting"`, `"Pyrycode Offline"`, `"Relay Connected"`, `"Relay Reachable"`, `"Relay Offline"`.

The ticket asks for a deliberate choice among three names for the host leg — "Host" (Figma), "Server"
(#710's visible label), "Pyrycode" (#330's shipped label). **"Pyrycode" wins**, on three grounds:

- Any other word re-derives the label half of the contract, which is a second copy in the same sense AC2
  forbids — just of the string rather than the category.
- It is the more precise word for what this dot actually reports. The leg is `daemonLeg`, the *pyry daemon
  session*; "Server"/"Host" name the *machine*. A machine can be up while the daemon is not, and this dot
  goes red in that case.
- "Host" is a Figma layer name, not user copy, and #710 already declined it for the visible label.

The visible row label stays "Server" (#710) and is untouched. AC3's "no daemon-supplied text reaches that
name" holds by construction: every arm of both mappings returns a module-level literal, and #330 pins the
`error` arm against a `DAEMON_SECRET` message at `ConversationScreen.test.tsx:1870-1873`.

### D4 — Leg order is the design's, not the shipped call site's

Host/daemon dot **first**, relay dot **second** (Figma: `110:3499` at x=341 precedes `106:3114` at x=353).
`ConnectionStatusIndicator(relay, daemon)` takes them the other way round; a developer copying that call
site swaps the legs silently and no type catches it, because both props are `ConnectionLeg`. This must be
pinned by a test.

### D5 — A store-bound leaf, not two more props through `renderBody`

Two new components in `ChannelList.tsx`:

- `HostConnectionDots({ host, relay }: { host: ConnectionLeg; relay: ConnectionLeg }): JSX.Element` —
  **exported** pure view. Renders the wrapper and the two dots, host first. Props in, markup out; no store,
  no `window.pyry`, no effects. Exported for the same reason `ConnectionStatusIndicator` and
  `CollapsibleWorkspaceGroup` are: it is the only seam through which the unit tier reaches the full
  category × label matrix.
- `HostConnectionDotsControl(): JSX.Element` — module-local store-bound container. Reads both stores with
  the shipped narrow selectors and passes the mapped legs down:
  `useSessionStore(selectStatus)` → `daemonLeg(…)` → `host`; `useRelayLinkStore(selectRelayLinkStatus)` →
  `relayLeg(…)` → `relay`. This is `ConnectionStatusIndicatorControl`'s body with the two props reordered.

`HostRow` renders `<HostConnectionDotsControl />` as its last child.

**Why a leaf rather than lifting the reads to `ChannelList`.** Two reasons, one of which is behavioural:

1. A relay flap must not re-render the conversation list. Lifting the reads to the container couples every
   row in the sidebar to both legs' state; the leaf keeps the re-render to the four dots. #330's control
   exists for precisely this ("The two narrow selectors re-render this control only on its own leg's
   change").
2. `HostRow` is rendered from `renderBody`, a plain function already taking five positional arguments.
   Threading two more through `ChannelListView` → `renderBody` → `HostRow` grows that signature to seven
   for a value neither intermediate uses.

**State the cost honestly:** `ChannelListView` stops being strictly pure — its subtree now reads two
singletons. That is a real deviation from this file's own doc comment ("the container reads the slice, the
pure `ChannelListView` renders it"), and the developer should record it in the `HostConnectionDotsControl`
comment. It is safe under the existing harness: `ConversationScreen.test.tsx:2322+` server-renders the
container holding the identical leaf, so zustand's `useStore` is proven to work under
`renderToStaticMarkup` in this repo. Under the existing `ChannelList.test.tsx` harness the singletons hold
their initial values — relay `null` → `down`/"Relay Offline", session `{ type: 'disconnected' }` →
`down`/"Pyrycode Offline" — which is deterministic, and nothing in that file mutates either singleton.

### D6 — DOM shape

```
<span class="channel-list__host-status">           ← layout only: no role, no aria-label
  <span class="channel-list__host-dot conn-dot--down" role="img" aria-label="Pyrycode Offline"></span>
  <span class="channel-list__host-dot conn-dot--down" role="img" aria-label="Relay Offline"></span>
</span>
```

- `role="img"` is the ARIA-in-HTML-legal host for `aria-label` on a non-interactive element — a bare
  `<span>`'s `aria-label` is ignored by the accessible-name computation, so the dot would silently have no
  name and AC3 would pass review while failing in a screen reader. Not `role="status"`: that is a live
  region, and #330 deliberately declined one here ("the banner already politely announces disconnects").
- The wrapper is **not** `role="group" aria-label="Connection status"` (#330's shape). The host row renders
  twice, and under #670's two-pane layout the conversation status row is on screen at the same time — that
  would put three identically-named groups in one window. AC3 asks for a name per dot, not per group.
- Both `channel-list__host-status` and `channel-list__host-dot` extend the existing `__host-*` family with a
  `-`, so neither joins the `class="channel-list__host"` exact-substring marker's match set (the closing
  quote is the guard; `ChannelList.test.tsx:62-65` documents it).
- The dots carry no text node — AC4.

### D7 — Geometry

Two new rules in `channels.css`:

- `.channel-list__host-status` — `margin-left: auto` (the right-push; `.channel-list__host` has no trailing
  element today and the row's `gap: var(--space-3)` alone would leave the dots beside the label),
  `display: flex`, `align-items: center`, `gap: 6px`, `flex: 0 0 auto`.
- `.channel-list__host-dot` — `width: 6px`, `height: 6px`, `flex: 0 0 auto`,
  `border-radius: var(--radius-full)`. No `background`: that is `.conn-dot--*`'s job (D2).

**Both 6px values are literals, not tokens** — structural component geometry, the `.conn-dot { width: 8px }`
precedent and its "not off a spacing token" comment. For the gap this is load-bearing rather than stylistic:
the design's 12px dot pitch is 6px diameter + 6px gap, so the gap must *equal* the diameter; 6px sits
exactly between `--space-1` (4px) and `--space-2` (8px) with no tie-break available, and either choice
breaks the relationship. (Contrast #703's 10px→12px gap tie-break, where the measurement was independent.)

**No wrapper element for the design's 6×14 dot frame.** `align-items: center` on the existing row centres
the 6px dot against the label's 20px line box, reproducing the instance frame exactly as #703 reproduced
the `Row icon` wrapper (`106:3110`) without an element.

`.channel-list__host-label` has no `flex: 1 1 auto`, so it stays its natural width and `margin-left: auto`
pushes the pair to the right inset. `HOST_ROW_LABEL` is a six-character compile-time constant and cannot
overflow the 400px sidebar; when #688 swaps in an operator-typed label, that ticket owns giving the label
`flex: 1 1 auto` + the ellipsize quartet so a long name shrinks instead of pushing the dots out.

---

## State + concurrency model

No new store, no new slice, no new action, no IPC message, no wire type. Two existing read-only surfaces
are read from one more place:

- `relayLinkStore` — `RelayLinkStatus | null`, written only by #328's subscription wiring.
- `sessionStore` — `ConnectionStatus`, written only by `dispatch`.

Both are read through the shipped narrow selectors, so `HostConnectionDotsControl` re-renders only when its
own leg changes. The legs are read **independently and never cross-referenced** (AC2) — that property comes
free from importing `relayLeg` and `daemonLeg` unchanged, each of which takes one status and returns one
leg. "Relay up, host down" renders as exactly that, and there is no code path in this slice that could make
it not.

Unidirectional: components read and render. Nothing here dispatches, and there is no local state at all —
the dots are a pure projection of two store slices. No effects, no subscriptions, no `AbortController`, no
teardown: nothing to cancel.

---

## Error handling

There is no failure mode to introduce. This slice adds no I/O, no parsing and no async work; the "errors"
it displays are already-mapped store states, and both mappings are total over their input unions with an
explicit return type and no `default` arm (so a future `RelayLinkStatus` or `ConnectionStatus` member trips
TS2366 at `npm run typecheck` in `ConversationScreen.tsx` — the existing guard, which this slice inherits
rather than duplicates).

The one hazard worth naming is **silent** rather than thrown: if `.conn-dot--*` ever leaves
`conversation.css`, the dots render at 6px with no `background` and become invisible. `npm test` cannot see
it (node environment, markup assertions), and the Playwright tier asserts no colour. The D2 comment in
`conversation.css` is the mitigation, and it is the appropriate weight — the failure requires someone to
delete a rule whose comment says not to.

Not surfaced anywhere: no banner, no dialog, no log line. The dots *are* the surface, and the failure-only
`ConnectionBanner` (#279) already owns the loud path.

---

## Testing strategy

All new coverage is unit (`npm test`, vitest, `environment: 'node'`, `renderToStaticMarkup`), in
`src/renderer/src/screens/channels/ChannelList.test.tsx`. Test-first, per CLAUDE.md.

**⚠ Marker landmine — read before writing the first assertion.** The dot emits
`class="channel-list__host-dot conn-dot--down"`. This file's established idiom is the *exact* attribute-value
substring with its closing quote (`HOST_ROW_MARKER = 'class="channel-list__host"'`), and that idiom
**silently returns zero here** because the closing quote follows the *last* class, not the first. Assert the
**full** attribute value per category (`'class="channel-list__host-dot conn-dot--up"'`) — which is better
than a workaround anyway, since one marker then pins the geometry class and the colour binding together.

Pure-view scenarios, server-rendering the exported `HostConnectionDots` with injected legs:

- Each of the three `LegCategory` values renders its matching full class attribute — `up` → `conn-dot--up`,
  `in-progress` → `conn-dot--in-progress`, `down` → `conn-dot--down`. Three cases, one per category, so the
  binding is pinned rather than sampled.
- **Order (D4):** given two legs whose labels differ, the **host** leg's dot appears before the relay leg's
  in the markup. Assert by comparing `indexOf` of the two `aria-label` values — the assertion that catches a
  developer copying `ConnectionStatusIndicator`'s reversed argument order.
- Each dot carries `role="img"` and an `aria-label` equal to its injected `leg.label` (AC3).
- **No visible text (AC4):** the rendered markup of the pair contains no text node — assert that stripping
  every tag from `HostConnectionDots`'s markup leaves the empty string. Document-wide "no text" would be
  wrong; this is scoped to the pair's own render.
- The two legs are independent: injecting `up` for one and `down` for the other renders one of each, in the
  right positions.

Container scenarios, through the existing `render(...)` helper on `ChannelListView`:

- With both trees populated, the markup holds **four** dots (two host rows × two legs) and exactly two
  `channel-list__host-status` wrappers; with one tree populated, two dots and one wrapper.
- The dots' accessible names in that render are the initial-state labels — `"Pyrycode Offline"` and
  `"Relay Offline"` — which doubles as the regression guard on D5's "the singletons hydrate to their initial
  values under `renderToStaticMarkup`" claim. Read them out of the markup rather than restating the
  constant, the `hostLabelsIn` treatment.
- **Regression:** `countOf(markup, HOST_ROW_MARKER)` is still 2, and `HOST_ICON_MARKER` still 2 — the new
  `__host-status` / `__host-dot` classes must not join that marker's match set. The existing assertions at
  `ChannelList.test.tsx:271-272` cover this; confirm they still pass rather than adding new ones.
- The dots render **inside** the host row: `indexOf(HOST_ROW_MARKER) < indexOf(the first dot marker)` and the
  dots precede the next section's `ROW_MARKER`.

Type-level (`npm run typecheck`): `ConnectionLeg` is imported as a type, so a future field on it is a
compile error here rather than a silent render difference.

**Nothing under `e2e/` changes.** Verified: `grep -rn "channel-list__host" e2e/` → 0;
`getByRole('img')` / `role="img"` in `e2e/` → 0; the connection vocabulary (`Connection status`, `conn-dot`,
`conn-leg`, `Offline`, `Pyrycode Connect`) → 0 matches in any locator. The dots add no visible text, so no
`getByText` locator's match set changes, and `launchPairedApp.ts:224`'s unfiltered
`.channel-list__row-open` click — which 28 specs ride — is untouched because the new classes share no
substring with it. **If a future ticket adds a Playwright locator for a dot, it must be scoped to its tree**:
the host row renders twice, so an unscoped locator strict-violates on the pair. `npm run e2e` should be run
as a regression check and is expected to be unchanged at 40/40.

---

## Scope check

| Red line | Count | |
|---|---|---|
| New files | 0 | ✅ |
| Production `.ts`/`.tsx` files touched | **1** (`ChannelList.tsx`) | ✅ (gate: ≥5) |
| Total files touched | 4 (`ChannelList.tsx`, `channels.css`, `ChannelList.test.tsx`, + a comment-only edit in `conversation.css`) | ✅ |
| New exported symbols | 1 (`HostConnectionDots`) | ✅ |
| Consumer call sites needing simultaneous update | 0 — purely additive; `relayLeg`/`daemonLeg`/`ConnectionLeg` gain a third import site and change in no way | ✅ |
| Acceptance criteria | 4 | ✅ |
| Error/reject branches | 0 — no state machine; both mappings are imported unchanged | ✅ |
| Total written LOC (production + CSS + tests + comments) | ~150–200 | ✅ (gate: ~600) |

**File-overlap check:** `git fetch origin --prune` then a branch-wide scan of every `origin/feature/<n>`
against the five files above found **no** overlapping in-flight branch. No `blockedBy` edge needed.

---

## Open questions

1. **Two surfaces, one window.** After this slice the same two legs render twice under #670's two-pane
   layout — as label-less dots in the sidebar and as labelled dots on the conversation status row.
   Removal is explicitly out of scope and is an operator decision (#679 is separately rebuilding a footer
   status row). Named here so code-review does not read the duplication as an oversight.
2. **The design's palette carries no red** (#2fc038 / #32628d, file locked before the indicator existed), so
   the shipped `--color-error` down state has no design counterpart. Resolved for this ticket by following
   #330; raised to the operator separately as a design-file gap.
3. **#688** replaces `HOST_ROW_LABEL` with an operator-typed machine name. That ticket owns giving
   `.channel-list__host-label` `flex: 1 1 auto` and the ellipsize quartet so a long name shrinks rather than
   pushing the dots past the 16px right inset. Deliberately not pre-built here — a six-character constant
   cannot overflow, and defending an unobserved failure mode is the thing to defer.
4. **#719** adds the not-yet-known relay state, which needs a fourth `LegCategory` on the shared union and
   therefore changes the conversation status row too. This slice renders whatever `relayLeg` returns today
   (`null` → `down`/"Relay Offline") and adds no seam for it — `#719` will add its category to
   `LegCategory`, its arm to `relayLeg`, and its `.conn-dot--<new>` rule to `conversation.css`, and both
   surfaces pick it up with no edit here. That the sidebar needs zero changes for #719 is a consequence of
   D2, and is the check that D2 was the right seam.
