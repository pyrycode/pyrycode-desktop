# Spec #339 — Server-info IPC surface: expose paired serverId + relayUrl across the bridge

Ships the renderer→main IPC surface that lets the window read the paired server's **non-secret**
identity — its server id and relay URL — including while disconnected. Four pieces, the same
footprint as the `pairingStatus` (#79/#80) and `unpair` (#173) twins: a shared **contract** (channel
constant + a sealed union whose present arm declares exactly two non-secret fields), a main-side
**handler**, a preload **bridge method**, and the composition-root **registration** + teardown. No
caller yet — the renderer store that consumes this ships in #340 (blocked on this), and the visible
Settings row is #334. Same "ship the boundary ahead of its consumer" shape as #131→#134 and
#173→#166/#167.

This is the **credential-boundary enforcement point** for the whole Settings-server-info feature: it
is the one place where record fields cross from main to renderer, so the union type is what
structurally guarantees that only `serverId` + `relayUrl` — never `token` or `server_static_pubkey`
— can be serialized back. Hence `security-sensitive`.

**Size:** S. Two new production files (`src/shared/ipc/serverInfo.ts`, `src/main/serverInfoHandler.ts`),
one new test file (`src/main/serverInfoHandler.test.ts`), two edited (`src/preload/index.ts` +2 lines,
`src/main/index.ts` +3 lines). Four new exported symbols (`SERVER_INFO_CHANNEL`, `ServerInfo`,
`ServerInfoHandleTarget`, `registerServerInfoHandler`). **Zero consumer cascade** — every piece is
additive; nothing calls `serverInfo()` yet (that is #340), and the `pairedServerStore` it reads is
already constructed at the composition root. This is the architect-established irreducible IPC-surface
floor (the shared contract MUST live in `src/shared/ipc/` because preload+renderer import it and
neither may import `src/main`; the handler MUST be its own testable unit; both established when #332
split into #339 + #340) — it cannot be sliced smaller without dangling types or dead code.

## Design source

N/A — this is a data path with no on-screen surface; the visible Settings Server row is #334 (Figma
17-2). No `## Figma` section in the ticket body is correct, and code-review's visual-fidelity check is
intentionally out of scope here.

## Files to read first

- `src/shared/ipc/pairingStatus.ts` (whole file, 48 lines) — **the contract idiom to clone.** A
  channel constant + a discriminated union, no runtime logic, relative imports only, nothing from
  `src/main`. Its header doc-comment is the "value-free BY CONSTRUCTION" argument you **adapt** (not
  copy verbatim) — here the present arm is *not* value-free, it declares exactly two non-secret data
  fields. Note it ships **no request guard** (no `isPairingRequest` sibling) because the query carries
  no body — same for server-info.
- `src/shared/ipc/unpair.ts` (whole file, 42 lines) — **the second twin**, read for the two-outcome
  discriminated-union shape and the "no field beyond what must cross / no request body" discipline. Its
  error arm carries no reason field; your absence arm carries nothing either.
- `src/main/pairingStatusHandler.ts` (whole file, 60 lines) — **the handler to clone.** Injected
  minimal target, single-registration + exact-teardown, stateless `load()`-per-call, `try`/`catch`
  that maps every throw to a no-detail outcome and **drops the caught object** (log-free, no
  `console.*`). The only deltas for server-info: a present record maps to
  `{ status: 'available', serverId: record.server, relayUrl: record.relay }` instead of the bare
  `{ status: 'paired' }` enum; `null`-or-throw maps to `{ status: 'unavailable' }`.
- `src/main/pairingStatusHandler.test.ts` (whole file, 114 lines) — **the test idiom to clone.**
  `fakeTarget()` (`L13-18`), `listenerOf()` (`L22-26`), `storeWithLoad()` (`L30-32`), the registration
  assertion against the exported constant (`L46-60`), and the record-field JSON assertion
  (`L103-113`). **The one inversion:** here `record.server` and `record.relay` *should* appear in the
  serialized response (they cross), while `token` and `server_static_pubkey` must *not* — the opposite
  of `pairingStatus`, which asserts none of the four cross.
- `src/main/pairedServerStore.ts:31-42, 64-69, 144-149` — `PairedServerRecord = QrPayload`
  (`{ server, relay, token, server_static_pubkey }`, all `string`); the **base** `PairedServerStore`
  interface (only `save`/`load` — the handler types against this, not `ClearablePairedServerStore`);
  `MalformedPairedServerRecordError`; and `load()`'s `null`-vs-throw semantics (`null` is the ONLY
  not-paired path; a malformed decode throws, a propagated decrypt failure propagates).
