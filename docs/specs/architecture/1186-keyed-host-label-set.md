# #1186 — the stored host label can be rewritten after pairing, on a keyed set channel

## Files read

- `src/shared/ipc/hostLabel.ts` → `HOST_LABEL_SERVER_CHANNEL`, `HostLabelServerRequest`,
  `isHostLabelServerRequest`, `HostLabelResult` — the contract this ticket adds a third channel to,
  and the guard shape the new one mirrors (including the `serverId in value` array rejection).
- `src/shared/ipc/unpair.ts` → `MAX_SERVER_ID_LENGTH`, `isUnpairServerRequest` — the bound already
  imported here, and the settled rulings on the empty id and the array test.
- `src/shared/ipc/pairing.ts` → `MAX_HOST_LABEL_LENGTH`, `isPairingRequest` — the label bound the new
  guard imports; `isPairingRequest`'s `label.length <= MAX_HOST_LABEL_LENGTH` is the exact test the
  new guard restates for a required field rather than an optional one.
- `src/main/hostLabelHandler.ts` → `registerHostLabelServerHandler`, `HostLabelServerHandleTarget` —
  the shape the new handler copies: guard as the listener's first statement, classify-don't-forward
  catch, value-free refusal, exact teardown. Its header's "registers TWO arms" goes stale.
- `src/main/unpairHandler.ts` → `registerUnpairServerHandler` — the handler whose dep narrowing
  *withholds* `loadById`, calling that "the security substance of this handler". The new handler is
  the first in this family that cannot make that promise; this is the file that says why.
- `src/main/serverInfoHandler.ts` → `registerServerInfoHandler` — the containment pattern for a
  materialised `PairedServerRecord`: fields named explicitly, never `...record`, the record never
  leaving the module.
- `src/main/hostLabelStore.ts` → `MultiHostLabelStore.saveFor` / `.clearFor`, `mutate`, `readForSave`,
  `HOST_LABEL_NAME` — the two store methods this channel drives, their serializing queue, and the
  ruling that an id is only ever a JSON value and a `===` comparand. Its header's accounting of the
  keyed writers' callers goes stale.
- `src/main/pairedServerStore.ts` → `MultiPairedServerStore.loadById`, `PairedServerRecord` — the
  existence check's method, and the fact that the record is a type alias of `QrPayload` and therefore
  carries `token` and `server_static_pubkey`.
- `src/main/index.ts` → the `unregisterHostLabel` / `unregisterHostLabelServer` block — the
  registration site, the `will-quit` symmetry, and the standing "reuse the SAME hostLabelStore" rule.
- `src/preload/index.ts` → `hostLabelFor` — the bridge method the new one sits beside, and its own
  comment's ruling that building the request object in the bridge is a convenience, not a defence.
- `src/renderer/src/screens/pairing/pairingState.ts` → `hostLabelToSend` — the trim-and-collapse rule
  this ticket relocates to the main side.
- `docs/knowledge/features/host-label-channel.md` § Security posture, § Edge cases — #1157's accepted
  residuals (the per-id existence oracle, no rate limit) and the already-documented non-atomicity
  between the unpair's two erases. Both recur below; neither is re-opened here.

## Design source

