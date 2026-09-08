# 1307 — a rejected `create_conversation` reaches the window as a bare `conversationCreateRejected`

## Files read

- `src/main/daemonConnection.ts` → `pendingCreateFolders` (declaration, the `daemon-error` match arm, the
  `createWorkspaceFolder` registration, the `dial()` clear) — the exact template this ticket repeats, down to
  the bare-`Set` rationale and the register-after-send ordering.
- `src/main/daemonConnection.ts` → `createConversation` — the send site that must capture its envelope id
  before the build advances `nextEnvelopeId`, the way `createWorkspaceFolder` beside it already does.
- `src/main/daemonConnection.ts` → `onDriverEvent`'s `daemon-error` case — the correlation chain
  (`pendingSettings` → `pendingCreateFolders` → `transferForEnvelope` → `pendingHistoryRequests` →
  `pendingSystemPromptWrites` → `pendingRetrievals`), then `reassembler?.fail` and the modal FIFO shift. The
  new check joins the chain; a match must `return` before both of those.
- `src/main/daemonConnection.ts` → `parseInboundMessage`'s `daemon-error` return — `inReplyTo?: number`,
  narrowed to a number at the decode boundary, so nothing daemon-typed reaches the set lookup.
- `src/shared/ipc/events.ts` → `workspaceFolderRejected` — the bare-arm declaration whose comment states the
  no-echo property the new arm inherits verbatim.
- `src/renderer/src/store/daemonEventBridge.ts` → `translateDaemonEvent` — per-arm `case` + individual
  comment + `return null`, closed by `assertNever`.
- `src/renderer/src/store/modalBridge.ts` → `translateModalEvent`, `src/renderer/src/store/timelineBridge.ts`
  → `translateTimelineEvent`, `src/renderer/src/store/questionBridge.ts` → `translateQuestionEvent` — the
  other three exhaustive `DaemonEvent` switches. All three group their no-op arms into one fall-through block
  with a single shared comment that names each consumer.
- `src/main/daemonConnection.test.ts` → the `create_workspace_folder rejection correlation (#396)` describe
  and its `errorPlaintext` helper — the test shape (match, drop-the-entry, absent id, unmatched id, modal
  FIFO untouched, bundle untouched, no-echo, dial clear, throwing send).
- `src/main/daemonConnection.test.ts` → the `createConversation (#241)` describe and `conversationCreatedPlaintext`
  — where the new tests sit relative to the send-side coverage, and the helper the success-emits-nothing case uses.
- `src/renderer/src/store/{daemonEventBridge,modalBridge,timelineBridge,questionBridge}.test.ts` → each
  bridge's no-op pin (a dedicated `it` in `daemonEventBridge.test.ts`, a table entry in the other three).
- `docs/knowledge/features/daemon-connection-correlation.md` — the tier's package overview: the
  register-after-send rule and the recycled-id hazard it exists to prevent.

## Context

`createConversation` is fire-and-forget: it builds, sends, and keeps no record of the envelope id, so a
daemon `error` correlated by `Envelope.in_reply_to` falls through the whole correlation chain and is consumed
by the modal FIFO (or dropped). Both callers — the FAB and the Channels-tree workspace plus, side by side in
`conversationCreatedBridge.ts` — have no failure path at all.

#1308's Add-workspace dialog needs one: it takes a typed folder path, and the daemon's `create_conversation`
handler refuses a folder that does not exist or escapes its home. This ticket ships the transport arm alone
with no consumer, exactly as #396 shipped `workspaceFolderRejected` ahead of #398's dialog.

No ADR is warranted: this is the sixth member of an established correlation tier, and the decision it would
record (`unique-per-request envelope id`) is already ADR-covered and documented in
`daemon-connection-correlation.md`.

