# #1289 — a guarded `renameWorkspace` command leaves as a `rename_workspace` frame

The outbound half of the desktop's side of the daemon's workspace-rename contract
(pyrycode/pyrycode#2209). It ships the verb — wire type, boundary guard, envelope builder, connection
method, main-side route — plus the e2e stateful fake learning to answer it. **Nothing in the window
sends it when this lands**: the pen and the Edit-workspace dialog are #1180, which is blocked on this.

## Files read

| Path → symbol | Why it matters |
|---|---|
| `src/shared/wire/types.ts` → `WorkspaceUpdatedPayload` | the structurally identical INBOUND shape (#1288); states the standing rule this ticket obeys — the verb owns its wire surface, so no alias |
| `src/shared/wire/types.ts` → `EnvelopeType` union, `CreateWorkspaceFolderPayload`, `ChangeWorkspacePayload` | where the new outbound member goes and the two-required-strings comment posture the new payload adapts |
| `src/shared/wire/types.ts` → `Envelope` | `in_reply_to?: number` — optional, never emitted as null; the fake's correlated reply rides it |
| `src/shared/ipc/commands.ts` → `RendererCommand`, `isRendererCommand`, `hasValidServerId` | the union, the dispatch switch, and the optional-`serverId` check the server-scoped members carry |
| `src/shared/ipc/commands.ts` → `isChangeWorkspacePayload`, `isCreateConversationPayload` | the two halves the hybrid guard is built from: present-and-string, and present-but-nullable |
| `src/main/transport/renameConversationEnvelope.ts` → `buildRenameConversation`, `RenameConversationInput` | the builder template, hop for hop |
| `src/main/transport/createWorkspaceFolderEnvelope.test.ts` | the builder's test shape: real-codec round trip + the over-cap `WireEncodeError` case |
| `src/main/daemonConnection.ts` → `changeWorkspace`, `createWorkspaceFolder`, `DaemonConnection` | the connected-guard / fresh-literal / shared-id-counter / swallow-the-throw method body, and where the interface entry goes |
| `src/main/connectionRegistry.ts` → `ActiveConnection`, `viewOf` | `Omit<DaemonConnection, …>`, so a new interface member is a compile-forced delegate here |
| `src/main/index.ts` → `case 'createWorkspaceFolder'`, `case 'changeWorkspace'` | the two routing idioms; this verb takes the server-scoped one |
| `src/main/serverRouter.ts` → `ServerRouter.route` | resolves `serverId`, falling back to the sole connection when the registry holds exactly one |
| `e2e/fixtures/conversationStateFake.ts` → `buildReplyFrames` switch, `renameWorkspace` seam, `workspaceUpdatedFrame`, `conversationDeletedFrame` | the mutation half already exists; `conversationDeletedFrame` is the correlated-reply idiom to copy |
| `e2e/workspace-updated-relist.spec.ts` | the spec this one is shaped on: same seed, same locator, same load-bearing opening read, same closing negative |
| `e2e/composer-file-drop.spec.ts` → the `drag` helper | the `page.evaluate` discipline — every value passed as the evaluate ARGUMENT, never closed over |
| `src/preload/index.ts` → `api.sendCommand`, `contextBridge.exposeInMainWorld('pyry', api)` | the bridge the spec drives; fire-and-forget, fixed channel |
| `docs/knowledge/features/conversation-workspace-change.md` | the five-pieces table and two-layer guard posture (#379) this slice reproduces with a sixth piece |
| `docs/knowledge/features/command-channel.md` | the command-boundary overview the new member joins |

## Context

The daemon accepts `rename_workspace { path, label }` and answers with a `workspace_updated` record
correlated to the requester. `path` must equal a stored conversation's `cwd` byte for byte; `label`
must be non-empty after trimming and at most 128 characters, or `null` to clear. It rejects with the
static errors `workspace.not_found` and `protocol.malformed`. **All of that is policed server-side.**
This client serializes what it is given, exactly as it does for `change_workspace` and
`create_workspace_folder`, and adds no client-side path or length check.

The inbound half (#1288) and the sidebar's read of the label (#1287) are already shipped, so the
fake's reply is decoded and its effect visible the moment this lands.

No ADR is warranted: this adds a verb to an established neighbourhood under decisions already
recorded (0002, the wire-type no-drift rule).

### Size — one file over the ceiling, deliberately

Six production files against the ≤5 line. Every other boundary holds: ~500 lines of total written
work, two new exported interfaces, zero consumer call sites needing simultaneous update (the change
is purely additive), four acceptance criteria, no state machine.

The overage stands rather than splitting because **the floor rule wins over the ceiling**. Every seam
this path offers — "wire type + guard" against "envelope + method + route", or "transport" against
"fake + drive" — yields a first slice whose only consumer is its sibling in the same family: a guard
for a command nothing forwards, or a builder no route calls. Neither half is observable on its own,
so neither is a ticket. Split depth also confirms it: the parent chain is `1289 → 1182 → none`, so a
split would be legal, but legality is not the question the floor asks. Stated here per § A5 rather
than routed back.

## Design

Six production pieces, mirroring the five-piece table of #379 with the server-scoped routing of #381.

| Piece | File | Role |
|---|---|---|
| `RenameWorkspacePayload` + the `rename_workspace` union member | `src/shared/wire/types.ts` | ported wire type, field-for-field with the daemon |
| `renameWorkspace` command member + `isRenameWorkspacePayload` | `src/shared/ipc/commands.ts` | untrusted renderer→main boundary |
| `buildRenameWorkspace` | `src/main/transport/renameWorkspaceEnvelope.ts` (new) | pure payload-carrying outbound envelope builder |
| `renameWorkspace(payload)` | `src/main/daemonConnection.ts` | connection method — the `send` twin, fresh-literal net |
| `renameWorkspace` delegate | `src/main/connectionRegistry.ts` | compile-forced `viewOf` entry |
| `case 'renameWorkspace'` | `src/main/index.ts` | command dispatch, routed BY SERVER |

### Wire type

```ts
export interface RenameWorkspacePayload {
  path: string
  label: string | null
}
```

**Its own type, not an alias of `WorkspaceUpdatedPayload`**, whose field set is identical. That inbound
shape's own doc comment states the standing rule in this neighbourhood — the verb owns its wire
surface — and an alias would couple an outbound request to an inbound record that is free to drift.
`rename_workspace` joins the `EnvelopeType` union beside `create_workspace_folder` /
`workspace_updated`.

`path` and `label` are renderer-supplied strings serialized to wire bytes ONLY: never resolved into a
local filesystem path, never a `Map` key, a filename, or a lookup path, and never logged.

### Boundary guard — a hybrid, not a clone

`isRenameWorkspacePayload` is the first guard in this file with a nullable field beside a required
one, so it is assembled from two existing arms rather than cloned from one:

- `path` — `isChangeWorkspacePayload`'s present-and-string arm. A missing key, an `undefined`, a
  literal `null`, and a non-string are all rejected.
- `label` — `isCreateConversationPayload`'s present-but-nullable arm: `'label' in value &&
  (typeof value.label === 'string' || value.label === null)`. The `in` check makes presence explicit
  (structured clone PRESERVES an explicitly-`undefined` property across the bridge, so a
  presence-by-truthiness check would pass one straight to the wire) and a literal `null` is the
  CLEAR signal, a value rather than an absence.

**Type, not emptiness.** An empty-string `label` passes, exactly as an empty `cwd` does for
`changeWorkspace` — the daemon's trim guard and 128-character bound are the authority, and a
client-side re-implementation is how the two drift.

**Structural minimum**, the house posture: an extra smuggled key is accepted here and bounded by the
main-side fresh literal instead. The command member carries the optional `serverId`, so the dispatch
arm pairs the payload guard with `hasValidServerId`, the `createWorkspaceFolder` shape. The union's
"FIVE MEMBERS CARRY AN OPTIONAL `serverId`" doc block becomes six.

### Envelope builder

`buildRenameWorkspace(input: RenameWorkspaceInput): Uint8Array` — the `buildRenameConversation`
contract verbatim: `{ id, ts, payload }` in, `encodeEnvelope`d `rename_workspace` bytes out. Pure, no
clock, no counter. MAY throw `WireEncodeError` over `MAX_PLAINTEXT_BYTES`; the sole caller catches it.
The payload serializes verbatim — a literal `null` `label` is preserved by `JSON.stringify`, so there
is no explicit-`null` concern here (the fresh literal in the method is what bounds the field set).

### Connection method

`renameWorkspace(payload: RenameWorkspacePayload): void` on `DaemonConnection`, body copied from
`changeWorkspace`:

- `if (driver === null) return` — the `send` twin, an inert no-op while disconnected, never a
  `consumer.fail`, never a throw. A request sent with no link simply draws no reply.
- A FRESH LITERAL `{ path: payload.path, label: payload.label }` — never a spread — the deterministic
  net that bounds the wire to exactly two fields whatever the structural-minimum guard let through.
- Shares the one monotonic `nextEnvelopeId` with `send`; advances only on a successful build.
- `catch {}` swallowing the caught object unread — its message could echo the payload. No log, no
  event (classify-don't-forward).

Fire-and-forget: no correlation memory, no pending set. The daemon's `workspace_updated` is decoded
by #1288's inbound path and reflected through the re-list, the posture `renameConversation` takes
toward `conversation_updated`.

`ActiveConnection` is `Omit<DaemonConnection, 'start' | 'stop' | 'reconnect'>`, so the new member is
compile-forced into `viewOf` in `connectionRegistry.ts` as a one-line delegate.

### Routing — the one place it differs from `renameConversation`

```ts
servers.route(command.serverId)?.renameWorkspace(command.payload)
```

A workspace label is not scoped to a conversation, so this is the `createWorkspaceFolder` line, not
`router.route(command.payload.conversation_id)`. Only `payload` is passed on, never `command`, so the
routing key has no expression that could carry it onto the wire.

### The e2e stateful fake

A `case 'rename_workspace'` arm that reuses the existing `renameWorkspace(cwd, label)` seam for the
mutation — it already moves both the per-`cwd` label map and every held row — and adds the CORRELATED
reply, `conversationDeletedFrame`'s idiom with the request's `env.id` echoed as `in_reply_to`.
`workspaceUpdatedFrame` gains an optional `inReplyTo?: number`; the mid-test seam keeps calling it
without one (the unsolicited broadcast #1288 drives), the new case passes `env.id`. Correlation
changes nothing the app does — the decode emits `workspace-updated` unconditionally and the refresh
trigger is correlation-blind — but a fake answering its own request with a broadcast is a state the
daemon cannot produce.

## State + concurrency model

No store slice, no async task, no subscription, no timer. The command is one synchronous hop
(renderer `sendCommand` → `ipcMain` → route → build → `driver.sendMessage`) with no promise, so there
is nothing to cancel and no teardown handle to hold. The reply's effect rides machinery that already
exists: #1288's decode → the conversation-list bridge's refresh → the existing `list_conversations`
round trip. The fake's `list` and `labels` are mutated synchronously inside `buildReplyFrames`, with
no `await` in the arm, so there is no check-then-act gap.

## Error handling

| Failure | Layer | Result |
|---|---|---|
| Malformed command from a compromised renderer | `isRendererCommand` | dropped at the boundary, no wire bytes |
| Extra smuggled key past the structural guard | `renameWorkspace`'s fresh literal | stripped; exactly two fields reach the wire |
| `serverId` naming no connected server | `servers.route` | `undefined`, optional-chained to a no-op |
| Not connected | `driver === null` guard | inert no-op, no throw |
| Over-cap plaintext (`WireEncodeError`) or a driver/wasm throw | the method's `catch` | swallowed unread, send dropped, no log, no event |
| `workspace.not_found` / `protocol.malformed` from the daemon | not handled here | this client neither awaits nor correlates the reply; #1180 owns any operator-facing surfacing |

Nothing on this path surfaces an error to the UI, deliberately: there is no sender yet to surface one
to.

## Testing strategy

**Vitest**, co-located, mirroring each hop's existing neighbour:

- `renameWorkspaceEnvelope.test.ts` (new) — real-codec round trip pinning `type` / `id` / `ts` and a
  payload of exactly `{ path, label }`; a `label: null` case proving the literal null survives
  serialization; the over-cap `WireEncodeError` case.
- `commands.test.ts` — a well-formed accept (extra key tolerated); an empty-string `label` accepted
  (type, not emptiness); a literal `null` `label` accepted; missing/null payload rejected; each of
  `path` wrong-typed / null / missing and `label` wrong-typed / missing rejected; the `serverId`
  round-trip rows the two existing table-driven suites carry.
- `daemonConnection.test.ts` — no-op before `start()` with no throw; after handshake-complete exactly
  one `rename_workspace` envelope with the expected id / ts / payload; the shared-id-counter case; the
  driver-throws parity case; the smuggled-extra-field case asserting the sent payload is exactly two
  fields.
- `connectionRegistry.test.ts` — the `noop` stub row that keeps the `ActiveConnection` fake compiling.

**Playwright**, `e2e/rename-workspace-command.spec.ts` (new, default fake tier). The unit tier pins
every hop but one: `src/main/index.ts` has no test file at all, so its `case 'renameWorkspace':` arm
is the single line whose absence every gate would miss. Shaped on `workspace-updated-relist.spec.ts`
— same seed, same `.channel-list__workspace-label` locator, same load-bearing opening read of the OLD
label, same closing negative against the cwd's folder segment — with the pushed frame swapped for a
command sent through the preload bridge:

```ts
await page.evaluate((command) => { (window as unknown as PyryWindow).pyry.sendCommand(command) }, COMMAND)
```

Payload passed as the evaluate ARGUMENT, never closed over (the `composer-file-drop.spec.ts`
discipline), with a local cast for `window.pyry`, which no `e2e/` declaration carries. `FakeDaemon`
has no inbound-capture API and needs none: the rendered label proves the frame arrived AND carried
both fields, since a wrong `path` selects no row and a wrong `label` renders the wrong text.

`e2e/` is in no tsconfig and Playwright strips types with esbuild, so a type error there reddens no
gate — the new spec is typechecked by hand with an ad-hoc `tsc --noEmit`, read by filename.

Fakes over mocks throughout: the existing `FakeRelayDriver` in `daemonConnection.test.ts` and the
stateful `conversationStateFake` in the e2e tier. No `vi.mock`.

## Open questions

1. Does `workspaceUpdatedFrame` gaining an optional `inReplyTo` disturb the existing
   `workspace-updated-relist.spec.ts` drive? Expected no — the seam calls it with two arguments and
   `JSON.stringify` omits an `undefined` property, so the broadcast frame's bytes are unchanged.
   Confirm by running that spec alongside the new one.
2. Does a fake-tier launch's `servers.route(undefined)` actually resolve the sole connection, or does
   the registry hold a second stand-in entry that makes it ambiguous? Expected resolved (the ticket
   states one connection per fake-tier launch); the spec reddens immediately if not.

Each is resolved in Phase B; anything that moves the design lands in a `## Revisions` entry.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. One explicit boundary: the renderer→main IPC, gated by
  `isRendererCommand`'s new `renameWorkspace` arm in `src/shared/ipc/commands.ts`. Downstream holds a
  parsed `RenameWorkspacePayload` and nothing re-parses it. The daemon→main direction adds nothing —
  the `workspace_updated` reply is decoded by #1288's already-shipped fail-closed decoder, and this
  ticket neither awaits nor correlates it.

- **[Trust boundaries]** No finding, but the non-obvious property of this verb, stated because it is
  not visible from any single hop: it opens a ROUND TRIP in which renderer-supplied text becomes
  daemon-STORED text that later returns and is rendered. Verified inert at the far end —
  `ChannelList`'s workspace row renders the label as `<span
  className="channel-list__workspace-label">{label}</span>`, a React text child (escaped), and that
  file's own comment block records the three sinks it deliberately refuses: no `title` attribute, no
  `aria-controls` id, no log line. The round trip is also not a new capability: `renameConversation`
  and `promoteConversation` already admit one over the same channel.

- **[Tokens, secrets, credentials]** Not applicable by design, not by omission. No token, key, or
  credential appears on this path: `path` and `label` are wire strings, the envelope builder is pure
  over `(id, ts, payload)`, and the device token lives in the already-established pairing store the
  connection reads at dial time. The new command member exposes no field that could hold one — the
  `RendererCommand` union's AC5 property, preserved.

- **[File / storage operations]** No findings, and this is the category the verb most looks like it
  should trip. `path` is filesystem-shaped and renderer-supplied, and NOTHING in this design resolves
  it: the guard type-checks it, the connection method's fresh literal copies it, `encodeEnvelope`
  serializes it. No `path.resolve`, no `path.join`, no `fs` call, no use as a filename or cache key.
  The daemon requires byte-for-byte equality with a stored `cwd` (not a path join), so a `../`-laden
  value is answered `workspace.not_found` rather than traversing anything. No file is written.

- **[File / storage operations]** SHOULD FIX — a comment whose rationale this ticket FALSIFIES.
  `conversationStateFake`'s `labels` Map carries a comment justifying the `Map`-over-`Record` choice
  partly on provenance: *"Fixture-authored keys make that unreachable here; the `Map` is the free
  second fabric."* The new `case 'rename_workspace'` arm makes the keys app-under-test-supplied, so
  the provenance half stops being true while the conclusion stays correct — a `Map` has no prototype
  chain, so a `__proto__` key is inert regardless of who authored it. In Phase B, amend that comment
  so the safety rests on the `Map` alone. Test-only code, hence SHOULD rather than MUST, but a
  comment that argues from a now-false premise is how the next reader loses the real reason.

- **[Inter-process / Electron attack surface]** No findings. The bridge is unchanged: `sendCommand`
  pins `COMMAND_CHANNEL`, `ipcRenderer` never crosses `contextBridge`, and window `webPreferences` are
  untouched. The new surface is exactly one union member, validated before use. Capability granted to
  a compromised renderer: rename a workspace label on a paired daemon — strictly weaker than what the
  same channel already admits (`deleteConversation` permanently deletes; `setSessionSettings` can set
  `yolo: true`). No escalation.

- **[Inter-process / Electron attack surface]** No finding on the routing key, verified rather than
  assumed. `hasValidServerId` accepts absent / `undefined` / a string, and `serverRouter`'s `resolve`
  then refuses an id naming no connected server with **no fallback to an arbitrary server**; `''` is
  treated as a name that refuses, not as an omission. The absent-id → sole-connection branch is
  bounded and observable. Its refusal diagnostic is content-free (`{ event, code }` — the id is not
  in it). All inherited from #1120 and unchanged here.

- **[Cryptographic primitives]** Not applicable — no RNG, no comparison against a secret, no key, no
  nonce. One adjacent property is load-bearing and is a design decision rather than an absence: the
  method shares the ONE monotonic `nextEnvelopeId` rather than introducing a second counter. A second
  counter would mint duplicate envelope ids, which would mis-correlate `in_reply_to` for OTHER verbs
  that do correlate (`createWorkspaceFolder`, `deleteConversation`, `setSystemPrompt`).

- **[Network & I/O]** No findings. `label` is unbounded client-side and that is deliberate: an
  over-cap payload throws `WireEncodeError` inside the method's `try`, the send is dropped, and
  nothing is retried or buffered, so an oversized value is bounded at `MAX_PLAINTEXT_BYTES` (65519)
  without a client-side rule. A client-side 128-character check was CONSIDERED AND REJECTED — the
  daemon's trim/length rule is the authority, re-implementing it is exactly the drift CLAUDE.md
  forbids, and unlike `setSystemPrompt` (which bounds early precisely so it can surface a refusal)
  there is no sender and no operator surface here to refuse to. Socket timeouts, `maxPayload`, TLS
  and reconnect backoff are inherited unchanged from `relayConnection`.

- **[Error messages, logs, telemetry]** No findings, and one clause is load-bearing rather than
  ceremonial: the method's `catch` DROPS the caught object unread. A `WireEncodeError` message can
  echo the payload, so logging it — or forwarding it as an event — would put renderer-supplied text
  into a log, which ADR 0007's content-free rule and CLAUDE.md both forbid. Verified there is no log
  call anywhere else on the path: `codec.ts` emits none, and the route's only diagnostic is the
  content-free refusal above. The new e2e spec asserts on rendered text, and both labels are
  non-secret literals authored in the spec itself.

- **[Concurrency]** No findings. Nothing async is introduced: no promise, no timer, no listener, no
  subscription, hence no `AbortSignal` to thread and nothing for window teardown to cancel. The one
  piece of shared mutable state, `nextEnvelopeId`, is read and written with no `await` between —
  the invariant `createWorkspaceFolder` already documents. The fake mutates `list` and `labels`
  synchronously inside `buildReplyFrames`, so no check-then-act gap opens there either. Fire-and-
  forget means no correlation memory is left dangling by a disconnect mid-flight.

- **[Threat model alignment]** Malicious relay — content-blind and on-path; it can drop or delay the
  `rename_workspace` frame, whose effect is that the rename silently does not happen and the sidebar
  keeps the old label. No plaintext leaks (the frame is inside the Noise session) and nothing hangs,
  because the verb awaits no reply. Hostile daemon response — the `workspace_updated` reply passes
  through #1288's fail-closed decoder, unchanged. Renderer compromise reaching the transport — the
  renderer gains one fire-and-forget verb and still never touches keys, the socket, or raw bytes.
  Token theft from disk — untouched by this ticket.

- **[Threat model alignment]** OUT OF SCOPE — surfacing the daemon's `workspace.not_found` /
  `protocol.malformed` rejections to the operator. This client neither awaits nor correlates the
  reply, matching `renameConversation`'s posture toward `conversation_updated`. Picked up by #1180,
  the Edit-workspace dialog, if it wants a failure surface.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
