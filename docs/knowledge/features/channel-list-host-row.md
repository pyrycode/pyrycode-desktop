# Channel List — the host row and its connection dots

Split out of [Channel List home screen](channel-list.md) to keep that document under the doc-guard's
50000-byte cap (`npm run check:docs`) — this page holds the two `ChannelList.tsx` sections that grew
past it: the sidebar's host row and its two trailing connection dots. Everything else about the screen
(the view-model, the row's save/rename affordances, workspace grouping, CSS) stays on the parent page.

## The host row (`ChannelList.tsx`, added by #710, the operator's label by [#834](https://github.com/pyrycode/pyrycode-desktop/issues/834))

`HostRow({ label, serverId }): JSX.Element` — the file's sixth inline-glyph idiom instance, alongside
`SettingsButton`/`ArchiveButton`/`NewConversationFab`/the row's rename/save buttons — is an **exported
pure view**, mirroring `HostConnectionDots`/`HostConnectionDotsControl` below it (§ next). It renders a
non-interactive `<div className="channel-list__host">` holding a 12px inline Material `dns` (server-rack)
glyph and `<span className="channel-list__host-label">{label}</span>`. A module-private
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
- [Channel List § Server grouping](channel-list.md#server-grouping-channellistviewmodelts--channellisttsx-added-by-1070) /
  [#1070 spec](../../specs/architecture/1070-sidebar-grouped-by-server.md) — draws one host row (and one
  dot pair) per paired server, in pairing order, by looping `renderServerTrees` over the same
  `serverInfoStore` list this page's `HostRowControl` used to read only `servers[0]` off; narrowed both
  `HostRow.serverId` and `HostConnectionDotsControl`'s to `string`, and amended the id's ban list to allow
  its one remaining use as a React key.