Figma: N/A — main-process IPC only. There is no rendered surface in this ticket; the Edit host dialog
(#1187) is the consumer and carries the design. The visual-fidelity check is intentionally skipped.

## Context

The host label has one writer (the pairing confirm, through `saveFor`) and one eraser (the per-server
unpair, through `clearFor`). Nothing can rewrite it once pairing is done, so a host named badly — or
left unnamed — can only be renamed by unpairing and pairing again. `MultiHostLabelStore` already has
both methods; what is missing is the seam between the renderer and them. #1187's Edit host dialog is
natively blocked on it.

A third channel, not a request shape on #1157's keyed read. Each arm holds a store handle narrowed to
the one thing it needs, so the read channel structurally cannot write, this one cannot reach the
un-keyed slot, and a malformed request on one cannot fall through to another. That is a property of
the types rather than of a branch.

No ADR is warranted: this adds no new decision, it applies #1157's settled channel-per-verb ruling a
third time.

**Sizing overage, stated per the builder brief's floor rule.** Estimated total written work is
~850–900 lines against a 800-line guideline. The ceiling is not the binding constraint here: the
guard, the handler, the registration and the bridge method each have exactly one consumer — the next
one down — so every available cut produces a child nothing outside the family calls. The floor wins;
built as one ticket, overage stated. Every other line of the one-ticket table holds (5 production
files, 2 new types, 1 consumer call site, 5 ACs, 4 reject branches).

## Design

### 1. The contract — `src/shared/ipc/hostLabel.ts`

Three additions, beside `HOST_LABEL_SERVER_CHANNEL` and its guard:

- `HOST_LABEL_SET_CHANNEL = 'pyry:host-label-set'` — the third channel constant, single source of
  truth for the preload invoker and the main registration.
- `HostLabelSetRequest = { serverId: string; label: string }` — both fields untrusted renderer input.
  `label` is **required** here where `PairingRequest.label` is optional: absence and emptiness are one
  answer on this channel ("no label"), decided by the trim on the main side, so a second
  representation would be a way for the two to disagree.
- `isHostLabelSetRequest(value: unknown): value is HostLabelSetRequest` — a non-null object carrying
  both keys, `serverId` a string within `MAX_SERVER_ID_LENGTH` and `label` a string within
  `MAX_HOST_LABEL_LENGTH`. Both constants **imported**, never restated:
  `MAX_SERVER_ID_LENGTH` from `./unpair` (already imported by this module),
  `MAX_HOST_LABEL_LENGTH` from `./pairing`. Pure; never throws.

Carried over unchanged from `isHostLabelServerRequest`, both settled in #1149 and re-applied here:
the `'serverId' in value` test rejects an array with no `Array.isArray` branch of its own, and the
empty `serverId` is structurally **accepted** (emptiness is answered one step later, by the existence
check, as `error`).

The bound applies to the **raw** label, before any trim. Trimming can only shorten, so this is
strictly the same test `isPairingRequest` applies to the value the pairing path sends; a label of
`MAX + 1` that would trim down to `MAX` is refused, deliberately, because the guard is structural and
bounds what crosses the wire rather than what survives normalisation.

`HostLabelResult` is **reused unchanged** — no new arm, no new field.

### 2. The handler — `src/main/hostLabelHandler.ts`

`HostLabelSetHandleTarget` — the two-argument `handle` / `removeHandler` shape, structurally identical
to `HostLabelServerHandleTarget`. A separate name rather than a reuse, for `isHostLabelServerRequest`'s
own stated reason: the two guard different verbs, and naming one after the other would make a later
divergence in either read as a bug in both. Reusing a type called `…ServerHandleTarget` on a writer
would also put a read-flavoured name on the module's first mutating arm.

`registerHostLabelSetHandler(target, deps)`, with

```ts
deps: {
  store: Pick<MultiHostLabelStore, 'saveFor' | 'clearFor'>
  pairedServers: Pick<MultiPairedServerStore, 'loadById'>
}
```

The first `Pick` withholds `save`, `load`, `loadFor` and `clear`, so this arm cannot reach the
un-keyed slot in either direction and cannot read a label back. The second is the ticket's one new
risk and is discussed under Error handling and in the security review.

Listener, in order:

1. **Guard first statement.** `if (!isHostLabelSetRequest(request)) return { status: 'error' }` —
   outside the try, matching both siblings. A refusal returns the same value-free `error` as every
   other failure and returns it before any store call, so a malformed request reaches neither store.
2. **Trim, once.** `const label = request.label.trim()` — `hostLabelToSend`'s collapse, relocated to
   the boundary. Blank after trimming means "no label".
3. **Existence check, inside the try**, reduced to a boolean at the call site:
   `if ((await pairedServers.loadById(request.serverId)) === null) return { status: 'error' }`.
   The record is never bound to a name, never destructured, never spread.
4. **One of two store calls, chosen by the trimmed value.** `label === ''` → `clearFor(serverId)`,
   answer `{ status: 'not-stored' }`. Otherwise → `saveFor(serverId, label)`, answer
   `{ status: 'stored', label }` — the trimmed value just written, not a read-back, so there is no
   second round trip and no read that could throw after a completed write and downgrade it.
5. **Classify-don't-forward catch** wrapping 3–4: every throw collapses to `{ status: 'error' }`
   without inspecting the error type; the caught object is dropped. `handle` must resolve to a value,
   so this never rethrows.

Log-free by construction: no `console.*` on any path, the id and the label opaque locals.

### 3. Registration — `src/main/index.ts`

Beside the other two arms, on the **same** `hostLabelStore` and `pairedServerStore` instances already
constructed there — never a second store — with a `will-quit` teardown symmetric with
`unregisterHostLabelServer`.

### 4. Bridge — `src/preload/index.ts`

`setHostLabelFor(serverId: string, label: string): Promise<HostLabelResult>`, invoking
`HOST_LABEL_SET_CHANNEL` with `{ serverId, label }`. Building the request in the bridge is a
convenience and not a defence — the renderer is untrusted and can invoke the channel with anything, so
main validates on its own merits regardless. `PyryApi` is inferred from the object literal, so
`index.d.ts` needs no edit.

### 5. Stale comments in scope

- `hostLabelHandler.ts` header: "Since #1157 it registers TWO arms" → three, and the third is the
  module's first **writer**, which is what makes the per-arm `Pick` narrowing carry more weight rather
  than less.
- `hostLabelStore.ts`: the header's "#1156 moved the writers…" accounting, and `MultiHostLabelStore`'s
  "Two of the three now have the callers … `loadFor` is still caller-less" — both now wrong about how
  many callers each keyed member has. Rewritten minimally; no other paragraph is touched.

## State + concurrency model

No renderer state, no store slice, no React surface. All state is at-rest.

`saveFor` and `clearFor` are read-modify-write and already run one at a time through
`hostLabelStore`'s `mutate` queue, so two concurrent sets — or a set racing the pairing confirm's
write or the unpair's erase — cannot drop another server's label. This handler adds nothing to that
and must not: putting a second queue in front of the store would serialize against a lock the store
does not share.

The one thing the queue does **not** cover is the gap between `loadById` and the write, which spans
two different stores with two different queues. See Error handling.

Teardown: the returned unregister removes exactly the channel it added; `will-quit` calls it. No
timers, no listeners, no long-lived async work, so there is nothing to abort.

## Error handling

Four reject branches, all landing on the same value-free `{ status: 'error' }`:

1. **Guard refusal** — missing field, wrong type, over-length id or label, array, null, undefined.
   Reaches no store method at all.
2. **Unknown id** — `loadById` returned null. Nothing is written.
3. **`loadById` throw** — a propagated decrypt failure or `MalformedPairedServerRecordError`. Nothing
   is written.
4. **`saveFor` / `clearFor` throw** — `EncryptionUnavailableError`, a decrypt failure, or
   `MalformedHostLabelError` from a drifted envelope. Fail-closed: `error` is the honest answer, since
   the store's write is single-shot and a throw means the prior blob is whole.

A refusal is deliberately **indistinguishable** from a throw, per the family's rule — a distinct
outcome would tell a compromised renderer which of its guesses was well-formed.

**Why the existence check is not optional.** `saveFor` drops any entry for the id and appends, so
without it a bogus id would (a) park an orphan label on disk, (b) become what the still-live un-keyed
`load` answers with, since that read returns the most recently stored entry, and (c) let a renderer
append one entry per guessed id and grow the at-rest blob without bound. The check turns all three
into `error`.

**Accepted residual: the check-then-act gap.** `loadById` and the write are two stores' operations
across an await, so an unpair landing between them leaves an orphan label for a server that is no
longer paired. It cannot be closed here — cross-store atomicity is not available, and neither store's
mutate queue serializes against the other's. It is the same shape and the same severity as the
already-documented non-atomicity between `unpairHandler`'s two erases: benign, self-healing (the next
pairing that carries a label overwrites it, the next unpair erases it, `clearFor` is idempotent), and
stale display text rather than a live credential. Named, not fixed.

