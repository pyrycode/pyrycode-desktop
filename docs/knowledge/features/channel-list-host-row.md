# Channel List — the host row and its connection dots

Split out of [Channel List home screen](channel-list.md) to keep that document under the doc-guard's
50000-byte cap (`npm run check:docs`) — this page holds the two `ChannelList.tsx` sections that grew
past it: the sidebar's host row and its two trailing connection dots. Everything else about the screen
(the view-model, the row's save/rename affordances, workspace grouping, CSS) stays on the parent page.

## The host row (`ChannelList.tsx`, added by #710, the operator's label by [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834))

`HostRow({ label, serverId, onAddWorkspace?, onEditHost? }): JSX.Element` — the file's sixth inline-glyph
idiom instance, alongside `SettingsButton`/`ArchiveButton`/`NewConversationFab`/the row's rename/save
buttons — is an **exported pure view**, mirroring `HostConnectionDots`/`HostConnectionDotsControl` below
it (§ next). It renders `<div className="channel-list__host">` holding a 12px inline Material `dns`
(server-rack) glyph, `<span className="channel-list__host-label">{label}</span>`, the connection dots (§
below) and, since [#1185](#the-rows-pen-and-plus-on-hover-1185), two conditionally-drawn trailing
`<button>`s. **The row tag itself is still not interactive** — no `onClick`, no `aria-label`, no `title` —
only its subtree grew controls. A module-private
`HostRowControl(): JSX.Element` resolves which server the row names, reads that server's label, passes it
through `hostRowLabel` (below), and renders `<HostRow label={…} serverId={…} />`; `renderBody` mounts
`HostRowControl`, not `HostRow`, at both call sites. The pure/container split exists for the same reason as
its neighbour: a Zustand singleton seeded before a `renderToStaticMarkup` call is invisible to it — the
server renderer reads `getServerSnapshot()`, wired to the state captured at store *creation* — so
`HostRowControl` can only ever render each store's initial cell, and `hostRowLabel`/`HostRow` are the only
seam the unit tier can reach the matrix through.

**The collapse — `hostRowLabel(value: HostLabelValue): string`.** Unchanged by #1199. Returns the
operator's label only when the [host-label window store](host-label-window-store.md)'s value is `stored`
*and* that label has non-whitespace content; `loading`, `not-stored`, `error`, and a `stored` label that is
blank or whitespace-only all yield `HOST_ROW_FALLBACK_LABEL = 'Server'` (renamed from `#710`'s
`HOST_ROW_LABEL`, since it is no longer the whole label — just what's shown absent one). Three decisions
worth keeping straight, none of them a type error if reversed:

- **`loading` falls back to the same word, never a `'Loading…'` placeholder.** This is the one place
  `ServerRow.tsx`'s precedent (a details-list value showing "Loading…" pre-settle) does *not* transfer:
  this is a *name* slot, and a placeholder in it would read as the machine's name. The pre-settle tick is
  indistinguishable from the not-stored steady state, which is the point — both mean "no name to show yet."
- **The predicate trims (`label.trim() === ''`); the displayed label is verbatim.** `''` is the case AC2
  names; a whitespace-only label renders equally blank, so the same rule covers both. Trimming only ever
  decides *whether* to fall back, never *what* is shown — the row never displays a value that differs from
  what is stored.
- **Nothing slices.** A 128-character (`MAX_HOST_LABEL_LENGTH`, `shared/ipc/pairing.ts:41`) label returns
  whole; truncation is CSS (`.channel-list__host-label`'s ellipsize rule, see the parent page's CSS
  section), so the accessible text stays complete.

**Which server each row names, since [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070).**
`HostRowControl` no longer resolves a server itself — it takes `serverId: string` as a **prop**, one per
call. `renderServerTrees` (`ChannelList.tsx`, see [Channel List § Server
grouping](channel-list.md#server-grouping-channellistviewmodelts--channellisttsx-added-by-1070)) is what
loops: it reads the client's paired-server list (`selectServers`, `pairedServerStore.list()` order —
oldest-paired first, so pairing order rather than whichever connection last spoke) once in the
`ChannelList` **container** and mounts one keyed `<Fragment>` per server, each holding one
`<HostRowControl serverId={…} />` and that server's own workspace groups. Before #1070,
`HostRowControl` read `useServerInfoStore((s) => s.servers[0]?.serverId ?? null)` and rendered only the
**first** paired server — #1199 had already made that single row name a *specific* machine rather than
whichever was named or moved last, but it took this ticket to draw a second one. `serverId` stays
client-held throughout, taken from this client's own `serverInfoStore` list and never from the wire — the
rule `conversationListStore`'s `selectConversationsFor` header states for its own read, and which
`groupByServer` (§ linked above) keeps intact one level up: it iterates the client's ids and only ever
*tests* a row's stamp against them, so a stamp can select among existing keys and never mint one.

**`HostRow`'s `serverId` narrowed from `string | null` to `string` in #1070.** The `null` arm meant "the
paired-server list has not resolved yet," reachable while the row rendered unconditionally from a single
global; it stopped being reachable once a host row's existence became *conditional on* an id being in
that list (an empty `serverIds` array is now what "not yet resolved" looks like — the row simply doesn't
exist yet, rather than existing with a placeholder id). The branch and its collapse were deleted rather
than left as a dead arm describing a frame that can no longer occur; `tsc` confirmed no reachable caller
still passed `null`.

**The id gets the label's four-sink treatment, plus a fifth sink amended rather than kept absolute.**
`HostRow`'s header already declines four sinks for the label (no `title`, no `aria-label`, no derived
id/key/lookup path, no log line); #1199 stated the parallel rule for the id: **the key is the server id,
the value is the label, and neither becomes an attribute, a class name, a title, a URL, a lookup path or a
log line.** #1070 needed the one sink that rule also banned — a React key, for `renderServerTrees`'s
`<Fragment key={serverId}>` — and amended the ban rather than quietly breaking it: the other six sinks all
either reach the DOM or reach persistence, where a React key is reconciliation identity alone, never
serialised and never emitted by `renderToStaticMarkup`. An index key would have been strictly worse,
cross-wiring fold state and per-row component instances between machines whenever the paired list
reorders. `ChannelList.test.tsx` pins the amendment with a sentinel server id asserted to appear nowhere
in the rendered markup. The id's only other use anywhere in this subtree is as an argument to selector
factories.

**Mount site.** `<HostLabelData />` (the [host-label window store](host-label-window-store.md)'s headless
loader) mounts in the `ChannelList` **container**, a sibling of `<ChannelListView />` — the `SettingsScreen`
idiom (`<ServerInfoData />` beside `<ServerRowControl />`) applied to the screen that actually renders the
row. #1199 mounts `<ServerInfoData />` beside it, for the same reason and with the same lifetime: it is
what tells `HostLabelData` which server ids to read a label for (see [host-label window
store](host-label-window-store.md)), and what tells `HostRowControl` which server the row names. Both
render `null`, so DOM order is immaterial, and both dereference `window.pyry` only inside their effects, so
the container stays server-renderable. `SettingsScreen` and `ChannelList` each mount their own
`<ServerInfoData />` instance — the established posture, not a duplicate: the store holds one list and
each mount re-reads it independently.

Two alternatives were rejected for the mount site, both still true post-#1199: an app-level mount fires
once at launch, before pairing, and never re-runs, leaving the row stale after a same-session pair;
mounting inside `SettingsScreen` is exactly what "populated with no Settings visit" forbids. Because
`ChannelList` is rendered at the same element position on both the `list` and `thread` routes ([paired
shell](paired-shell.md)), React preserves it across that flip and no re-read fires there — it *does*
remount on return from `settings`/`archive`/`pairServer`, which re-reads both one-shots, keeping a
mid-session re-pair (Settings → "Pair another server") from leaving a stale name or a missing server id on
the row. This is also why neither [host-label window store](host-label-window-store.md) nor
`serverInfoStore` needs to be in `clearPairingScopedState`: the remount-driven re-read already resolves the
staleness either store's own edge-case notes once flagged as unresolved.

**Launch-frame ordering, since #1199.** `ServerInfoData`'s invoke resolves → `serverInfoStore` fills →
`HostRowControl`'s derived `serverId` changes → `HostLabelData`'s effect (keyed off that same list, see
[host-label window store](host-label-window-store.md)) issues one label read per paired server. Every
frame before the first of these resolves renders the fallback word and the two dot stores' initial cell (§
next) — precisely what the row showed at launch before this ticket, which is what makes AC5
("unchanged launch frame") true by construction rather than by a restated literal.

**The untrusted-text sink.** `label` is untrusted, unbounded-in-content text off disk
(`hostLabelHandler.ts:69-71` hands the "escaped text only" obligation to this row) and reaches the DOM only
as an auto-escaped React child on `.channel-list__host-label`, never an attribute — no `title` (the
reflex AC3 exists to guard: the standard companion to ellipsized text is `title={label}`, which is exactly
CLAUDE.md's "never into an attribute" case), no `aria-label`, no `id`/`key`/lookup path, no log line. Same
four declined sinks `WorkspaceRow`'s comment block already enumerates for daemon-derived text.

`renderBody` mounts each section's header unconditionally, immediately followed by `renderServerTrees`
(§ [Channel List — Server grouping](channel-list.md#server-grouping-channellistviewmodelts--channellisttsx-added-by-1070)),
which draws one `<HostRowControl serverId={…} />` per paired server in pairing order, each followed by
that machine's own workspace groups. **This inverted the header's own comment until #1070**: the row used
to live inside the section's `length > 0` gate, so a zero-row tree rendered neither a header nor a host
row — which is also what the two promote specs used as their "a zero-row section renders no header"
proxy. Operator ruling, 2026-09-06: every paired machine now gets a row in both sections regardless of
whether it has conversations there, because the row carries the plus that starts a chat in a new
workspace (#1185, #1189), and a freshly paired machine has no conversations — under the old gate it had
no row and so no route to its first chat from the desktop at all (the floating button refuses to create
while more than one server is paired, #1120). The promote specs moved to the row's own Save/Rename
affordance as their section proxy instead (see [Channel List § Edge cases](channel-list.md)).

The row repeats once per **server per section** deliberately — the operator confirmed the original
per-section repetition (2026-08-21), and #1070 did not change that: the two sections are not merged under
one shared host heading, and neither are two machines merged under one row. A row whose stamp names no
paired machine renders with **no host row above it** at all (§ [Channel List — Server
grouping](channel-list.md#server-grouping-channellistviewmodelts--channellisttsx-added-by-1070)).

**Selector-safety by construction.** `channel-list__host`/`__host-icon`/`__host-label` share no class token
*and no substring* with any existing selector in the file (`channel-list__row`, `__row-open`,
`__section-header`, …), and the shipped label contains neither "Channels" nor "Chats" case-folded either
way. Both guard the same failure mode: Playwright's strict mode turns an added element that joins an
*existing* locator's match set into a violation rather than an assertion failure — at fixture-launch scale
for the unfiltered `.channel-list__row-open` click 28 specs ride (`launchPairedApp.ts:224`), not just the
two `.channel-list__section-header` + `hasText` promote-spec locators. See [#710 codebase
notes](../codebase/710.md) for the full hazard writeup.

## The host row's connection dots (`ChannelList.tsx`, added by #718)

Split from #672 (the not-yet-known relay state half is [#719](../codebase/719.md), which shipped as a
fourth `LegCategory` picked up here with no code change at the time — see below). Each host row ends with
two label-less 6px dots at its trailing edge — the host (daemon) leg first, the relay leg second — reusing
[#330's shipped `relayLeg`/`daemonLeg`/`ConnectionLeg`
mapping](conversation-shell-chrome.md#two-dot-relaypyrycode-connection-status-leg-mapping-330-its-render-retired-from-this-screen-by-962)
verbatim rather than growing a second copy of it. The exported pure view `HostConnectionDots({ host, relay
})` renders `<span className="channel-list__host-status">` holding two `<span
className="channel-list__host-dot conn-dot--{category}" role="img" aria-label={leg.label} />`.

**Per-server since #1199; `serverId` narrowed to `string` in #1070** for the same reason `HostRow`'s did
(§ above) — a `null` id meant "the paired-server list has not resolved yet," unreachable once a host row
only exists because its id was already in that list. `HostConnectionDotsControl({ serverId }: { serverId:
string })` mounts as `HostRow`'s last child, taking `serverId` as a prop (pass-through from
`HostRowControl`, § above) rather than resolving it itself, so a relay flap re-renders only the four dots,
not the row or the conversation list beneath it. Before #1199 it read `useSessionStore(selectStatus)` and
`useRelayLinkStore(selectRelayLinkStatus)` — both "the most recently written status, across every
connection" cells — so with two machines paired the row reported whichever connection last moved,
including the **other** machine's flap. It now reads each leg through its own per-server selector,
[`selectStatusFor`](session-store.md) (#1133) and [`selectRelayLinkStatusFor`](relay-link-store.md)
(#1134), both shipped for exactly this consumer and both read with the same client-held `serverId` the
label path uses — never a wire-supplied one, the rule `relayLinkStore`'s own header states.

**The silent-server collapse, and why it is two constants rather than two literals.** Both per-server
selectors answer `undefined` for a server that has reported nothing yet — deliberately undefaulted, so
"not heard from" stays distinct from a reported state — while `daemonLeg` takes a non-optional
`ConnectionStatus` and `relayLeg` takes `RelayLinkStatus | null`. So this control has to decide what a
silent server's dots look like, and it lands them on each store's **own initial cell**:
`daemonLeg(daemonStatus ?? initialSessionState.status)` and `relayLeg(relayStatus ?? initialRelayLinkState.status)`.
That is not a fifth category and not a guess — it is literally the pair this row has rendered on every
launch frame since #718, back when both reads were app-wide and both stores were untouched (`initialSessionState.status`
→ down, "Pyrycode Offline"; `initialRelayLinkState.status` → `null`, hence unknown, "Relay Unknown").
Reading the constants rather than restating those two values here is what keeps this collapse correct if
either store's initial cell ever changes — one edit there, no edit here.

**The `null`-guard this control used to branch on is gone since [#1070](https://github.com/pyrycode/pyrycode-desktop/issues/1070).**
It existed because `StatusOrigin` and the relay store's equivalent origin type both admit `null` as a
**real slot key** (an unstamped write lands there), so a `null` id reaching `selectStatusFor`/
`selectRelayLinkStatusFor` would read someone else's cell rather than answering "not known" — the frame
that needed guarding against was the one before the paired-server one-shot resolved. That frame no longer
reaches this control: a host row (and so its `HostConnectionDotsControl`) is drawn *because* an id was
already in the paired list, so the id is always a real one, and `serverId` narrowed from `string | null`
to `string` with the branch deleted. The silent-server collapse above is a different, still-reachable
case — a paired server that has reported nothing yet — and is untouched.

Two reuse decisions survive #1199 unchanged, at the two levels the contract exists on:

- **TypeScript.** `relayLeg`/`daemonLeg`/`ConnectionLeg` are imported straight from
  `conversation/ConversationScreen.tsx` — the established cross-screen-import idiom in this codebase —
  rather than lifted into a shared module first. Order is the design's, and is the *reverse* of
  `ConnectionStatusIndicator(relay, daemon)`'s call site: host/daemon first here, relay first there. Both
  props share one type, so a copied call site would swap them silently; a leg-order test pins it.
- **CSS.** The colour contract lives one level below the TS mapping, in `.conn-dot--up` / `--in-progress` /
  `--down` / `--unknown` — declared in this screen's own `channels.css`, directly below
  `.channel-list__host-dot`, since [#962](https://github.com/pyrycode/pyrycode-desktop/issues/962) moved
  the four rules here from `conversation.css`. The sidebar dot wears the modifier *without* a `.conn-dot`
  base class — `.channel-list__host-dot` supplies 6px geometry only. This keeps the category → colour
  binding to one copy in the renderer, and `e2e/connection-dot-colours.spec.ts` (added by #962) reads the
  shipped `getComputedStyle().backgroundColor` back off all four to guard the CSS-deletion risk directly.
  See [conversation-shell-chrome.md](conversation-shell-chrome.md#two-dot-relaypyrycode-connection-status-leg-mapping-330-its-render-retired-from-this-screen-by-962).

The accessible name is `leg.label` unchanged — "Pyrycode Connected"/"Relay Offline"/"Relay Unknown"/etc. —
on a `role="img"` span (a bare `<span>`'s `aria-label` is dropped by the accessible-name computation, so
this is load-bearing, not decorative). The wrapper carries no role or name of its own, unlike \#330's
`role="group" aria-label="Connection status"`: the host row renders twice, and #670's two-pane layout shows
the conversation status row at the same time, so a per-group name would put three identically-named groups
in one window. The dots add no text node.

"Pyrycode" — not the Figma's "Host" or #710's visible "Server" — was kept as the host leg's label word: any
other word would re-derive the label half of #330's contract, and the dot reports the *daemon session*, not
the machine — a machine can be up while `pyry` is not, and since #1199 that is specifically the paired
server this row names, not any other paired machine.

## The row's pen and plus on hover (#1185)

The host row was the last row family in the sidebar tree with no controls of its own — the workspace row
below it grew a create plus ([#1178](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178))
and an edit pen ([#1180](edit-workspace-dialog.md)); the channel rows had carried theirs since #1172. This
ticket brings the same pair up one level, into the slot the two connection dots (§ above) occupy at rest,
matching the redrawn Host component (Figma 399:1366, Hover variant 399:1408).

**Two new optional, nullary props — `onAddWorkspace?: () => void` and `onEditHost?: () => void`.** Each
control renders only when its own handler is passed, the same withheld-by-presence shape
`WorkspaceRow`'s `create`/`edit` use, minus the bundled label: the two names here are fixed by this
ticket, not by the caller, so there is nothing to bundle. `ADD_WORKSPACE_CONTROL_LABEL = 'Add workspace'`
and `EDIT_HOST_CONTROL_LABEL = 'Edit host'` are module-private constants beside
`CREATE_CHAT_CONTROL_LABEL`, read by each button's `aria-label` and never by the caller. **This is the
security decision the slice turns on, not a convenience**: a `{ label, onEdit }` bundle would have
admitted a caller passing `` `Edit ${hostLabel}` `` — untrusted operator text interpolated into an
attribute, the shape #696's review made a MUST FIX and this row's own header already declines four ways
for `label` itself. With handlers only, there is no field for a name to arrive in.
`ChannelList.test.tsx` pins a sentinel label occurring exactly once in the two-control render, as the
label span's text child and nowhere else.

Nullary rather than `(serverId) => void`, matching `WorkspaceRow`'s `onEdit`: the caller closes over the
machine it is drawing (#1187/#1189 will, against the `serverId` this row already carries), so the id
never becomes an argument this view handles, and `() => void` also refuses a handler declaring a
parameter — React's synthetic event cannot reach it.

**This ticket shipped no caller — since corrected.**
[#1299](#the-edit-host-dialog-1299) (split from #1187) gave `onEditHost` its first caller: every
production host row now draws the pen. `onAddWorkspace`/the plus is still capless, #1189's, so a
hovered row today shows the pen in its slot and an empty one where the plus belongs.

**The swap is guarded on a control actually being drawn, not on the row alone being hovered** — the whole
point of the ticket, and the reason it needed a `:has()` rule rather than the obvious `.channel-list__host:hover
.channel-list__host-status { opacity: 0 }`. With no caller yet, that obvious form would blank the
*shipped* app's connection dots into an empty slot on every hover for as long as #1187/#1189 take.
`channels.css` instead keys the suppression on the row containing a drawn control:

```css
.channel-list__host:hover:has(> .channel-list__host-edit, > .channel-list__host-add)
  .channel-list__host-status,
.channel-list__host:has(
    > .channel-list__host-edit:focus-visible,
    > .channel-list__host-add:focus-visible
  )
  .channel-list__host-status { opacity: 0 }
```

`:has()` over a `~` sibling combinator deliberately: `~` would encode "a control *precedes* the dots in
DOM order," coupling the rule to a DOM order chosen for tab-order reasons alone (see below) and free to
change; `:has()` states the condition actually meant. Electron 33 is Chromium 130, and `channels.css`
already carries one `:has()` consumer (`.channel-list__row:has(> .channel-list__row-open[…])`).
`e2e/host-row-hover-controls.spec.ts` is the one spec that can read this back — the unit tier renders
markup in a node environment and never evaluates CSS. **Rewritten and inverted by
[#1299](#the-edit-host-dialog-1299)** per that ticket's AC5, once the pen had a caller and so a
production row to actually draw it on: the workspace-row calibration instrument described above (hover
a workspace row first, watch its plus, as proof `:hover` reaches the tree at all) is gone, because the
pen's own appearance on the production row is now a positive read that calibrates itself. The spec now
reads, on the production host row alone: at rest the pen sits at opacity 0 and both dots are visible;
hovering brings the pen up first (14×14, right edge 28px in, vertically centred, `--color-primary`) and
only then reads the dots at opacity 0. Deleting the `:has()` guard, or "simplifying" it to a bare
`:hover`, still reddens that read — the plus's two "no button drawn" assertions are untouched, since
that half of the guard is still #1189's.

Both reveals (the pair's suppression, each control's own appearance) use `opacity` and never `display:
none`/`visibility: hidden` — #1171's ruling, load-bearing twice here: a display-none control cannot take
focus, and `e2e/connection-dot-colours.spec.ts`/`host-label-sidebar.spec.ts` count and read the dots'
computed style without ever hovering.

**Geometry**, both boxes 20×20 (`--space-5`) hit targets reusing `.channel-list__workspace-create`'s and
`.channel-list__workspace-edit`'s blocks with the ancestor swapped rather than the shared classes reused
— a shared class would need a `:hover` selector list that grows with every row family that adopts the
control, where a per-row block says where it lives. The plus (`.channel-list__host-add`) sits at `right:
0; top: var(--space-1)`, centring its 16px glyph at right 2 — exactly the dots' own slot (341…359 of the
360-wide content box vs. the plus's 342…358), which is what makes this a *swap* rather than an addition.
The pen (`.channel-list__host-edit`) sits at `right: calc(var(--space-7) - 3px); top: var(--space-1)`,
centring its 14px glyph at right 28, 10px clear of the plus. Both filled `--color-primary`, no
background, no hover circle, `fill="currentColor"`/`aria-hidden="true"` on the SVGs, the file's
`:focus-visible` outline convention. Neither carries a `.channel-list__control-name` pill —
[#1181](channel-list-desktop-row-geometry.md#the-workspace-rows-plus-names-itself-in-a-pill-1181) gave
the workspace pair one, and copying those buttons wholesale would have pulled it in; the host row's pill
is #1190's ticket.

**#1190 inherits an occupied top band, not an empty one.** The Channels section header's own plus grew a
name pill in [#1304](channel-list-section-header-pair-control.md#the-hoverfocus-name-pill-channelscsschannellisttsx-added-by-1304),
and that pill hangs *below* its control (`top: 100%`) rather than centred on its band, landing in this
row's own 12px of top padding. `.channel-list` isn't a stacking context and this row is `position:
relative; z-index: auto` — the same slot as the header — so tree order, not `z-index`, decides: this
row's subtree paints after the header's, and `.channel-list__host-status`/`.channel-list__host-add` paint
*over* that pill, not under it, when both are up at once (reachable: the header's pill on `:focus-visible`
while this row's controls fill on their own `:hover`). #1190's own pill, if placed the same way, would sit
in this same band relative to the *next* row instead.

**The row's right padding goes from 0 to 52px** (`calc(var(--space-8) + var(--space-5))`,
`.channel-list__workspace`'s own value) **in both states, not only on hover** — reserving the trailing
slot unconditionally is what stops a long label re-truncating the moment the pointer arrives. The row
also takes `position: relative` for the first time, which is what lets the two controls (and the dots,
next) position against it rather than against the nearer `.channel-list` containing block — the same
idiom `.channel-list__row` and `.channel-list__workspace-head` already use, and it slots this row into
the same painting step (6) those two already occupy, above the card's hover wash.

**The dots moved from `margin-left: auto` to `position: absolute; right: 0` and did not move by a
pixel.** `margin-left: auto` depended on the row having no other trailing content to push against; once
the row reserves 52px of padding unconditionally, an in-flow auto margin would have parked the dots at
the *padding* edge, 52px short of where they are drawn. `right: 0` resolves against the row's padding
box — its content edge — so the pair stays exactly where #718 and the 2026-09-05 inset fix put it, and
[`host-label-sidebar.spec.ts`'s `ROW_INSET_PX = 0`](channel-list-desktop-row-geometry.md#the-trees-inset-channelscss-the-2026-09-05-inset-fix)
stays literally true. See that page's own note on the now-superseded "right padding goes to 0" bullet.

**DOM order is pen, then plus** — the reverse of `WorkspaceRow`'s plus-first order. Both controls are
absolutely positioned, so order drives neither layout nor the drawn result (the pen still sits left of
the plus), only tab order. `WorkspaceRow`'s own header records its plus-first order as a *cost* forced by
`e2e/sidebar-workspace-create.spec.ts`'s single-Tab assertion, not a preference; no shipped spec
constrains the order here, so this row puts tab order back in visual order instead of propagating that
cost for symmetry's sake. `ChannelList.test.tsx` pins it.

**The pen is now observable end to end; the plus is not, yet.** [#1299](#the-edit-host-dialog-1299) gave
`onEditHost` its caller, so the pen's drawn geometry, its hover reveal, and what clicking it opens are
all covered by e2e now (`e2e/host-row-hover-controls.spec.ts`'s rewrite and the new
`e2e/sidebar-host-edit.spec.ts`, § below). The plus still needs #1189's caller before its geometry and
click behaviour are observable past the static unit tier.

## The Edit host dialog (#1299)

[#1299](https://github.com/pyrycode/pyrycode-desktop/issues/1299) (split from #1187) gave the pen its
first caller: clicking it opens `EditHostDialogView` (new,
`src/renderer/src/screens/channels/EditHostDialog.tsx`), a near-clone of
[`EditWorkspaceDialogView`](edit-workspace-dialog.md) (#1180) that renames the machine through
`window.pyry.setHostLabelFor` (#1186) — the write reaches no daemon: no wire type, no command, no
bridge change.

**Two departures from the sibling dialog, both deliberate.** Save is enabled on a blank name — a host
has no folder name to fall back to the way a workspace does, so blank is the valid way back to the
generic fallback word, and main clears that server's stored entry rather than storing an empty string.
And the dialog carries a round-trip status (`idle` / `saving` / `failed`) the sibling has no use for,
because this write is a promise rather than a fire-and-forget outbound command: Save disables and
freezes the field while `saving`, and an `error` (or an unrecognised) answer renders one client-owned
line (`.edit-host__error`, "Could not save that name") and re-enables Save. **Cancel is never disabled,
in any status** — `ipcRenderer.invoke` carries no timeout, so a main side that never answers would
otherwise leave the dialog frozen with no exit.

**The write helper, `requestSetHostLabel`, tests the recognised arms positively.** `stored`/`not-stored`
map through `mapHostLabel` (the same mapper the reads use) to the value the container writes into
[the window store](host-label-window-store.md); anything else — `error`, a rogue arm, or a rejected
invoke — resolves `null`, meaning "keep the dialog open, write nothing." Written as a negative
`if (status === 'error')` instead, a future or malformed arm would fall through to the mapper, collapse
to `error`, and silently reset the row to the generic word; the positive form makes an unrecognised
answer degrade to the conservative outcome by shape rather than by a branch someone has to keep correct.
Unlike [`loadHostLabelFor`](host-label-window-store.md), this path does **not** write `error` into the
store on failure: a failed read genuinely means "unreadable, show the fallback," but a failed write
means the label is whatever it was before, and recording `error` would invent a state change out of a
refusal. The promise always resolves and the caught rejection is dropped unread, so nothing here can
surface as an unhandled rejection in React or log the label.

**The seed is a different collapse from the one the row displays.** `hostRowLabel` (§ above) turns every
non-name outcome into the fallback word `'Server'`; seeding the field with it would invite the user to
Save that word as the machine's actual name. `hostRowEditSeed(value)` — exported for the same
unit-testability reason `hostRowLabel` is — answers "what is stored" instead: verbatim on `stored`
(including a blank or whitespace-only label, unslimmed — Save is what trims), empty on the other three
arms.

**Container state is three `useState` cells in `ChannelList`** (`editHostServerId`, `editHostName`,
`editHostStatus`), gated on `editHostServerId !== null` rather than truthiness — `isHostLabelServerRequest`
deliberately accepts the empty string as a server id, so a truthy gate would collapse a real machine's
dialog into "none open." The store write on a successful Save is keyed by the id captured in the render
closure before the `await`, never by anything the response carried — `HostLabelResult` names no server
at all, so keying off the response would let one machine's answer land on another machine's row.

**The renderer host-label store gained its second writer.** [Host-label window store](host-label-window-store.md)'s
`setHostLabelFor` used to have exactly one caller, the loader that fills every slot on mount; this
dialog's successful Save is the second, recording main's answer for one slot. The row still only reads,
and nothing feeds a rendered value back into the store — see that page's own note.

**A known gap, left open at merge (code review, non-blocking):** the container's three cells are not
scoped to the interaction that opened them. If a write is slow, the user Cancels and reopens the dialog
on a different machine before it resolves, the late resolution still lands on the *new* interaction's
state — closing a dialog the user just opened, or showing the failure line in a dialog that made no
write at all. The store write itself is unaffected (it is keyed correctly, per above); only the dialog's
own open/closed/failed state can drift. Flagged for the next touch of this surface rather than fixed
here.

**CSS.** `.edit-host*` is its own class family in `channels.css` — a reuse of `.edit-workspace*` or
`.rename-conversation*` would join those classes' Playwright strict-mode match sets and violate rather
than fail an assertion (`e2e/sidebar-workspace-edit.spec.ts`, `e2e/conversation-create-rename.spec.ts`).
Mirrors `.edit-workspace*` declaration for declaration minus the path line, plus a `.edit-host__error`
line on `.save-as-channel__error`'s recipe. **Since [#1300](https://github.com/pyrycode/pyrycode-desktop/issues/1300)
the panel also carries the `max-height: 90%` / `overflow-y: auto` pair `.edit-workspace` has always
had** — this ticket's own comment declined the pair on the premise that everything the panel renders is
client-owned copy or a label bounded at `MAX_HOST_LABEL_LENGTH` inside a single-line input, and #1300
falsified that premise by adding an unbounded relay URL (§ below). The comment was corrected in place
rather than left standing next to code that contradicted it.

**The identity block ([#1300](https://github.com/pyrycode/pyrycode-desktop/issues/1300)).** No Figma
node draws this dialog at all, so the block follows [`EditWorkspaceDialogView`](edit-workspace-dialog.md)'s
own `cwd` line instead: which machine this row actually is, under the field that renames it — the same
`{ serverId, relayUrl }` pair [Settings' Connection → Server row](server-info-channel.md) already shows.
Unlike that one-line precedent, two values need to be tellable apart, so each gets its own caption
(`Server ID`, `Relay`) — a `display: block` `<span>` caption immediately followed by the value as a
direct text child of the same `<p>` (`.edit-host__detail`), `overflow-wrap: anywhere` so a URL with no
space still wraps rather than growing the panel past its `max-width`.

`EditHostDialogView` takes one new prop, `server: ServerInfoValue | null`, rather than the two separate
strings the ticket's own Technical Notes suggested. [`serverInfoStore`](server-info-channel.md)'s state
docblock already rejects an unobservable pair of nullable fields as ceremony without benefit, and the
lookup miss (id present, relay absent) is not a state the container's lookup can ever produce — the
entry is found whole or not at all. One nullable object makes that impossible state unrepresentable
rather than merely untested; the substance (both values arrive as props, the view looks nothing up) is
unchanged. `ChannelList` does the lookup in the one place both halves are already in scope —
`servers.find((entry) => entry.serverId === editHostServerId) ?? null` — so nothing below the container
changes: `renderServerTrees` (§ above) only ever has the bare id to pass down.

On a miss (a reseed or an unpair while the dialog is open) both captions stay and the value slot renders
a client-owned `Unavailable` rather than an empty string or a closed dialog — a blank slot would be
indistinguishable from a value that failed to arrive, and closing would discard an in-progress rename
for a reason that has nothing to do with it. Both values are the same semi-trusted QR/paste-payload text
`pairedServerStore`'s own header calls the id untrusted, reaching this view only as an auto-escaped
React child — `HostRow`'s label already declines four sinks (no `title`, no `aria-label`, no derived
id/key/lookup path, no log line) and this block holds over all four unchanged, plus a fifth the relay
URL specifically needs: **displayed, never dialled** — no `new URL`, no `<a href>`, no `window.open` —
the one value here that invites the opposite instinct.

**Tests.** Unit: `EditHostDialog.test.tsx` (new) covers the chrome, the blank-enabled/round-trip
departures, the length bound measured on the trimmed name, and `requestSetHostLabel`'s three outcomes
against a spy. `ChannelList.test.tsx` extends to cover `hostRowEditSeed`'s four arms and that
`ChannelListView` threads `onEditHost` to every host row. [#1300](https://github.com/pyrycode/pyrycode-desktop/issues/1300)
extends both further: `EditHostDialog.test.tsx` gains the identity block's rendered-text coverage
(populated and per-caption, a long relay URL held whole — the `hostRowLabel` 128-character idiom, the
wrap is CSS and never a slice — and the `server: null` miss rendering `Unavailable` under both
captions), plus the sink guard riding `ChannelList.test.tsx`'s existing SENTINEL idiom rather than a new
one: a sentinel id and a sentinel relay each occurring exactly once, immediately after their own
caption's close. `ChannelList.test.tsx`'s sidebar-side sentinel test gained a line of its own: with the
dialog closed, which every static render is, neither value reaches the sidebar markup either. E2E, fake
tier: `e2e/sidebar-host-edit.spec.ts`
(new) drives Cancel, a blank Save (the clear), a reopen reading the field back empty, a rename visible
on both of one machine's rows while a second paired machine's rows stay untouched, and a Settings
round-trip remount proving the value reached main's at-rest store rather than only the renderer
singleton the Save wrote — a `reuseUserDataDir` relaunch cannot observe this criterion at all, since it
never reconnects, so `renderBody`'s first gate returns `null` and the sidebar draws nothing; recorded
under that spec's own `## Revisions` in
[the architecture spec](../../specs/architecture/1299-edit-host-dialog.md). `host-row-hover-controls.spec.ts`
is inverted rather than replaced — see the correction above. #1300 extends the same spec with the
two-machine identity check: machine A's dialog carries `FIRST_SERVER_ID` and its own relay URL read off
the fixture handle (`${servers[0].forwarder.url}/v1/client`, never a literal — the port is an ephemeral
loopback one), and machine B's pen opens a dialog carrying B's own pair, asserted by exact per-element
text rather than substring (`fake-daemon` is a prefix of `fake-daemon-2`, so a `toContainText` would
pass on the wrong row).

## Related

- [Channel List home screen](channel-list.md) — the parent page: the view-model, the row's save/rename
  affordances, workspace grouping, and the CSS this section's classes live in.
- [Host-label window store](host-label-window-store.md) / [#833](https://github.com/pyrycode/pyrycode-desktop/issues/833) —
  the store `HostRowControl` reads and the loader `<HostLabelData />` mounts; re-keyed by server id in
  [#1199](https://github.com/pyrycode/pyrycode-desktop/issues/1199).
- [Server-info store](server-info-store.md) / [#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148) —
  the paired-server list `HostRowControl` reads `servers[0]` off, and `<ServerInfoData />`, mounted beside
  `<HostLabelData />` in `ChannelList` since #1199.
- [Session store](session-store.md) / [#1133](https://github.com/pyrycode/pyrycode-desktop/issues/1133) and
  [relay-link store](relay-link-store.md) / [#1134](https://github.com/pyrycode/pyrycode-desktop/issues/1134) —
  the two per-server selectors this control reads since #1199, and the app-wide cells it stopped reading.
- [#710 codebase notes](../codebase/710.md) — added the host row heading each tree (Figma `106:3094`), a
  client-owned `'Server'` placeholder label ahead of the operator-typed one.
- [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834) — put the operator's stored label on the
  host row: the `hostRowLabel` four-arm collapse, the `HostRow`/`HostRowControl` split, the
  `<HostLabelData />` mount site, and the label's ellipsize treatment.
- [#718 codebase notes](../codebase/718.md) — added the host row's two trailing connection dots (Figma
  `110:3499`/`106:3114`), reusing [#330's two-leg
  mapping](conversation-shell-chrome.md#two-dot-relaypyrycode-connection-status-indicator-330) across
  screens rather than a second copy of it.
- [#719 codebase notes](../codebase/719.md) — gave the relay leg's `null` sentinel its own
  `unknown`/`Relay Unknown` category instead of collapsing it into `down`/`Relay Offline`; reaches this
  screen's dots via the shared mapping with no edit at the time.
- [#1199 spec](../../specs/architecture/1199-host-row-names-one-server.md) — the per-server re-keying of
  both the label read and the two connection-dot reads.
- [Channel List § Workspace row's own nest and its create-chat plus](channel-list-desktop-row-geometry.md#the-workspace-rows-own-nest-and-its-create-chat-plus-1178) /
  [Edit workspace dialog](edit-workspace-dialog.md) (#1180) — the workspace row's plus/pen pair, one level
  down, that #1185 brought up to the host row; the template rather than a loose analogy.
- #1185 spec — put the pen/plus swap above the two connection dots, guarded on a control actually being
  drawn (`:has()`) so a production row with no caller yet (#1187, #1189) hovers unchanged. See § above.
- [Channel List § Server grouping](channel-list.md#server-grouping-channellistviewmodelts--channellisttsx-added-by-1070) /
  [#1070 spec](../../specs/architecture/1070-sidebar-grouped-by-server.md) — draws one host row (and one
  dot pair) per paired server, in pairing order, by looping `renderServerTrees` over the same
  `serverInfoStore` list this page's `HostRowControl` used to read only `servers[0]` off; narrowed both
  `HostRow.serverId` and `HostConnectionDotsControl`'s to `string`, and amended the id's ban list to allow
  its one remaining use as a React key.
- [Edit workspace dialog](edit-workspace-dialog.md) (#1180) — the dialog § The Edit host dialog above
  clones, one level down: the same overlay/scrim/panel chrome and Name field.
- [Host-label store](host-label-store.md) (#1186) — the main-process keyed SET channel,
  `window.pyry.setHostLabelFor`, this dialog's Save writes through; reaches no daemon.
- [#1299 spec](../../specs/architecture/1299-edit-host-dialog.md) — the Edit host dialog's full design:
  the two departures from `EditWorkspaceDialogView`, the positive-arm write contract, and the
  reopen-while-saving gap recorded under § The Edit host dialog above.
- [#1300 spec](../../specs/architecture/1300-edit-host-dialog-server-id-and-relay.md) — the identity
  block's full design and security review: the one-nullable-object prop shape, the lookup-miss
  placeholder, the `max-height`/`overflow-y` correction, and why the relay URL is displayed but never
  dialled. Recorded under § The Edit host dialog above.
- [Server-info store](server-info-channel.md) — `ServerInfoValue`'s `{ serverId, relayUrl }` shape, the
  `serverInfo` handler's field allowlist, and Settings' Connection → Server row, the one other surface
  showing this same pair.