- `src/preload/index.ts:61-69, 103` — **the bridge method to clone** is `pairingStatus` (`L61-69`): a
  fixed-channel `ipcRenderer.invoke(CONSTANT)` with no args, narrow declared return type. And
  `PyryApi = typeof api` (`L103`) — adding `serverInfo` to `api` flows the type to `window.pyry`
  automatically, so **no `src/preload/index.d.ts` edit** (if such a file even exists here — confirm;
  the type is re-derived regardless).
- `src/main/index.ts:133, 142-143, 152-153` — the composition root. `pairedServerStore` is built once
  at `L133`; the `registerPairingStatusHandler(ipcMain, { store: pairedServerStore })` +
  `will-quit` teardown sit at `L142-143`, and the `unpair` sibling at `L152-153`. **This block is the
  slot for the server-info registration** — same store, no `connection` dependency, synchronous.
- `docs/knowledge/decisions/0002-remote-head-over-relay-shared-wire.md` — the credential boundary:
  `token` + `server_static_pubkey` stay in main. This is what classifies `server`/`relay` as the
  non-secret half that MAY cross.
- `docs/knowledge/decisions/0005-secret-at-rest-safestorage-fail-closed.md` — the classify-don't-
  forward / "an unreadable record is not silently masked" discipline the `catch` implements.
- `docs/specs/architecture/173-unpair-ipc-surface.md` (esp. its `## Security review`) and
  `docs/specs/architecture/79-launch-time-pairing-status-signal.md` — the two sibling specs; #173's
  security review is the near-exact template for this one, with the single delta that this contract's
  present arm carries data.

## Context

