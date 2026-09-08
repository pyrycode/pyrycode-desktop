# #1308 — the host row's plus opens an Add workspace dialog that starts a chat in a folder on that host

## Files read

- `src/renderer/src/screens/channels/ChannelList.tsx` → `HostRow`, `HostRowControl`, `renderServerTrees`,
  `renderBody`, `ChannelListView`, `ChannelList` — the plus is already drawn behind an optional
  `onAddWorkspace`; `HostRowControl` passes only `onEditHost`, so nothing lights it. This file is where the
  handler is threaded and where the open-dialog cell lives.
- `src/renderer/src/screens/channels/CreateChannelDialog.tsx` → `CreateChannelDialogView` — the view this
  clones: same overlay/scrim/panel chrome, an empty `autoFocus` field, Cancel + primary action. Its header
  records why the `cwd` is deliberately not a prop.
- `src/renderer/src/screens/channels/EditHostDialog.tsx` → `EditHostDialogView`, `EditHostSaveStatus` — the
  only shipped dialog with a **round trip**: a three-arm status, a disabled field while busy, a
  client-owned failure line, and a Cancel that is never disabled. Every one of those rulings transfers.
- `src/renderer/src/screens/channels/SaveAsChannelDialog.tsx` → `SaveAsChannelDialog` — the shipped
  precedent for a dialog CONTAINER holding its own state and effect beside its pure view in one file, with
  `window.pyry` dereferenced only inside callbacks and effects.
- `src/renderer/src/store/conversationCreatedBridge.ts` → `requestNewConversation`, `requestNewChannel`,
  `subscribeConversationCreated` — the two fixed create payloads sitting side by side, and the subscribe
  seam this ticket's rejection sibling goes beside.
