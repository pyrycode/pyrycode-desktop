# #1149 — the unpair request names the server to forget

## Files read

Codegraph is not initialized in this repo (`mcp__codegraph__*` returns "CodeGraph not initialized"),
so this list came from Grep/Read.

- `src/shared/ipc/unpair.ts` → `UNPAIR_CHANNEL`, `UnpairResult` — the contract this slice extends.
  Its header states "there is no untrusted request field to validate at the boundary"; that claim
  stops being true here and must be rewritten, not left standing.
- `src/main/unpairHandler.ts` → `registerUnpairHandler`, `UnpairHandleTarget` — the existing no-arg
  handler, its fail-closed catch, its record → label → teardown ordering, and the long comment
  arguing why the label erase and the teardown trigger sit outside the catch. The new arm reuses
  every one of those rules.
- `src/main/unpairHandler.test.ts` → `storeWithClear`, `labelWithClear`, the "erases exactly once and
  never reads" test — the surface this slice must not break, and the single edit site for the fake.
- `src/main/pairedServerStore.ts` → `MultiPairedServerStore`, `clearServer`, `clear`, `mutate`,
  `read`, `PAIRED_SERVER_NAME` — `clearServer` is the per-server erase, it has **no production
  caller yet**, and its `mutate` queue is the only place where "did anything match" and "what
  remains" can both be read atomically with the erase itself.
- `src/main/pairedServerStore.test.ts` → the `clearServer` cases — one of them
  (`'clearServer for an unheld id changes nothing and writes nothing (AC4)'`) asserts
  `resolves.toBeUndefined()`, the single assertion that moves with the return-type widening.
- `src/shared/ipc/pairing.ts` → `isPairingRequest`, `MAX_PASTE_LENGTH`, `MAX_HOST_LABEL_LENGTH` —
  the in-repo guard precedent: structural minimum, extra fields tolerated, a length bound applied at
  the IPC trust boundary, exported so both sides bound against the same constant.
- `src/main/pairingHandler.ts` → `PairingHandleTarget`, `registerPairingHandler` — the precedent for
  a two-argument listener (`(event: unknown, request: unknown)`) that `ipcMain` still satisfies
  structurally, and for a `Pick`-narrowed store dep.
- `src/main/serverInfoHandler.ts` → `Pick<MultiPairedServerStore, 'list'>` — the precedent for
  typing a handler against the narrowest store surface it needs.
- `src/main/hostLabelStore.ts` → `HostLabelStore`, `HOST_LABEL_NAME` — one slot, not keyed by
  server; per-server keying is recorded there as deferred and out of scope.
- `src/main/hostLabelHandler.ts` → the `MAX_HOST_LABEL_LENGTH` import from `pairing.ts` — precedent
  that a bound constant is imported across `shared/ipc` modules rather than restated.
- `src/main/connectionRegistry.ts` → `ConnectionRegistryDeps.store`, `reconcile` — the `Pick`
  **without** `clear`/`clearServer` that makes the registry structurally unable to erase a pairing.
  Not widened here; `reconcile()` already answers a per-server drop.
- `src/main/index.ts` → the `registerUnpairHandler` registration block and its `#1149` forward
  reference at the end of that comment — the composition root this slice adds a sibling registration
  to.
- `src/preload/index.ts` → `unpair` — the fixed-channel, no-second-argument bridge method the new
  one mirrors.
- `docs/knowledge/features/unpair-channel.md` § "Security posture" → the two bullets this slice
  falsifies: *"No untrusted input to validate"* and *"The renderer can trigger, never
  parameterize."* Flagged for the documentation phase; not edited here.

## Design source

**Figma:** N/A — this slice is a main-process IPC contract, a handler arm, a store return-type
widening and a preload method. Nothing renders. The visible per-server unpair control is #1090's UI.

## Context

`unpairHandler`'s listener calls `store.clear()`, which erases the **whole** collection. Since #1069
the store holds several records and since #1117 a live connection sits behind each, so "unpair" today
forgets every paired machine. This slice supplies the contract and the handler for the per-server
answer; #1152 migrates the one existing caller and retires the no-arg path, and #1150 scopes the
renderer-side clear.

