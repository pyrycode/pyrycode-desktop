# Spec #172 — Paired-server store gains an erase capability

Adds a symmetric `clear()` method to the background-process paired-server store, so a higher
layer (the follow-up IPC surface, #173) can erase the persisted pairing record and return the
app to a clean not-paired state. Domain capability only — no IPC, no preload, no renderer reach
in this ticket. Split child of #165; twin of the #131→#134 "ship the store capability ahead of
its IPC consumer" shape.

**Size:** XS. One production file (`src/main/pairedServerStore.ts`), one test file
(`src/main/pairedServerStore.test.ts`). One new exported interface, one new method, **zero
consumer edits, zero fixture cascade** (see Design).

## Files to read first

- `src/main/pairedServerStore.ts` (whole file, ~140 lines) — the store you extend. Note: the
  `name` local at `L125` (`deps.name ?? PAIRED_SERVER_NAME`) is the single home for the store's
  key; `save`/`load` at `L128-136` both route through it. `clear` must use this same `name`.
- `src/main/pairedServerStore.test.ts` (whole file, ~205 lines) — the fake and test idiom you
  mirror. `fakeSecureStore()` at `L15-46` is Map-backed; its `control` blob (`L23-26`) has
  `setError`/`getError` toggles but **no `deleteError`** — you'll add one. `RECORD` fixture at
  `L48-53`, `seed()` helper at `L56-58`, the injected-name test at `L154-165`, the log-free test
  at `L167-204`.
- `src/main/secureStore.ts:48-61` — `SecureStore` interface. `delete(name)` (`L59-60`) is
  "Remove the named secret; idempotent (an absent name is a no-op)." This is what `clear`
  delegates to. `SecretPersistence.delete` (`L43-45`) confirms the no-op-when-absent semantics
  propagate all the way down.
- `src/main/deviceKeypair.ts:70` — `DEVICE_STATIC_KEY_NAME = 'pyrycode.device_static'`. This is
  a **different store name in a different store instance**; AC4 (preserve the device identity)
  is satisfied because `clear` only ever names `PAIRED_SERVER_NAME`. Read only to confirm the
  name is distinct.
- `src/main/index.ts:130-167` — the composition root. `createPairedServerStore` is called once
  at `L132`; its result flows into `createPairingConfirmation` (`L133`), the pairing-status
  handler (`L141`), and the driver deps `pairedServer:` (`L167`). Read to confirm the return-type
  widening (below) is assignable into all three **without any edit**.
- `docs/knowledge/decisions/0005-secret-at-rest-safestorage-fail-closed.md` — the fail-closed
  posture `clear` inherits (a `delete` failure propagates, never reported as success).

## Context

Recovery from a stale, wrong, or never-connecting pairing needs a prerequisite the app lacks: a
way to erase the persisted paired-server record. That record — the bearer `token` and
`server_static_pubkey` — lives only in the background process behind `SecureStore`, keyed by
`PAIRED_SERVER_NAME`, which `createPairedServerStore` owns (CLAUDE.md: "keep the transport out of
the window"). Today the store exposes only `save`/`load`. This ticket adds the symmetric erase.

The IPC channel + preload method that let the renderer trigger the erase ship in **#173**
(blocked-by this ticket). #172 lands the domain capability behind the transport boundary first,
unwired — exactly how #131 shipped its store/logger capability ahead of its IPC consumer #134.

This is **not** UI work — a main-process store method with no renderer surface — so there is no
`## Figma` section and no Design source section is expected. Nothing visual lands here.

## Design

### The widened return type (the fixture-cascade avoidance is the whole design)

Introduce a new exported interface that extends the base:

```ts
export interface ClearablePairedServerStore extends PairedServerStore {
  /** Erase the persisted paired-server record. Idempotent; fail-closed. */
  clear(): Promise<void>
}
```

Change **only the return type** of `createPairedServerStore` from `PairedServerStore` to
`ClearablePairedServerStore`. **Do not widen the base `PairedServerStore` interface.**

Why this exact shape:

- Every existing consumer types against the **base** `PairedServerStore`, not the concrete
  return type: the fakes in `pairingStatusHandler.test.ts` (`L30`), `pairingConfirmation.test.ts`
  (`L20-22`), and `daemonConnection.test.ts` (`L124`), plus the production deps in
  `pairingConfirmation.ts` (`L126`), `pairingStatusHandler.ts` (`L38`), and `daemonConnection.ts`
  (`L57`). Widening the base interface would force every one of those fakes to grow a `clear`
  stub — a fixture cascade the ticket explicitly calls out. Widening the return type touches none
  of them: a fake that only needs `save`/`load` still satisfies `PairedServerStore`.
- The widened return is a **subtype** of `PairedServerStore`, so it stays assignable into every
  slot at the composition root (`index.ts` L133/L141/L167) with **zero edits** — verify this by
  reading those three call sites, not by editing them. `clear` becomes reachable only where the
  concrete `ClearablePairedServerStore` type is held (the composition root), which is where #173
  will pick it up. Unwired-but-present is the intended end state.

### The `clear` method contract

`clear` is a single delegation to the injected persistence seam, keyed by the store's own
`name` local — **not** a delete-by-literal:

```ts
async clear() {
  await secureStore.delete(name)   // name === deps.name ?? PAIRED_SERVER_NAME
}
```

- **No `try`/`catch`.** A throw from `secureStore.delete` propagates unchanged (fail-closed — see
  Error handling). Wrapping-and-swallowing would report success while a live bearer token remains
  on disk; that is the one behaviour this method must never have.
- Uses `name`, so it deletes exactly what `save` wrote and `load` reads — and honours the injected
  per-server-id keying seam for free (the deferred multi-server change stays one line).
- Because `name` is `PAIRED_SERVER_NAME` (a fixed constant, never caller-controlled) and
  `pyrycode.device_static` is a distinct name in a distinct store, `clear` **cannot** touch the
  device static keypair. AC4 is structural, not a runtime check.
- No cache, no timers, no listeners — nothing to add to teardown. Consistent with the existing
  "read/write through on every call" model.

### Post-conditions (map to ACs)

- After `clear()`, `secureStore.get(name)` returns `null` → `load()` returns `null` (the only null
  path), so a later launch-time pairing-status query reports not-paired (AC2).
- `SecureStore.delete` → `SecretPersistence.delete` is a documented no-op when the name is absent,
  so `clear()` on a never-paired store resolves without throwing and leaves the not-paired state
  unchanged (AC3).

## State + concurrency model

- No store state — `clear` is a stateless pass-through, like `save`/`load`. Nothing to select,
  subscribe, or memoise (this is background-process code, not React).
- No read-modify-write: `clear` is an unconditional delete, so there is no check-then-act race
  across the single `await`. A concurrent `save`+`clear` resolves last-writer-wins at the
  persistence layer, matching the existing no-cache semantics — no new coordination is needed.
- **Live-session teardown is OUT OF SCOPE.** `clear` erases the at-rest record only; it does not
  tear down an in-flight Noise session or relay socket. The user's current connection (if any)
  lives until next launch, and AC2 is explicitly launch-time-scoped ("a later launch-time
  pairing-status query reports not-paired"). Orchestrating an active-connection teardown on
  unpair belongs to the #173 caller (or a later ticket) — name it there, don't build it here.

## Error handling

| Failure | Layer | Behaviour |
|---|---|---|
| `secureStore.delete` throws (persistence I/O error, etc.) | main process | Propagates from `clear` unchanged — **not** swallowed, **not** reported as success. |
| Name absent (never paired / already cleared) | persistence | No-op; `clear` resolves. Idempotent (AC3). |

The static-message, secret-free error posture is inherited: `SecureStore`/`SecretPersistence`
errors carry no name and no value, and this module is log-free by construction (no `console.*`),
so no token or record field can reach a log or an error string via `clear`.

## Testing strategy

Unit tests only, in `pairedServerStore.test.ts`, mirroring the existing fake-driven idiom — no
keychain, no filesystem, no Electron (AC5). Add a `deleteError: Error | null` toggle to
`fakeSecureStore`'s `control` and honour it in the fake's `delete` (mirroring the existing
`setError`/`getError` toggles) so the fail-closed path is exercisable.

Scenarios (developer writes them in the project's vitest idiom):

- **Erase then not-paired (AC2):** `save(RECORD)`, then `clear()`, then `load()` resolves `null`;
  assert `store.size === 0`.
- **Idempotent when absent (AC3):** on a fresh store, `clear()` resolves without throwing; `load()`
  still `null`; `store.size` stays `0`.
- **Name-precision + device-keypair preserved (AC1, AC4):** seed the Map-backed fake under BOTH
  `PAIRED_SERVER_NAME` and a second name (use the literal `'pyrycode.device_static'` with a
  comment naming AC4), then `clear()`; assert `PAIRED_SERVER_NAME` is gone AND the second name
  survives. This is the direct proof that `clear` deletes exactly its own key and touches nothing
  else — the whole Map-backed fake exists to make this a one-liner.
- **Honours the injected name (deferred per-server-id seam):** build the store with an injected
  `name`, seed under that name plus the default `PAIRED_SERVER_NAME`, `clear()`; assert only the
  injected name is removed and the default survives. Mirrors the existing injected-name test at
  `L154-165`; proves `clear` uses the `name` local, not a hardcoded literal.
- **Fail-closed propagation (Technical Notes):** set `control.deleteError`, assert `clear()`
  rejects with that error (not swallowed, not resolved). Pins the no-`try`/`catch` invariant
  against a future regression.
- **Log-free (extend the existing AC4 log-free test):** exercise `clear()` on the happy path and
  the `deleteError` path within the existing `console` spy block at `L167-204`; assert no
  `console.*` call. Cheap add to a test that already stands up the spies.

Type coverage under `npm run typecheck` confirms the widened return type is assignable into all
three composition-root call sites without edits (if it weren't, `index.ts` would fail to compile).

## Open questions

None. The design is fully determined by the ticket body, the existing store, and the confirmed
`SecureStore.delete` semantics. The only judgement call — widen the return type vs the base
interface — is settled by the fixture-cascade evidence in Design.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. `clear()` takes no arguments and reads no untrusted input;
  the key is the fixed `PAIRED_SERVER_NAME` constant, never caller-controlled. The
  renderer→main IPC boundary that would expose this capability is #173's and is explicitly out of
  scope — #172 adds no boundary crossing at all.
- **[Tokens, secrets, credentials]** No findings — and this is a positive-posture change: `clear`
  *destroys* the at-rest bearer `token` and `server_static_pubkey`, shrinking the token-theft-
  from-disk window. The one security-relevant subtlety is handled by design: `clear` is
  fail-closed (no `try`/`catch`), so a `delete` failure propagates rather than reporting success
  while a live token still sits on disk. No token reaches a log or error string (module is
  log-free by construction; SecureStore errors are static and value-free).
- **[File / storage operations]** No findings. The delete is keyed by a fixed constant, not a
  path and not caller input — no path traversal. Single unconditional `delete` call — no
  check-then-act / TOCTOU. Idempotent no-op when absent. Storage scope, encryption-at-rest, and
  atomic-write concerns are owned by the `SecureStore`/`SecretPersistence` adapters `clear`
  delegates to, unchanged here.
- **[Inter-process / Electron attack surface]** No findings — and this is the load-bearing scope
  boundary. #172 adds **no** `contextBridge` API, **no** `ipcMain` channel, **no** preload
  method, **no** `BrowserWindow`. The capability is main-process-only and reachable only where the
  concrete `ClearablePairedServerStore` type is held (the composition root). A compromised
  renderer cannot invoke `clear` in this ticket. The IPC exposure is deferred to #173, where the
  channel must be value-free (no args) so a compromised renderer can at most trigger an unpair
  (an availability annoyance), never leak or inject a secret. **MUST-verify at code-review:** no
  preload/IPC/window edit sneaks into this diff — the diff is `pairedServerStore.ts` +
  `pairedServerStore.test.ts` only.
- **[Cryptographic primitives]** N/A. `clear` handles no key material and performs no crypto,
  comparison, or RNG — deleting a stored blob is not a cryptographic operation.
- **[Network & I/O]** N/A. No socket, no relay, no network path is touched.
- **[Error messages, logs, telemetry]** No findings. Log-free by construction; the propagated
  `delete` error is a static, secret-free `SecureStore`/`SecretPersistence` error. The log-free
  test extends to cover `clear` on both the happy and error paths.
- **[Concurrency]** No findings for this ticket's surface. `clear` is a single `await` with no
  shared state, no read-modify-write, and nothing to cancel on teardown. OUT OF SCOPE (→ #173 or
  later): tearing down an in-flight Noise session / relay socket when the user unpairs — `clear`
  erases at-rest storage only, consistent with AC2's launch-time framing.
- **[Threat model alignment]** No findings. Token-theft-from-disk: `clear` reduces exposure by
  removing the token. Malicious relay / hostile daemon: N/A (no network). Renderer compromise
  reaching the transport: #172 keeps `clear` out of renderer reach entirely (no IPC), deferring
  that boundary to #173.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
