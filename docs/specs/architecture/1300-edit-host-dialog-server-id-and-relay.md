# #1300 — the Edit host dialog shows the row's server id and relay URL

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/renderer/src/screens/channels/EditHostDialog.tsx` | `EditHostDialogView` | The view this ticket extends: its prop list, its sink declines, its `EDIT_HOST_TITLE_ID` / error-copy constants |
| `src/renderer/src/screens/channels/EditWorkspaceDialog.tsx` | `EditWorkspaceDialogView` | The recipe being followed: one bare `cwd` line under the Name field, and the header's stated reason for having no caption |
| `src/renderer/src/screens/channels/ChannelList.tsx` | the `ChannelList` container | Holds `servers` (off `selectServers`) and `editHostServerId` in the same component that renders the dialog — the lookup site |
| `src/renderer/src/store/serverInfoStore.ts` | `ServerInfoValue`, `selectServers` | The `{ serverId, relayUrl }` entry shape, and the store docblock's own "an unobservable impossible-state pair is ceremony without benefit" ruling, which decides the prop shape below |
| `src/renderer/src/screens/settings/ServerRow.tsx` | `ServerRow` | The one shipped surface showing these two values today — untouched by this ticket, and the precedent for a client-owned placeholder in the values' slot |
| `src/renderer/src/screens/channels/channels.css` | `.edit-host`, `.edit-workspace`, `.edit-workspace__path` | The panel comment this ticket falsifies, the `max-height`/`overflow-y` pair being adopted, and the wrap recipe being copied |
| `src/renderer/src/screens/channels/EditHostDialog.test.tsx` | the `EditHostDialogView` describe | The `renderView` helper every new assertion rides, and the shipped "no `title=`, no `aria-label=`" guard the new lines must not redden |
| `src/renderer/src/screens/channels/ChannelList.test.tsx` | `countOf`, `SENTINEL`, `never interpolates a server id into the markup, key included` | The SENTINEL idiom the Technical Notes point at, and the sidebar-side id-absence guard that must stay true |
| `e2e/sidebar-host-edit.spec.ts` | the whole drive | The spec being extended; its `secondServer: {}` launch already pairs both machines |
| `e2e/fixtures/launchPairedApp.ts` | `FIRST_SERVER_ID`, `SECOND_SERVER_ID`, `PairedServerHandle`, the `servers` handle | Where the ids come from as constants and the relay URL comes from as `${forwarder.url}/v1/client` — never a literal |
| `src/main/serverInfoHandler.ts` | the `serverInfo` handler | Confirms `relayUrl ← record.relay`, the at-rest paired record, so the e2e's expected URL is exactly what the fixture paired with |
| `docs/knowledge/features/channel-list.md` | § Host row | Prior-ticket lessons on this surface; the doc phase folds this ticket in there |

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=102-498

N/A for these lines specifically — no node draws the Edit host dialog, verified against the file 2026-09-08 (the Desktop page's Dialogs section holds Rename, Save as Channel, Create Folder and Paste Code only). The node above is the Rename dialog, whose chrome `EditHostDialogView` already mirrors declaration for declaration. The two lines this ticket adds follow `EditWorkspaceDialogView`'s path line instead: a muted body-small block sitting under the Name field, inside the same 16px panel column, wrapping rather than ellipsizing.

## Context

#1299 shipped the Edit host dialog with a Name field and two actions. It can rename a machine but it cannot tell you *which* machine — the row it opened from is behind an opaque modal by then. This adds the identifying detail: the row's own server id and relay URL, the same pair Settings' Connection → Server row shows, which is what turns the dialog into a place to check a host rather than only rename one.

Both values are the client's own. They come from `serverInfoStore`, filled from `window.pyry.serverInfo()` out of main's paired records — never from the wire. A daemon-supplied lookup would let a confused or hostile server put one machine's details on another machine's row.

No ADR is warranted: this is one view gaining two display lines on an established recipe.

## Design

### The view — one nullable prop, not two strings

`EditHostDialogView` gains **one** prop:

```ts
server: ServerInfoValue | null
```

**A single object prop rather than the two separate `serverId` / `relayUrl` strings the ticket's Technical Notes suggest**, and the reason is the store's own. `serverInfoStore`'s state docblock rejects `ServerInfoValue[] | null` because it would add a distinction no consumer reads — "an unobservable impossible-state pair, which is the same *ceremony without benefit* test that kept this store's mutation a setter rather than a reducer". Two nullable strings here reproduce exactly that pair: an id present with the relay absent is not a state the lookup can produce, because the miss is **atomic** — the entry is found whole or not at all. One prop makes the impossible state unrepresentable instead of merely untested. The refiner's substance — both values arrive as props from the container, the view never looks anything up — is unchanged.

The type is imported `type`-only from `serverInfoStore`, so the view stays React-pure and DOM-free.

### The rendered shape — a captioned pair, not two bare lines

`EditWorkspaceDialogView` renders its one path line bare and says why: one line needs no caption. Two do. A relay URL announces itself (`ws://`, `wss://`); an opaque server id does not, and a reader who cannot name the second value has not been told which machine this is.