**Size note — the file ceiling is exceeded deliberately.** Six production files against a boundary of five:
`daemonConnection.ts`, `events.ts`, and the four exhaustive bridges. Four of the six are compiler-forced
one-line `case` labels that cannot be deferred — a new `DaemonEvent` arm does not typecheck without them —
so a slice carrying only the transport arm would not build, and a slice carrying only the no-ops would have
nothing to no-op. The floor rule (no child that nothing outside the family consumes) wins over the file
ceiling here, as the ticket's own estimate line states. Every other line of the boundary holds: ~440 lines,
one new union arm, four consumer sites, four acceptance criteria, one reject branch.

## Design

### 1. The pending set (`daemonConnection.ts`)

A module-scope `const pendingCreateConversations = new Set<number>()`, declared beside `pendingCreateFolders`
and carrying a header in that comment's shape: a Set and not a Map because the emitted event is bare (no
per-entry value to carry, contrast `pendingSettings`' `changeId`) — membership is the whole query; keyed by
the request's unique envelope id, so a match is unambiguously the reply to that request; set after a
successful send, deleted on the correlated error, cleared on `dial()`; single-writer, no `await` between a
read and a write. The header says **which tier it joins**, not what number it holds — two in-tree headers
already claim to be "the fourth member", and no gate checks the count.

### 2. Registration (`createConversation`)

Capture `const envelopeId = nextEnvelopeId` before the build, mirroring `createWorkspaceFolder`, then
`pendingCreateConversations.add(envelopeId)` **after** `driver.sendMessage(bytes)` returns. The ordering is
load-bearing, not stylistic: the counter advances only on a successful build, so a build or send that throws
leaves the id to be re-minted by the next outbound envelope — an entry armed under an unspent id would
swallow that envelope's reject. The existing `catch` is unchanged and still drops the caught object.

The success reply does **not** delete the entry, matching `pendingCreateFolders` exactly. Entries therefore
accumulate across successful creates until the next `dial()`. That is bounded and deliberate on
`pendingHistoryRequests`' stated argument: an entry costs one number, only this client's own sends add one,
and every dial clears all. See the security review for the consequence and who owns it.

### 3. The correlation arm (`onDriverEvent`, `daemon-error`)

Immediately after the `pendingCreateFolders` block — its nearest sibling in shape — inside the existing
`inReplyTo !== undefined` guard:

```ts
if (pendingCreateConversations.has(inReplyTo)) { … emit bare … return }
```

A match consumes the frame entirely: emit, drop the entry, `return` before `reassembler?.fail` and before the
modal-FIFO shift. An error correlated by a unique per-request envelope id is unambiguously the reply to that
request, so failing a healthy in-flight bundle or dequeuing the oldest modal answer on it would be a bug.
Order relative to the other five members is immaterial — an envelope id is minted once, so at most one store
can hold it. An absent `in_reply_to` short-circuits at the enclosing guard; an unmatched id falls through
unchanged. Nothing is read off the error payload and the numeric `inReplyTo` stays main-internal.

No diagnostic log: no member of this tier logs, and the event *is* the report. The only values a log line
could carry here are the wire routing id and daemon-authored text, and neither may reach a sink.

### 4. `dial()`

`pendingCreateConversations.clear()` beside `pendingCreateFolders.clear()`, with the same rationale: a
reconnect abandons outstanding requests, and ids recycle from 2, so a stale id from a dead session must not
correlate on the fresh one.

### 5. The event arm (`events.ts`)

`| { type: 'conversationCreateRejected' }` declared next to `workspaceFolderRejected`, with a header stating:
emitted by the main-side correlation gate on a content-free `error` matching a pending `create_conversation`;
bare by construction, so no daemon-supplied byte, code, message, path or wire id can ride it (AC3-by-
construction); the daemon's own refusal message never echoes the path, so nothing is lost by the bareness;
consumed by #1308, so every exhaustive bridge no-ops it for now — the `workspaceFolderRejected`-was-a-no-op
precedent.

### 6. The four compile-forced no-ops