Nothing beyond the union's three arms leaves the handler: `label` only on `stored`, and no field of
the `PairedServerRecord` anywhere.

## Testing strategy

Unit only, vitest, node environment. There is no preload test file in this repo and this ticket does
not mint one; the dialog ticket (#1187) drives this in the running app.

**`src/shared/ipc/hostLabel.test.ts`** — a `describe('isHostLabelSetRequest')` beside
`isHostLabelServerRequest`'s, plus one channel-pinning assertion extended to the third constant:

- the three channel strings are pinned and mutually distinct
- accepts a well-formed request, including one carrying an extra field (structural minimum)
- accepts an empty `serverId` and an empty `label` — both answered later, not here
- rejects null, undefined, a string, a number, an array, `{}`, either field missing, either field
  non-string, and either field present-but-`undefined`
- bounds each field independently: exactly `MAX_SERVER_ID_LENGTH` / `MAX_HOST_LABEL_LENGTH` accepted,
  one over rejected, and a long value in one field does not excuse the other
- an over-long label that would trim to within the bound is still rejected — the guard bounds the raw
  wire value
- a prototype-shaped `serverId` is an ordinary string

**`src/main/hostLabelHandler.test.ts`** — a `describe('registerHostLabelSetHandler')`, reusing the
file's existing `fakeSecureStore` / `createHostLabelStore` helpers for the round-trip cases:

- registers exactly one handler, on the SET channel and neither other; unregisters exactly that one
- **AC1** a non-blank label stores it trimmed for the named server and no other — over a real store:
  `loadFor` returns the trimmed value, a second server's label is unchanged, response is `stored`
  carrying the trimmed label; interior whitespace survives
- **AC2** blank after trimming (`''`, `'   '`, `'\t\n'`) calls `clearFor` and never `saveFor`;
  `loadFor` is null afterwards, another server's label is unchanged, response is `not-stored` with no
  `label` key
- **AC3** every malformed shape → `error`, exactly one key, and neither store method **nor**
  `loadById` called (the half that detects a deleted guard: on `null` / `undefined`,
  `request.serverId` would throw and the catch would return `error` anyway)
- **AC3** an id naming no paired server → `error`, `saveFor` and `clearFor` uncalled
- **AC3** a `loadById` throw, a `saveFor` throw and a `clearFor` throw each → `error`, resolving
  rather than rejecting, with nothing written on the `loadById` path
- **AC5** no field of the paired record rides back: `loadById` resolves a full record whose `token`
  and `server_static_pubkey` are recognisable strings; the response's keys are exactly
  `['status','label']` / `['status']` and its serialisation contains neither
- **AC5** log-free across every branch — `console.log/info/warn/error/debug` spied, all branches driven
- the id passes through verbatim to both store methods, `__proto__` included
- reads through on every invoke — two sets in sequence both reach the store

**AC4** needs no new test: the existing whole-interface literals in this file (`HostLabelStore` and
`MultiHostLabelStore`) and the #1069 structural fakes keep compiling because no interface gains a
member. `npm run build` is what proves it, and a regression there is `tsc`-only.

## Open questions

1. Whether the response should be a genuine read-back (`loadFor` after the write) rather than the
   value just written. Resolved in the design above — a read-back would need a third store method in
   the dep, could throw after a completed write and downgrade a real success to `error`, and would
   race the store's own queue. Recorded here so the choice is visible rather than implicit.
2. Whether `HostLabelSetHandleTarget` should be a reuse of `HostLabelServerHandleTarget`. Resolved
   above in favour of a separate name; if implementation shows the duplication is inert, the decision
   still stands on the divergence argument.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. One explicit boundary, one function: `isHostLabelSetRequest`,
  applied as the listener's first statement and outside the try, so a malformed request reaches
  neither store. Both fields stay untrusted after it — `serverId` becomes a JSON string value and a
  `===` comparand only, `label` becomes a JSON string value and the `stored` arm's payload. One
  asymmetry worth naming rather than fixing: on this channel `stored.label` is **renderer-origin**
  text echoed back, where on both read channels it is disk-origin. It is still the label now held,
  because the write is single-shot and reported only after it resolves, and it is the value the
  renderer just supplied — so it is not a disclosure. The `.trim()` sits outside the try
  deliberately and cannot throw: after the guard `request.label` is a string, and `request` is a
  structured-clone deserialization — a plain object, never a Proxy with a throwing getter — which is
  the same property both siblings already rely on when they re-read `request.serverId`.

- **[Tokens, secrets, credentials]** SHOULD FIX, and the plan already carries the fix. `loadById`
  makes this the first handler in the host-label family able to materialise a `PairedServerRecord`,
  and that record is a type alias of `QrPayload` — a bearer token and a server static key. Contained
  by reducing it to a boolean **in the call expression itself**
  (`(await pairedServers.loadById(id)) === null`): never bound to a name, never destructured, never
  spread, so no field is reachable after that line. `loadById` rather than `list` for exactly this
  reason — a null test names no field, where `list` would put a whole collection in scope. Phase B
  must land the pinning test named in Testing strategy: a `loadById` resolving a record whose `token`
  and `server_static_pubkey` are recognisable strings, asserting the response's keys are exactly
  `['status','label']` / `['status']` and its serialisation contains neither. A store throw's caught
  object is dropped, and `pairedServerStore`'s own malformed-record message is already static (no
  bytes, no id, no index).

