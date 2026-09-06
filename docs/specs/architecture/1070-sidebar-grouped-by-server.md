# #1070 — group each sidebar section by server, then by workspace

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `renderBody` — the seam: it partitions the flat
  list into two sections and calls `groupByWorkspace` once per section. The server level goes above the
  workspace level here.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRowControl` — reads `servers[0]` today; its
  own header says "#1070 turns this read into the loop that draws one row per paired server."
- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRow`, `HostConnectionDotsControl` — the
  `serverId: string | null` prop and the `serverId === null` collapse branch #1199 added for the
  before-the-list-resolves frame.
- `src/renderer/src/screens/channels/ChannelList.tsx` → `ChannelList`, `ChannelListView` — the
  container-reads / pure-view split, and `openConversationId`'s header, which is the ruling this plan
  reuses for the server list: a store read inside a row can only ever render the initial cell under
  `renderToStaticMarkup`, so state the unit tier must vary arrives as an injected prop.
- `src/renderer/src/screens/channels/channelListViewModel.ts` → `groupByWorkspace`, `workspaceLabelFor`,
  `partitionActive` — the grouper whose key is the raw `cwd`, and the `Map`-not-object reasoning this
  plan's new sibling copies.
- `src/renderer/src/store/conversationListStore.ts` → `ServerConversationSummary`,
  `ConversationListOrigin`, `selectConversations`, `selectConversationsFor` — the row's server stamp, its
  three-case domain, and the "CALL IT WITH A CLIENT-HELD ID" rule this ticket's join obeys.
- `src/renderer/src/store/serverInfoStore.ts` → `selectServers`, `ServerInfoValue` — the paired-server
  list in `pairedServerStore.list()` order (oldest-saved first), and the fact that `selectServers` hands
  back the held array **by reference**, which is what keeps the container's subscription stable.
- `src/renderer/src/store/hostLabelLoader.ts` → `HostLabelData`, `startHostLabelLoads` — already issues
  one read per paired server and writes each server's own slot, so a second **named** server gets its own
  label with no change here.
- `src/renderer/src/screens/channels/channels.css` → `.channel-list__section-header`,
  `.channel-list__host`, `.channel-list__empty` — the flat-sibling spacing model (no `gap` on
  `.channel-list`; every element carries its own padding) and the rule that dies with the empty state.
- `e2e/fixtures/launchPairedApp.ts` → `SEEDED_ROW`, `SECOND_SEEDED_ROW`, `LaunchControl` — the two seeds
  (distinct `cwd`, names sharing no substring) and the `hostLabel` / `secondServer` controls, both on the
  **second** argument.
- `e2e/host-row-per-server.spec.ts` — #1199's two-server drive; its `toHaveCount(1)` on
  `.channel-list__host` names this ticket as what makes it more.
- `e2e/save-as-channel-promote.spec.ts`, `e2e/real-daemon-promote.spec.ts` — the two mutually-exclusive
  section-header proxies AC4 retires.
- `e2e/sidebar-row-geometry.spec.ts` — the affordance-as-section-proxy shape (`.channel-list__save` on a
  Chats row, `.channel-list__rename` on a Channels row) the re-proxy copies.
- `e2e/host-label-sidebar.spec.ts`, `e2e/connection-dot-colours.spec.ts`,
  `e2e/sidebar-tree-geometry.spec.ts`, `e2e/multi-server-launch.spec.ts` — the four specs whose counts or
  comments the always-render-both-sections amendment moves.
- `docs/knowledge/features/channel-list.md` was not consulted separately; the per-ticket lessons this
  slice needs are already carried in the headers of the symbols above, which state them at the call site.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=103-2959
(and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3094 for the repeated host row)

