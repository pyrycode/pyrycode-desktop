# Settings screen (scaffold + Connection + Defaults + Notifications + Storage + About sections)

The paired region's third view — `settings`, a sibling of [`list`](channel-list.md) and
[`thread`](conversation-shell.md) — reachable from a new entry button on the Channel List home. A
top-bar (back + "Settings" title) above five sections: "Connection", whose body renders one Server row
per paired server (each showing its own `serverId` + `relayUrl` and an empty host slot for the future
two-dot status indicator — #1148), plus a "Pair another server" nav row that adds another; "Defaults for new
conversations", whose body renders a Default workspace row showing the client-owned default-workspace
preference and opens a picker to change it; "Notifications", whose body renders a single push-toggle
row reflecting and writing the client-owned push-notification preference; "Storage", whose body renders
a live archived-conversations count; and "About", whose body renders the running app's build version.
Mirrors mobile #390/#398, with the relay URL as a documented desktop addition.

Introduced in [#333](../codebase/333.md) as a chrome-only scaffold (the scaffold child of the #150
split; the other child, #332, shipped the data path: [#339](../codebase/339.md)'s IPC surface +
[#340](../codebase/340.md)'s renderer store). [#334](../codebase/334.md) then filled the scaffold's empty
section-body with the store-bound Server row and mounted #340's previously-dormant loader. [#350](../codebase/350.md)
appended the About section, a static version readout sourced from `package.json` at build time (a #151
split sibling). [#351](../codebase/351.md) then inserted a Storage section between Connection and About,
a live archived-conversations count derived from the existing
[conversation list store](conversation-list-store.md) (another #151 split sibling). [#152](../codebase/152.md)
then added a "Pair another server" row below the Server row that re-opens the existing
[pairing screen](pairing-input-screen.md) as a new [paired-shell](paired-shell.md) sub-route, letting the
user switch which daemon desktop drives without a relaunch — the last open follow-up on the #150 line.
[#404](../codebase/404.md) then inserted a Defaults section between Connection and Storage, holding a
single interactive Default-workspace row that reads and writes the [#403](../codebase/403.md)
default-workspace preference and opens the [#383](../codebase/383.md) recent-workspaces picker to change
it (a #352 split sibling — #352 itself split from the #151 line's Defaults/Push follow-ups). [#409](../codebase/409.md)
then inserted a Notifications section between Defaults and Storage, holding a single push-toggle row
that reads and writes the [#408](../codebase/408.md) push-notification preference — the write half of
the #353 push-toggle split (#353 itself split from the #158 push-notifications line; #408, the data
half, shipped first).
[#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148) then widened the Connection section
from one Server row to one per paired server — the read path from the [server-info
store](server-info-store.md) down to the row had stayed single-valued even after
[#1069](paired-server-store.md) keyed the paired-server store by server id, so pairing a second machine
still named only whichever was paired last.
Renderer-only throughout — no keys, sockets, or tokens touched directly (the Server row reads only the
vetted, non-secret `serverId`/`relayUrl` pair off #340's store; the Default-workspace row reads/writes a
renderer-local, non-secret preference and sends no daemon command; the Notifications row reads/writes
another renderer-local, non-secret preference and sends no daemon command either; the Storage row reads
a derived count off the conversation-list store; the About row reads a compile-time constant; the
Pair-another-server row fires pure navigation over the already-vetted pairing IPC surface, #152 security
review PASS) — not security-sensitive except for #152's navigation-only reach into the pairing flow.

## What it does

- A new icon-only **Settings** entry button (gear glyph, `aria-label="Settings"`) renders as the first
  child of the [Channel List](channel-list.md)'s root `<section>`, pinned top-right via CSS, present in
  all three list states (not-yet-loaded / loaded-zero / non-empty).
- Clicking it navigates the [paired shell](paired-shell.md) to a new `settings` route.
- The Settings screen shows a top-bar: a back affordance (`aria-label="Back"`, the same 48px
  `arrow_back` glyph as `ConversationScreen`'s `BackControl`) and a "Settings" title.
- Below the top-bar, one section: a "Connection" heading (`--color-primary`, **not** the muted
  `channel-list__section-header` tone) plus a content container (`.settings__section-body`) that now
  hosts the Server row: a "Server" label, the paired `serverId` as the primary identity line, and the
  `relayUrl` as a secondary line beneath it — or, before the one-shot fetch resolves, a `Loading…`
  placeholder in place of both values. An empty host slot beneath the values is reserved for a future
  two-dot Relay/Pyrycode status indicator (#330's `ConnectionStatusIndicator`, not yet mounted here).
- Directly below the Server row, a "Pair another server" nav row (label + trailing chevron) opens the
  existing pairing flow in place. Confirming a new pairing overwrites the single stored server record
  and the transport reconnects to the new daemon automatically; cancelling returns to Settings with the
  current server untouched — see [#152](../codebase/152.md).
- Below the Connection section, a "Defaults for new conversations" heading (same `--color-primary`
  treatment) precedes a single interactive "Default workspace" row: a primary label over a secondary
  line showing the current default (the stored path verbatim, or the client-owned "scratch" placeholder
  when none has ever been chosen) and a trailing chevron. Activating it opens the recent-workspaces
  picker; choosing an entry writes the new default and closes the picker — see [#404](../codebase/404.md).
- Below the Defaults section, a "Notifications" heading (same `--color-primary` treatment) precedes a
  single row: the label "Push notifications when claude responds" beside a trailing on/off switch
  reflecting the client-owned push-notification preference. Toggling it writes the negated value back
  through the preference store immediately — see [#409](../codebase/409.md).
- Below the Notifications section, a "Storage" heading (same `--color-primary` treatment) precedes a single
  row reading "Archived conversations" with a secondary line — "N archived" for a loaded list (every N,
  including 0 and 1 — no singular/plural branch) or a neutral "—" placeholder before the conversation list
  has loaded. The count is a live derived read: it updates when an archive/restore round trip re-lists.
- Below the Storage section, an "About" heading (same `--color-primary` treatment) precedes a single
  row reading "Version X.Y.Z" — the running app's `package.json` `version`, baked in at build time.
- Back returns to the channel-home `list` view via the paired router's existing `back` transition — no
  new nav event, no stack-aware back.

## Where the detail lives

Each section below keeps the heading it had here, so an existing `#anchor` still resolves once the
link points at the right file.

- [How it works](settings-screen-how-it-works.md) — the route + nav arm, the second guard, the entry
  affordance, the scaffold view, and every section's own row implementation (Pair-another-server,
  Server row(s) + the per-row Unpair action, Defaults, Notifications, Storage, About), the CSS, and
  the full data flow.

## Edge cases and limitations

- **Momentary loading window, not a persistent empty state.** Before the one-shot fetch resolves
  (`servers` still `[]`), `ServerRows` shows a single `Loading…` placeholder row — never a blank or stale
  value. Because Settings mounts only post-pairing, this is a brief window that resolves within a tick,
  not a "not paired" state; the store can't currently distinguish "not yet loaded" from "fetch
  rejected/unavailable" (both are `[]`) — see
  [server-info store](server-info-store.md#edge-cases-and-limitations).
- **The two-dot status slot is intentionally empty.** `.settings__server-status-slot` is a
  class-labelled mount point for a future #330-style indicator; it carries no `aria-label="Connection
  status"` in this slice to avoid colliding with the `thread` view's existing indicator of the same name.
- **No trailing chevron.** Mobile's Server row (17:12) has a navigate-to-detail chevron (17:16); desktop
  has no server-detail screen for it to lead to, so it's omitted rather than rendered dead. The Storage
  row (17:97) omits its own chevron for the same reason — no archive browse screen exists yet (#153/#347).
  The Default-workspace row (#404) is the exception: it **keeps** its chevron, like the Pair-another-server
  row, because it genuinely opens something (the recent-workspaces picker).
- **No client-side way to clear the default back to `null`.** The Default-workspace row's picker only
  ever writes a concrete chosen path via `onChoose`; nothing in the #404 UI calls
  `setDefaultWorkspace(null)`. `null` is reachable today only via a fresh install (no `localStorage` key
  written yet) or by clearing it outside the app. A "reset to scratch" affordance is not in the Figma and
  was out of scope for this ticket.
- **The create-folder picker entry stays inert here.** The Default-workspace row's picker supplies no
  `onCreateFolder`, so the "Other → Create new folder" entry renders disabled — [#398](../codebase/398.md)'s
  `CreateFolderDialog` promotes onto a live conversation, which doesn't exist in the Settings context.
- **The Storage row's `null` vs. `0` distinction is load-bearing and easy to erode.** `conversations:
  null` (not yet loaded) and a loaded `[]` (zero archived) must stay distinct — collapsing them would
  regress the placeholder to a spurious "0 archived" during the brief pre-load window. Any future selector
  added to `conversationListStore` over the same `conversations` slice should preserve this passthrough.
- **The Storage row's populated branch is untestable through `SettingsScreen`'s server-render test** —
  same zustand-v5 gotcha as the Server row: `renderToStaticMarkup` only ever sees the store's initial
  `null`. The count matrix (0/1/5/mixed) is proven on `ArchivedCountRow`'s pure view directly, not through
  the container. The Default-workspace row (#404) has the identical gotcha: under server render
  `defaultWorkspaceStore` hydrates to `null` (its own `typeof window` import guard), so
  `SettingsScreen.test.tsx` only ever exercises the "scratch" placeholder branch — the non-null path
  matrix is proven on `DefaultWorkspaceRowView` directly, and the picker's open/choose interaction isn't
  exercisable under `renderToStaticMarkup` at all (untested reviewed glue, like #383's own container).
  The Notifications row (#409) has the same structural gotcha in the opposite direction: under `node`,
  `pushNotificationPrefStore` always hydrates to the enabled default (its own `typeof window` guard makes
  `storage.read()` return `null`), so a `SettingsScreen`-level render test would only ever see the
  `aria-checked="true"` branch — the full reflect matrix (both states, the `role="switch"` + label +
  native-`<button>` assertions) is proven directly on `PushNotificationRowView` with injected props, not
  through the container, same as the Default-workspace and Storage rows above.
- **No stack-aware back.** `settings` → `back` always lands on `list`; the `pairServer` sub-route added
  by [#152](../codebase/152.md) sidesteps rather than solves this — its two exits are their own explicit
  nav arms (`pairServerCancelled`/`pairServerPaired`), not a reuse of `back`, precisely because a future
  stack-aware `back` from `pairServer` would need to land on `settings`, which is a different resolution
  than the two intents this ticket actually needs. `current` stays in `nextPairedRoute`'s signature for
  exactly this reason — see [paired shell](paired-shell.md).
- **Every row now carries its own Unpair action ([#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162)), closing the gap #1148 opened.** Since #1148 the Connection
  section renders one row per entry in [`pairedServerStore`](paired-server-store.md)'s collection
  (`list()`, oldest-paired first); confirming a new pairing from the Pair-another-server row adds or
  replaces an entry **by server id** (#1069's keyed `save`). #1162 added the removal half: a two-phase
  confirm per row, a re-read of the collection so the departed row leaves without a relaunch, and a
  route flip to the pairing screen conditional on no records remaining — see [How it
  works](settings-screen-how-it-works.md#the-server-rows-serverrowtsx-334-widened-to-a-list-by-1148-given-an-unpair-action-by-1162)
  for the mechanism. What #1162 deliberately does **not** do: scope the app-wide state clear to the
  departed server ([#1150](https://github.com/pyrycode/pyrycode-desktop/issues/1150) owns that) or
  migrate the composer's Re-pair control off the whole-collection channel
  ([#1163](https://github.com/pyrycode/pyrycode-desktop/issues/1163)).
- **A failed per-server unpair has no visible affordance — the row just returns to idle.** No banner,
  no row-local error copy, no session-store degradation (the deliberate reason for the last point).
  Retrying is the affordance: the Unpair button is right there, un-armed. Reddening a richer surface
  needs a main-side throw the fake e2e tier cannot currently drive, so nothing was built for a failure
  that has not been observed — revisit if one is.
- **Whether the surviving server's channel list repopulates after the first of two unpairs is
  deliberately unasserted.** `clearPairingScopedState` does not run on the "records remain" path (see
  [Paired shell § data flow](paired-shell-routing.md)), and whether the surviving connection's rows are
  re-listed depends on a session-status re-assertion this ticket neither owns nor drives. AC3 for #1162
  is worded against the Settings rows and the shell route, both owned outright, rather than against the
  channel list — [#1150](https://github.com/pyrycode/pyrycode-desktop/issues/1150) is what would make
  the channel-list question answerable.
- **Marker collision, worth knowing before writing more `PairedShellView` tests.** The `thread` view
  already renders `aria-label="Connection status"` (the two-dot indicator, [#330](../codebase/330.md)),
  and `list` now renders a button with `aria-label="Settings"` — so neither `"Connection"` nor
  `"Settings"` alone discriminates the `settings` view in a `PairedShellView` render test. Use the root
  `aria-label="Settings screen"` (or `class="settings"`) instead — see
  [#333 codebase notes](../codebase/333.md#lessons-learned).
- **Settings entry corner is a free CSS swap.** Top-right sticky was the developer's call against the
  mobile home mock; no Figma node pins it, and the AC only required presence + an accessible name.
- **A `define` added to `electron.vite.config.ts` alone is invisible to `npm test`.** `vitest.config.ts`
  is a separate Vite config; any future compile-time renderer constant needs the same `define` mirrored
  into both, or the render test throws `ReferenceError` at transform rather than failing the assertion
  (#350).
- **The "Version 0.1.0" test assertion is coupled to `package.json`'s current version** and needs a
  one-line update on the next version bump — accepted deliberately since deriving it dynamically in the
  test would need its own JSON import, blocked by the same missing `resolveJsonModule` (#350).
- **No build-hash sub-line.** Desktop has no wired build-metadata source; the Figma's "build a8f3c2d" row
  is deferred to a follow-up.

## Related

- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the `list ⇄ thread ⇄ settings` router
  this screen fills the third arm of.
- [Channel List home screen](channel-list.md) / [#141](../codebase/141.md) — hosts the new entry button;
  its "Deferred visual elements" note about a future settings gear is now partially resolved by this
  ticket (the entry exists; the top app bar it was originally imagined inside still doesn't).
- [Server-info store](server-info-store.md) / [#340](../codebase/340.md) — the store and loader
  [#334](../codebase/334.md) mounts and reads for the Server row.
- [Conversation list store](conversation-list-store.md) / [#208](../codebase/208.md) — the store
  [#351](../codebase/351.md)'s `selectArchivedCount` selector reads, kept live by the same
  `ConversationListData` bridge the Channel List home also depends on.
- [Default-workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) —
  the client-owned preference [#404](../codebase/404.md)'s Default-workspace row reads and writes; this
  screen is that store's only UI consumer.
- [Push-notification preference store](push-notification-preference-store.md) / [#408 codebase
  notes](../codebase/408.md) — the client-owned preference [#409](../codebase/409.md)'s Notifications
  row reads and writes; this screen is that store's write consumer (the read consumer, #392, is
  separate — the delivery-side [Push notifications](push-notifications.md) trigger, still open).
- [Conversation shell](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) / [#383 codebase notes](../codebase/383.md)
  — `WorkspacePickerSheetView`, the pure picker view [#404](../codebase/404.md) reuses (not its
  conversation-coupled container).
- [Recent-workspaces store](recent-workspaces-store.md) / [#382 codebase notes](../codebase/382.md) —
  the store + `RecentWorkspacesData` bridge [#404](../codebase/404.md)'s picker sheet mounts while open.
- [#330 codebase notes](../codebase/330.md) — the `ConnectionStatusIndicator`/`Control` view/container
  precedent `ServerRow`/`ServerRowControl` follows, and the `aria-label="Connection status"` marker this
  screen's empty host slot deliberately avoids duplicating.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — the ephemeral-state rule
  `PairedShell`'s `useReducer` (and this ticket's added arm) follows.
- [#333 codebase notes](../codebase/333.md) · Spec: `docs/specs/architecture/333-settings-screen-scaffold.md`
- [#334 codebase notes](../codebase/334.md) · Spec: `docs/specs/architecture/334-settings-connection-server-row.md`
  — fills this screen's Connection section-body with the Server row.
- [#350 codebase notes](../codebase/350.md) · Spec: `docs/specs/architecture/350-settings-about-version.md`
  — appends the About section and its version readout; a #151 split sibling of #351/#352/#353.
- [#351 codebase notes](../codebase/351.md) · Spec: `docs/specs/architecture/351-settings-storage-archived-count.md`
  — inserts the Storage section and its archived-count row between Connection and About; a #151 split
  sibling of #350/#352/#353.
- [#152 codebase notes](../codebase/152.md) · Spec: `docs/specs/architecture/152-pair-another-server-from-settings.md`
  — adds the "Pair another server" row and the `pairServer` sub-route it opens; the last open follow-up
  on the #150 line for the Connection section.
- [#1148](https://github.com/pyrycode/pyrycode-desktop/issues/1148) · Spec:
  `docs/specs/architecture/1148-settings-lists-every-paired-server.md` — widens the Connection section to
  one `ServerRow` per paired server via the new `ServerRows` view; the first of #1090's four slices,
  and what [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162)'s per-server Unpair hangs on.
- [Unpair channel](unpair-channel.md) / [#1149](https://github.com/pyrycode/pyrycode-desktop/issues/1149) —
  the per-server erase channel this screen's Unpair action calls; #1149 shipped it with no caller, #1162
  is the first one.
- [#1162](https://github.com/pyrycode/pyrycode-desktop/issues/1162) · Spec:
  `docs/specs/architecture/1162-per-server-unpair-from-settings.md` — the interim per-server Unpair home
  (#1090's decision), wiring the row action, the confirm, the list refresh and the conditional route
  flip; see [How it works](settings-screen-how-it-works.md) for the mechanism. Split from #1152, which
  is otherwise exhausted as a parent (split depth capped at #1090 → #1152 → #1162).
- [#403 codebase notes](../codebase/403.md) · Spec: `docs/specs/architecture/403-default-workspace-persist-apply.md`
  — the data half of the Defaults section: the persisted store and its read/write seam, no UI.
- [#404 codebase notes](../codebase/404.md) · Spec: `docs/specs/architecture/404-default-workspace-row.md`
  — inserts the Defaults section and its Default-workspace row between Connection and Storage; a #352
  split sibling of #403 (data half) and #405 (model/effort/YOLO rows, still daemon-blocked).
- [#409 codebase notes](../codebase/409.md) · Spec: `docs/specs/architecture/409-push-toggle-ui.md`
  — inserts the Notifications section and its push-toggle row between Defaults and Storage; the write
  half of the #353 split (data half: [#408](../codebase/408.md)).
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the reused
  `PairingScreen` paste→review→confirm flow #152 re-opens as a paired sub-route.
- Remaining follow-ups: #158 split sibling #392 (the renderer trigger reading [#409](../codebase/409.md)'s
  preference to gate [push notifications](push-notifications.md)), blocked-by the now-merged #353 line
  but not yet built; #352 split sibling #405 (model/effort/YOLO rows of the Defaults section),
  daemon-blocked.