So each value is a captioned block on the Name field's own label-over-value shape — the caption reads as a caption because the panel already uses that shape one element up:

```
<div class="edit-host__details">          ← one panel child, so the 16px column gap stays between field and block
  <p class="edit-host__detail">
    <span class="edit-host__detail-label">Server ID</span>   ← display: block, label-small, muted
    {server.serverId}                                        ← escaped React child, body-small, muted
  </p>
  <p class="edit-host__detail">
    <span class="edit-host__detail-label">Relay</span>
    {server.relayUrl}
  </p>
</div>
```

The value is a **direct text child of the `<p>`**, not a third span. The caption span is `display: block`, so ordinary inline flow puts the value on its own line under it and `overflow-wrap: anywhere` on the `<p>` breaks a URL that carries no space. Adding a value span would buy a locator and cost a nesting level; the e2e reads the values off `.edit-host__detail` text instead, minus the caption, which is the same information.

Both captions are client-owned constants (`Server ID`, `Relay`), apostrophe-free — `renderToStaticMarkup` escapes `'` to `&#x27;`, the standing desktop lesson.

### The miss

`servers` can empty under an open dialog (a reseed, an unpair). The lookup then answers `null` and **each line keeps its caption and renders a client-owned word in the value slot**:

```ts
const EDIT_HOST_DETAIL_UNAVAILABLE = 'Unavailable'
```

Three properties this buys, each of which the ticket asks for by name:

- **Not a crash.** `server === null` is a rendered arm, not a dereference.
- **Not a blank.** An empty value slot is indistinguishable from a real value that failed to arrive; a word is not.
- **Not mistakable for a value.** The reader gets the caption *and* a statement that the value is missing, rather than a caption over nothing. It is `ServerRow`'s `SERVER_ROW_LOADING` posture applied to the two slots that can go absent together.

The dialog is **not** closed on a miss and the lines are **not** dropped: closing would destroy a rename the user is mid-way through for a reason that has nothing to do with the rename, and dropping them would make the panel jump.

### The container

`ChannelList` already holds both halves in the same component. Inside the existing `editHostServerId !== null` gate:

```ts
server={servers.find((entry) => entry.serverId === editHostServerId) ?? null}
```

`find` answers `undefined` on a miss; `?? null` normalises it to the view's one absent form. No helper is extracted for a single expression, and nothing below the container changes: `renderServerTrees` receives `readonly string[]` and cannot supply these, which is why `ChannelListView`, `renderServerTrees`, `HostRowControl` and `HostRow` are all untouched.

### CSS — and the panel bound #1299 declined

`.edit-host` gains `max-height: 90%` + `overflow-y: auto`, the pair `.edit-workspace` already carries. **The existing `.edit-host` comment states the opposite and is corrected, not left standing**: its premise was that every string the panel renders is client-owned copy or a label bounded at `MAX_HOST_LABEL_LENGTH` inside a single-line input. A relay URL is unbounded and wraps, so without the pair a long one grows the panel past the window with its actions off-screen.

Three new rules, on `.edit-workspace__path`'s recipe:

