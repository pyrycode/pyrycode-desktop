# #1185 — the host row swaps its connection dots for a pen and a plus while hovered

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRow` — the pure view this ticket extends;
  its header states the four declined label sinks the two new controls must also decline, and the
  "Not interactive: a plain `<div>` … no `aria-label`" clause this ticket partly falsifies.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRowControl`, `HostConnectionDotsControl`,
  `HostConnectionDots` — the store-bound containers above and below the row. Untouched here; read to
  confirm nothing between `renderBody` and the dots has to change.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `WorkspaceRow` — the template. Its `create` /
  `edit` blocks give the `<button>` shape, the two inline glyph paths this ticket reuses, and the
  recorded reason its own DOM order is plus-then-pen.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `CREATE_CHAT_CONTROL_LABEL`,
  `EDIT_WORKSPACE_CONTROL_LABEL` — the module-private client-owned-constant idiom the two new names copy.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__host`, `.channel-list__host-label`,
  `.channel-list__host-status` — the three rules this ticket edits, and the three comments it falsifies.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace-create`,
  `.channel-list__workspace-edit` — the insets, box sizes and reveal rules copied verbatim one level up.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list` — the stacking paragraph at the head
  of the file, which names `.channel-list__host` as unpositioned; this ticket positions it.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `HOST_ROW_MARKER`, `HOST_ICON_MARKER`,
  `HOST_LABEL_OPEN`, `DOT_WRAPPER_MARKER`, the four `DOT_*_MARKER`s — every marker AC5 pins byte for
  byte. `HOST_ROW_MARKER` is `class="channel-list__host"` **with its closing quote**, which is what
  forbids a modifier class on the row and forces the drawn-control test into CSS.
- `e2e/host-label-sidebar.spec.ts` → `ROW_INSET_PX`, its trailing-gap and label-overlap reads — the
  flush trailing edge the dots must keep after they leave the flex flow.
- `e2e/sidebar-tree-geometry.spec.ts` → `HOST_ICON_X`, `HOST_LABEL_X`, `HEADER_TO_HOST_PX` — the row's
  left geometry and vertical rhythm, none of which this ticket touches.
- `e2e/paired-shell-card.spec.ts` → `hitAt` / `hitAtCentreOf` — the host row's hit test. It resolves
  through `hit.closest(expected)`, so a positioned descendant cannot break it.
- `e2e/sidebar-workspace-create.spec.ts` → its header and constants — the opacity/hover drive idiom the
  new spec below copies, including `HIDDEN_OPACITY` / `SHOWN_OPACITY`.
- `docs/knowledge/features/channel-list-host-row.md`, `channel-list-desktop-row-geometry.md` — both
  describe a non-interactive row with in-flow dots. Read, not written: the documentation phase owns them.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=399-1366
(Channels frame https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=103-2966)

The Host component draws one 28px row twice on the dark surface. **Idle** is the glyph, the machine name
in title-small, and the two green 6px connection dots pinned to the trailing edge. **Hover** is the same
glyph and name with the dots gone and, in their place, a `--color-primary` (#9dcbfc) pen and plus — the
plus's 16px box at right 2, the pen's 14px box at right 28, both vertically centred in the row. Neither
state fills the row; the only difference between them is which trailing marks are drawn.

Two notes from reading the node rather than the ticket:

- The Hover plus's inner leaf is *named* `circle-chevron-up-solid-full 1` (`I399:1414;399:1046`) in the
  component set. The rendered screenshot draws a **plus**, and the ticket reads it as the plus glyph
  `399:1045`. The drawing wins over the layer name; this ticket reuses the plus path already in
  `ChannelList.tsx` and re-exports nothing.
- The component's own frame carries `pr-[28px]`, not the 52 this plan uses. 28 reserves the *glyph*
  slot; 52 reserves the pen's full 20px hit box plus the plus's, which is what makes "no glyph of the
  label is painted under either control" true of the hit boxes and not only of the art. 52 is also the
  value `.channel-list__workspace` already ships for the identical pair one level down, so the two rows
  stop their labels at the same inset. Deviation stated rather than silent.

## Context

The host row is the last row family in the sidebar tree with no controls of its own. The workspace row
below it grew a plus (#1178/#1179) and a pen (#1180); the channel rows have carried theirs since #1172.
This ticket brings the same pair up one level, into the slot the connection dots occupy at rest.

The interesting constraint is that **this ticket ships no caller**. #1187 (Edit host dialog) and #1189
(Add workspace dialog) supply the handlers. So the production row draws neither control for as long as
those take, and a hover rule keyed on the row alone would blank the shipped app's connection dots into
an empty slot the whole time. The dots must give way only to a control that is actually drawn.

No ADR is warranted: this is one row adopting a shape three row families already ship.

## Design

### `HostRow` (`ChannelList.tsx`)

Two new optional props, both nullary:

```
onAddWorkspace?: () => void
onEditHost?: () => void
```

Each control renders only when its handler is passed — the optional-callback shape `WorkspaceRow` uses
for `create` / `edit`, minus the bundled `label`. The names are **fixed by this ticket**, not by the
caller, so there is no per-tree variation to bundle: `ADD_WORKSPACE_CONTROL_LABEL = 'Add workspace'` and
`EDIT_HOST_CONTROL_LABEL = 'Edit host'`, module-private constants beside `CREATE_CHAT_CONTROL_LABEL`.
Keeping the name out of the prop surface is the security decision recorded below: there is no field a
future caller could fill with a host's name.

Nullary rather than `(serverId: string) => void`, matching `WorkspaceRow`'s `onEdit`: the caller closes
over the machine it is drawing, so the id never becomes an argument this view handles. `() => void` also
forbids the handler from declaring a parameter, so React's synthetic event cannot reach it.

Both controls are `<button type="button">` siblings of the label inside the row `<div>`, never nested in
a button, each carrying `className`, `aria-label` (the constant) and `onClick` and nothing else. The row
itself stays a plain non-interactive `<div>` with no `onClick`, no `aria-label`, no `title`.

Classes: `.channel-list__host-add` (plus) and `.channel-list__host-edit` (pen), with
`.channel-list__host-add-icon` / `.channel-list__host-edit-icon` on the SVGs. Class selectors match whole
tokens, so none of these joins `.channel-list__host`, `.channel-list__row`, `.channel-list__row-open` or
`.channel-list__section-header`; and `class="channel-list__host"` with its closing quote — the marker AC5
pins — matches none of them as a substring either.

Glyphs are the two paths already in this file, reused in place and not re-exported: the plus at
`viewBox="0 0 16 16"` drawn 16×16 (`.channel-list__workspace-create-icon`'s) and the pen at
`viewBox="0 0 12 12"` drawn 14×14 (`.channel-list__workspace-edit-icon`'s), both `fill="currentColor"`
and `aria-hidden="true"`. Neither carries a `.channel-list__control-name` pill — that is #1190's ticket,
and copying the workspace buttons wholesale would have pulled it in.

**DOM order: pen, then plus** — deliberately the reverse of `WorkspaceRow`'s. Both controls are
positioned, so order drives neither layout nor the drawn result, only the tab order, and no shipped spec
constrains it here. `WorkspaceRow`'s own header records its plus-first order as a *stated cost* forced by
`e2e/sidebar-workspace-create.spec.ts`'s single-Tab assertion, not as a preference; propagating a
documented defect for the sake of symmetry is the wrong trade. Pen-first makes tab order match visual
order. `ChannelList.test.tsx` pins it so a future reorder reddens a unit test rather than nothing.

Nothing above `HostRow` changes: `HostRowControl`, `renderBody` and `renderServerTrees` are untouched.

### `channels.css`

- `.channel-list__host` takes `position: relative` (z-index auto, so it joins `.channel-list__row` and
  `.channel-list__workspace-head` in the paint step already used under the card wash) and its right
  padding goes from 0 to `calc(var(--space-8) + var(--space-5))` = 52 — `.channel-list__workspace`'s
  value, for its stated reason: reserving the trailing slot unconditionally is what stops a long label
  re-truncating the moment the pointer arrives. The row's 28px height stays derived, never declared.
- `.channel-list__host-status` loses `margin-left: auto` and `flex: 0 0 auto` and becomes
  `position: absolute; right: 0; top: var(--space-1); height: var(--space-5)`, keeping its flex/gap. A
  20px box 4px down a 28px row centres the pair at 14 — where `align-items: center` put it before — and
  `right: 0` resolves against the row's *padding box*, i.e. its right border edge, which is the card's
  content edge. So the dots do not move by a pixel and `host-label-sidebar.spec.ts`'s `ROW_INSET_PX = 0`
  stays literally true. An explicit `opacity: 1` is added so the suppression rule below reads as a pair.
- `.channel-list__host-add` and `.channel-list__host-edit` are `.channel-list__workspace-create` and
  `.channel-list__workspace-edit`'s blocks with the ancestor changed: `right: 0` / `top: var(--space-1)`
  and `right: calc(var(--space-7) - 3px)` / `top: var(--space-1)`, 20px boxes, `--color-primary`, no
  background and no radius, `opacity: 0` at rest, revealed by `.channel-list__host:hover` and by each
  control's own `:focus-visible` (which also draws the file's outline).
- **The suppression guard.** The dots drop to `opacity: 0` only when the row is hovered *and* contains a
  drawn control, or when a drawn control has `:focus-visible`:

  ```
  .channel-list__host:hover:has(> .channel-list__host-edit, > .channel-list__host-add)
    .channel-list__host-status,
  .channel-list__host:has(> .channel-list__host-edit:focus-visible, > .channel-list__host-add:focus-visible)
    .channel-list__host-status { opacity: 0 }
  ```

  `:has()` rather than a `~` sibling combinator, which is the other way to write it. `~` would state the
  condition as "a control precedes the dots in DOM order", coupling a CSS rule to a DOM order this plan
  chose on accessibility grounds and is free to change; `:has()` states the condition that is actually
  meant. `channels.css` already ships one (`.channel-list__row:has(> .channel-list__row-open[…])`) and
  `conversation.css` several; Electron 33 is Chromium 130. Both reveals and the suppression use
  `opacity` and never `display: none` / `visibility: hidden` — #1171's ruling, load-bearing twice over: a
  display-none control cannot take focus, and `connection-dot-colours.spec.ts` /
  `host-label-sidebar.spec.ts` count and read the dots' boxes without hovering.

### Falsified comments this ticket must rewrite

Not optional cleanup — each currently argues for a declaration this ticket deletes:

- `channels.css` head, the stacking paragraph, which lists `.channel-list__host` among the unpositioned
  descendants. `.channel-list`'s own `position: relative` is still required (the section header is still
  unpositioned and the wash still lives on `.paired-shell__sidebar::before`); only the parenthetical
  changes.
- `.channel-list__host`'s argument for the 0 right padding.
- `.channel-list__host-label`'s argument against `flex: 1 1 auto` — it reasons from `margin-left: auto`
  being rendered inert, and that mechanism is gone. The declaration stays absent; the reason becomes
  "nothing needs it", not "it would break the dots".
- `.channel-list__host-status`'s whole `margin-left: auto` rationale.
- `HostRow`'s "Not interactive: a plain `<div>`, no `<button>`, no `onClick`, no `aria-label`". The row
  stays a plain `<div>` with no `onClick`; the last two clauses stop being true of its subtree.
- `HostRow`'s four-sink list gains the two controls' attributes explicitly.

The two package overviews (`channel-list-host-row.md`, `channel-list-desktop-row-geometry.md`) also go
stale. The documentation phase owns those; they are named in the PR body, not edited here.

## State + concurrency model

None added. `HostRow` stays a pure view: no store read, no effect, no subscription, no async work, no
timer. The two props are opaque callbacks the view never invokes itself. The dots' suppression is CSS
with no JavaScript state, so there is nothing to tear down and nothing that can leak between rows. The
existing store reads in `HostRowControl` and `HostConnectionDotsControl` are untouched.

## Error handling

No new failure mode: no I/O, no IPC, no parse, no promise. The only conditional is "was this handler
passed", which is a compile-time-optional prop with a rendered/not-rendered outcome and no error arm.
The row emits no `console.*` today and this ticket adds none — a click log would carry the machine's
name, which is operator content and forbidden by ADR 0007's content-free rule and by `CLAUDE.md`.

## Testing strategy

**vitest, `ChannelList.test.tsx`, static markup** (`renderToStaticMarkup` through the exported `HostRow`
— the four-arm handler matrix is unreachable through the container, which server-renders its store's
initial cell only):

- With both handlers: `aria-label="Add workspace"` and `aria-label="Edit host"` each appear exactly once.
- With neither: each appears zero times, and neither `.channel-list__host-add` nor
  `.channel-list__host-edit` is in the markup.
- With one: exactly that control, confirming the two are independently withheld.
- Both are `<button type="button">`, and the pen precedes the plus in the markup.
- The two SVGs' opening runs: 16×16 on `viewBox="0 0 16 16"` for the plus, 14×14 on `viewBox="0 0 12 12"`
  for the pen, both `fill="currentColor"` `aria-hidden="true"`.
- A sentinel host label passed with both handlers appears in the markup exactly once — as the label's
  text child — and in no attribute; the row still carries no `aria-label` and no `title`.
- The existing marker assertions (`HOST_ROW_MARKER`, `HOST_ICON_MARKER`, `HOST_LABEL_OPEN`,
  `DOT_WRAPPER_MARKER`, the four `DOT_*_MARKER`s) pass **unedited** — that is AC5's byte-for-byte half.

**Playwright, one new spec `e2e/host-row-hover-controls.spec.ts`** — AC2, the one criterion observable on
the production row today and the one whose regression would degrade the shipped app rather than an
unreleased one. It hovers a **workspace** row first and asserts its plus goes to opacity 1: a positive
control proving the fixture's hover actually fires, without which the host-row read below is vacuous.
Then it hovers the host row and asserts `.channel-list__host-status` still computes opacity 1 and that
neither control class is in the DOM. Deleting the `:has()` guard reddens it; nothing else does.

Not covered here, and stated in the PR rather than asserted as an absence: the drawn geometry of the two
controls (right 2 / right 28, 16 and 14, `--color-primary`) and "clicking fires that handler". Both need
a caller, and both land with #1187 and #1189, which draw the controls for the first time. The static
tier's `type="button"` + not-nested-in-a-button assertions are what it can honestly say about the click.

## Open questions

1. **`:has()` or a `~` sibling combinator for the suppression guard?** Resolved in Design above:
   `:has()`, because the condition is "the row contains a drawn control", not "a control precedes the
   dots".
2. **DOM order of the pair?** Resolved: pen then plus, pinned in the unit tier. See Design.
3. **Does the new e2e spec belong in this ticket at all**, given the ticket says "unit only"? Resolved:
   yes for AC2 alone, which the ticket itself flags as the exception. It is the only criterion here that
   protects behaviour already in a user's hands.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No finding, by a structural decision rather than by inspection. The one
  untrusted value in this subtree is `HostRow`'s `label` (operator-typed, off disk — `hostLabelHandler`
  hands the "escaped text only" obligation to this component), and the one client-held identifier is
  `serverId`. Neither control reads either: their `aria-label`s are `ADD_WORKSPACE_CONTROL_LABEL` and
  `EDIT_HOST_CONTROL_LABEL`, module-level string literals. **The design forecloses the obvious next
  edit**: a `WorkspaceRow`-style `{ label, onEdit }` bundle would have admitted a caller passing
  `` `Edit ${hostLabel}` ``, interpolating untrusted text into an attribute — the exact shape #696's
  review made a MUST FIX and `host-label-sidebar.spec.ts` step 4 already polices for `title`. The props
  carry handlers only, so there is no field for a name to arrive in. Pinned by the unit test asserting a
  sentinel label appears once, as a text child, and in no attribute.
- **[Trust boundaries, second]** No finding. Both handlers are typed `() => void`, which TypeScript
  refuses to satisfy with a function declaring a parameter, so React's synthetic event cannot reach a
  caller's handler and the caller cannot come to depend on it. Nullary also keeps `serverId` out of this
  view's event surface entirely — #1187/#1189 close over the machine they are drawing, as
  `renderServerTrees` already does for `WorkspaceRow`'s `onEdit`.
- **[Tokens, secrets, credentials]** N/A with a stated reason, not a shrug: this subtree renders no
  token, key or credential, and adds no read of one. `serverId` remains a React key and a selector
  argument, rendered nowhere — the amendment `HostRow`'s header already records — and this ticket adds
  no new sink for it.
- **[File / storage]** N/A: no path is constructed, no file read or written, no web storage touched. The
  handlers are opaque to the view.
- **[Electron / IPC attack surface]** No finding. This ticket adds no `contextBridge` API, no
  `ipcMain` channel, no `window.pyry` call, no navigation and no window. `HostRow` is a renderer-side
  pure view; nothing about the transport, keys or sockets is in reach.
- **[Cryptographic primitives]** N/A: no randomness, no comparison against a secret, no key material.
- **[Network & I/O]** N/A: no socket, no fetch, no timeout to set.
- **[Errors, logs, telemetry]** No finding, and the live risk named: any useful log on a click
  ("Edit host <name>") would carry operator content into a log file, which ADR 0007 and `CLAUDE.md`
  forbid. This path emits no `console.*`, matching `hostRowLabel`'s own recorded posture, and the two
  handlers belong to callers who inherit that obligation.
- **[Concurrency]** N/A: nothing async, no effect, no listener, no timer, no shared mutable state. The
  reveal and the suppression are both pure CSS.
- **[Threat model alignment — availability of a security signal]** ACCEPTED RISK, named rather than
  waved past. Hovering a host row hides that machine's connection status for as long as the pointer
  rests there, so a user cannot read "is this machine actually connected" while pointing at its row.
  Accepted by the operator and by the drawing: the dots return the instant the pointer leaves, the
  ConnectionBanner (#279) announces disconnects independently of any hover, and Settings → Connection
  carries the same signal with no hover at all. It also cannot be *triggered* by a hostile daemon — a
  hover is a local pointer event, and neither control's presence nor its name is daemon-derived.
- **[Threat model alignment — the guard's own fragility]** SHOULD FIX, addressed in this ticket rather
  than deferred. The suppression rule names both control classes inside `:has()`, whose forgiving
  parsing drops an unrecognised selector without invalidating the rule — so a class rename would
  silently un-key the guard, and a "simplification" to `.channel-list__host:hover
  .channel-list__host-status` would blank the shipped app's connection dots on every hover for as long
  as #1187 and #1189 take. Two independent detectors, of different fabric: `ChannelList.test.tsx` pins
  both class names, and `e2e/host-row-hover-controls.spec.ts` reads the dots' computed opacity while the
  production row is hovered. The second is what the CSS comment must cite.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
