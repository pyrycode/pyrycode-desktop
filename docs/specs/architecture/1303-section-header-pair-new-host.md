# #1303 — the Channels and Chats headers show a plus that opens the pairing flow

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderBody` — emits the two bare
  `<header className="channel-list__section-header">` elements the plus goes inside; `ChannelListView`
  and `ChannelList` — the prop chain the handler is threaded down; `HostRow` — the shipped icon-button
  idiom and, in `ADD_WORKSPACE_CONTROL_LABEL` / `EDIT_HOST_CONTROL_LABEL`, the compile-time-constant
  label decision this control inherits; `WorkspaceRow` — #1178's plus glyph path and markup.
- `src/renderer/src/screens/channels/channels.css` → the head paragraph (its stacking argument names
  `.channel-list__section-header` as *unpositioned*); `.channel-list__section-header` (the 20px line and
  the 12px below it); `.channel-list__host-add` and `.channel-list__workspace-create` — the 20×20-box /
  16px-glyph geometry this control copies, minus their `opacity: 0` reveal.
- `src/renderer/src/pairedRoute.ts` → `PairedNav`, `nextPairedRoute` — the `pairServerCancelled` arm
  hard-wired to `'settings'`, and the docblocks that say so.
- `src/renderer/src/applyPairingChange.ts` → `PairingChangeDeps`, `applyPairingChange` — the
  `returnToSettings` dep name and the `cancelledPairAnotherServer` arm; the module's argued
  no-diagnostic and no-clear properties, both of which must survive.
- `src/renderer/src/PairedShell.tsx` → `PairedShellView` (`onOpenPairServer` is already a prop, passed
  to `SettingsScreen`), `PairedShell` (`pairingChangeDeps`, the `paneKey` cell and its comment asserting
  every exit lands where the pane renders `null`).
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → the `render()` harness for
  `ChannelListView`, and `SECTION_HEADER_MARKER` — a quote-anchored `class="channel-list__section-header"`
  substring count that five specs read, so the header's own class attribute must stay exactly that.
- `src/renderer/src/PairedShell.test.tsx` → its six `PairedShellView` render literals (the fan-out the
  ticket predicted; see **Design** for why this plan does not incur it).
- `src/renderer/src/pairedRoute.test.ts`, `src/renderer/src/applyPairingChange.test.ts` → the arms and
  the `NavEffect` table that pin the cancel destination today.
- `e2e/paired-shell-navigation.spec.ts` → the shipped Settings → Pair another → Cancel → Settings drive
  and its `[aria-label="Pairing code"]` hook; `e2e/sidebar-tree-geometry.spec.ts` (reads each header's
  left edge and count) and `e2e/paired-shell-card.spec.ts` (hit-tests the header's *centre*) — the two
  specs AC5 requires to pass unedited.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=103-2966 —
`Sidebar header` `405:7885` (Channels), the identical component `405:7896` (Chats), plus
`I405:7885;399:1461`.

The header is a 360-wide, 20-tall row: the label-large section name at the left in
`--color-on-surface-variant` at 85% opacity — exactly what ships today — and a 16×16 "Icon Edgeless"
plus absolutely positioned at `right: 2px`, vertically centred on the line. The screenshot confirms the
glyph is painted in `--color-primary` and is drawn at rest, with no background circle, no radius and no
hover treatment; nothing else in the header moves.

## Context

Pairing a second machine is reachable only from Settings' "Pair another server" row. The drawing puts a
plus on both section headers that opens the same flow, so adding a host is one click from the sidebar.

The button itself is small. The substance is that **cancel has to learn where it came from**: today the
destination is hard-wired to Settings in two modules, because Settings was the only entry. With a second
entry the rule that covers both is the one cancel already honours — *cancel puts the operator back on
the surface they launched pairing from* — and the reducer is memoryless, so the origin must be recorded
somewhere.

No ADR is warranted: this widens one existing nav arm and adds one screen-local cell, inside decisions
ADR 0006 (screen-local ephemeral nav state) already covers.

## Design

### 1. The origin is one screen-local cell in `PairedShell`, written from the route at open time

`PairedShell` gains a `useState<PairedRoute>` cell beside `paneKey` — same scope, same ADR 0006
justification, never a store and never persisted. It is written in the container's `onOpenPairServer`
binding, from **the route the reducer is currently on**:

```
onOpenPairServer: () => { setPairServerReturn(route); dispatch({ type: 'openPairServer' }) }
```

That single site serves both entries and cannot drift, because neither entry has to know its own name:
clicked from Settings the route is `'settings'`, clicked from the sidebar plus it is `'list'` or
`'thread'`. Seeded `'settings'` — the shipped destination — so the unreachable
never-opened-but-cancelled frame behaves exactly as today.

### 2. The sidebar plus reuses `onOpenPairServer`; **no new `PairedShellView` prop**

This is the one place the plan departs from the ticket's Technical Notes, which budget for a new
required `PairedShellView` prop and the six render-literal edits it forces. `PairedShellView` already
takes `onOpenPairServer` and hands it to `SettingsScreen`; it now hands the *same* prop to
`ChannelList` as well. Both callers mean exactly "open the pairing flow", and §1 makes the destination a
function of the route rather than of the caller — so a second prop would be two names for one act, with
nothing to tell them apart and every opportunity to drift. `PairedShell.test.tsx`'s six literals
therefore need no edit, and the ticket's predicted fan-out does not arise.

The prop chain that *does* grow is inside the sidebar, one hop longer than `onOpenSettings` as the
ticket says: `ChannelList` → `ChannelListView` → `renderBody` → both headers. Required at every level,
`onCreateChat`'s stated reasoning — a defaulted prop would let a future caller silently render headers
whose plus opens nothing.

### 3. `pairServerCancelled` carries its destination

`PairedNav`'s `pairServerCancelled` arm gains a `returnTo: PairedRoute` field, and `nextPairedRoute`'s
arm returns it instead of the `'settings'` literal. The reducer stays pure, total and memoryless; the
destination becomes an input rather than a constant.

`PairedRoute` and not a narrower `'list' | 'thread' | 'settings'` origin union: the narrow type would
force a total narrowing function in the container with an unreachable fallback arm — dead code needing a
test that cannot be motivated. `'pairServer'` and `'archive'` are unrepresentable *by construction*
rather than by type: the only writer is §1, which fires only from a surface that renders an entry, and
neither the pairing screen nor the archive screen renders one. Stated in the arm's comment, not guarded.

`applyPairingChange`'s `returnToSettings` dep is renamed `returnToPairingOrigin` and the container binds
it to `() => dispatch({ type: 'pairServerCancelled', returnTo: pairServerReturn })`. The arm's *shape*
is untouched: it still drives exactly one nav effect and still clears nothing.

### 4. The plus

A `<button type="button" className="channel-list__pair">` appended **inside** each `<header>`, after the
text, wrapping the 16px glyph `<svg>` — `WorkspaceRow`'s create-plus markup, whose path is the same
`399:1045` glyph, minus the `.channel-list__control-name` pill. Icon-only, so `aria-label` carries the
accessible name.

- **The name is a module-level constant, never a prop.** `HostRow`'s decision verbatim and for its
  stated reason: with no `label` field there is no slot for interpolated untrusted text to arrive in.
- **The class shares no token** with `channel-list__row`, `__row-open`, `__section-header`,
  `__workspace` or `__host`, so it joins no shipped Playwright locator's match set and no unit-tier
  attribute scan. The header's own `class` attribute is left as exactly `channel-list__section-header`.
- **Geometry, from tokens and no 2px literal** — `.channel-list__host-add`'s derivation with one number
  changed: a `--space-5` (20px) box at `right: 0`, centring a `--space-4` (16px) glyph, puts the glyph's
  right edge at 2 (the box's 4px of slack, halved). Because the header's content line is exactly 20px
  (`--text-label-large-line`), the box is `top: 0` rather than the rows' `--space-1` offset, and the
  glyph is centred on the line. Absolutely positioned, so it is out of flow and the header's own box —
  and the 32px header-to-first-host rhythm the 12px bottom padding produces — is untouched.
- **Visible at rest**: no `opacity: 0`, no reveal rule, no hover circle, no radius, no background. The
  `:focus-visible` outline stays, per the file convention.
- The header takes `position: relative` so the button pins to it rather than to the scroll column.

### 5. Prose the change falsifies, re-stated in the same commit

`channels.css`'s head paragraph rests its stacking argument on `.channel-list__section-header` being
unpositioned. Nothing breaks — the subtree is already above the card wash via `.channel-list`'s own
`position: relative`, which is what that paragraph actually establishes — but the sentence becomes false
and is re-stated. Likewise: `pairedRoute.ts`'s `PairedNav` docblock and its `pairServerCancelled` arm
comment; `applyPairingChange.ts`'s dep list, its `PairingChange` union docstring and its
`cancelledPairAnotherServer` arm comment, all of which name Settings as the only cancel destination; and
`PairedShell`'s `paneKey` comment, which asserts every exit lands on a route where the pane renders
`null` — cancel returning to a thread is exactly why that cell must keep *not* being cleared.

## State + concurrency model

One new cell, `pairServerReturn`, React `useState` in `PairedShell`. No store, no reducer slice, no IPC,
no disk, no `localStorage`. It dies with the shell on unpair, which is correct: a pairing origin has no
meaning across pairings.

No async work is added, so there is no cancellation path to define. Written and read in two ordinary
React event handlers on the renderer's single thread with no `await` between them, so there is no
check-then-act gap. `pairingChangeDeps` is already a per-render object literal and must stay one — a
module-scope or stale-dependency-memoised version would close over an old origin.

Double entry is impossible: the sidebar is unmounted on the `pairServer` route, so `openPairServer`
cannot be dispatched from the pairing screen and the cell cannot be rewritten mid-flow.

The exit bridges (`useConversationDeletedExit`, `useArchivedActiveConversationExit`) stay mounted in
`PairedShell` across the detour and dispatch `back` when the open chat disappears — which unmounts the
pairing screen along with its Cancel. So a cancel returning to `'thread'` cannot land on a conversation
that vanished while the pairing screen was up: reaching Cancel at all proves no exit fired.

## Error handling

No new failure modes: no I/O, no IPC, no parse, no permission. The click is a pure injected nav effect,
the `SettingsButton` / `ArchiveButton` shape — it dereferences no `window.pyry` and touches no store, so
`ChannelList` stays server-renderable and the neutral-first-paint invariant is untouched.

`applyPairingChange`'s argued no-diagnostic property is preserved exactly: no `console.*` is added on
any path here, and the rename is not an occasion to log the origin.

## Testing strategy

**Unit (vitest, static server render).**

- `ChannelList.test.tsx`: the new prop joins the `render()` harness; the static markup carries
  `aria-label="Pair new host"` exactly twice in every drawn state; `SECTION_HEADER_MARKER` still counts 2
  (the header's class attribute is unchanged); the new class occurs twice and is absent from the
  not-yet-loaded frame.
- `pairedRoute.test.ts`: `pairServerCancelled` lands on the route its payload names — one case per real
  origin (`settings`, `list`, `thread`), the first replacing the existing hard-wired assertion.
- `applyPairingChange.test.ts`: the `NavEffect` table and the cancel case follow the rename; the
  negative that the cancel and pair-another arms call **no** clear is kept exactly as it stands — that
  negative is what this module's test exists for.
- `PairedShell.test.tsx`: expected to need no edit (no new `PairedShellView` prop); confirmed by running
  it, not assumed.

**E2E (fake tier), one new spec, one launch, one continuous drive.** The glyph's box read against its
header's box (right edge 2px in, centred on the line); then open a thread, click a header plus, assert
`[aria-label="Pairing code"]` appears, Cancel, assert the thread is back; then Settings → "Pair another
server" → Cancel, assert Settings. Both buttons carry the same accessible name by design, so that
locator is two-match and is **indexed**, never differentiated by name. The real-daemon tier is untouched.

## Open questions

1. Does `.channel-list__section-header`'s rendered content box measure exactly 20px, making `top: 0`
   correct rather than an offset? Predicted yes (`line-height: var(--text-label-large-line)` = 20px);
   the e2e geometry read settles it.
2. Does `PairedShell.test.tsx` truly need no edit under §2? Predicted yes; the suite run settles it.

Both are resolved in Phase B and recorded under `## Revisions` if either moves the design.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, by a decision this plan makes rather than inherits. Two values are
  introduced and both are client-owned: the control's accessible name is a module-level constant inside
  `ChannelList.tsx` and deliberately **not** a prop — `HostRow`'s ruling, which exists because a `label`
  field admits a caller passing interpolated operator or daemon text into an `aria-label`, the exact
  shape #696's review made a MUST FIX; and `returnTo` is a `PairedRoute`, a closed string union whose
  only producer is `nextPairedRoute`'s own output threaded back through the container. Neither is
  daemon-asserted, neither comes off disk, and no untrusted value can reach either. This ticket adds no
  boundary and crosses none — reversing either decision would be a MUST FIX.