- `.edit-host__details` — a flex column at a tighter gap (`--space-2`) so the pair reads as one block inside the panel's 16px column.
- `.edit-host__detail` — `margin: 0`, muted body-small, `overflow-wrap: anywhere`.
- `.edit-host__detail-label` — `display: block`, muted label-small (the `.edit-host__label` mapping).

No `min-width: 0` is needed anywhere: `.edit-host__details` is a flex **column**, so the `min-width: auto` floor (main-axis only) does not apply to its children's width, and the `<p>` blocks take the panel's bounded width and wrap inside it.

## State + concurrency model

None added. The view stays pure, the container's three `useState` cells are unchanged, no new store slice, no async work, no subscription, no effect and so no teardown. `servers` is already subscribed through `useServerInfoStore(selectServers)` for the host rows; the dialog re-reads the same slice on the same re-render.

## Error handling

One failure mode, the lookup miss, handled above as a rendered arm rather than a thrown error or a typed result — this path performs no I/O, so there is no boundary to return a result across. `EditHostSaveStatus` and the save round-trip are untouched: the details block renders identically in `idle`, `saving` and `failed`, because which machine the dialog names does not depend on whether a write is in flight.

## Testing strategy

**vitest — `EditHostDialog.test.tsx`** (the only file that renders this dialog; the container renders no dialog under a static render, since `editHostServerId` starts `null`):

- Both values render as text under the Name field, given a populated `server` prop (AC1).
- Each value is reachable under its own caption, so a reader can tell which line is which (AC1).
- A long relay URL is held **whole** — the wrap is CSS, never a slice (AC1). The `hostRowLabel` 128-character idiom.
- `server: null` renders both captions with the client-owned word, and no empty value slot (the miss).
- **The sink guard, on `ChannelList.test.tsx`'s SENTINEL idiom rather than a new one**: sentinel id and sentinel relay, each occurring **exactly once** in the markup and immediately after its own `<p>` caption's close — which catches `title=`, `aria-label=`, an id, a key, a class-name interpolation and any attribute nobody thought to ban, in one assertion per value (AC3). Plus the shipped `not.toContain('title=')` / `not.toContain('aria-label=')` pair, which the new lines must leave green.
- A hostile id and a hostile relay render as inert escaped text, never live markup — the delimiters, not the payload's words.

**vitest — `ChannelList.test.tsx`**: the shipped `never interpolates a server id into the markup, key included` test keeps the sidebar side honest and gains a line for this ticket — with the dialog closed, which is every static render, neither value reaches the sidebar markup.

**Playwright fake tier — `e2e/sidebar-host-edit.spec.ts`**, extending the existing two-server launch rather than adding one:

- Machine A's dialog carries `FIRST_SERVER_ID` and `${servers[0].forwarder.url}/v1/client`, read off the fixture handle — never a literal, the port being ephemeral (AC1).
- Machine B's pen opens a dialog carrying B's own pair, not A's (AC2). Exact per-element text matching, not substring: `fake-daemon` is a prefix of `fake-daemon-2`, so a `toContainText` would pass on the wrong row.
- Each assertion is a **positive auto-waiting read** before any absence or mutation check, and the shipped `[title]` / `[aria-label]` count-0 assertions inside the open dialog now cover the new lines too (AC3).

## Open questions