Strangler Fig: the id-taking path lands **alongside** the existing no-arg path, which keeps working
byte-for-byte for its single caller (the composer's Re-pair control via `runUnpair`). Nothing
migrates here.

No ADR is warranted: this reuses the established IPC-boundary shape (shared contract + guard, main
handler, preload bridge, composition-root registration) rather than introducing a new one.

**Size, re-checked against this plan.** Five production source files, three new exported types, one
consumer call site to update (a single `clearServer` return assertion), five acceptance criteria,
three reject branches — every boundary but one holds. Total written work lands near the refiner's
~950-line estimate, over the 800-line ceiling, **stated deliberately and not split**. The only seam a
split could cut is contract-and-guard from handler-and-wiring, which would leave a guard whose sole
consumer is its sibling — the one-consumer floor the ceiling must not override. The ticket is at
split depth 1 (parent #1090, no grandparent), so a split was available and was rejected on the merits.

## Design

### The shape: a second channel, not a second branch

`ipcMain.handle` allows one handler per channel, so "alongside" is either a second channel or one
listener that discriminates a bodiless invoke from an id-bearing one. **This plan takes the second
channel**, and the deciding argument is AC2's wording — the property must hold *"rather than leaving
it to the guard's correctness."*

With a second channel and a second registration function, the per-server listener closes over a
store dep typed `Pick<MultiPairedServerStore, 'clearServer'>`. `clear` is **not a member of that
type**. The whole-collection erase is therefore unreachable from the per-server path not by a branch
that could be mis-written, but because the compiler has no name to call it by. A one-channel design
would make the same property depend on a runtime discrimination staying correct forever.

Two further consequences, both wanted:

- `registerUnpairHandler` is **not touched**. Its listener, its dep type, its 22 existing test
  registrations and its `daemonConnection.test.ts` call site all compile and pass unchanged, which is
  exactly what "the existing no-arg path still erases the whole collection for its one caller" asks
  for. The existing *"erases exactly once and never reads"* test survives verbatim on the legacy path,
  as the ticket requires.
- #1152's retirement is a deletion — one channel constant, one register function, one preload
  method, one registration block — not a refactor of a shared listener.

### The existence read: there is none, and that is the point

AC2 needs "names no held record" and AC3 needs "no records remain". Neither can be answered by
today's `clearServer`, which resolves silently on no match. The ticket asks for a read that answers
existence without materialising credentials. **This plan removes the read instead of narrowing it**:
`clearServer` — which has no production caller yet, so nothing depends on its current return —
widens from `Promise<void>` to report what it did.

```ts
/** What one per-server erase did. Counts and a flag only — no record, id, or field value. */
export interface ClearServerOutcome {
  matched: boolean   // an entry held this id and was erased (false ⇒ nothing was written)
  remaining: number  // entries still paired after this erase
}

clearServer(serverId: string): Promise<ClearServerOutcome>
```

Why this beats every read-based alternative:

1. **No credential can be materialised in the handler at all.** `loadById` and `list` hand back full
   records; `load` does too, and it is inherited into the handler's dep type *today* via
   `ClearablePairedServerStore`. Typing the new arm's store dep as
   `Pick<MultiPairedServerStore, 'clearServer'>` leaves it with no read member and no whole-erase
   member — the compiler holds AC5's "no bearer token in this module", exactly as
   `Pick<HostLabelStore, 'clear'>` holds it for the label. A hypothetical `serverIds()` member would
   also avoid materialising a token, but it would still be a read the module could grow a second use
   for.
2. **It removes the failure mode the ticket asks to be kept outside the catch.** A separate
   remaining-records read after a successful erase could throw and downgrade an already-completed
   erase; the ticket's guidance ("keep the remaining-records read outside it too") is a mitigation for
   a read this design does not have. The count comes back from the call that already succeeded.
3. **It is atomic.** Both answers are computed inside the store's own `mutate` queue, from the same
   `read()` the filter used, so no concurrent `save` can land between "does this id exist" and the
   erase.

`ClearServerOutcome` never crosses IPC: the handler consumes it and returns the unchanged value-free
`UnpairResult`.

### Contracts

`src/shared/ipc/unpair.ts` — additive; `UNPAIR_CHANNEL` and `UnpairResult` are untouched:

```ts
export const UNPAIR_SERVER_CHANNEL = 'pyry:unpair-server' as const
/** Aliased to MAX_PASTE_LENGTH — see "The id bound" below. */
export const MAX_SERVER_ID_LENGTH = MAX_PASTE_LENGTH
export type UnpairServerRequest = { serverId: string }
export function isUnpairServerRequest(value: unknown): value is UnpairServerRequest
```

`src/main/unpairHandler.ts` — additive; `registerUnpairHandler` and `UnpairHandleTarget` unchanged:

```ts
export interface UnpairServerHandleTarget {
  handle(
    channel: string,
    listener: (event: unknown, request: unknown) => Promise<UnpairResult>
  ): void
  removeHandler(channel: string): void
}

export function registerUnpairServerHandler(
  target: UnpairServerHandleTarget,
  deps: {
    store: Pick<MultiPairedServerStore, 'clearServer'>
    onUnpaired?: () => void
    hostLabel?: Pick<HostLabelStore, 'clear'>
  }
): () => void
```

`src/preload/index.ts` — one method, fixed channel, request built in the bridge:

```ts
unpairServer: (serverId: string): Promise<UnpairResult>
```

`src/main/index.ts` — a sibling registration beside the existing one, same `pairedServerStore`, same
`hostLabelStore`, same `onUnpaired: () => registry.reconcile()`, its own `will-quit` teardown.

### The guard

`isUnpairServerRequest` mirrors `isPairingRequest`: pure, never throws, structural minimum
(extra fields tolerated), rejecting a non-object, `null`, a missing `serverId`, a non-string
`serverId`, and one over `MAX_SERVER_ID_LENGTH`. An array is rejected by the missing-key test, so no
`Array.isArray` branch is needed. The empty string is **accepted** by the guard and refused one step
later as "names no held record" — see "The id bound".

### The listener, in order

`guard → clearServer → matched? → label (only when remaining === 0) → teardown → ok`

- Guard rejects → `{ result: 'error' }`, no store call at all.
- `clearServer` throws → `{ result: 'error' }`, caught object **dropped** (it can carry a keychain or
  filesystem path), same fail-closed rule and same classify-don't-forward as the legacy arm.
- `matched === false` → `{ result: 'error' }`. Nothing was erased: `clearServer` returns without
  writing when its filter removed nothing.
- `remaining === 0` → erase the host label, inside its own catch, dropped, outside the fail-closed
  boundary. `remaining > 0` → the label is left alone; it still names a still-paired server (AC3).
- Teardown trigger fires on the success path only, inside its own catch, dropped — never after a
  guard refusal, an unknown id, or a throw (AC4).
- `{ result: 'ok' }`.

### The id bound

`MAX_SERVER_ID_LENGTH` is aliased to `pairing.ts`'s `MAX_PASTE_LENGTH` rather than given an
independent number, imported the way `hostLabelHandler` imports `MAX_HOST_LABEL_LENGTH`. Every
persisted `server` id arrived inside a pairing paste bounded by that constant, so no held record can
be made **unforgettable** by this bound, while an absurd input is still refused before it reaches a
comparison. A tighter, independently-chosen number would risk exactly that lockout.

### What this slice does not touch

- `ConnectionRegistryDeps.store` stays a `Pick` without `clear`/`clearServer`. `reconcile()` already
  drops the one connection whose record is gone, and `connectionRegistry.test.ts` already proves it.
  This slice owns the trigger, not the drop.
- The pairing-status handler: `load()` returns null only on an empty collection, so `paired` already
  means "at least one record exists".
- `registerUnpairHandler`, its dep type, its listener and its tests.
- Any renderer caller. `unpairServer` ships ahead of its consumer, exactly as `unpair` did.

## State + concurrency model

No state is held anywhere in this slice. The handler is stateless — every invoke reads through to the
store — and holds nothing between calls, matching the legacy arm.

- **The one critical section** is inside `clearServer`, on the store's existing `mutate` queue:
  `read → filter → (delete | set)` plus the two outcome fields, computed from the same `read()`. A
  concurrent `save` from a pairing therefore cannot interleave, and there is no check-then-act gap
  because there is no separate check.
- **The label erase is deliberately not atomic with the record erase.** A pairing that saves a record
  between the erase and the label read could make the label describe a server that arrived
  microseconds ago. That is display text, self-healing on the next pairing or unpair, and the module's
  existing comments already accept exactly this staleness class. A record's survival is the severe
  failure; a label's is not.
- **Nothing long-lived starts here.** No timers, no listeners, no async jobs, no subscriptions — so
  there is nothing to abort. The only lifecycle obligation is the registration itself, torn down by
  the returned unregister handle wired to `will-quit`, symmetric with the existing one.
- `onUnpaired` remains a trusted, synchronous, value-free in-process callback.

## Error handling

Every failure resolves to the unchanged value-free `UnpairResult`; the listener never rejects, since
`handle` must produce a value.

| Failure | Result | Erased | Label | Teardown |
|---|---|---|---|---|
| Guard refuses (absent / non-string / over-bound `serverId`, non-object request) | `error` | nothing — no store call | untouched | not fired |
| `clearServer` throws (keychain unavailable, decrypt failure, malformed blob) | `error` | nothing (the store's write is single-shot, never delete-then-write) | untouched | not fired |
| `matched === false` (unknown id) | `error` | nothing (no write) | untouched | not fired |
| Erase succeeded, `remaining > 0` | `ok` | that one record | **kept** | fired |
| Erase succeeded, `remaining === 0` | `ok` | that one record | cleared | fired |
| Erase succeeded, label erase throws | `ok` | that one record | may survive | fired |
| Erase succeeded, `onUnpaired` throws | `ok` | that one record | per the rows above | attempted |

Every caught object is **dropped** — never logged, interpolated, or returned. The module stays
log-free by construction on the new arm as on the old, and the `serverId` never reaches a log line.

**A known new limitation, inherent to a per-server erase.** `clear()` never reads, so it succeeds
over a corrupt blob; `clearServer` must read, so a `MalformedPairedServerRecordError` makes a
per-server unpair report `error`. The recovery paths are unchanged and both still available: re-pair
(which overwrites a malformed collection) or the whole-collection unpair. Noted for the
documentation phase; no code change here.

## Testing strategy

Vitest, node environment. No keychain, no filesystem, no Electron harness — structural fakes only, as
the existing suites do. No Playwright: nothing renders and no interaction exists to drive.

**`src/shared/ipc/unpair.test.ts` (new)** — mirrors `pairing.test.ts`:

- accepts a well-formed `{ serverId }`, and one carrying an extra field (structural minimum)
- rejects: `undefined`, `null`, a string, a number, an array, `{}`, `{ serverId: undefined }`,
  `{ serverId: 42 }`, and a `serverId` one over `MAX_SERVER_ID_LENGTH`; accepts one exactly at it
- accepts `serverId: ''` — the guard is structural; the unknown-id refusal owns emptiness
- `__proto__` as a `serverId` is an ordinary accepted string (it never becomes a key — see § Security
  review)
- the channel constant differs from `UNPAIR_CHANNEL`

**`src/main/pairedServerStore.test.ts`** — extends the existing `clearServer` block:

- a match among several → `{ matched: true, remaining: n - 1 }`, others still paired
- the final entry → `{ matched: true, remaining: 0 }` and no blob left behind
- an unheld id → `{ matched: false, remaining: n }` and **no write** (the existing
  `resolves.toBeUndefined()` assertion moves here)
- an unheld id against an empty store → `{ matched: false, remaining: 0 }`

**`src/main/unpairHandler.test.ts`** — a new `registerUnpairServerHandler` describe block; the legacy
block is untouched. The existing `storeWithClear` helper is untouched too; the per-server arm gets its
own `storeWithClearServer` helper carrying spies for `clear`, `save`, `load`, `loadById` and `list`
so their non-use is asserted, while the production dep type structurally excludes all five.

- registers exactly one handler on `UNPAIR_SERVER_CHANNEL` and unregisters that exact channel
- a matched erase → `ok`, `clearServer` called exactly once with the request's `serverId`
- **AC2 as a property**: a table of malformed requests (the guard-test list above) each →
  `error` with `clearServer` never called *and* `clear`/`load`/`save`/`loadById`/`list` never called
- an unknown id → `error`, nothing erased beyond the no-op call, no label erase, no teardown
- `clearServer` throws → `error`, no label erase, no teardown, and the thrown message's
  keychain-path substring absent from the serialized response
- `remaining > 0` → the label is **not** erased; `remaining === 0` → it is, exactly once, with no
  arguments
- order on the success path: record → label → teardown
- a throwing label erase and a throwing `onUnpaired` each still resolve `ok`
- the ok response stringifies to exactly `{"result":"ok"}`
- `console.error/log/warn` untouched across the ok, refusal, unknown-id, throwing-erase,
  throwing-label and throwing-callback paths, and the `serverId` never appears in any spy call
- resolves `ok` with no `hostLabel` dep wired (the optional-dep path)

## Open questions

1. Should an unknown id be distinguishable from a failed erase in the response? **Resolved in this
   plan: no.** Both map to `error`. A third member would tell a compromised renderer whether an id is
   paired; the renderer can already learn that from `serverInfo`, so it is not a new capability, but
   the value-free two-member union is the smaller surface and AC5 asks for exactly it.
2. Does `ipcMain` still satisfy a two-argument `handle` target? Expected yes — `registerPairingHandler`
   does exactly this today. Confirmed by `npm run build` in Phase B; a revision entry lands here if not.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. This slice *creates* a renderer→main untrusted-input boundary
  where `unpair.ts`'s header asserts none exists, and the boundary is a single named function,
  `isUnpairServerRequest`, applied as the listener's first statement before any store call. Downstream
  of it the value is the narrowed `UnpairServerRequest`; nothing else in the module reads the raw
  request. The `IpcMainInvokeEvent` first argument stays typed `unknown` and is never forwarded,
  matching `PairingHandleTarget`. The falsified doc bullets in `unpair-channel.md` § Security posture
  (*"No untrusted input to validate"*, *"The renderer can trigger, never parameterize"*) are named in
  § Files read for the documentation phase — the plan does not leave them standing as true.
- **[Tokens, secrets, credentials]** No findings, and the posture is strengthened. The per-server
  dep is `Pick<MultiPairedServerStore, 'clearServer'>`: no `load`, `loadById`, `list` or `save`, so a
  `PairedServerRecord` — and therefore a bearer `token` or `server_static_pubkey` — cannot be
  materialised in this module at all. That is stricter than the legacy arm, whose
  `ClearablePairedServerStore` dep inherits `load` and relies on a test to pin its non-use.
  `ClearServerOutcome` carries a boolean and a count, never a record, an id, or a field value, and
  never crosses IPC. Revocation granularity is precisely what this ticket adds: per-server rather
  than all-or-nothing.
- **[File / storage operations]** No findings. **The id must never become a key, and it does not.**
  `clearServer` matches with `===` against each decoded entry's own `server` field; the blob is
  written and deleted under the fixed `PAIRED_SERVER_NAME` constant. No id-derived store name, path,
  or object key exists on this path, so `__proto__`, `../../etc`, or a NUL-bearing id is inert — it
  matches no entry and is refused. No new persistence surface, no new file, no `fs` call: everything
  goes through the existing `SecureStore` seam. The store's single-shot write (never
  delete-then-write) means a failed erase leaves the prior blob whole, so `error` never
  under-reports what is on disk.
- **[Inter-process / Electron attack surface]** No findings. One new `ipcMain.handle` channel,
  fixed in the preload as a constant so the renderer cannot address an arbitrary channel;
  `ipcRenderer` still never crosses the bridge. The capability granted is exactly one verb — "erase
  the record under this id" — strictly *narrower* than the whole-collection erase the renderer can
  already trigger, so this adds no new class of power. Every argument is type- and length-checked
  before use. No window options, protocol handler, navigation seam or remote content is involved.
  Transport, keys and sockets stay in main.
- **[Cryptographic primitives]** N/A by design decision: this slice performs no comparison against a
  secret, derives no key, and generates no randomness. The one comparison is `serverId === entry.server`
  — a *non-secret* identifier already exposed to the renderer through `serverInfo`, so
  `timingSafeEqual` is not indicated. No handshake, nonce, or AEAD surface is touched.
- **[Network & I/O]** N/A — no socket, no relay, no daemon frame, no timeout surface. The one
  network-adjacent consequence is `registry.reconcile()`, unchanged and already proven.
- **[Error messages, logs, telemetry]** No findings. Every catch drops its object; nothing is logged,
  interpolated or returned on any path. The response union gains no member, so a refusal, an unknown
  id and a failed erase are indistinguishable and value-free — no keychain path, no label text, no
  record field. The `serverId` itself is deliberately never logged, keeping the module log-free by
  construction; a test asserts `console.error/log/warn` stay untouched and that the id appears in no
  spy call.
- **[Concurrency]** No findings, and one class removed. The "does this id exist" check-then-act race
  a read-based design would have had does not exist: existence and remaining-count are computed
  inside `clearServer`'s own `mutate` queue from the same `read()` as the filter. The label erase is
  intentionally outside that queue; the worst interleaving leaves stale display text, which the
  existing design already accepts and which self-heals on the next pairing or unpair. No task,
  timer, or listener is started, so no cancellation path is needed beyond the `will-quit` unregister.
- **[Threat model alignment]** Malicious relay: not on this path — no wire traffic. Token theft from
  disk: unchanged; the per-server erase deletes strictly less than `clear()` and cannot touch
  `pyrycode.device_static` or `pyrycode.host_label`, which live under distinct names in distinct
  stores. Hostile daemon response: not on this path. **Renderer compromise reaching the transport:**
  the worst outcome from a fully compromised renderer is erasing one named pairing — an availability
  annoyance recoverable by re-pairing, and a *reduction* from the whole-collection erase it can
  already trigger. A compromised renderer gains no read: the reply is value-free, and the handler
  holds no credential to leak. **OUT OF SCOPE, named:** per-server host labels — `hostLabelStore` is
  a single slot and `hostLabelStore.ts` records per-server keying as deferred, so a two-server unpair
  down to one leaves the survivor displayed under whichever name was last stored. This slice takes the
  conservative half (clear only when nothing remains) rather than introducing the regression; the
  keying itself belongs to a future host-label ticket.

**Reviewer:** builder (self-review per `builder/security-review.md`)
**Date:** 2026-09-06