- `src/shared/ipc/commands.ts` → `RendererCommand` — `createConversation` carries an optional top-level
  `serverId` (#1120), a sibling of `payload` and never a field inside it, which is what keeps it off the
  wire by construction.
- `src/main/index.ts` → the `createConversation` case — `servers.route(command.serverId)?.createConversation(...)`,
  the routing this dialog's `serverId` reaches.
- `src/main/daemonConnection.ts` → `pendingCreateConversations` — #1307's correlation set. Its header states
  the two obligations inherited here: the success reply does not consume an entry, and the bare event cannot
  say whose rejection it is.
- `src/shared/ipc/events.ts` → the `conversationCreateRejected` arm — nullary, no daemon byte crosses IPC.
- `e2e/fixtures/conversationStateFake.ts` → `conversationStateFake`, its `create_conversation` arm and the
  `Object.assign` seam — the fixture answers a create in the click's own frame and models no daemon
  rejection at all, which is the gap AC3/AC4 need closed.
- `e2e/fixtures/launchPairedApp.ts` → `LaunchPairedAppOptions`, `LaunchControl` — `hostLabel` / `secondServer`
  ride the **second** argument; one passed in the first is dropped silently with no gate red.
- `e2e/host-row-hover-controls.spec.ts` — its step 2 asserts the plus is drawn **nowhere**. This ticket
  inverts that premise; see § Revisions-worthy deviation in Testing strategy.
- `docs/knowledge/features/daemon-connection-correlation.md` § Create-conversation rejected correlation —
  the two inherited obligations, stated as obligations rather than as trivia.
- `docs/knowledge/features/channel-list-host-row.md`, `channel-list.md` § Workspace grouping — a workspace
  is drawn while a live conversation sits in it (`partitionActive`), which is why adding one means starting
  a chat in it.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=102-498 (Rename
dialog — the chrome cloned) and https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG/Pyrycode-Client?node-id=399-1366
(Host component, Hover state — the plus, already drawn and already coded in `HostRow`).

No Add workspace dialog is drawn. Read back from the Rename node on 2026-09-08: a dark rounded panel with
a left-aligned title at the top, one outlined field carrying a small caption above its value, and two
right-aligned text actions — a neutral Cancel and a `--color-primary` confirm. That is exactly what the
shipped `.edit-host*` and `.create-channel*` blocks in `channels.css` already trace from this node, so the
new block mirrors `.edit-host*` (the one that already carries a disabled state and an error line) rather
than re-deriving the node's tokens. Per the ticket's stated assumption: title "Add workspace", one field
labelled "Folder path on the host", actions Cancel and "Start chat".

## Context

The host row's plus is `HostRow`'s shipped-but-uncalled affordance: #1185 drew it behind an optional
`onAddWorkspace`, #1299 wired only its sibling pen, so no caller lights it. This ticket is that caller,
plus the dialog it opens. Functionally it is #1178's workspace-row plus one level up with a folder field
in front of it — the same `createConversation`, with the folder typed rather than taken from a group key —
and it is the first consumer of #1307's dormant `conversationCreateRejected` arm.

Nothing keeps a client-side list of workspaces: both trees are derived from the conversation list, so the
folder appears in the sidebar with its first chat and leaves when its last conversation is archived. That
is `partitionActive`'s shipped behaviour and is not re-proved here.

No ADR is warranted. Every decision below is a local application of a rule already recorded — the
container/pure-view split, the `window.pyry`-at-interaction-time discipline, the four declined sinks for
untrusted text, and the round-trip status shape `EditHostSaveStatus` established.

**Sizing, stated rather than hidden.** The ticket declares itself ~300 lines over the 800-line boundary and
argues the floor: the rejection half — the subscribe sibling, the in-flight gate, the dialog's rejected
state — has this dialog as its only possible consumer, so a split would produce a child nothing outside the
family calls. Re-counted against this plan: 3 production source files (`AddWorkspaceDialog.tsx` new,
`ChannelList.tsx`, `conversationCreatedBridge.ts`), 2 new exported symbols that count against the type/
component line (`AddWorkspaceDialogView`, `AddWorkspaceStatus`; `AddWorkspaceDialog` is the container in
the same file, `SaveAsChannelDialog`'s shape), 0 consumer call sites forced to change, 4 acceptance
criteria, 1 reject branch. Five of the six lines hold; only total written work is over, and the floor
outranks the ceiling. Building it.

## Design

Three modules move. Nothing in `src/main/` or `src/shared/` changes: the command member, its optional
`serverId`, the routing and the rejection arm all shipped already.

### 1. `AddWorkspaceDialog.tsx` (new, `screens/channels/`)

Three exports, the `SaveAsChannelDialog` shape — a pure view and the container that drives it in one file,
because this dialog's round trip is its whole substance and separating them would put the state one import
away from the markup it is about.

- `AddWorkspaceStatus = 'idle' | 'creating' | 'rejected'` — `EditHostSaveStatus`'s three-arm shape and its
  reasoning verbatim: "in flight" and "failed" cannot both be true and neither can be lost, and there is no
  `succeeded` arm because a confirmed create CLOSES the dialog.
- `AddWorkspaceDialogView({ path, status, onPathChange, onCancel, onStart })` — props in, markup out, no
  store, no `window.pyry`, no effects, server-renderable. It renders the overlay + scrim + panel, the
  labelled field (`autoFocus`, so AC1's "empty and focused" is one declaration assertable in static
  markup), the client-owned failure line on `rejected` only, and the Cancel / Start chat row.
- `AddWorkspaceDialog({ serverId, onDismiss })` — the container. Holds `path` and `status`, subscribes to
  the two daemon arms for exactly its own mounted lifetime, dispatches on Start chat.

**The absolute-path rule is one expression, not a validator.** Start chat is refused when
`status === 'creating'` or when the trimmed path does not begin with `/`. `''.startsWith('/')` is `false`,
so the single test also covers AC2's blank case — no second predicate, no error message, no normalisation.
The client rule exists to keep group keys canonical (`~/foo` and `/home/x/foo` would be two groups); the
daemon confines the path on its own and rejects one that escapes its home or does not exist.

**Cancel is never disabled, in any status.** `EditHostDialogView`'s ruling, and load-bearing for a stronger
reason here: there is no timeout anywhere on the create round trip, so a daemon that answers neither
`conversation_created` nor `error` would otherwise leave a frozen field, a disabled action and no exit.

**The typed path reaches exactly one sink: the controlled input's `value`.** No `title`, no `aria-label`
built from it, no id / key / class-name interpolation, no lookup path, no log line — `HostRow`'s four
declines re-derived rather than inherited. It leaves the renderer only as the command's `cwd`.

### 2. `conversationCreatedBridge.ts` (two additions)

- `requestNewWorkspaceChat(sendCommand, cwd, serverId)` → sends
  `{ type: 'createConversation', payload: { is_promoted: false, name: null, cwd }, serverId }`.

  A **third sibling** rather than a widening of `requestNewConversation`, and the choice is deliberate. Its
  payload is that helper's byte-for-byte; what differs is the top-level routing key, and here that key must
  be REQUIRED — main refuses an unnamed `createConversation` as ambiguous once more than one server is
  paired, and this dialog always knows which machine's row was clicked. A widened `serverId?: string`
  parameter would make the field forgettable at exactly the call site that must never forget it, and would
  force a conditional spread to avoid emitting an explicit `undefined` key across `structuredClone`. Two
  shipped call sites stay untouched, and the unit test stays a single-literal assertion — the property the
  file's own header asks callers to preserve.

  `cwd` travels TRIMMED and otherwise verbatim: no `path` module, no local resolution, no normalisation.
  Main re-validates at the untrusted IPC boundary and rebuilds a fresh three-field literal before the wire.

- `subscribeConversationCreateRejected(onDaemonEvent, onRejected)` → `subscribeConversationCreated`'s
  sibling, placed beside it. No `translate*` companion: the arm is nullary, so there is no payload to map
  and a `boolean`-returning translator would be ceremony. The listener only invokes the callback; it never
  throws into React.

### 3. `ChannelList.tsx` (thread the handler, hold the open cell)

`addWorkspaceServerId: string | null` joins the five per-interaction cells, beside `editHostServerId` and
for the same reason — an open dialog's fixed-inset overlay covers the window, so no two can be open at once
and no mutual-exclusion logic is needed. Gated on an explicit `!== null` and never on truthiness:
`isHostLabelServerRequest` accepts the empty string as a server id, so a truthy gate could collapse a real
machine's dialog into "none open" (the trap `editHostServerId` already names).

The handler threads exactly as `onEditHost` does — `ChannelListView` → `renderBody` → `renderServerTrees`
→ `HostRowControl` → `HostRow` — and lands as a **nullary** `onAddWorkspace` because `HostRowControl`
closes over the `serverId` it was drawn for. One `HostRowControl` serves both trees and `groupByServer`
buckets every paired server whether or not it holds rows, so one handler lights the plus on every host row
in both sections, including a freshly paired machine with no conversations (AC1).

`onAddWorkspace` on `renderServerTrees` is REQUIRED and sits immediately after `onEditHost`, ahead of the
two optional per-tree control objects: both calls supply it, every host row draws the plus, and an optional
parameter would be a fourth way to render a sidebar whose plus opens nothing — which is precisely the state
#1185 shipped and this ticket ends.

### 4. `channels.css`

An `.add-workspace*` block cloned from `.edit-host*`: overlay, dedicated scrim element (so the opaque panel
is never dimmed and no bare colour literal is needed), panel, title, field, label, input, error line,
actions, focus-visible and disabled states. Every value is a theme token; no hex, no magic number.

## State + concurrency model

No store is added. `newFolderStore` exists because #398 wanted one, not because a round trip requires one,
and #1179's dialog needed none.

- **Where the in-flight cell lives.** In the `AddWorkspaceDialog` container, not in `ChannelList`. The
  container is rendered only while `addWorkspaceServerId !== null`, so the subscription's lifetime is
  exactly the dialog's open lifetime — which is what makes AC4's closed-dialog case true by construction
  rather than by a guard: with no dialog open there is no listener to fire.
- **Subscriptions.** One `useEffect` with an empty dep array establishes both listeners through the
  injected `window.pyry.onDaemonEvent` and returns a cleanup composing both off-handles, so a StrictMode
  double-mount nets exactly one live listener each. `window.pyry` is dereferenced inside the effect alone,
  never during render, so `ChannelList` stays server-renderable. The latest `status` is read through a ref
  inside the listeners (the `useConversationCreatedNav` idiom) so the subscription is established once and
  never re-subscribes as the status moves.
- **The gate is `status === 'creating'`, and it is the whole of AC3/AC4.** A rejection arriving at `idle` or
  `rejected` changes nothing: no error line, no state moved. That covers both of AC4's cases — a rejection
  after this dialog's own create was already confirmed (the dialog is closed and unmounted, so no listener
  exists), and a rejection belonging to the FAB's or the workspace plus's concurrent create arriving before
  this dialog has submitted anything.
- **The indistinguishability is accepted and named, not designed away.** While this dialog's own create IS
  outstanding, a concurrent caller's rejection is indistinguishable from its own and will show the error
  line; #1307's own review says the bare arm cannot say whose it is, and the daemon's refusal never echoes
  the path, so there is nothing to correlate on even if a field were added. The failure mode is a false
  failure report on a create that will still land — never a false success — and the user's recourse is the
  same either way: retype and retry, or Cancel.
- **Closing on `conversationCreated` does NOT match on `cwd`, deliberately.** The payload carries one, and
  comparing it to the typed path is the obvious tightening. It is declined because it makes the dialog's
  only exit depend on the daemon echoing the string byte for byte: a daemon that normalises a trailing
  slash or resolves a symlink would strand the dialog open forever over a chat that was created. Closing on
  the first confirmation while our own create is outstanding fails in the safe direction. Same
  indistinguishability as above, benign in this arm.
- **No timers, no `AbortController`, no polling.** The only long-lived work is the two listeners, torn down
  by the effect cleanup on unmount — which a Cancel, a successful create, or a sidebar remount all trigger.

## Error handling

| Failure | Where it surfaces | Result |
|---|---|---|
| Blank or relative path | `AddWorkspaceDialogView` | Start chat disabled; nothing sent |
| Daemon refuses the folder (escapes home / does not exist) | `conversationCreateRejected` → container | `status: 'rejected'`, client-owned line, action re-enabled, dialog open, no row |
| Rejection with no create outstanding | container gate | Nothing happens |
| Daemon never answers | — | Dialog stays in `creating`; Cancel is the exit and is never disabled |
| Send throws in main before registering | — | Same as "never answers"; main registers the pending id only after a successful send |

The failure line is a client-owned module constant, `'Could not start a chat in that folder'` — apostrophe-
free by design (`renderToStaticMarkup` escapes `'` → `&#x27;`, the standing desktop lesson). It interpolates
neither the path nor any daemon text, and it cannot: the event is nullary, so there is no daemon string in
the renderer to interpolate even by accident. Nothing on this path logs — a useful line would carry the
operator-typed path, which ADR 0007's content-free rule and `CLAUDE.md` both forbid.

## Testing strategy

**Unit (vitest, `renderToStaticMarkup`).**

- `AddWorkspaceDialog.test.tsx` — the view's matrix: title and field label present; the field renders
  `autofocus=""` and its value escaped; Start chat disabled on blank, on whitespace-only, on a relative
  path, and enabled on an absolute one; `creating` disables both the field and the action and renders no
  error line; `rejected` renders the client-owned line exactly once with the action re-enabled; Cancel
  carries no `disabled` in any of the three statuses; a path containing `<`/`&`/`'` reaches the input's
  value alone and no attribute of the overlay, panel, field or either action.
- `conversationCreatedBridge.test.ts` — `requestNewWorkspaceChat` sends exactly one command, asserted as a
  single literal including the top-level `serverId` and the trimmed `cwd`; `subscribeConversationCreateRejected`
  invokes its callback on the rejection arm, no-ops on every other event, and returns the off-handle.
- `ChannelList.test.tsx` — the plus is drawn on every host row in both sections once `onAddWorkspace` is
  passed; its accessible name; the existing pen-before-plus DOM order pin still holds; the `noop` default
  in the render helper.

**E2E (fake tier), `e2e/sidebar-add-workspace.spec.ts`.** One launch per outcome:

- Happy path — hover a host row, click the plus, assert the dialog opens with an empty field, type an
  absolute path, submit; assert the thread opens and a workspace row labelled with the path's last segment
  appears under that host in the Chats tree.
- Rejection — the same drive against a fake scripted to refuse, asserting the dialog stays open, the line
  appears, the action is enabled again, and no workspace row was drawn. A **positive** read of the error
  line is ordered before the closing "no row" absence, so the absence is a mutation check rather than a
  locator that was 0 all launch.

**Fixture gap, closed minimally.** `conversationStateFake` gains one option — how it answers
`create_conversation`, defaulting to today's `conversation_created` — with the alternative answering a
daemon `error` frame carrying `in_reply_to: env.id`, which is what main's `pendingCreateConversations`
correlates on. That is the only fixture change: the *withheld-reply* variant the ticket also anticipates is
deliberately not built, because the in-flight state it would expose is a pure function of the `status` prop
and is proven directly in the static tier, while the happy-path spec already fails if the status were to
stick (the dialog would never close).

**Deviation from the ticket's technical notes, stated up front.** They say to check that
`e2e/host-row-hover-controls.spec.ts` still passes rather than editing it. It cannot: its step 2 asserts
`.channel-list__host-add` and the "Add workspace" button at count 0, and that spec's own header names those
two reads as #1189's half, to be replaced when the plus is finally wired — exactly as #1299 replaced the
pen's half. They invert to the host-row count. Its geometry assertions are unaffected: both controls are
absolutely positioned at different insets, so drawing the plus moves nothing the spec measures.

## Open questions

1. Whether the dialog should also offer to create a missing folder — Juhana's open call, recorded in the
   project's Open Questions and explicitly out of scope here. Not resolved by this ticket.
2. Whether a rejection should distinguish its originating caller. Answered above: it cannot, by
   construction, and this dialog is designed for the ambiguity rather than around it.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No new boundary. The operator-typed path crosses renderer → main as the existing
  `createConversation` command's `cwd`, where main re-validates at the untrusted IPC boundary and rebuilds a
  fresh three-field literal before the wire — unchanged by this ticket. The reverse direction carries
  *nothing*: `conversationCreateRejected` is nullary by construction, so no daemon byte, code, message or
  path reaches the renderer on the failure path. The `serverId` added to the dispatch comes from the
  client's own `serverInfoStore` list (filled from main's paired records), never from the wire — the rule
  `HostRowControl`'s header already states for the same id.
