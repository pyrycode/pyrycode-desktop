# #1178 — the workspace row nests 20px in, and shows a plus that starts a chat in that workspace

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `WorkspaceRow`, `CollapsibleWorkspaceGroup`,
  `renderServerTrees`, `renderBody`, `ChannelListView`, `ChannelList`, `Row`,
  `RENAME_CONTROL_LABEL` / `SAVE_AS_CHANNEL_CONTROL_LABEL` — the whole edit surface: the row that
  moves, the group that gains the callback, the one shared helper both trees render through, and the
  two shipped control-name constants the new one is written in the idiom of.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__workspace`,
  `.channel-list__workspace:hover`, `.channel-list__workspace-label`, `.channel-list__row`,
  `.channel-list__row-open`, `.channel-list__save`, `.channel-list__row:hover .channel-list__save` —
  the rule being retuned, and the trailing-control block whose absolute / `opacity: 0` / reveal shape
  the plus restates one level up.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace`, `WorkspaceGroup`,
  `UNKNOWN_WORKSPACE_KEY` — `group.key` IS `row.cwd`, which is the `cwd` the plus sends; the unknown
  bucket's key is `''` and must draw no plus.
- `src/renderer/src/store/conversationCreatedBridge.ts` → `requestNewConversation`,
  `useConversationCreatedNav` — the command constructor, which already takes the cwd as a required
  parameter, and the event-driven nav that opens the created thread. No bridge change.
- `src/renderer/src/screens/channels/ChannelList.test.tsx` → `render`, `WORKSPACE_ROW_MARKER`,
  `WORKSPACE_LABEL_OPEN`, `workspaceRowTagsIn`, `countOf` — the markers AC5 pins byte for byte, and
  the reason the wrapper's class must not end where `channel-list__workspace` ends.
- `e2e/sidebar-tree-geometry.spec.ts` → `CARD_INSET_PX`, `WORKSPACE_ICON_X`, `TITLE_X` — the spec AC1
  retargets, and the 2px gap deviation recorded beside `WORKSPACE_ICON_X` that expires here.
- `e2e/sidebar-row-geometry.spec.ts`, `e2e/workspace-collapse.spec.ts` → their `.channel-list__workspace`
  count and gap assertions, which AC5 requires to pass unedited.
- `e2e/fixtures/conversationStateFake.ts` → `DEFAULT_CREATED_CWD` (`/fake/workspace`) — the reason the
  drive must seed its clicked group at some OTHER path, or a plus sending `null` passes vacuously.