1. **Caption pair or self-evident shape?** Resolved in Design above: a caption pair. A relay URL is self-describing, an opaque server id is not, and the requirement is that a reader can tell *which line is which* — which a bare id under a bare URL does not deliver.
2. **What the dialog shows on a lookup miss.** Resolved in Design above: captions kept, a client-owned `Unavailable` in each value slot, dialog stays open.
3. Whether a long relay URL needs the panel scroll pair at all, or whether `overflow-wrap: anywhere` alone suffices. Resolved: the pair lands. Wrapping bounds the *width*; nothing bounds the *height* an arbitrarily long URL adds, and `.edit-workspace`'s own comment says not to drop them on the reasoning that the neighbours barely need them.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary, and the two values are named for what they are: **semi-trusted**. `record.server` and `record.relay` are QR/paste-payload fields held verbatim — `pairedServerStore.ts`'s own header says so ("the `server` id is untrusted QR/paste input"). They reach the renderer through the shipped `serverInfo` handler, which crosses exactly those two keys per entry and no other record field (pinned by `serverInfoHandler.test.ts`'s `Object.keys(entry).sort()` assertion). This ticket adds no IPC channel, no bridge method and no parse; it holds both as **display strings** whose only sink is an auto-escaped React child.
- **[Tokens, secrets, credentials]** No finding, and the reason is a check rather than an assumption: `parsePairingPayload` rejects `relay-has-credentials` whenever the URL carries a `username` or `password`, and that check sits **after** the policy verdict, so it applies on every accepted host including the dev loopback. No stored `relay` can carry embedded credentials, so rendering one to screen cannot print one. The token and the static pubkey are structurally absent from `ServerInfoValue`.
- **[File / storage operations]** Not applicable by an explicit decision, not by absence of thought: neither value becomes a filename, a cache key, a lookup path or a storage-key segment. `pairedServerStore` records why that matters — it keeps `PAIRED_SERVER_NAME` one fixed name rather than deriving it from the untrusted id, and this surface must not reintroduce what that avoided.
- **[Inter-process / Electron attack surface]** No finding. No `contextBridge` addition, no `ipcMain` channel, and no `window.pyry` dereference anywhere in the diff — the values arrive through `<ServerInfoData />`, mounted in this container since #1199. No new capability crosses the bridge and no window preference changes.
- **[Cryptographic primitives]** Not applicable — no primitive, no RNG, no comparison against a secret is touched.
- **[Network & I/O]** No finding, and one decision worth stating because the reflex points the other way: the relay URL is **displayed, never dialled**. No `new URL()`, no `<a href={relayUrl}>`, no `window.open`, no fetch. An anchor here would turn a semi-trusted string into a navigation sink; a bare escaped child does not.
- **[Error messages, logs, telemetry]** No finding. Nothing this ticket adds calls `console.*`, matching `EditHostDialog.tsx`'s stated rule that any useful line on this path would carry operator content. The miss placeholder is a client-owned constant interpolating neither value, on `EDIT_HOST_ERROR_COPY`'s recipe. The e2e comparands are harness-owned (`FIRST_SERVER_ID` and the fixture's own loopback URL), so a failure diff on this tier can print only what the fixture minted — the file's stated secret-hygiene rule, restated in the spec's comment rather than assumed.
- **[Concurrency]** Investigated, not waved through. `servers.find((entry) => entry.serverId === editHostServerId)` would show the wrong machine's relay if two entries shared a `serverId`. It cannot: `pairedServerStore` treats a repeated `server` id as **malformed** on decode, and `save` adds-or-replaces by key (`entries.filter((entry) => entry.server !== record.server)` then append), so the id is unique at two layers — and the store's own retrieval uses the identical `find` shape. Separately, the displayed pair cannot disagree with the write target: both derive from the same `editHostServerId` cell in the same render, and the save arrow fixes the id before its await. No async work, no listener and no timer is added, so there is nothing new to cancel.
- **[Threat model alignment]** The hostile-daemon arm is the ticket's central claim and it is inherited rather than newly built: `serverInfoHandler` reads the **at-rest record, never a live `hello_ack` value**, so a confused or hostile server cannot put one machine's details on another machine's row. A malicious relay is on-path but content-blind and never touches this path — the values never leave the client. A renderer compromise gains nothing new, since no capability was added.
- **[Display integrity — bidi/homoglyph]** OUT OF SCOPE, named rather than skipped. Both values are unbounded free-form strings (`parsePairingPayload` requires only non-empty), so a bidirectional override (U+202E) or a homoglyph could make one machine's id render as another's on a surface whose whole purpose is *checking* which machine this is. It is deferred, and deliberately so: `ServerRow` renders the same two values with no such filter, and sanitising one of the two surfaces would leave the inconsistency as the new hazard. If it is wanted it is one ticket covering both surfaces together. The length half of the same concern **is** addressed here — `overflow-wrap: anywhere` on both lines plus the panel's new `max-height`/`overflow-y` pair bounds an arbitrarily long id as well as an arbitrarily long URL.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