Each section is a label followed by a `Hosts` column: one *host container* per machine, and each
container is the host row (server glyph, machine name, two trailing connection dots) with that machine's
workspace rows and conversation rows nested under it. The two containers are separated by 16px
(`106:3160` / `405:7612` `gap-[16px]`); the whole server list repeats verbatim under both the Channels
and the Chats label, with the divider between the sections. The `+` on each header and host row, and the
header's collapse chevron, are other tickets' (#1185, #1189) and are not drawn here.

## Context

The sidebar has always rendered exactly one host row per section, because `HostRowControl` read
`serverInfoStore`'s **first** entry. Every level the design needs already exists — `HostRow`,
`WorkspaceRow`, `CollapsibleWorkspaceGroup`, the two headers, `HostConnectionDots` — so this is a
grouping change, not a new surface: the servers to draw come from the paired-server list, and each
server's own rows are grouped by workspace under that server's host row.

Two things make the server level load-bearing rather than cosmetic. The workspace group key is the raw
`cwd`, and a path is unique only *within* one machine — so two servers both holding `/home/user/project`
would silently merge into one group holding both machines' conversations unless the server level sits
above the workspace level. And the operator ruling of 2026-09-06 gives every paired machine a host row in
both sections whether or not it has conversations there, because the host row is where #1185/#1189 put
the plus that starts a chat in a new workspace, and a freshly paired machine has no conversations — under
the old `length > 0` gate it had no row and therefore no way to get its first chat from the desktop at
all (the floating button refuses to create while more than one server is paired, #1120).

No ADR is warranted: every decision here is local to one screen and is recorded at its call site.

## Design

### `channelListViewModel.ts` — one new pure function

```ts
type ServerStamped = { readonly serverId?: string | null }
export type ServerGroup<T> = { readonly serverId: string; readonly rows: readonly T[] }
export function groupByServer<T extends ServerStamped>(
  serverIds: readonly string[],
  rows: readonly T[]
): { readonly servers: readonly ServerGroup<T>[]; readonly unattributed: readonly T[] }
```

Generic over the row and constrained **structurally**, not by importing `ServerConversationSummary`: this
module's header promises it is framework-free and store-free, and importing the store type would drag
zustand into the view-model's import graph for a single field. `ServerConversationSummary`'s
`serverId: ConversationListOrigin` (`string | null | undefined`) satisfies the constraint.

Behaviour, in one pass:

- The order of `servers` is the order of `serverIds` — the client's own pairing order — and never the
  order rows arrive in. A duplicate id collapses (the buckets are a `Map`, seeded from `serverIds`), so no
  two groups can ever share a React key.
- A row joins a server's group only when its stamp is a `string` that is a **key of that map**. Anything
  else — `null`, `undefined`, or a string naming no paired server — goes to `unattributed`.
- `Map`, never a plain object, per `ServerOrigin`'s standing rule in `shared/ipc/events.ts`: a
  `__proto__` id would write through `Object.prototype` on a `Record<string, …>`. The ids here are the
  client's own, so this is the free second fabric rather than the only one.
- Rows keep array order within a group; nothing sorts.

`groupByWorkspace` is **not** re-keyed. Splitting the rows by server first is the smaller change, and it
is also the correct one: a composite `serverId + cwd` key inside the grouper would put a client-held id
into a value the group is identified by, where the split keeps the id out of the grouper entirely. React
scopes keys per sibling list, so wrapping each server's subtree in its own keyed fragment already makes
the raw-`cwd` group keys collision-free across servers.

**Where an unstamped row goes, and why.** `unattributed` renders *after* every server subtree in its
section, grouped by workspace exactly like any other rows, with **no host row above it**. Three outcomes
were available and two are wrong. Dropping the row is what the ticket forbids outright. Filing it under
the first paired server would put a row under a machine's name without evidence it belongs to that
machine — the same lie in the same pixel that the "take the origin from the client's own list, never from
a row" rule exists to prevent, arrived at by omission rather than by a hostile stamp. Rendering it
unattributed keeps the row reachable and names no machine, which is exactly what is known about it.
#1068 stamps every daemon event main-side, so this is unreachable in production; the type admits it and a
server-keyed tree has to answer.

### `ChannelList.tsx`

**The server list becomes a prop.** The container reads `useServerInfoStore(selectServers)` and passes
`serverIds` down through `ChannelListView` to `renderBody`. This is `openConversationId`'s ruling applied
unchanged: zustand v5 serves `getInitialState()` under `renderToStaticMarkup`, so a component that read
the list itself could only ever render the empty launch list — the unit tier could then prove the
no-server frame and nothing else, leaving the whole of AC1 to e2e. Read in the container it arrives as an
injectable prop, which is the seam `ChannelList.test.tsx`'s `render()` helper already has. `selectServers`
returns the held array by reference, so the subscription stays value-stable; the `.map` to ids happens at
the JSX boundary, never inside the selector.

**`renderBody` gains one level.** Its structure becomes:

- `conversations === null` → `null`. Unchanged, and still the first check: the not-yet-loaded posture is
  the wrapper alone, no headers, no rows, no empty state.
- Nothing to draw — no paired server *and* no row in either partition → `null`. This one gate replaces
  the `No conversations yet` paragraph and both `length > 0` section gates.
- Otherwise: the `Channels` header, that section's server subtrees, the divider, the `Chats` header, that
  section's server subtrees. All three chrome elements render unconditionally inside the gate, which is
  AC2.
- Each section's subtrees come from a shared local helper taking the section's rows, so the two trees
  stay literally the same code rather than two copies that can drift.

Per server: a keyed `<Fragment key={serverId}>` holding `<HostRowControl serverId={…} />` and that
server's `groupByWorkspace` output, each group in the existing `CollapsibleWorkspaceGroup`. The fragment
emits no element, so the rendered sequence under `.channel-list` stays the flat run of siblings
(header, host, workspace, rows, host, workspace, rows, divider, …) that 28 e2e specs' ancestry depends on
— no wrapper `<div>` becomes a flex item of the column. The unattributed rows follow, as bare workspace
groups with no host row.

**`HostRowControl` takes its server as a prop** and no longer reads `serverInfoStore` at all:
`{ serverId: string }` in, `selectHostLabelFor(serverId)` read, `HostRow` out.

**`HostRow`'s and `HostConnectionDotsControl`'s `serverId` narrows from `string | null` to `string`.**
The `null` arm was #1199's answer to "the paired-server list has not resolved yet" while the row rendered
unconditionally. It is now unreachable by construction: a host row exists *because* a server id was in
the list. The branch and the paragraph documenting it are deleted rather than left as a dead arm whose
comment claims a frame that no longer exists. The silent-server collapse onto `initialSessionState.status`
/ `initialRelayLinkState.status` is untouched — that is a different case (a paired server that has
reported nothing) and it is still reachable.

**Deletions.** The `No conversations yet` paragraph and its `.channel-list__empty` rule in
`channels.css` (its last consumer). Three comments elsewhere cite that class as a precedent
(`archive.css`, `conversation.css`, `ConversationScreen.tsx`) and are re-pointed at the surviving
sibling, so no comment is left citing a rule that is gone.

**Comments that go false, rewritten in the same commit:** `HostRow`'s "rendered INSIDE each section's
`length > 0` gate … do not hoist it out of the gate" — criterion 2 inverts precisely that;
`renderBody`'s empty-state paragraph; `HostRowControl`'s "the row stays SINGLE here";
`CollapsibleWorkspaceGroup`'s per-tree-independence paragraph, which now holds per *server subtree* as
well and for the same reason; `HostRow`'s seven-sink ban list, whose "never a React key" clause the keyed
fragment contradicts and which is amended rather than quietly violated (see § Security review); and
`multi-server-launch.spec.ts`'s "WHAT THIS SPEC DELIBERATELY DOES NOT ASSERT: two sidebar HOST rows".

### `channels.css`

`.channel-list__host` gains `margin-top: var(--space-4)` — the design's 16px between host containers —
with `.channel-list__section-header + .channel-list__host { margin-top: 0 }` resetting the first row of
each section. Adjacency is exact because fragments emit no DOM, so a section's first host row is always
the header's next element sibling. Single-server geometry is therefore byte-identical to today's, which
is what leaves `sidebar-tree-geometry.spec.ts`'s header→host rhythm assertions untouched.

## State + concurrency model

No new store, no new IPC, no new wire type, no async work, and therefore nothing to cancel. Three
existing renderer stores are read on paths that already exist: `serverInfoStore` (moved from inside
`HostRowControl` up to the `ChannelList` container), `hostLabelStore` and the two connection-status
stores (unchanged, one keyed read per host row).

Re-render seams. Moving the `selectServers` read to the container means a pairing change re-renders the
whole sidebar rather than one row — correct, since a pairing change *is* a whole-sidebar change, and the
list is written once per loader settle. The per-server label and dot reads stay inside `HostRowControl` /
`HostConnectionDotsControl`, so one machine's flap still wakes only that machine's two dots. `n` servers
add `n − 1` host rows per section; the paired count is a handful by construction.

`CollapsibleWorkspaceGroup`'s fold is per instance and unpersisted, and stays so: each server's groups
are their own sibling list inside that server's fragment, so the same `cwd` on two machines yields two
instances holding two separate booleans — the property the two *trees* already had, now also across
servers, with nothing to implement and one thing not to do, namely lift the state.

## Error handling

Nothing here does I/O, so there is no result type to thread and no new failure mode. The two degenerate
inputs are data shapes, not errors, and both have a defined rendering: a row whose stamp names no paired
server renders unattributed (above), and a server with no rows in a section renders its host row with
nothing under it (AC2). Neither is logged: a log line worth writing would carry a `cwd`, a conversation
name or a server id, and this screen is log-free by construction.

## Testing strategy

**vitest — `channelListViewModel.test.ts`** (`groupByServer`, pure):

- rows fan out to their own server's group, in `serverIds` order regardless of row order
- two servers whose rows share an identical `cwd` produce two groups, not one merged group (AC1's second
  clause; this is the unit-tier case — the shared e2e fixture's two seeds deliberately differ in `cwd`)
- a server with no rows still yields a group with `rows: []`
- an unstamped row (`null`, `undefined`) and a row naming an unpaired server land in `unattributed`, and
  no row is ever dropped: the group sizes plus `unattributed` sum to the input length
- an empty `serverIds` puts every row in `unattributed`
- a duplicate id in `serverIds` yields one group

**vitest — `ChannelList.test.tsx`** (`renderToStaticMarkup` over `ChannelListView` with injected props):

- one host row per server per section, in pairing order, with each server's rows under its own row
- both headers and the divider render with one server paired and zero rows; a server with rows in one
  section only still shows its row in the other
- `conversations === null` still renders the wrapper alone — no header, no divider, no row
- no server paired and no row → no header and no divider
- `No conversations yet` appears in no state (the retired paragraph, asserted absent rather than deleted
  silently)
- `.channel-list__section-header` still matches exactly two elements, and no new element joins the
  `.channel-list__row-open` or `.channel-list__row` match sets (AC5)
- the existing empty-state cases and `renders no host row when the list is empty or not yet loaded` are
  rewritten to the new contract, not deleted

**Playwright, fake tier:**

- `host-row-per-server.spec.ts` grows to AC3: four host rows with two servers paired (two per section),
  the four labels reading `[named, fallback, named, fallback]` **by length**, never by value; then
  dropping server B's client leg, waiting on B's own dots changing (the positive, auto-waiting read of
  the action's own effect, on the row under test), and only then asserting A's dots equal their baseline.
  A closing `toEqual(baseline)` ordered first would pass against the pre-drop render.
- `save-as-channel-promote.spec.ts` re-proxied per AC4: the row's own affordance replaces the section
  headers — `.channel-list__save` present and `.channel-list__rename` absent before, then
  `.channel-list__rename` visible under the round-trip timeout and `.channel-list__save` gone after.
  Positive read first, closing absence second (`sidebar-row-geometry.spec.ts`'s shape). It still reddens
  when the promotion does not happen: on a promote that never lands the row keeps its Save affordance and
  the Rename one never appears, so the positive read times out.
- `host-label-sidebar.spec.ts`, `connection-dot-colours.spec.ts`, `sidebar-tree-geometry.spec.ts`,
  `multi-server-launch.spec.ts`: count and comment updates for the always-render-both-sections amendment
  (two host rows and four dots on a single-server launch; the divider present before the FAB mints the
  second row).

**Playwright, real tier:** `real-daemon-promote.spec.ts` takes the same re-proxy. It is `testIgnore`d by
`playwright.config.ts`, so a green `npm run e2e` proves nothing about it — which is why the ticket carries
`needs-real-claude`, and why the change there is kept a mechanical mirror of its fake twin.

Fakes over mocks throughout; no new fixture, no fixture change. Nothing in this ticket can be proven by
clicking in the unit tier — `vitest.config.ts` sets `environment: 'node'` — so every transition lives in
`e2e/` and every shape lives in the static render.

## Open questions

1. Whether the unattributed bucket deserves a visible marker of its own (a "no machine" row) rather than
   rendering bare under the section. Resolved for this ticket in favour of bare: it is unreachable in
   production, and inventing chrome with no Figma node for a state no operator can produce is design
   invention, not implementation.
2. Whether `HostRow`'s `serverId` narrowing to `string` leaves any reachable caller passing `null`. To be
   settled by `tsc` during implementation — if the compiler finds one, the narrowing is wrong and the
   branch stays.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries] No findings — and the join direction is the whole of it.** Two id spaces meet in
  `groupByServer`, and both are client-held: `serverIds` comes from `serverInfoStore`, which main answers
  out of its paired records, and a row's stamp is written by `stampRows` **spread first, stamp last**
  from an origin `bindServerOrigin` bound per connection. The design iterates the *client's* list and only
  ever **tests** a row's stamp against it — a stamp can select among existing keys, never mint one — so
  the worst a confused or hostile daemon reaches is its own rows, under its own host row. Connection A
  cannot produce an event stamped B, and `parseConversationSummary` is a closed reconstruction that
  cannot smuggle a `serverId` key through the spread. The two fabrics are independent, and the direction
  is the one `selectConversationsFor`'s header states as a condition of its signature.
- **[Trust boundaries / prototype pollution] SHOULD FIX — the `Map` is load-bearing, so say so in the
  code and not only here.** `groupByServer` looks up an arbitrary string against its buckets. With a
  `Map` that is safe for every key including `__proto__`; the "simplification" to
  `Record<string, T[]>` an implementer or reviewer will reach for turns a `__proto__` stamp into a
  lookup that resolves `Object.prototype` — a truthy non-array whose `.push` corrupts or throws.
  Unreachable today because stamps are client-set, which is exactly why it must be written down as a
  deliberate choice rather than left as an accident of style. Phase B carries the reason at the
  declaration.
- **[Tokens, secrets, credentials] SHOULD FIX — the design uses the server id as a React key, which
  `HostRow`'s own header currently bans.** That header lists seven sinks the id may never reach:
  attribute, class name, **React key**, title, URL, lookup path, log line. The keyed fragment this ticket
  needs contradicts one of them, and the honest resolution is to amend the ban list, never to violate it
  quietly. A React key is admissible where the other six are not, and for a reason that generalises: the
  other six either reach the DOM or reach persistence, while a key is reconciliation identity alone —
  never serialised, never emitted by `renderToStaticMarkup`, unobservable to the page. The alternative is
  worse than a doc edit: index keys would cross-wire fold state and per-row instances between machines
  whenever the paired list reorders. Phase B amends the header *and* pins the claim with a unit assertion
  that a sentinel server id appears nowhere in the rendered markup — the twin of the shipped "never
  interpolates the conversation id into the markup" case. No token, key, or credential is otherwise
  touched; the operator's host label keeps its existing treatment (escaped React child, no attribute, no
  log, never asserted by value in `e2e/`).
- **[File / storage operations] No findings — nothing here reaches disk.** The only state this ticket
  adds is `CollapsibleWorkspaceGroup`'s in-memory fold, which is per instance, unpersisted, and dies with
  the renderer; no path is built, no file is opened, no web storage is touched.
- **[Inter-process / Electron attack surface] No findings — no new capability crosses the bridge.** No
  IPC channel, no `contextBridge` API, no `BrowserWindow` option is added or changed. The one movement is
  a `serverInfoStore` read relocating from a leaf component to its own container, entirely inside the
  renderer and against a store the renderer already held. The transport, the keys and the Noise session
  stay in main, untouched.
- **[Cryptographic primitives] Not applicable — this slice contains no randomness, no comparison against
  a secret, and no primitive.** Grouping is a synchronous fold over data both stores already hold.
- **[Network & I/O] No findings, with the unbounded quantity named.** Nothing here opens, reads or
  configures a socket. Host-row count is `2 × paired servers`, and the paired list is written only by the
  user's own pairing flow — a daemon cannot add itself to it, so the fan-out is not a hostile-input
  vector. Conversation-row count remains daemon-supplied and uncapped exactly as it is today; that is
  pre-existing and unchanged here, not something this ticket introduces.
- **[Error messages, logs, telemetry] No findings — and one tempting log is declined by name.** The
  screen is log-free by construction and stays so. The `unattributed` bucket is where an implementer will
  want a `console.warn` for "a row with no server", and any useful form of that line carries the row —
  its `cwd`, its name, or the stamp — which ADR 0007's content-free rule and CLAUDE.md both forbid. The
  bucket therefore renders the row and reports nothing.
- **[Concurrency] No findings.** `groupByServer` is a pure synchronous fold; there is no `await`, no
  timer, no listener and no long-lived task, so there is nothing to cancel and no check-then-act gap. The
  container's `selectServers` read and each row's `hostLabelStore` read can settle a tick apart, showing
  the fallback word for that tick — not a torn read (`conversationUnread.ts` rules that reading two
  stores back to back in a single-threaded renderer is not one) and identical to the launch frame the row
  already renders.
- **[Threat model alignment] No findings — this ticket closes a misattribution vector rather than
  opening one.** Against a **hostile daemon**, the `cwd` collision the Context section names is precisely
  a cross-machine misattribution: today two machines sharing `/home/user/project` merge into one workspace
  group holding both machines' conversations, and putting the server level above the workspace level is
  what separates them. Against a **malicious or compromised relay**, grouping is unreachable: the relay is
  content-blind and the stamp is bound per connection, client-side. Against **daemon-driven suppression**,
  the amendment is now the stronger posture rather than the weaker one — a host row's existence depends on
  the client's paired list alone, so a daemon answering `list_conversations` with `[]` can no longer
  collapse the tree to an empty state, and every paired machine keeps a row and therefore a route to its
  first chat. **Renderer compromise** reaching the transport is unchanged: no new capability is exposed.
  Row-count and `cwd`-length resource exhaustion from a hostile daemon is OUT OF SCOPE — pre-existing,
  untouched here, and `cwd` labels already ellipsize in CSS rather than widening the sidebar.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