- **[File / storage operations]** No MUST FIX; two things named. **(a) The existence check is what
  bounds at-rest growth, not just correctness.** `saveFor` drops any entry for the id and appends, so
  without the check a renderer could append one entry per guessed id — an id up to
  `MAX_SERVER_ID_LENGTH` (8192) and a label up to 128 — and grow the blob without bound, *and* park
  text that the still-live un-keyed `load` would answer with, since that read returns the most
  recently stored entry. With the check, the stored id is necessarily `===` an already-persisted
  paired id, so the entry count is capped by the paired-server count and a repeat set on the same id
  replaces rather than appends. **(b) OUT OF SCOPE — on a pre-#1156 legacy blob a clear is a silent
  no-op.** `readEntries` reads a bare blob as no entries, so `clearFor` finds nothing to remove and
  returns *without writing*; the bare label survives on disk and the zero-argument `hostLabel()` — the
  query the sidebar still uses until #1070 — keeps answering with it, while this channel truthfully
  reports `not-stored`. That discrepancy is the already-documented one-way loss, not something this
  handler may fix: erasing the legacy blob would be a new migration behaviour, and the ticket scopes
  changes to the store's semantics and to either unpair erase out. Picked up by #1187 as a UI note
  and by the documentation phase. No path traversal: `HOST_LABEL_NAME` is one constant and the id is
  never composed into a persistence name. Encryption at rest, fail-closed writes and temp-then-rename
  atomicity are inherited unchanged from `SecureStore` / `fileSecretPersistence`.