- **[Tokens, secrets, credentials]** No findings. The plus routes to the pairing screen; it changes
  nothing about that screen, the pairing code, the device token or its `safeStorage` handling.
  Adversarial check made explicitly: a second entry point does **not** create a second credential path,
  because `applyPairingChange`'s clear decision is untouched — `pairedAnotherServer` and
  `cancelledPairAnotherServer` still clear nothing, and the plus reaches the identical arm by the
  identical route transition. The only state this ticket creates is a route name.
- **[File / storage operations]** No findings. `pairServerReturn` is React `useState`, screen-local per
  ADR 0006 — no disk write, no `localStorage`, no IndexedDB, no IPC, no path construction anywhere in
  the diff. Nothing to traverse, nothing to make atomic, nothing to encrypt at rest.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no `ipcMain`
  channel and no `webPreferences` change. The click handler is a pure injected nav effect (the
  `SettingsButton` / `ArchiveButton` shape) and dereferences `window.pyry` nowhere — which is also what
  keeps `ChannelList` server-renderable. **A `window.pyry` dereference appearing on this path in
  Phase B would be a MUST FIX**, not a style nit: it would put a bridge call in a render-reachable
  position in the one component the sidebar always mounts.
- **[Cryptographic primitives]** Not applicable, and specifically: this ticket does not touch the Noise
  handshake, the variant constant, any key, nonce or comparison. It routes to the screen that already
  drives pairing and changes no byte of it.