- **[Tokens, secrets, credentials]** Not applicable, and the reason is structural rather than incidental:
  nothing on this path reads, writes or holds a credential. No `safeStorage` call, no `localStorage`, no
  device token, no key. The dialog's entire state is one string and one three-arm enum, both discarded on
  unmount.
- **[File / storage operations]** No client-side filesystem access at all — no `path.join`, no
  `path.resolve`, no `fs`. The typed path is a *string the daemon interprets*, never a path this client
  opens, so there is no traversal or TOCTOU surface here. Confinement is the daemon's (`$HOME` check plus
  existence check, non-retryable refusal whose static message never echoes the path). The deliberate
  absence of local normalisation is what keeps the group key canonical AND keeps this client out of the
  path-resolution business entirely.
- **[Inter-process / Electron attack surface]** No IPC channel, `contextBridge` method or `ipcMain` handler
  is added. The dispatch reuses the shipped `sendCommand` with an existing command member; the subscription
  reuses the shipped `onDaemonEvent`. `serverId` is a top-level sibling of `payload`, never a field inside
  it, so the envelope builders — which consume `payload` alone — keep it off the wire by construction
  rather than by discipline. No window options, navigation guards or protocol handlers are touched.
- **[Cryptographic primitives]** Not applicable. No randomness, no comparison against a secret, no
  handshake code. The one `===` this ticket introduces compares a status enum to a client-owned literal.
