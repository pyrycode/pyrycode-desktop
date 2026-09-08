# 1288 — an inbound `workspace_updated` re-lists so a rename from any client lands

The daemon fans out a `workspace_updated { path, label }` frame when a workspace's label changes
(pyrycode#2209): correlated by `in_reply_to` to whoever asked for the rename, and pushed unsolicited to
every other connected interactive client. This client decodes nothing of it today. This ticket adds the
inbound half — decode, emit, and one more refresh trigger — so a rename performed anywhere reaches the
sidebar without a reconnect.

## Files read

| Path | Symbol | Why it matters |
|---|---|---|
| `src/shared/wire/types.ts` | `WorkspaceFolderCreatedPayload` | the closest shape precedent: a single required `path`, and the standing "untrusted daemon-side REMOTE path, never resolved, never logged" posture AC1 asks for |
| `src/shared/wire/types.ts` | `ConversationUpdatedPayload` | the `workspace_label` contract (`string \| null`, no `omitempty`) the new `label` mirrors; also carries the stale comment the ticket flags — see Context |
| `src/shared/wire/types.ts` | `EnvelopeType` | the vocabulary union each inbound type joins |
| `src/main/transport/inboundMessage.ts` | `parseWorkspaceFolderCreatedPayload` | the fail-closed parser this one is cloned from — `isRecord` guard, one `requireString`, fresh literal, category-only message |
| `src/main/transport/inboundMessage.ts` | `parseConversationUpdatedPayload` | where the new parser sits, and the `requireStringOrNull` idiom for the nullable half |
| `src/main/transport/inboundMessage.ts` | `parseInboundMessage`, `InboundDaemonMessage` | the frame-level `MAX_PLAINTEXT_BYTES` guard, the `switch (envelope.type)` the new arm joins, and the narrow-then-log ordering that keeps a throw unlogged |
| `src/main/transport/codec.ts` | `decodeEnvelope` | `Envelope.type` is a plain validated `string`, so the switch arm compiles without the `EnvelopeType` edit; the edit is the vocabulary mirror, not a compile need |
| `src/main/daemonConnection.ts` | the `'workspace-folder-created'` and `'conversation-updated'` inner-switch arms | the emit idiom — `emitDaemonEvent(sink, …)` with a fresh literal, and why the flat-field form is used for a small payload |
| `src/shared/ipc/events.ts` | `workspaceFolderCreated`, `conversationDeleted` arms | the single/small-payload flat emit idiom, and the standing untrusted-text warning each arm carries forward |
| `src/renderer/src/store/conversationListBridge.ts` | `shouldRefreshList`, `subscribeConversations` | the re-list trigger this event joins, and the "we react to the OCCURRENCE, never read the payload" rule |
| `src/renderer/src/store/{timelineBridge,questionBridge,modalBridge,daemonEventBridge}.ts` | each file's `assertNever`-terminated switch | the four compile-forced no-op arms |
| `e2e/fixtures/conversationStateFake.ts` | `conversationStateFake`, its `labels` map, `conversationUpdatedFrame` | the fixture AC4 needs a seam in: one label per `cwd`, derived once from the seed, with no handle to change it |
| `e2e/fixtures/launchPairedApp.ts` | `PairedApp.daemon` → `pushFrame` | the only route by which a spec can drive an *unsolicited* frame; used by the second-server poll already |
| `e2e/workspace-label.spec.ts` | the whole spec | #1287's sibling — the locator (`.channel-list__workspace-label`), the seed shape, and the "assert the label is not the folder segment" negative |
| `docs/knowledge/features/conversation-list-fetch.md` | the eight-piece table | the standing shape of a decode-to-event slice in this codebase, piece for piece |

## Design source

**Figma:** no drawing changes. The row whose label refreshes is the Workspace component
<https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=399-1059> in the Hosts frame
<https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=106-3160>, already built by #1287. This
ticket changes no markup and no token; it changes only *when* that row re-reads its text. The visual
fidelity check is intentionally the one #1287 already passed.

## Context

#1287 put the daemon's workspace label on the sidebar row, read off `ConversationSummary.workspace_label`
in the `list_conversations` reply. That made the label *visible*; it did not make it *live*. A rename
performed from another client — or by this client once #1289 lands the outbound verb — changes the
daemon's held label, and the desktop keeps rendering the old one until something else happens to
re-request the list.

The mechanism is deliberately the one already in the file: a re-list, not a patch. `shouldRefreshList`
turns a create, a rename, an archive and a delete into a fresh `list_conversations`, and the daemon's
authoritative reply lands the new rows. That is why none of those verbs does local array surgery, and it
is why this one must not either. It also has a security consequence worth stating up front, because it
makes most of the review below trivial: **the `path` and `label` this frame carries never reach a store
or a render sink.** The label that ends up on screen comes from the follow-up `conversations` reply,
through the decode path #1287 already hardened. This frame is a pure trigger.

**Sizing — this plan exceeds the ≤5 production-file line, deliberately, at nine.** Five files carry the
feature (`types.ts`, `inboundMessage.ts`, `events.ts`, `daemonConnection.ts`, `conversationListBridge.ts`)
and four carry a one-line no-op `case` forced by an `assertNever`. The only seam is decode versus
emit-and-refresh, and cutting there leaves the second half at seven files — still over — while the first
half is a decoded arm nothing emits, whose sole consumer is the second half. That is the floor rule, and
the floor beats the ceiling: a slice consumed by exactly one sibling in its own family is part of that
sibling. Every other boundary holds — one new exported type, four compile-forced call sites, four
acceptance criteria, three reject branches, and ~600 lines of total written work.

**No ADR is warranted.** Every decision here follows a precedent already recorded in
`docs/knowledge/features/inbound-message-decode.md` and `conversation-list-fetch.md`.

**One stale comment is left alone on purpose.** `ConversationUpdatedPayload`'s doc calls its arm "the LIVE
path for a label change". It is not: `conversation_updated` fans out on a *conversation* mutation, so a
bare workspace rename produces no such frame. Correcting it is a documentation-phase errand, not a side
edit here.

## Design

### 1. The wire type — `src/shared/wire/types.ts`

```ts
export interface WorkspaceUpdatedPayload {
  path: string
  label: string | null
}
```

Two fields, mirroring the daemon's struct. `label` takes `ConversationUpdatedPayload.workspace_label`'s
contract verbatim — required key, nullable value, no `omitempty`, so a cleared label arrives as a literal
`null` and never as an absent key. `path` takes `WorkspaceFolderCreatedPayload.path`'s: an untrusted
daemon-side *remote* path held as opaque text, resolved against no filesystem here. Its own type, not an
alias of either neighbour — the verb owns its wire surface, this file's standing rule.

`'workspace_updated'` joins `EnvelopeType` beside `'workspace_folder_created'`. Not a compile need
(`Envelope.type` is a plain validated `string`), but `EnvelopeType` is this repo's mirror of the daemon's
vocabulary and an inbound type absent from it reads as unmodelled.

### 2. The decode — `src/main/transport/inboundMessage.ts`

```ts
function parseWorkspaceUpdatedPayload(payload: unknown): WorkspaceUpdatedPayload
```

Placed beside `parseWorkspaceFolderCreatedPayload`, in its shape: an `isRecord` guard throwing
`WireDecodeError('malformed workspace_updated payload')`, then `requireString(payload, 'path')` and
`requireStringOrNull(payload, 'label')`, returning a fresh two-field object so no server-added key rides
through. `null` is a value ("this workspace has no label"), a missing key an absence that fails closed.

The union gains one member:

```ts
| { kind: 'workspace-updated'; workspaceUpdated: WorkspaceUpdatedPayload }
```

**No `inReplyTo`, and that is a decision.** The frame is correlated when this client asked for the rename
and unsolicited otherwise, and AC1 requires both to decode to the same kind — which they do, because the
arm simply never reads `envelope.in_reply_to`. Surfacing the handle would hand a consumer a match key
nothing correlates on: the outbound verb (#1289) learns the rename landed the same way every other client
does, from the re-listed rows. `workspace-folder-created` is the precedent — always correlated, carries no
handle, because its payload is self-sufficient.

The `switch (envelope.type)` gains `case 'workspace_updated'`, beside `'workspace_folder_created'`:
narrow first, then log `{ event: 'inbound-decoded', code: 'workspace_updated', bytes, hash }` — the
existing content-free field set, no `count`, and neither decoded field. Narrowing before logging is what
keeps a malformed frame unlogged.

### 3. The emit — `src/main/daemonConnection.ts`

A `case 'workspace-updated'` in the inner switch, beside `'conversation-updated'`:

```ts
emitDaemonEvent(sink, {
  type: 'workspaceUpdated',
  path: inbound.workspaceUpdated.path,
  label: inbound.workspaceUpdated.label
})
```

Flat fields, not a payload reference — the `workspaceFolderCreated { path }` / `conversationDeleted { id }`
idiom for a small payload; only the six-field `conversationUpdated` wraps a wire type by reference. A
fresh literal naming each field, never a spread, so a decoder that later grew a field could not smuggle it
across IPC.

The server stamp is inherited, not written: `emitDaemonEvent(sink, …)` is the same call every neighbour
makes, and `bindServerOrigin` applies `serverId` at bind time from the paired record this client holds.
AC2's "never read from the payload" is therefore satisfied by construction — there is no code here that
*could* read an origin off `path`, and none is added.

### 4. The IPC event — `src/shared/ipc/events.ts`

```ts
| { type: 'workspaceUpdated'; path: string; label: string | null }
```

Ships dormant in the sense that matters: no consumer reads either field. The arm carries the standing
warning its neighbours do — both strings are untrusted daemon text, owed plain-text rendering (never
`innerHTML` / `dangerouslySetInnerHTML`), and `path` is a *remote* path that must never be resolved into a
local filesystem operation, keyed into a lookup, or logged. The first consumer to read a field inherits
that from the declaration; see the security review's first finding for why this is written down rather
than assumed.

### 5. The refresh trigger — `src/renderer/src/store/conversationListBridge.ts`

`shouldRefreshList` gains one disjunct, `event.type === 'workspaceUpdated'`, joining the three arms already
there. Behaviour identical to `conversationUpdated`'s: the trigger is the *occurrence*, the payload is
never read, the re-list is global rather than scoped to the emitting server, and no row is patched. Scoping
a trigger to its origin server is a command-with-a-server-id concern the module already names as the
routing ticket's — not opened here.

`subscribeConversations` needs no edit: it already calls `shouldRefreshList` on every event.

### 6. The four compile-forced arms

`timelineBridge.ts`, `questionBridge.ts`, `modalBridge.ts` and `daemonEventBridge.ts` each end their switch
in `assertNever`, so each needs one `case 'workspaceUpdated':` in its no-op group — exactly as
`conversationDeleted` and `workspaceFolderCreated` have one. No behaviour, no new dependency; the typecheck
reddens the moment the union member exists.

### 7. The fixture seam — `e2e/fixtures/conversationStateFake.ts`

The fake holds one label per `cwd`, derived once from the seed rows, with no handle to change it. AC4 needs
one. The seam is a **property attached to the returned function**:

```ts
export interface ConversationStateFake {
  (inboundPlaintext: Uint8Array): Uint8Array[]
  /** Rename one workspace: update the held label for `cwd` and every row in it, and return the
   *  unsolicited `workspace_updated` broadcast frame for the spec to push. */
  renameWorkspace(cwd: string, label: string | null): Uint8Array
}
```

Two properties make this the right shape. It costs **zero call-site edits across the 29 spec files** that
use this fixture — a function carrying an extra property is still assignable to
`(inbound: Uint8Array) => Uint8Array[]`, so `launchPairedApp({ buildReplyFrames })` is untouched — where
returning an object would fan out to all 29. And it does the state change and the frame in **one call**, so
a spec cannot mutate the fake's state and push a frame that disagrees with it; the fake owns the wire shape
the way `conversationUpdatedFrame` already does.

The mutation updates both the `labels` map and every held row whose `cwd` matches, so the follow-up
`list_conversations` answers with the new label — which is the whole point, since that reply is what the
sidebar actually renders. The fake does not model the `rename_workspace` request verb; that is #1289's.

## State + concurrency model

No store is added and no store is written by this path. The one state effect is the existing
`refreshOnChange` → `requestConversationList` → `conversations` reply → `setConversations` cycle, unchanged
in shape and now reachable from one more frame type.

No new async task, no timer, no subscription. `subscribeConversations` already owns the single listener and
returns the unsubscribe handle used as the React effect cleanup; this ticket adds a disjunct inside that
listener, so cancellation and teardown are unchanged.

Ordering note, and it is the reason AC4's opening read matters: the re-list is asynchronous. The frame
arrives, the trigger fires a `list_conversations`, and the label changes only when the reply lands. A spec
that asserts the new label without first pinning the old one cannot tell that cycle from a fake that was
seeded with the new label all along.

## Error handling

| Layer | Failure | Result |
|---|---|---|
| `parseInboundMessage` | plaintext over `MAX_PLAINTEXT_BYTES` | existing frame-level guard throws `WireDecodeError`; no arm runs, nothing logged |
| `parseWorkspaceUpdatedPayload` | payload not a record | `WireDecodeError('malformed workspace_updated payload')` |
| `parseWorkspaceUpdatedPayload` | `path` missing or not a string | `requireString` throws `missing required field: path` |
| `parseWorkspaceUpdatedPayload` | `label` missing, or neither string nor `null` | `requireStringOrNull` throws `missing required field: label` |
| `daemonConnection` inbound loop | any of the above | the existing catch drops the line — no event emitted, no throw into the app |

Three reject branches, all fail-closed, all category-only: every message names a **client-owned field-name
constant** and never a value. A partial value is never returned — a frame missing `label` does not decode
to a path-only event.

## Testing strategy

**Vitest — `src/main/transport/inboundMessage.test.ts`** (beside the `workspace_folder_created` describes):

- narrows a `workspace_updated` into `{ kind: 'workspace-updated' }` carrying both fields
- a `null` `label` decodes as the value `null`, not as an absence
- decodes identically **with** and **without** `in_reply_to` (AC1's explicit both-ways case)
- fail-closed: non-record payload; missing `path`; non-string `path`; missing `label`; `label` a number
- throws on an oversized plaintext even when the JSON is valid
- logs content-free — `code: 'workspace_updated'`, bytes and hash, and neither `path` nor `label` anywhere
  in the record; asserted by the sibling's exact-field-set idiom
- does **not** log on the malformed throw path

**Vitest — `src/main/daemonConnection.test.ts`** (beside the `workspace_folder_created` describes):

- an inbound `workspace_updated` emits exactly one `workspaceUpdated` carrying `path` and `label`
- a malformed one emits nothing and throws nothing

**Vitest — `src/renderer/src/store/conversationListBridge.test.ts`**:

- `shouldRefreshList` returns true for `workspaceUpdated`
- through `subscribeConversations`: the event fires `refreshOnChange` exactly once and calls
  `setConversations` **zero** times — the "no row is patched, no other store is written" half of AC3, which
  a `shouldRefreshList`-only test cannot reach

**Vitest — `src/shared/wire/types.test.ts`**: `'workspace_updated'` is an `EnvelopeType` member;
`WorkspaceUpdatedPayload` admits a string label and a `null` one.

**Playwright — `e2e/workspace-updated-relist.spec.ts`** (fake tier, default `npm run e2e`): seed one
promoted row whose workspace carries `OLD_LABEL`; assert `.channel-list__workspace-label` reads it — the
load-bearing opening read, and a *positive* auto-waiting assertion rather than an absence, so it cannot
pass before the sidebar has rendered. Then one call to `fake.renameWorkspace(cwd, NEW_LABEL)` pushed
through `daemon.pushFrame`, and assert the same locator reads `NEW_LABEL`, with no relaunch and no
reconnect anywhere in the drive. Both labels are fixed literals chosen to share no substring with each
other, with any locator, or with the cwd's folder segment.

Fakes over mocks throughout: the decode tests drive `parseInboundMessage` with real encoded envelopes, and
the e2e drives the real decoder, the real IPC arm and the real store behind `conversationStateFake`.

## Open questions

1. **Does the sidebar re-render on a re-list that changes only a workspace label?** #1287 derives the label
   from the rows, and `setConversations` replaces the server's whole slot, so it should. Resolved by AC4's
   spec either way — if it does not, the bug is in this ticket's scope because AC4 names the rendered text.
2. **Does `renameWorkspace` need to update rows, or is the `labels` map alone enough?** The map feeds
   minted rows; the *held* rows carry their own `workspace_label`, and `list_conversations` answers from
   those. Both must move. To confirm against the running fake in Phase B.

Each is resolved during implementation; anything that changes the design above is recorded under
`## Revisions`.

## Security review

**Verdict:** PASS

The design's central security property is structural rather than defensive, and it decides most of what
follows: **because the trigger re-lists rather than patches, the `path` and `label` this frame carries
reach no store, no render sink and no log.** The label that ends up on screen arrives later, on the
`conversations` reply, through the decode path #1287 already hardened. Two fields cross IPC and nothing
reads them. Several categories below are therefore not "N/A" in the hand-waving sense — they are closed
by that decision, and they would reopen if it were reversed.

**Findings:**

- **[Trust boundaries] SHOULD FIX — the event ships two untrusted fields that no consumer reads, and the
  first one to read them will inherit whatever the declaration says.** The boundary itself is single and
  explicit: `parseWorkspaceUpdatedPayload` is the only place this payload is narrowed, and downstream code
  holds a fresh two-field object. What is *not* self-evident is that `path` — a value that looks exactly
  like a filesystem path and would be the obvious key for a future workspace-grouping map — is a **remote**
  daemon-side path this client must never resolve, join, key on, or log. The mitigation is at the
  declaration: the `events.ts` arm carries that warning explicitly (§ Design 4), so it is read by whoever
  writes the first consumer rather than rediscovered. Not a MUST FIX because nothing in this ticket reads
  either field; recorded because "no consumer today" is exactly the condition under which such a contract
  goes stale.

- **[Trust boundaries] SHOULD FIX — patching the row locally from this frame would be a new render path
  for untrusted daemon text, so the no-patching rule is a security property and not only an architectural
  one.** The tempting shortcut is to write `label` straight onto the matching sidebar rows and skip the
  round trip. That would put a daemon-supplied string on screen *bypassing* the `list_conversations`
  decode, and would do it on the one arm whose payload is never otherwise validated for display. The
  deterministic detector is a test, not a rule: `conversationListBridge.test.ts` asserts `setConversations`
  is called **zero** times for a `workspaceUpdated` event (§ Testing strategy), so a future patch-the-row
  change reddens a gate rather than relying on a reviewer noticing.

- **[File / storage operations] No findings — by decision, not by omission.** `path` is never an argument
  to anything in `node:path` or `node:fs`: it is not resolved, joined, boundary-checked, stat-ed or
  written, because there is nothing to check — it names a directory on the *daemon's* host, which this
  process cannot see and must not pretend to. No file is read or written on this path at all, so there is
  no traversal surface, no TOCTOU window and no atomic-write question. The `WorkspaceFolderCreatedPayload`
  posture, inherited deliberately.

- **[Inter-process / Electron attack surface] No findings.** No `contextBridge` API, no `ipcMain` channel
  and no `BrowserWindow` is added or changed; `workspaceUpdated` rides the existing daemon-event channel.
  Note the direction: this is main → renderer, the *trusted → untrusted* leg, so a compromised renderer
  cannot forge this event to drive re-lists — and it gains nothing if it tries, since it can already send
  `requestConversations` itself. No new renderer capability, no new privileged surface.

- **[Cryptographic primitives] No findings — out of this slice's reach by construction.** The frame arrives
  as already-decrypted plaintext from the existing Noise session; this ticket is strictly downstream of the
  handshake, touches no key, no nonce, no token and no comparison against a secret, and adds no
  randomness. Nothing here could reuse a `(key, nonce)` pair because nothing here holds one.

- **[Network & I/O] OUT OF SCOPE — a hostile daemon can amplify this frame into conversation-list requests,
  including requests to a *different* paired server.** `subscribeConversations` fires one global
  `refreshOnChange` per trigger event, and the module states in as many words that it re-requests from
  every server; so server A flooding `workspace_updated` produces outbound `list_conversations` traffic to
  server B as well. This is real, it is **pre-existing and unchanged in kind** — `conversationUpdated` has
  had exactly this property since #275, and the ticket requires this trigger's behaviour be identical to
  it — and this slice widens the surface by one frame type without creating it. Scoping a refresh to the
  server that emitted it is a command-with-a-server-id concern the module already names as the **routing
  ticket's**; rate-limiting the re-list is a refresh-policy concern belonging to whichever ticket takes
  that up. Deliberately not opened here: diverging this arm's trigger from its neighbour's would leave two
  refresh policies in one function and fix neither.

- **[Error messages, logs, telemetry] No findings.** Every message names a **client-owned field-name
  constant** — `malformed workspace_updated payload`, `missing required field: path`,
  `missing required field: label` — and never a value, so a `$HOME`, a username or a project name in
  either field cannot be echoed (AC1). The diagnostic record is the existing content-free set,
  `{ event, code: 'workspace_updated', bytes, hash }`, with no `count` and neither decoded field; `code` is
  a literal written in this file, not the peer's `type` string. Narrowing runs **before** the log, so a
  malformed frame throws first and leaves no record at all. Nothing reaches the renderer console.

- **[Concurrency] No findings.** No async task, timer, subscription or listener is added; the change is one
  disjunct inside the listener `subscribeConversations` already owns and already tears down through the
  returned unsubscribe handle. Two frames in quick succession produce two re-list requests whose replies
  are idempotent by construction — `setConversations` replaces the server's whole slot — so there is no
  check-then-act window across an `await` and no ordering assumption to violate.

- **[Threat model alignment] No findings — the applicable threat is the hostile daemon response, and it is
  parsed defensively.** A daemon (or anything impersonating one *inside* the session) sending malformed,
  mistyped, partial or oversized input fails closed at `parseWorkspaceUpdatedPayload` and the frame-level
  `MAX_PLAINTEXT_BYTES` guard, with no partial value returned and the line dropped rather than surfaced.
  No allocation is derived from either field, so there is no claim-driven memory vector; no client-invented
  length cap is added either, since that would fail-close a legitimately long path while
  `MAX_PLAINTEXT_BYTES` already bounds the frame. The **malicious relay** is unaffected: it stays
  content-blind and can only drop, delay, reorder or duplicate this frame, each of which degrades to a
  missed or repeated re-list. **Token theft** and **renderer compromise reaching the transport** are
  untouched — no secret is read, written or moved by this path.

- **[Test-only surface] No findings.** The fixture's `renameWorkspace` seam mutates a `Map` keyed on `cwd`,
  not a plain object, so a `__proto__` key resolves to nothing — the choice the existing `labels` comment
  already justifies, preserved rather than re-litigated. Fixture-authored keys make it unreachable anyway,
  and none of this ships in the app bundle.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08

## Revisions

**2026-09-08 — both Open Questions resolved; no design change.**

1. *Does the sidebar re-render on a re-list that changes only a workspace label?* **Yes.**
   `e2e/workspace-updated-relist.spec.ts` drives the whole path and the row's text moves from the old
   label to the new one. Falsified as well as confirmed: with the `workspaceUpdated` disjunct disabled in
   `shouldRefreshList` and the app rebuilt, the spec's closing assertion reddens, so it detects the
   feature rather than passing on a fake seeded with the new label. No production change followed.
2. *Does `renameWorkspace` need to update rows, or is the `labels` map alone enough?* **Both must move**,
   as the plan anticipated. The map feeds rows minted or moved into the workspace later; the held rows
   carry their own `workspace_label` and are what `list_conversations` answers with — and that reply, not
   the pushed frame, is what the sidebar renders. Implemented as specified.

One thing the plan did not anticipate, recorded because it shaped the tests rather than the design: the
`connected()` helper in `daemonConnection.test.ts` is **describe-local**, defined afresh in each of a dozen
describes rather than hoisted, so the new describe carries its own copy. That is the file's existing
convention, not a duplication introduced here.