- **[Network & I/O]** No findings. No socket, no fetch, no URL, no timeout to set. Worth naming as the
  mechanism rather than luck: a *second concurrent pairing attempt* is unrepresentable because
  `PairedShellView` replaces the whole shell on the `pairServer` route, so the sidebar carrying the plus
  is unmounted and `openPairServer` cannot be dispatched from the pairing screen.
- **[Error messages, logs, telemetry]** No findings, and one property to actively preserve.
  `applyPairingChange`'s docblock argues that its total absence of diagnostics "currently holds
  absolutely" and that a change label is the first crack in it. Renaming `returnToSettings` →
  `returnToPairingOrigin` must not become the occasion to log the origin. No `console.*` is added on any
  path in this diff.
- **[Concurrency]** SHOULD FIX — one concrete implementation trap, no design change. `pairingChangeDeps`
  is a per-render object literal today and **must stay one**: hoisting it to module scope, or wrapping
  it in a `useMemo` whose dependency array omits `pairServerReturn`, would close over a stale origin and
  send cancel to the wrong surface with no type error and no test reddening unless one is written for
  it. The three-origin unit cases in **Testing strategy** are what pin it. Otherwise no findings: no
  async work is added, so there is no `AbortSignal`, timer or listener to own, and the write and the
  read are two ordinary event handlers on the single renderer thread with no `await` between them.