- `docs/knowledge/features/channel-list-desktop-row-geometry.md` § "The redrawn frame" (#1171) — three
  lessons this plan takes directly: the reveal must be `opacity` and never `display: none`;
  `:focus-visible` is a keyboard-modality heuristic, so a bare `.focus()` proves nothing; and an
  out-of-flow control stops being detectable by a row-height assertion, so its box needs its own read.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=399-1059
(Workspace component; Idle `399:1039`, Hover `399:1060`, plus `399:1065`), placed in the Hosts frame
https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=106-3160 as `405:7456`
inside the `pl-[20px]` `Workspace` wrapper `405:7469`.

A 340-wide, 28-tall row on a 6px corner, `pl-[8px] py-[4px] pr-[32px]` with a 10px gap between a 12px
folder glyph and a title-small label, drawn on no fill in either state. The Hover variant adds one
16×16 "Icon Edgeless" plus at `right: 2px; top: 6.01px`, filled `--color-primary`, and (for #1180) a
14×14 pen at `right: 28px`, which takes the Hover variant's `pr-[52px]` with it. The two states differ
by their controls alone — no hover fill, no chevron, no background behind the glyph. The screenshot
confirms it: two identical rows, the lower one carrying a blue pen and a blue plus at its trailing edge.

## Context

The workspace row is the last level of the sidebar tree still laid out against the pre-redraw frame. Its
label sits 48px from the card's content edge while the channel titles under it sit at 50 (#1171 moved
them), so the two nesting levels are 2px out of alignment — and the row itself starts at the content
edge where the drawing nests it 20px in. Pinning the alignment is the point of the geometry half.

The behaviour half gives the sidebar its first per-workspace create. Today the only route to a new chat
is `NewConversationFab`, which always sends the client's default workspace as `cwd`; a user working in
another workspace has no way to open a chat there from the sidebar at all.

No ADR is warranted: the create path, the command shape and the event-driven nav are all shipped, and
this adds a second caller to a helper that already takes the cwd as a parameter.

## Design

**A wrapper element becomes necessary, and it carries the nest.** `WorkspaceRow` returns a wrapper
`<div class="channel-list__workspace-head">` holding the disclosure `<button class="channel-list__workspace">`
and the plus `<button class="channel-list__workspace-create">` as SIBLINGS — never nested, since an
interactive control cannot sit inside a `<button>` (#274), which is also what keeps the plus's click off
the disclosure's handler. The wrapper is the plus's positioned ancestor: `.channel-list` is
`position: relative` for a stacking reason, so an absolutely positioned plus without a nearer
containing block would pin itself to the scroll column.

The wrapper wraps the HEAD ROW ONLY. `CollapsibleWorkspaceGroup` keeps returning a fragment whose
second child is `{expanded && children}`, so the group's channel rows stay flat siblings of
`.channel-list` — the ancestry 28 e2e specs click through, and the `+` adjacent-row rule's
precondition.

**The wrapper's class shares no token with any strict-mode locator in the suite.**
`channel-list__workspace-head` is not matched by `.channel-list__workspace`,
`.channel-list__row`, `.channel-list__row-open`, `.channel-list__section-header` or
`.channel-list__host` — class selectors match whole tokens — and, for the unit tier,
`class="channel-list__workspace-head"` does not contain the exact substring
`class="channel-list__workspace"` because the marker carries its closing quote. Both guards hold by
construction, and neither needs a single `e2e/` file edited.

**Naming.** `CREATE_CHAT_CONTROL_LABEL = 'Create chat'`, a client-owned module-level constant in the
`RENAME_CONTROL_LABEL` / `SAVE_AS_CHANNEL_CONTROL_LABEL` idiom, read by the plus's `aria-label` and
reused by #1181's pill. The workspace label — daemon text — reaches no attribute of the control, on the
four-sink rule `WorkspaceRow`'s own comment already lists.

**The prop chain, one parameter per level.**

- `ChannelListView` gains `onCreateChat: (cwd: string) => void`, REQUIRED, threaded like
  `onNewConversation`: the container must decide, and a defaulted prop would let a caller silently
  render a sidebar with no create route.
- `renderBody` gains it as a trailing callback and passes it to the `discussions` call of
  `renderServerTrees` and NOT to the `channels` one. That is the whole per-tree difference: the Channels
  tree passes nothing until #1179 lands.
- `renderServerTrees` gains an OPTIONAL `onCreateChat`; its inner `workspaceGroups` decides per group
  and hands `CollapsibleWorkspaceGroup` a nullary `onCreateChat?: () => void`.
- `CollapsibleWorkspaceGroup` passes it to `WorkspaceRow` as `onCreate?: () => void`; the plus renders
  only when it is defined — the optional-callback shape `Row` already uses for `onSaveAsChannel`.
- The container supplies `(cwd) => requestNewConversation(window.pyry.sendCommand, cwd)`, dereferencing
  `window.pyry` inside the arrow alone so the server-render smoke is untouched.

**The unknown group draws no plus.** `UNKNOWN_WORKSPACE_KEY` gains an `export` (its "module-local"
comment is corrected in the same edit) and `workspaceGroups` withholds the callback for the group whose
key is it. That key is `''`, not a directory: a create sent with it as `cwd` would be rejected.
Comparing against the KEY and never the label is deliberate — a real directory named `Unknown workspace`
must keep its plus, which is the same both-directions rule `workspaceLabelFor`'s header already states.

**Geometry (`channels.css`).** All x below are from the card's content edge.

- `.channel-list__workspace-head` — `display: flex; align-items: center; position: relative;
  margin-left: var(--space-5)`. The nest rides the head row as a margin for `.channel-list__row`'s
  stated reason: there is no group wrapper to hang a padding on. It stretches to the content edge, so
  the row runs 20 → 360 (340 wide, as drawn).
- `.channel-list__workspace` — padding `var(--space-1) var(--space-8) var(--space-1) var(--space-2)`
  (was `--space-1 --space-4 --space-1 --space-6`), gap `calc(var(--space-2) + 2px)` (was `--space-3`),
  plus `flex: 1 1 auto; min-width: 0`. Glyph at 20 + 8 = 28; label at 28 + 12 + 10 = 50, which is
  `.channel-list__row-open`'s title x exactly. The 10px gap has no token, so it is written as the sum
  with a comment saying WHY it is 10 and not the 12 the tie-break gave — the same shape as that rule's
  `calc(var(--space-2) + 6px + var(--space-2))`. Height is unchanged and still DERIVED: 4 + the 20px
  label line box + 4 = the drawing's 28.
- **`min-width: 0` on the button is load-bearing, not tidiness.** Until now the button was a flex item
  of a COLUMN container, where `min-width: auto` resolves to 0; inside a row-direction wrapper it
  resolves to the content-based floor instead, which is opaque to the label's `min-width: 0` /
  `overflow: hidden` chain and would let an unbounded daemon `cwd` widen the row. `.channel-list__row`
  / `.channel-list__row-open` already ship exactly this pair for exactly this reason.
- `.channel-list__workspace:hover`'s `--color-surface-container` fill is **deleted**. The drawing now
  pins a Hover state and it carries no fill; the rule's own comment says it existed because no hover
  state was pinned, so it expires with that sentence. **Assumption, stated per the ticket.**
  `:focus-visible` stays, per the file convention.
- `.channel-list__workspace-create` — `position: absolute; right: 0; top: var(--space-1)`, a 20×20 box
  (`--space-5`) centring the 16px glyph. That reproduces the drawing's rectangle — right edge 2px in,
  top 6 in a 28px row — with no 2px literal anywhere: (20 − 16) / 2 = 2 on both axes, over a 4px top
  offset. `color: var(--color-primary)`, no background, no hover circle, `opacity: 0`, the
  `:focus-visible` outline per the file convention.
- The reveal is `opacity` and NEVER `display: none` / `visibility: hidden` (#1171's ruling): a
  display-none control cannot take focus, and the plus must be keyboard-reachable and present in the
  accessibility tree at rest (AC3). `opacity: 1` under `.channel-list__workspace-head:hover` and on the
  plus's own `:focus-visible`. The rule is self-contained rather than keyed to being the only control,
  so #1180's pen slots in beside it.

**The glyph** is the design's own export at `viewBox="0 0 16 16"`, `width="16" height="16"`,
`fill="currentColor"`, `aria-hidden="true"` — the file's eighth inline path, in its established idiom.

**Stale prose corrected in the same commit** (never a separate sweep): `.channel-list__workspace`'s
24px-inset and 12px-tie-break argument, its `:hover` comment, `.channel-list__row`'s and
`.channel-list__row-open`'s forward references to "#1178's, not this rule's", and
`WORKSPACE_ICON_X`'s deviation note in `sidebar-tree-geometry.spec.ts`.

## State + concurrency model

None added. The fold stays one `useState` boolean in `CollapsibleWorkspaceGroup`, untouched — the plus
is a sibling of the disclosure, so its click never reaches the toggle and `aria-expanded` cannot move.
The create is fire-and-forget through the shipped `requestNewConversation` (`sendCommand` is `void`);
navigation stays event-driven, so the daemon's `conversationCreated` confirmation opens the thread
through `PairedShell`'s existing `useConversationCreatedNav` → `activateConversation`. No optimistic
row, no new subscription, no new store, no new effect, and therefore no teardown to define.

The re-listed chat lands in the clicked group because `groupByWorkspace` keys on `cwd` and the plus
sent that group's key verbatim.

## Error handling

No new failure mode reaches this code. `sendCommand` returns `void` and the command's rejection path is
already the shipped one for the FAB — main answers, and nothing in the sidebar awaits a result. A
create that main declines simply mints no row; that is the FAB's behaviour today and this ticket adds no
second answer to it. Notably #1120's multi-server case is unchanged: this sends the same
`createConversation` shape the FAB sends, carrying no `serverId`, so a multi-server client behaves
exactly as it does for the FAB — the host row's own plus (#1185/#1189) is where that is answered.

No `console.*` anywhere on this path: any useful line would carry the `cwd`, which is daemon text and
is forbidden in a log by ADR 0007 and `CLAUDE.md`.

## Testing strategy

**Unit, `ChannelList.test.tsx`** (static markup — this tier cannot click, hover or measure):

- A render holding a promoted row and an unpromoted row in the same workspace contains
  `aria-label="Create chat"` exactly once, and zero times in the slice before the divider (the Channels
  tree).
- The plus's `<svg>` opening run carries `width="16" height="16"`.
- `class="channel-list__workspace-head"` appears once per group, and the marker counts AC5 pins —
  `WORKSPACE_ROW_MARKER` and `WORKSPACE_LABEL_OPEN` at one per group — are unchanged, with
  `workspaceRowTagsIn` still returning a `<button>` tag carrying no `aria-label` and no `title`.
- A row whose `cwd` yields no usable segment renders its group with zero `aria-label="Create chat"`.
- `CollapsibleWorkspaceGroup` rendered directly with no `onCreateChat` draws no plus.

**E2E, `e2e/sidebar-tree-geometry.spec.ts`** (edited): the workspace row's left edge retargets from
`CARD_INSET_PX` to `CARD_INSET_PX + 20`, `WORKSPACE_ICON_X` to `CARD_INSET_PX + 28`, a new
`WORKSPACE_LABEL_X` pins the label at `CARD_INSET_PX + 50` and is asserted `toBe(TITLE_X)`, and the
row's right edge is asserted flush with the content edge. The host-row assertions are not touched.

**E2E, `e2e/sidebar-workspace-create.spec.ts`** (new, one launch, one continuous drive): the control's
own box and its behaviour, which only a running window can answer.

- Seed ONE unpromoted row at a cwd that is NOT the fake's `DEFAULT_CREATED_CWD` — so a plus that sent
  `null` would mint its row in a SECOND group and the group count would move. That count is the
  non-vacuity guard, and it is the assertion the drive turns on.
- At rest, with the pointer parked on the actions cluster: the plus is present by role and name
  (`getByRole('button', { name: 'Create chat' })`) with computed `opacity: 0`.
- Hovering the row: `opacity: 1`, the glyph's box 16×16 with its right edge 2px in from the row's right
  edge and its centre on the row's centre, `color` = `--color-primary`, and the row still 28 tall.
- Keyboard: focus the disclosure button, press Tab — a real keyboard traversal, since `:focus-visible`
  is a modality heuristic that a bare `.focus()` after a pointer interaction does not satisfy — and read
  `opacity: 1` with the pointer off the row.
- Click the plus, then a POSITIVE auto-waiting read first: `.channel-list__row` count goes 1 → 2, and
  the open row's title is the client-owned `Untitled` (so the created chat's thread opened). Only then
  the two closing reads — `.channel-list__workspace` still 1 (the new row landed in the clicked group,
  which is what proves the `cwd` travelled) and the group's `aria-expanded` still `"true"`.
- Rounded deltas are normalised against `-0` before any `toBe(0)` (the #868 rule).

`e2e/workspace-collapse.spec.ts` and `e2e/sidebar-row-geometry.spec.ts` are run unedited as the
regression check AC5 names.

## Open questions

- **Does the wrapper move any existing e2e locator's tree position?** Read as: only
  `.channel-list__workspace` gains an ancestor; `.channel-list__row` and everything above it are
  untouched. To be CONFIRMED by running both unedited specs, not by reading.
- **Does deleting the workspace hover fill leave the row with no pointer feedback at all?** As drawn,
  yes — the plus appearing is the feedback. Recorded as the ticket's stated assumption; if Juhana wants
  a fill, it is a one-declaration follow-up.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] SHOULD FIX — a daemon-asserted `cwd` becomes an OUTGOING command field for the
  first time on this path, and the design must say so at the call site.** In `renderServerTrees`,
  `group.key` IS `row.cwd` (`groupByWorkspace`), untrusted daemon text; until now the sidebar's uses of
  it were an escaped React child, a `Map` key and a React key. This plan hands it to
  `requestNewConversation` as the `createConversation` payload's `cwd`. Four things bound it, each
  checked rather than assumed: the reachable set is a strict SUBSET of paths the daemon itself asserted
  (`groupByWorkspace` mints no key but the `''` sentinel, so the client cannot invent a path); the value
  round-trips to its own origin over the same Noise session, reaching no third party;
  `isCreateConversationPayload` validates it at the untrusted renderer→main boundary and
  `daemonConnection.createConversation` then rebuilds a FRESH three-field literal, so no smuggled
  sibling field rides along; and — verified by grep over `src/main` — no `fs`, `path`, `URL` or `node:*`
  call anywhere in main touches a payload `cwd`, so it never becomes a local filesystem path.
  **Phase B obligation:** pass it VERBATIM — no normalisation, no trim, no `path` module, no local
  resolution — and state that at the call site, the way `workspaceLabelFor`'s header already does.
- **[Trust boundaries] The unknown-group withhold is load-bearing, not cosmetic.**
  `UNKNOWN_WORKSPACE_KEY` is `''`, and an empty string is NOT the `null` "take the daemon default"
  signal — `CreateConversationPayload`'s contract makes the two distinct on the wire, so a daemon
  reading `''` as "the current directory" would create a chat in its own process cwd. The withhold is
  therefore a create the design must not offer, not a tidiness rule. It is decided on the KEY and never
  on the label (a real directory named `Unknown workspace` keeps its plus), and the unit tier asserts
  the zero-plus case directly.
- **[Attribute sinks / injection] No findings, by construction.** The plus's `aria-label` is
  `CREATE_CHAT_CONTROL_LABEL`, a client-owned compile-time constant; the wrapper and control class names
  are constants. Nothing in this design derives a `title`, `id`, `aria-controls`, `data-*`, class name,
  URL or CSS custom property from the label or the key, which is the four-sink list `WorkspaceRow`'s
  own comment already declines. The one amended sink (`group.key` as a React key) is untouched.
- **[Errors, logs, telemetry] No findings.** No `console.*` is added on any path — a useful line would
  carry the `cwd`, which ADR 0007 and `CLAUDE.md` forbid. The failure side is already silent upstream:
  `daemonConnection.createConversation` catches and DROPS, deliberately emitting no log and no event
  because the caught object could echo the payload.
- **[Electron / IPC attack surface] No findings.** No new `contextBridge` API, no new `ipcMain`
  channel, no new command member. This is a SECOND caller of the shipped `requestNewConversation`
  constructor, whose command already has a validator and a routing case. The renderer gains no
  filesystem, socket, key or raw-byte reach; the transport stays in main.
- **[Tokens / secrets, file & storage, cryptography, network & I/O] Not applicable, concretely:** the
  change is one CSS block, one `<button>` and one parameter threaded through four renderer functions.
  It opens no file, writes no storage, mints no randomness, touches no key or token, and opens no
  socket — the create rides the already-established Noise session.
- **[Concurrency] No security finding; one behaviour named rather than glossed.** A rapid double-click
  on the plus sends two `createConversation` commands and mints two chats. `NewConversationFab` has the
  identical property today with no guard, so this is neither new nor this ticket's to change. No new
  async task, subscription, timer or listener is introduced, so there is nothing to cancel or tear down.
- **[Threat model — hostile daemon] Addressed.** Beyond the boundary finding above, the oversized case:
  a megabyte-long `cwd` reaches `buildCreateConversation`, which throws `WireEncodeError` on an over-cap
  plaintext, and `createConversation` drops the send — a dropped request, not an unbounded write.
  Visually it is bounded too, and that is the second reason this plan adds `min-width: 0` to
  `.channel-list__workspace`: inside a row-direction wrapper the button's automatic minimum size would
  otherwise be content-derived and let an unbounded path widen the row past the 400px sidebar.
- **[Threat model — renderer compromise] OUT OF SCOPE, unchanged.** Process isolation is what stops a
  compromised renderer reaching keys or the socket, and this ticket moves nothing across that line.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