A Settings screen (#334) needs to tell the user which server they are paired with — its server id and
relay URL — and must do so **even while disconnected**. Those two values live only in the paired-
server record (`server`, `relay`), which sits behind `SecureStore` in the background process
alongside two credentials — `token` (a bearer token) and `server_static_pubkey` (the responder static
key) — that must never cross to the renderer (CLAUDE.md "keep the transport out of the window"; ADR
0002). The renderer cannot read the record itself.

This slice ships **only** the main-side IPC surface that exposes the two non-secret fields, unwired:
no renderer calls `serverInfo()` yet (that is #340's store + one-shot loader). Same shape as
#173→#166/#167.

**Why a new channel, not `pairingStatus`.** The existing `pairingStatus` contract is deliberately
value-free ("only the enum comes back, never the token / server key / relay"). Adding `relayUrl` to it
would relax that security contract for a channel whose whole purpose is to leak nothing. A new
dedicated channel keeps `pairingStatus` value-free and confines the two-field surface here, where the
`security-sensitive` review can bound it.

**Disconnected-safe source (a correctness pitfall to pin).** `serverId` originates from the persisted
record's `server` field and `relayUrl` from its `relay` field — the at-rest record, available whether
or not a live connection exists. The live `hello_ack.server_id` (in `sessionStore` on a `connected`
event) is a **distinct value** and must NOT be used; conflating them would make Settings blank when
disconnected, defeating the ticket. The handler reads `store.load()`, never a live-connection value.

## Design

Four additive pieces. Each mirrors an existing, merged twin — the work is faithful cloning, not
invention.

### 1. Shared contract — `src/shared/ipc/serverInfo.ts` (new)

A channel constant + a sealed union, no runtime logic. Mirrors `pairingStatus.ts`'s structure; the
one difference is that the present arm declares two data fields.

```ts
/** The IPC channel the paired-server-info query travels on, renderer ↔ main. Single source of
 *  truth: the preload invoker ships on it, the main handler registers on it. */
export const SERVER_INFO_CHANNEL = 'pyry:server-info' as const

/**
 * The paired server's NON-SECRET identity, discriminated on `status`:
 *   - available   → a record was read; the two non-secret fields cross.
 *   - unavailable → no server info: not paired (load() → null) OR the stored record could not be
 *                   read (load() threw). Both collapse here; the error type is never surfaced.
 *
 * Value-free-by-construction, RELAXED to exactly two non-secret fields: the present arm declares
 * ONLY serverId + relayUrl, so the handler cannot serialize `token` or `server_static_pubkey` back
 * across the boundary (ADR 0002) — statically enforced by the union type. Do NOT add any field to
 * the present arm; do NOT add an error-reason field to the absent arm.
 */
export type ServerInfo =
  | { status: 'available'; serverId: string; relayUrl: string }
  | { status: 'unavailable' }
```

- **Discriminated-union style, per CLAUDE.md** ("model … as discriminated unions on a `type` field")
  and both sibling IPC contracts (`pairingStatus.status`, `unpair.result`). The `status` discriminant
  is **structural, not a record field** — the AC's "exactly two typed string fields — serverId and
  relayUrl — and nothing else" constrains the *data* the arm carries off the record, and its test
  asserts "no other field **of the record** crosses." `token` and `server_static_pubkey` are
  structurally absent from the type; that is the security property. Chose the discriminant over a bare
  `{ serverId, relayUrl } | null` so this contract *feels like it belongs* next to its two siblings;
  the trivial mapping to #340's `{ serverId, relayUrl } | null` store lives on the renderer side (as
  `pairingStatus`/`unpair` are also mapped in the renderer).
- **Absence arm carries nothing** — `{ status: 'unavailable' }`, no reason field. A coarse error
  category could leak backend detail, and the ticket mandates the error type is not surfaced.
- Imports **nothing** from `src/main` (shared is a clean leaf loaded by preload + renderer); relative
  imports only. No request guard — the invoke carries zero arguments, so there is no untrusted request
  field to validate at the boundary.

### 2. Main-side handler — `src/main/serverInfoHandler.ts` (new)

Clone of `pairingStatusHandler.ts`. Two contracts:

```ts
export interface ServerInfoHandleTarget {
  handle(channel: string, listener: (event: unknown) => Promise<ServerInfo>): void
  removeHandler(channel: string): void
}

export function registerServerInfoHandler(
  target: ServerInfoHandleTarget,
  deps: { store: PairedServerStore }
): () => void
```

Behaviour (do not pre-write the body — it is ~8 lines, cloned from `pairingStatusHandler`):

- The registered listener takes **no request argument** (the invoke carries no body). It `await`s
  `store.load()`, then:
  - record is `null` → resolve `{ status: 'unavailable' }`.
  - record is present → resolve `{ status: 'available', serverId: record.server, relayUrl: record.relay }`,
    built as an **explicit two-field object literal**. **Never `...record` spread, never read
    `record.token` or `record.server_static_pubkey`** — the mapping names exactly the two non-secret
    fields, so no secret can ride along even at runtime.
  - In a `catch`, resolve `{ status: 'unavailable' }` — **classify-don't-forward**: the caught object
    (a `MalformedPairedServerRecordError` OR a propagated decrypt failure) is dropped without
    inspecting its type, never logged, interpolated, or returned (its message could echo a filesystem
    path, keychain detail, or record bytes). `handle` must resolve to a value, so the listener never
    rethrows.
- **Every non-readable case is one outcome.** `null` (not paired) and every throw (malformed record,
  propagated decrypt failure) all map to `{ status: 'unavailable' }`. The handler does not distinguish
  them and does not surface the error type — the consumer (#340/#334) only needs "do I have an
  identity to show."
- **`console.*`-free by construction** — no logging anywhere in the module, matching
  `pairingStatusHandler`. This is the deterministic net for "the caught error is dropped."
- Store dep typed against the **base** `PairedServerStore` (only `load()` is needed) — **not**
  `ClearablePairedServerStore`, so the fake needs only `save`/`load` stubs. Register on
  `SERVER_INFO_CHANNEL`; return an unregister thunk that removes exactly that channel (`ipcMain.handle`
  allows one handler per channel). Holds no state between calls — reads the store on each invoke, so a
  re-pair is observed immediately. Imports nothing Electron-specific: `ipcMain` satisfies
  `ServerInfoHandleTarget` structurally, and the unit test injects a fake.

The invariant the test pins: on a present record, the response contains **exactly** `serverId` +
`relayUrl` (sourced from `server`/`relay`) and **no other record field** — `token` and
`server_static_pubkey` never appear.

### 3. Preload bridge method — `src/preload/index.ts` (edit, +2 lines)

Clone of the `pairingStatus` method. Add one import and one method to the `api` object, next to
`pairingStatus`/`unpair`:

```ts
// import { SERVER_INFO_CHANNEL, type ServerInfo } from '../shared/ipc/serverInfo'
serverInfo: (): Promise<ServerInfo> => ipcRenderer.invoke(SERVER_INFO_CHANNEL),
```

- `SERVER_INFO_CHANNEL` is **fixed here**, so the renderer cannot address arbitrary IPC channels; only
  this typed function crosses the bridge, never `ipcRenderer` itself. Called with **no second
  argument** — no data leaves the renderer; only the two-field-or-absent union comes back, never the
  token / server key.
- **No preload `.d.ts` edit** — `PyryApi = typeof api` (`L103`) re-derives the window type from `api`,
  so the new method flows to `window.pyry.serverInfo` automatically.

### 4. Composition-root registration — `src/main/index.ts` (edit, +3 lines)

Register alongside the existing pairing-status / unpair handlers at `L142-153`, over the **same**
`pairedServerStore` (built at `L133` — do not build a second store), with symmetric `will-quit`
teardown:

```ts
const unregisterServerInfo = registerServerInfoHandler(ipcMain, { store: pairedServerStore })
app.on('will-quit', () => unregisterServerInfo())
```

- `pairedServerStore` satisfies the handler's base `PairedServerStore` dep with no cast (it is the
  wider `ClearablePairedServerStore`, structurally assignable).
- **Placement:** the pairing-status / unpair slot (`L142-153`), **not** the `connection`-dependent
  block further down. The handler needs only the store — no `connection`, no `did-finish-load` gate —
  so it belongs with the synchronous registrations. Placement is not correctness-critical (no caller
  races it — the consumer is #340), but grouping with its twins over the shared store is the readable
  choice.

### Data flow

```
renderer window.pyry.serverInfo()  →  ipcRenderer.invoke(SERVER_INFO_CHANNEL)   [no body]
  →  ipcMain handler listener  →  PairedServerStore.load()
       present record  →  { status: 'available', serverId: record.server, relayUrl: record.relay }
       null OR throw   →  { status: 'unavailable' }                              [no detail]
```

## State + concurrency model

- **No store state.** The handler holds nothing between invokes (no cache, no pending state) — each
  invoke reads through `load()`. Nothing to select, subscribe, or memoise (this is background-process
  code, not React; the renderer-side store is #340).
- **No read-modify-write.** `load()` is a single read; there is no check-then-act race. Concurrent
  invokes each read independently and are consistent with the persistence layer's own semantics.
- **Teardown:** `ipcMain.handle` allows one handler per channel; the returned thunk `removeHandler`s
  exactly `SERVER_INFO_CHANNEL` on `will-quit`, symmetric with `unregisterPairingStatus` /
  `unregisterUnpair`. No timers, listeners, or sockets to cancel.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| Not paired (`load()` → `null`) | main handler | Resolves `{ status: 'unavailable' }`. |
| Malformed record (`load()` throws `MalformedPairedServerRecordError`) | main handler | `catch` resolves `{ status: 'unavailable' }`. Caught object **dropped** — never logged, interpolated, or returned. |
| Propagated decrypt failure (`load()` throws a plain `Error`, message may carry a path) | main handler | Same `catch` → `{ status: 'unavailable' }`. The error type is **not** inspected or surfaced. |
| Present, readable record | main handler | Resolves `{ status: 'available', serverId: record.server, relayUrl: record.relay }` — exactly two non-secret fields. |
| Handler unregistered (post-`will-quit`) | Electron | Invoke rejects in the renderer (no handler on channel) — outside this ticket's surface; the app is quitting. |

Every non-readable case collapses to the single `{ status: 'unavailable' }` outcome. No secret,
keychain path, record byte, or error string crosses back — the union has no field to carry one on the
absent arm, the present arm names only the two non-secret fields, and the handler is log-free.

## Testing strategy

Unit tests only, in `src/main/serverInfoHandler.test.ts`, cloning `pairingStatusHandler.test.ts`'s
fake-driven idiom — no keychain, no filesystem, no Electron harness (`npm test`, vitest). The fake
target is `{ handle: vi.fn(), removeHandler: vi.fn() }`; the fake store satisfies base
`PairedServerStore` with an inert `save` (`vi.fn()`) and a `load` stub carrying the scenario. Use a
`RECORD` fixture with **distinct, non-overlapping** sentinel values for each field so the
`.not.toContain` secret assertions cannot false-pass by substring collision (e.g. `token` and
`server_static_pubkey` values that are not substrings of `server`/`relay`). Scenarios — developer
writes them in the project's vitest idiom, as bullet points not full bodies:

- **Registration + exact teardown (AC "handler shape"/"wiring"):** `registerServerInfoHandler(fake,
  { store })` calls `handle` exactly once with `(SERVER_INFO_CHANNEL, function)` — assert against the
  **exported constant**, not a string literal, so a channel rename can't silently pass. The returned
  thunk calls `removeHandler(SERVER_INFO_CHANNEL)` exactly once.
- **Present record → available (AC "contract"/"field source"):** `load` resolves `RECORD`; drive the
  extracted listener → **deep-equals** `{ status: 'available', serverId: RECORD.server, relayUrl:
  RECORD.relay }`. `toEqual` pins that the arm has *exactly* these keys — a stray `token` field would
  fail. Confirms `serverId`←`server` and `relayUrl`←`relay` (the disconnected-safe source), not any
  live value.
- **Exactly-two / no-secret-crosses (AC "contract" security clause — the value-free-relaxed
  assertion):** on the present record, `JSON.stringify(await listener({}))` **contains** `RECORD.server`
  and `RECORD.relay` (they cross) and **does not contain** `RECORD.token` or
  `RECORD.server_static_pubkey`. Optionally also assert `Object.keys` of the available arm are exactly
  `['status', 'serverId', 'relayUrl']`. This is the structural "no other record field crosses" pin —
  the inverse of `pairingStatusHandler.test.ts:103-113` (which asserts *none* of the four cross).
- **Not paired (null) → unavailable (AC "absence"):** `load` resolves `null` → listener resolves
  `{ status: 'unavailable' }`.
- **Malformed-record throw → unavailable, resolves-never-rejects (AC "absence"):** `load` rejects with
  `MalformedPairedServerRecordError` → `await expect(listener({})).resolves.toEqual({ status:
  'unavailable' })` (resolves, never rejects — `handle` must produce a value; never collapses into a
  thrown error).
- **Propagated decrypt failure → unavailable + no detail crosses (AC "absence, no leak"):** `load`
  rejects with a plain `Error` whose message carries a secret-shaped path (e.g. `'decrypt failed:
  /Users/x/Library/Keychains/...'`); listener resolves `{ status: 'unavailable' }`, AND
  `JSON.stringify(await listener({}))` **does not contain** the path substring. Asserting a plain
  `Error` (not `MalformedPairedServerRecordError`) proves the handler maps EVERY throw to unavailable
  without branching on the type.
- **Log-free (AC "no leak"):** spy `console.error`/`console.log`/`console.warn`; assert **none** called
  on any path (present, null, malformed, decrypt-failure). Deterministic net for "the handler drops the
  caught error object and never logs" — the place a propagated keychain/fs path would otherwise leak.

Type coverage (`npm run typecheck`) confirms: (a) the handler's `deps.store: PairedServerStore` accepts
`pairedServerStore` at the composition root with no cast, and (b) `serverInfo` on the preload `api`
flows to `window.pyry.serverInfo` via `PyryApi = typeof api`. If either broke, `index.ts` / the
renderer type would fail to compile. `npm run build` is the salvage/QA gate.

## Open questions

None. The design is fully determined by the ticket body, the `pairedServerStore` semantics, and the
`pairingStatus` / `unpair` twins it clones. The one judgement call — discriminated-union with a
`status` field vs. a bare `{ serverId, relayUrl } | null` — is settled toward the discriminant by
CLAUDE.md's modeling convention and sibling consistency, with the "exactly two non-secret fields"
security property preserved either way (the discriminant is structural, not a record field).

## Security review

**Verdict:** PASS

Adversarial self-review per the architect security-review pass (label `security-sensitive`). This
ticket **introduces a renderer→main IPC boundary that carries record-derived data** — unlike its
fully value-free twins #79/#173, the present arm *does* cross two fields, so the tokens/secrets
category is the load-bearing one here: the review's job is to affirm that **exactly** the two
non-secret fields cross and nothing more.

**Findings:**

- **[Trust boundaries]** No findings. The invoke carries **no request body** (zero arguments), so
  there is no untrusted input to validate — a request guard is unnecessary by construction (same as
  `pairingStatus`). The renderer cannot parameterise the read: no channel, store name, or record field
  is caller-controlled (`load()` is keyed by the fixed `PAIRED_SERVER_NAME` constant inside the store).
  The one thing the renderer can do is *trigger* the read.
- **[Tokens, secrets, credentials]** No findings — **the load-bearing category**. The present arm
  declares **only** `serverId` + `relayUrl`; `token` and `server_static_pubkey` are structurally
  absent from the `ServerInfo` type, so the handler *cannot* serialize them back — value-free-by-
  construction, relaxed to exactly two non-secret fields and statically enforced by the union. ADR 0002
  classifies `token` (bearer credential) + `server_static_pubkey` (static key) as the credentials that
  stay in main; `server` (an id) and `relay` (a URL) are non-secret addressing identity the Settings
  screen exists to show. **MUST-verify at code-review:** (1) the handler builds the response as an
  explicit `{ serverId: record.server, relayUrl: record.relay }` literal — **never** `...record`
  spread, never reads `record.token` / `record.server_static_pubkey`; and (2) the `catch` drops the
  caught object entirely (no `console.*`, no return of `error.message`) — a propagated
  `secureStore.get`/decrypt error can carry a filesystem/keychain path. Both are pinned by the
  exactly-two-crosses, no-detail-leaks, and log-free tests.
- **[Inter-process / Electron attack surface]** No findings. The preload exposes **one** typed method
  **fixed** to `SERVER_INFO_CHANNEL` — the renderer cannot address arbitrary channels, and
  `ipcRenderer` never crosses the bridge (only the typed function does). A compromised renderer can at
  most learn the paired server's id + relay URL — non-secret addressing info it would observe anyway
  once #334 renders it, never the token or static key. This introduces **no new class of power**: a
  renderer that can already `submitPairingPaste`/`confirmPairing` (establish or overwrite the pairing,
  and thus set these very values) gaining read access to the two non-secret fields is a strict, minimal
  relaxation. `ipcMain.handle` allows one handler per channel; the single registration + `will-quit`
  teardown prevents duplicate/leaked handlers. **Accepted, no mitigation needed** — exposing these two
  fields to the app's own UI is the ticket's purpose.
- **[Absence-collapse / fail-safe correctness]** No findings — verified. Every non-readable case
  (`null`, `MalformedPairedServerRecordError`, propagated decrypt failure) collapses to the **same**
  `{ status: 'unavailable' }` outcome without distinguishing the error type or surfacing it. The absent
  arm has no field to carry a reason, so no error detail can ride out on it. Unlike `pairingStatus`
  (which keeps `error` distinct from `not-paired` for a re-pair recovery flow), this consumer only
  needs "identity present or not," so the collapse is intentional — and safe, because it errs toward
  showing *nothing* rather than risk surfacing a malformed/undecryptable record's bytes. Pinned by the
  null / malformed / decrypt-failure tests all asserting the same result.
- **[Disconnected-safe source]** Considered — correctness with a security flavour. `serverId`/`relayUrl`
  are read from the **persisted** record (`server`/`relay`), never from the live `hello_ack.server_id`.
  This keeps the surface a pure at-rest read with no dependency on an in-flight Noise session, and
  avoids conflating two distinct values. No network path is touched.
- **[Availability / destructive action]** N/A. Read-only, non-destructive — no write, no delete, no
  state mutation. Idempotent across calls.
- **[File / storage operations]** No findings. The handler performs no file/path operation itself; it
  delegates to `load()` → `secureStore.get` keyed by a fixed constant (no path traversal, no caller
  input, no TOCTOU). Encryption-at-rest is owned by the unchanged `SecureStore`/`SecretPersistence`
  adapters.
- **[Cryptographic primitives]** N/A. No key material, no crypto, no comparison, no RNG — the handler
  reads a stored blob and maps two string fields.
- **[Network & I/O]** N/A. No socket, relay, or network path. The at-rest record is the disconnected-
  safe source, so the surface works with no live connection.
- **[Error messages, logs, telemetry]** No findings. Log-free by construction; the caught error is
  dropped, not logged or returned. Covered by the log-free test on every path.
- **[Threat model alignment]** Aligned. Token-theft-via-renderer: **blocked** — `token` /
  `server_static_pubkey` are structurally excluded from the response type. Renderer compromise: gains
  only the two non-secret addressing fields, never a secret. Malicious relay / hostile daemon: N/A (no
  network; reads the at-rest record). Device-identity: untouched (this surface never reads the device
  keypair).

**Reviewer:** architect (self-review, `security-sensitive` label)
**Date:** 2026-07-13
