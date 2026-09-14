# Channel List — the host row and its connection dots

Split out of [Channel List home screen](channel-list.md) to keep that document under the doc-guard's
50000-byte cap (`npm run check:docs`) — this page holds the two `ChannelList.tsx` sections that grew
past it: the sidebar's host row and its two trailing connection dots. Everything else about the screen
(the view-model, the row's save/rename affordances, workspace grouping, CSS) stays on the parent page.

## The host row (`ChannelList.tsx`, added by #710, the operator's label by [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834))

`HostRow({ label, serverId, onAddWorkspace?, onEditHost?, failed?, onRepair? }): JSX.Element` — the file's sixth inline-glyph
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

`HostRowControl` also reads that server's session status. Any `error` gives the row its
`channel-list__host--failed` treatment: error-colored glyph and label, plus the primary-colored
`Repair host` button beside the two dots. The normal pen/plus are withheld in this state; the
workspace subtree remains. Repair is a real button, visible at rest with a focus outline, and
delegates the saved server ID to [shell recovery](paired-shell-routing.md#host-recovery-and-navigation-lifetime).
The unchanged plug SVG lives at `src/renderer/public/repair-plug.svg` and is used as a `currentColor`
mask. Importing it through Vite inlined a data URL blocked by the renderer CSP. The recovery
interaction test decodes the mask image: button visibility alone cannot prove the glyph loaded.

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
remount on return from `settings`/`archive` or ordinary full-screen pairing, which re-reads both
one-shots, keeping a
mid-session re-pair (Settings → "Pair another server") from leaving a stale name or a missing server id on
the row. This is also why neither [host-label window store](host-label-window-store.md) nor
`serverInfoStore` needs to be in `clearPairingScopedState`: the remount-driven re-read already resolves the
staleness either store's own edge-case notes once flagged as unresolved. Host recovery keeps the
sidebar mounted instead; its confirmation callback explicitly refreshes `serverInfoStore`, including
the saved-order change from a same-host upsert. The label loader reacts to that refreshed list.

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

An unreported host's offline-looking dots are only a display fallback. Connection-status changes
never open repair or change the current view; the user opens recovery explicitly through `Repair host`
or the composer's Re-pair action. `daemonLeg` announces a classified rejection as
`Pyrycode Pairing rejected`, while ordinary failures remain `Pyrycode Offline` and an in-progress
connection remains `Pyrycode Connecting`. The relay mapping is independent, so rejection may still
sit beside `Relay Connected`. See [Session store](session-store.md#one-slot-per-server-since-1133).

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

**This ticket shipped no caller for either handler — both since corrected.**
[#1299](#the-edit-host-dialog-1299) (split from #1187) gave `onEditHost` its first caller, and
[#1308](#the-add-workspace-dialog-1308) gave `onAddWorkspace` its own. Since #1367,
`HostRowControl` supplies the plus only for `selectStatusFor(serverId).type === 'connected'`
and rechecks that host's current session state when invoked. Missing, connecting,
disconnected and failed states withhold it; another connected host or relay reachability
cannot enable Add workspace. Existing error-host recovery controls retain their treatment.

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
`:focus-visible` outline convention. **Both wear `.channel-list__control-name` — the shipped pill
(#1172) — since [#1190](#the-rows-pen-and-plus-on-hover-1185).**
[#1181](channel-list-desktop-row-geometry.md#the-workspace-rows-plus-names-itself-in-a-pill-1181) gave the
workspace pair one first; #1190 brought it up to the host row with no new drawing declaration, appending
one `<span className="channel-list__control-name" aria-hidden="true">` after each control's `</svg>` —
appended, not prepended, which is load-bearing: `ChannelList.test.tsx` pins each glyph's whole opening run,
so a pill placed in front of it would redden the static tier. Each span reads the same
`EDIT_HOST_CONTROL_LABEL`/`ADD_WORKSPACE_CONTROL_LABEL` constant its own button's `aria-label` already
reads, so the spoken and the drawn name cannot drift apart; `aria-hidden` is belt-and-braces rather than
the mechanism, since a button's `aria-label` already overrides child text for the accessible name. Four
`channels.css` selectors — one hover/focus-visible pair per control — trigger `display: block` on the
**control's own** `:hover`/`:focus-visible`, never the row's: the whole of AC1's "hovering the row's label
shows nothing," and a deliberately different scope from the glyph's own reveal three paragraphs up, which
hangs off the row so the glyph is already there when the pointer arrives at a 20px box it could not
otherwise see. While one pill is up it covers the other control's glyph or the trailing part of the
machine label — accepted on #1172's and #1181's precedent, since `pointer-events: none` on the shared
block lets a click or a hit test land on the row underneath regardless.

**The band placement is reused verbatim, and the Channels host row clears the sticky actions cluster
with room to spare.** The Channels section header's own plus hangs its name pill *below* its control
(`top: 100%`) rather than on the shared band
([#1304](channel-list-section-header-pair-control.md#the-hoverfocus-name-pill-channelscsschannellisttsx-added-by-1304)),
because the sticky `.channel-list__actions` cluster's `top` resolves against the scrollport's *content*
box and so lands 4px *inside* that header at scroll top. The first host row of a section sits one whole
header box lower — 20px of content line plus 12px of bottom padding, with
`.channel-list__section-header + .channel-list__host` taking no margin — so at scroll top this pill's top
edge clears the cluster's bottom edge by ~30px (measured on the running window: row centre y 118, pill top
y 106, cluster bottom y 76). #1304's `top: 100%` deviation was therefore not needed here: the shared band
(`right: 0; top: 50%; transform: translateY(-50%)`) is reused unmodified, and
`e2e/sidebar-host-row-control-name-pill.spec.ts` reads that clearance back as a runtime relation between
the two edges rather than trusting the prediction — a cluster that grows or a sticky offset that changes
would redden it. Which of the spec's own assertions actually catches a wrong placement is row-specific
and not interchangeable with the header's own spec: re-pointing the pen's pill at #1304's `top: 100%;
transform: none` reddens the **band** assertion here, by exactly 22px, and leaves the actions-edge and
containment reads green — the opposite of what the same mutation does on the section header, where 30px
of slack from the header sitting between the row and the cluster means no placement a reader would
plausibly write closes the gap. Each pill spec has to re-measure its own detector rather than copy a
sibling's answer.

**Superseded by [#1443](https://github.com/pyrycode/pyrycode-desktop/issues/1443).** The bar moved
outside the scroller entirely, so the 30px of slack measured above became the whole tree: the clearance
now holds by construction rather than against a live sticky edge. The assertion is kept rather than
deleted — it still reads a relation between two live boxes and would catch a bar that grew back down into
the tree — but as this paragraph already states, it was never the detector for a wrong placement here;
the band assertion is, and stays unchanged by #1443.

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

**Both controls are now observable end to end.** [#1299](#the-edit-host-dialog-1299) gave `onEditHost` its
caller and [#1308](#the-add-workspace-dialog-1308) gave `onAddWorkspace` its own, so each control's drawn
geometry, its hover reveal, and what clicking it opens are all covered by e2e now
(`e2e/host-row-hover-controls.spec.ts`'s rewrite, twice, plus `e2e/sidebar-host-edit.spec.ts` and
`e2e/sidebar-add-workspace.spec.ts`, § below).

## The Edit host dialog (#1299)

Split into its own page, [Edit host dialog](edit-host-dialog.md), once this page neared the doc-guard's
byte cap. [#1299](https://github.com/pyrycode/pyrycode-desktop/issues/1299) (split from #1187) gave the
pen — drawn with no caller since [#1185](#the-rows-pen-and-plus-on-hover-1185) — its first caller: a
near-clone of [`EditWorkspaceDialogView`](edit-workspace-dialog.md) that renames the paired machine
through `window.pyry.setHostLabelFor` (#1186), reaching no daemon.
[#1300](https://github.com/pyrycode/pyrycode-desktop/issues/1300) then added an identity block showing
the machine's server id and relay URL. See [Edit host dialog](edit-host-dialog.md) for the full design:
the departures from the sibling dialog, the write helper's positive-arm contract, the identity block, and
the reopen-while-saving gap left open at merge.

## The Add workspace dialog (#1308)

Split into its own page, [Add workspace dialog](add-workspace-dialog.md), for the same reason.
[#1308](https://github.com/pyrycode/pyrycode-desktop/issues/1308) gave the plus — also drawn with no
caller since #1185 — its first caller: a near-clone of [`CreateChannelDialogView`](create-channel-dialog.md)
with a round trip added, closer in shape to [the Edit host dialog](edit-host-dialog.md) than to its own
template. Sends `requestNewWorkspaceChat`, a third sibling beside `requestNewConversation`/
`requestNewChannel`. See [Add workspace dialog](add-workspace-dialog.md) for connection
gating, host-scoped results, the 30-second uncertain outcome, explicit retry and safe text sinks.

## Related

- [Channel List home screen](channel-list.md) — the parent page: the view-model, the row's save/rename
  affordances, workspace grouping, and the CSS this section's classes live in.
- [Edit host dialog](edit-host-dialog.md) (#1299) / [Add workspace dialog](add-workspace-dialog.md)
  (#1308) — split out of this page once it neared the byte cap; the two dialogs the row's pen and plus
  open, § above.
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
- [#1299 spec](../../specs/architecture/1299-edit-host-dialog.md) / [#1300
  spec](../../specs/architecture/1300-edit-host-dialog-server-id-and-relay.md) — the Edit host dialog's
  full design and the identity block's security review; recorded on [that dialog's own
  page](edit-host-dialog.md).