- **[Inter-process / Electron attack surface]** No findings. Every argument is validated for type,
  length and shape before use; the bridge exposes exactly `setHostLabelFor(serverId, label)` and never
  `ipcRenderer` or a Node primitive; the channel string is fixed in the preload so the renderer cannot
  address an arbitrary channel, and is pinned distinct from the other two by a test. `webPreferences`
  is untouched. **Named and accepted: this is a new write capability for the renderer** — previously it
  could write a label only through the pairing confirm and erase one only by unpairing. It is the
  ticket's purpose, and it adds durability rather than capability: the renderer already *renders* the
  sidebar and can misname a host on screen without persisting anything. It reaches no token, server
  key, relay URL or socket — the dep types withhold every read that could materialise one except the
  contained `loadById`.

- **[Cryptographic primitives]** Not applicable by design: this handler adds no RNG, no primitive, no
  key handling, and no comparison against a secret. The `=== null` is a null test, not a token
  compare, so `timingSafeEqual` does not apply. A timing side channel on `loadById` would disclose
  only whether an id is paired, which the outcome already states and which `serverInfo` publishes in
  full.

- **[Network & I/O]** Not applicable by design: at-rest state only. The handler holds no reference to
  the relay connection, the supervisor, or any session value, so there is no socket, frame, timeout or
  TLS decision in scope and the channel answers whether or not a connection is live.

- **[Error messages, logs, telemetry]** No findings. Log-free by construction — no `console.*` on any
  path, pinned by a test that drives every branch; the id and the label are opaque locals, never named
  fields of a logged object. All four reject branches land on the same value-free `error`, which is
  value-free by the *type* rather than by handler care, so no reason field, no length, no truncated
  prefix and no echoed id can ride back. Refusal is deliberately indistinguishable from a throw, so a
  compromised renderer cannot learn which of its guesses was well-formed. The listener never rethrows,
  so nothing crosses as an Electron-serialized error carrying a main-process stack trace.

- **[Concurrency]** Named, accepted, not fixed: the `loadById` → write gap is a check-then-act across
  two stores with two independent mutate queues, so an unpair landing in the gap leaves an orphan
  label for a server that is no longer paired. Cross-store atomicity is not available here, and a
  second queue in this handler would serialize against a lock the paired store does not share. Same
  shape and same severity as the non-atomicity already documented between `unpairHandler`'s two
  erases: stale display text rather than a live credential, self-healing (the next pairing that
  carries a label overwrites it, the next unpair erases it, `clearFor` is idempotent). Within the
  label store, `saveFor` and `clearFor` are already serialized by its own `mutate` queue, so
  concurrent sets cannot drop another server's label. No timers, no listeners, no long-lived async
  work; teardown removes exactly the channel added, and `ipcMain.handle` permits one handler per
  channel so double registration is unrepresentable.

- **[Threat model alignment]** No findings. Malicious relay and hostile daemon response are off this
  path — the label here is renderer-origin, not daemon-origin, and no connection is referenced. Token
  theft from disk is unchanged: the same `safeStorage` seam, and this ticket adds no plaintext
  persistence. Renderer compromise reaching the transport is contained by the two `Pick` dep types.
  **Accepted and named, inherited from #1157's review:** a per-id existence oracle — a compromised
  renderer learns whether a guessed id is paired — which discloses strictly less than `serverInfo`,
  which already returns every paired id with no request at all. **No rate limit, deliberately,** on
  the same reasoning: this is the first freely-drivable *write* in the family, but each invoke is one
  local decrypt plus one encrypt-and-write bounded by the paired count, and `unpairServer` already
  offers the renderer an unrated keychain write. A limit on this channel alone would close nothing.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-08