`daemonEventBridge.ts` gets its own `case` + comment + `return null` (its per-arm house style); `modalBridge.ts`,
`timelineBridge.ts` and `questionBridge.ts` each get a `case` label added to their existing fall-through group,
with the group's shared comment extended to name #1308 as this arm's consumer (the way #1288's `workspaceUpdated`
was named). No store, no screen, no dialog — that is the whole renderer footprint.

## State + concurrency model

One new module-scope `Set<number>` inside the `createDaemonConnection` closure; no store slice, no async task,
no timer, no subscription. Every mutation runs to completion inside a synchronous `createConversation` or
`onDriverEvent` body with no `await` between a read and a write, so the single-writer property the four
existing correlation stores document holds unchanged. Teardown is `dial()`'s clear — the same handle both
`start()` and `reconnect()` funnel through — so no entry outlives the connection that minted it.

## Error handling

The arm *is* an error path. Failure modes it must survive: an error with no `in_reply_to` (short-circuits at
the enclosing guard, emits nothing); an error whose id matches nothing (falls through to the bundle net and
the modal FIFO unchanged); a duplicate error for an already-matched id (the entry is gone, so it falls
through — at most one rejection per create); a build or send that throws (registers nothing, so the re-minted
id cannot be swallowed); a reconnect mid-flight (`dial()` clears). Nothing throws out of the module: the arm
adds no `throw` and the existing `catch` in `createConversation` is untouched.

## Testing strategy

vitest only — this is main-process logic plus four type-level no-ops; there is no interaction and nothing
renders, so no Playwright spec.

`src/main/daemonConnection.test.ts`, a new describe modelled on the #396 block, reusing `errorPlaintext`,
`conversationCreatedPlaintext` and `decodeEnvelope`:

- a correlated error emits exactly one `conversationCreateRejected` — and `Object.keys` on it is `['type']`
  (the no-echo key pin, the `sessionSettingsRejected` / `workspaceFolderRejected` shape)
- the entry is dropped on match: a second error for the same id emits nothing further
- an error with an absent `in_reply_to` emits nothing while a create is pending
- an unmatched id falls through to the modal FIFO, which still rejects the oldest outstanding answer
- a matched id does **not** shift the modal FIFO and does **not** fail a healthy in-flight bundle
- a successful `conversation_created` emits `conversationCreated` and nothing on the new arm
- no emitted event contains the daemon's message, code, or the routing id (the serialize-and-scan no-echo test)
- `dial()` clears: after a reconnect, an error echoing the old id emits nothing
- a send that throws registers nothing: an error echoing the id that request would have used emits nothing

Bridge pins: a dedicated `it` in `daemonEventBridge.test.ts` asserting `translateDaemonEvent` returns `null`;
a table entry in each of `modalBridge.test.ts`, `timelineBridge.test.ts`, `questionBridge.test.ts`.

## Open questions

1. Should the success arm (`conversation_created`) delete the pending entry, so a stray later error cannot
   report a completed create as rejected? Resolved in the design above: **no** — matching `pendingCreateFolders`
   keeps the tier uniform, the success arm is shared with unsolicited broadcasts, and the consumer-side
   in-flight gate #396 established (`newFolderStore` honours a reply only while in flight) is the right place
   for it. Recorded as a finding below so #1308 inherits the obligation explicitly.
2. Where in the correlation chain does the new check go? Resolved: immediately after `pendingCreateFolders`,
   its nearest sibling in shape. Order is immaterial to correctness — an envelope id is minted once.

## Revisions

**2026-09-08 (implementation).** One addition the Testing strategy did not foresee: `questionBridge.test.ts`
asserts a COUNT over its no-op table (`toHaveLength(40)`, "43 union arms minus the 3 owned"), so adding the
arm reddens that pin as well as needing a table entry. Both were updated (41 / 44). No design change — the
pin is doing exactly its job, catching an arm that could otherwise be dropped from the table unnoticed. The
other three bridges' tests carry no such count.

## Security review

**Verdict:** PASS

**Findings:**