- **[Threat model alignment]** Malicious relay, token theft from disk, hostile daemon response and
  renderer-compromise-reaching-the-transport are all unreachable from this diff: no data crosses the
  Noise session, no secret is handled, and the transport stays in the background process untouched. The
  one desktop threat this ticket genuinely moves is social: **the plus makes starting a pairing one
  click closer, which slightly widens the surface for an operator persuaded to enter an attacker's
  pairing code.** The mitigation is entirely inside the pairing screen's own flow (a typed pairing code,
  unchanged here), so this is OUT OF SCOPE and stays owned by the pairing surface; a modal presentation
  of that screen, if ever wanted, is the later ticket the issue body defers.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08

## Revisions

**2026-09-08 — Open questions resolved. Neither moved the design.**

1. **The header's content line is exactly 20px, so `top: 0` is correct** — as predicted.
   `line-height: var(--text-label-large-line)` is 20px and the rule's only padding is the 12px below,
   so a `--space-5` box at `top: 0` lands on the line and the 16px glyph centres in it. Measured rather
   than reasoned: `e2e/sidebar-pair-new-host.spec.ts` reads the glyph's box against its header's and
   pins the right edge at 2, the vertical centre at the line's centre, and the header's own box at 32.
2. **`PairedShell.test.tsx` needed one edit after all, not none** — the prediction in §2 was right about
   the *cause* and wrong about the *count*. None of its six `PairedShellView` render literals moved, as
   designed; but one case (`PairingScreen onCancel → pairServerCancelled…`) composes `nextPairedRoute`
   directly rather than rendering the view, so it needed the arm's new `returnTo`. One line, and it is
   the Settings seam that case was always about — the three-origin matrix lives in `pairedRoute.test.ts`.

**Also worth recording, since the plan asserted the opposite would be risky:** the e2e drive was
falsified before being trusted. Hardcoding `returnTo: 'settings'` in the container and rebuilding
reddened exactly step 2's `expect(thread).toBeVisible()`, which is the assertion the ticket turns on;
reverting restored green. The four specs AC5 names pass unedited, `e2e/paired-shell-card.spec.ts`'s
centre hit-test on `.channel-list__section-header` included — the one the header's new
`position: relative` put at genuine risk.