- **[Network & I/O]** No socket, no URL, no fetch, no timeout to set. One `createConversation` command per
  Start chat click, and the action is disabled for the duration of the round trip, so a click cannot be
  repeated into a send loop while a create is outstanding.
- **[Error messages, logs, telemetry]** **The strongest guarantee in this slice, and it is enforced by the
  arm's shape rather than by care:** the rejection event carries no fields, so the renderer has no daemon
  text to render or log. The user-facing line is a client-owned constant naming neither the path nor a
  reason. No `console.*` on any path added here — a useful log line would carry the operator-typed folder,
  which ADR 0007 and `CLAUDE.md` forbid.
- **[Concurrency]** Two listeners, one effect, one cleanup composing both off-handles; nothing else is
  long-lived. There is no check-then-act race: `status` moves only inside synchronous React event handlers
  and listener bodies, never across an `await` (there is no `await` on this path — the dispatch is
  fire-and-forget and the answer arrives as an event). SHOULD FIX carried forward, inherited from #1307 and
  named rather than silently accepted: a rejection correlated to an already-confirmed create still fires.
  The gate is the dialog's own `status === 'creating'`, which is the mitigation that ticket asked its first
  consumer to build; the residue — a concurrent caller's rejection landing on this dialog while its own
  create is in flight — is unfixable without a per-request payload the daemon does not send, and it fails
  toward a false failure report, never a false success. The verifier should check the gate exists and is
  read from a ref rather than a stale closure.
- **[Threat model alignment]** *Hostile daemon response*: the only inbound this ticket consumes is nullary,
  so a hostile daemon's richest attack is to emit spurious rejections — which at worst shows a generic line
  on an open dialog, and cannot inject text, move a row, or reopen a closed dialog. A hostile
  `conversation_created` is out of scope here and unchanged: it flows through the shipped list/nav path.
  *Malicious relay*: on-path drop or delay leaves the dialog in `creating` with Cancel always available —
  the reason Cancel is never disabled. *Renderer compromise*: this slice adds no capability a compromised
  renderer did not already have; `createConversation` was already dispatchable from it.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