- [Trust boundaries] No findings — the only untrusted input the arm reads is `inbound.inReplyTo`, narrowed to
  `number | undefined` at the single decode boundary (`parseInboundMessage`'s `daemon-error` return) before it
  reaches the set. It is used for one membership test and one delete, never as a lookup path, a filename, a
  cache key or a rendered value. The emitted event is nullary, so the untrusted-to-trusted crossing carries
  zero bytes — the strongest form of the no-echo property, and the key pin test makes it a regression gate
  rather than a promise.
- [Trust boundaries] No findings on the store shape — a `Set<number>` has no prototype-setter surface, and its
  members are minted by this client's own `nextEnvelopeId` counter, never read off the wire. A later widening
  that keys anything daemon-supplied would have to revisit this; the header says so.
- [Tokens, secrets, credentials] Not applicable by construction — the ticket touches no key, token or
  credential path, adds no storage, and the event it introduces has no field that could carry one.
- [File / storage operations] Not applicable — no filesystem access is added or reached. Note the adversarial
  reading that makes this non-trivial: the daemon's rejection is *about* a folder path, so the tempting design
  is to surface that path. The arm deliberately carries none, so no daemon-supplied path can reach a renderer
  that might resolve it locally.
- [Inter-process / Electron attack surface] No findings — no new IPC channel, no `contextBridge` addition, no
  `ipcMain.handle`. The arm rides the existing main→renderer `emitDaemonEvent` channel one-way; it adds no
  renderer→main command surface, so a compromised renderer gains nothing from it. Window `webPreferences` are
  untouched.
- [Cryptographic primitives] Not applicable — no randomness, no comparison against a secret, no handshake or
  AEAD code is touched. The envelope-id match is a non-secret routing comparison, so `timingSafeEqual` does not
  apply.
- [Network & I/O] SHOULD FIX (accepted, bounded) — `pendingCreateConversations` is unbounded and only a
  correlated error or `dial()` removes an entry, so a run of successful creates leaves one number per create
  until the next dial. A hostile daemon or relay cannot add entries (only this client's own sends do), and a
  relay that withholds replies achieves at most one number per user-initiated create. Same shape and same
  accepted cost as `pendingCreateFolders` and `pendingHistoryRequests`, whose headers state the argument. No
  frame-size, TLS, timeout or reconnect behaviour changes.
- [Error messages, logs, telemetry] No findings — the arm adds no log call, matching every member of this tier.
  The event carries no message and no code, so no daemon-authored text can reach a log, a renderer console, or
  a crash report through it. The existing `createConversation` catch still drops its caught object rather than
  forwarding it.
- [Concurrency] No findings — one synchronous mutation site on the send side, one on the receive side, no
  `await` between any read and its write, so the single-writer invariant the tier documents is preserved. The
  register-after-send ordering is the load-bearing part: registering before the send would arm an entry under
  an id the next envelope re-mints, letting that envelope's reject settle this request — a real
  misdelivery, not a theoretical one, and it is pinned by the throwing-send test. `dial()`'s clear is the
  teardown, so a reconnect cannot let a dead session's id correlate on the fresh one.
- [Threat model alignment] SHOULD FIX, and it is #1308's to fix — a hostile or buggy daemon can send an error
  correlated to a create it already answered successfully, producing a `conversationCreateRejected` after a
  `conversationCreated`. This ticket accepts that: the consequence is a false failure report, never a false
  success and never leaked content, and the success arm is shared with unsolicited broadcasts so consuming the
  entry there would be a larger change than the arm itself. The mitigation is the consumer-side gate #396
  already established — `newFolderStore` honours a reply only while a request is in flight — and #1308's
  dialog must do the same. Recorded here so it is inherited rather than rediscovered.
- [Threat model alignment] OUT OF SCOPE — a malicious relay that silently drops the reply leaves a create with
  no terminal at all. Unchanged by this ticket (that is today's behaviour for every create) and not addressable
  in the transport without a timeout policy; #1308 owns whatever its dialog does about a reply that never comes.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
