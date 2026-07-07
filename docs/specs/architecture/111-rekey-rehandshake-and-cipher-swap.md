# 111 — Run the in-session Noise re-handshake + atomically swap cipher states on the recognized rekey trigger

On the recognized `rekey_request` trigger (#108, already landed), the Noise session runs a **fresh in-session IK handshake as the INITIATOR** — reusing the same injected static keys and the `NOISE_PROTOCOL` suite, with **empty early-data** — and on the daemon's reply derives new send/recv cipher states via `Split()` and **atomically** swaps them for the old ones. After the swap, transport encrypt/decrypt resume under the new keys. A failure at any point leaves the pre-rekey ciphers intact and the session usable.

This is the **session-layer crypto mechanism only**, unit-tested at the session boundary against a test responder that initiates the rekey and then acts as the fresh-handshake responder. Framing the fresh msg1 on the wire as `noise_init` and the end-to-end round-trip against `fakeDaemon` are the immediate follow-up **#112** (blocked by this ticket). **No driver change is in scope.**

Split from #109 (session crypto vs driver/framing seam). Daemon twin: pyrycode #453 (`handleRekeyInit`, the daemon's per-conn-id `awaitingRekeyInit` substate) / #435 (atomic switchover).

## Design source

N/A — transport-layer crypto. No UI surface, no Figma. The code-review visual-fidelity check is intentionally not applicable to this ticket.

## Files to read first

- `src/main/transport/noiseSession.ts:162-205` — `onFrame`. **The seam.** The `transport`-state branch (162-184) holds the recognition point (line 178, `if (isRekeyRequest(plaintext)) { config.onEvent({ type: 'rekey-requested' }); return }`) where the new action attaches; the `awaiting-handshake-reply` block (189-204) is the exact shape (`ReadMessage` → `Split` → cipher install) the new `awaiting-rekey-reply` branch mirrors — **except** its failure path goes to `closed` and yours goes back to `transport`.
- `src/main/transport/noiseSession.ts:146-160` — `start()`. The initiator-side send: it sets `state` **before** `sendFrame(msg1)` (line 158-159). `beginRekey()` must reproduce that ordering (set `hs` + `state` before `sendFrame`) because the test peer is a synchronous re-entrant callback. It passes `config.hello` to `WriteMessage`; the rekey passes **empty** early-data instead.
- `src/main/transport/noiseSession.ts:105-140` — the factory closure. `lib` (106), the injected `config.staticPrivateKey` / `config.remoteStaticPublicKey` / `config.prologue` (115-120), `sendCipher`/`recvCipher`/`state` (122-124), and `freeAll()` (129-140, the guarded free discipline you mirror when freeing the old cipher pair on swap). `lib` is closed over, so a fresh `HandshakeState(INITIATOR)` needs no wasm reload.
- `src/main/transport/noiseSession.ts:76` — `SessionState` union. Add `'awaiting-rekey-reply'` as a clean additive member (`'idle' | 'awaiting-handshake-reply' | 'transport' | 'closed'`).
- `src/main/transport/noiseSession.ts:51-62` — `NoiseSessionErrorReason` + `NoiseSessionEvent`. **Both stay UNCHANGED** — the rekey reuses `handshake-read-failed` and the existing `rekey-requested` trigger event. See Design § Error reason for why no new member is added.
- `src/main/transport/noiseSession.ts:1-23` — module header. Update the handshake description to note the in-session re-handshake (see Design § Header).
- `src/main/transport/noise-c.wasm.d.ts:18-54` — `NoiseHandshakeState`. `WriteMessage(payload?)`, `ReadMessage(msg, payloadNeeded?)`, and `Split(): [send, recv]` semantics + the "wasm object freed automatically on error before the throw" contract that makes the failure paths leak-free.
- `src/main/transport/noiseSession.test.ts:46-124` — `createNoiseResponder` (the test-only IK responder). **This is what you extend** for the success path: add an `awaiting-rekey-init` state + an `initiateRekey()` method. Its `sendMessage` (106-109) already AEAD-seals a plaintext — that is how the responder initiates the rekey.
- `src/main/transport/noiseSession.test.ts:224-403` — the `mode 2` and `rekey_request recognition (#108)` describe blocks. `pair()`, `collector`, `enc`, `bytes`, `initErrors`, `plaintexts` — reuse unchanged; the new tests are additive. The #108 block (295-403) shows the exact peer-cipher idiom for asserting on the initiator's `NoiseSessionEvent` collector.
- `src/main/transport/fakeDaemon.ts:169-206` — `handleMsg1` / `handleTransport`. Confirms the noise-c `Split()` `[send, recv]` mapping is **role-adjusted, no pair-swap** (line 179 note), for both roles. Your swap uses the identical mapping as the initial handshake.
- `src/main/transport/noiseRelayDriver.ts:48-59, 194-204` — `RelaySessionErrorReason` (a superset of `NoiseSessionErrorReason`) + `route`. Confirms: (a) reusing `handshake-read-failed` needs **no** driver edit; (b) `route` already **drops** `rekey-requested` (line 203), so the session self-triggering with no propagation is correct.
- Daemon reference (context, not code): pyrycode `docs/protocol-mobile.md` § Re-key — the wire contract. Msg1 empty early-data, reply empty early-data, no `rekey_ack`, atomic switchover, WS 4426 on miss. Peer-static continuity is the **daemon's** check (#452/#453).

## Context

`noiseSession.ts` runs one IK handshake, then in `transport` state AEAD-decrypts each inbound frame. #108 added recognition: a decrypted `rekey_request` control envelope surfaces the bare `{ type: 'rekey-requested' }` event and diverts (`noiseSession.ts:178`). Today that event is **dropped** by the driver (`noiseRelayDriver.ts:203`) — recognition happens, but nothing acts on it, so the session is still torn down at the daemon's ~1-hour rekey interval (WS 4426).

In v2 the daemon is the rekey initiator (pyrycode #450/#453): on its per-session timer it seals a `rekey_request` and opens a ~30 s window, expecting the client — the IK initiator — to run a fresh in-session handshake (a new `noise_init`, empty early-data). The daemon swaps its own `CipherState`s under a peer-static continuity check; both sides resume under new keys; the implicit ack is the next AEAD round-trip. Miss the window → WS 4426.

This ticket adds the **action at the session layer**: the fresh IK handshake as INITIATOR + the atomic cipher swap. Recognition already lives in the session (#108) and IK requires the initiator (the desktop) to send the fresh handshake, so the action lives in the session too — keys, sockets, and the handshake never reach the renderer. Off the first-milestone critical path (milestone sessions last seconds); built now because long-lived desktop sessions are on the roadmap.

## Design

All changes live in `src/main/transport/noiseSession.ts` (production) and `src/main/transport/noiseSession.test.ts` (tests). **No new files. No new exported types. No driver change.**

The mechanism is a small extension of the existing initiator state machine: recognition self-triggers a fresh handshake, which parks the session in a new `awaiting-rekey-reply` phase holding the **old** ciphers live, and the reply drives an atomic swap.

### 1. New session state

Add one member to `SessionState` (`noiseSession.ts:76`):

```ts
type SessionState = 'idle' | 'awaiting-handshake-reply' | 'transport' | 'awaiting-rekey-reply' | 'closed'
```

Internal only (the type is not exported), so no consumer fan-out.

### 2. Self-trigger at the recognition seam

In the `transport`-state branch of `onFrame` (`noiseSession.ts:178-181`), keep the existing `rekey-requested` emit (it preserves #108's observable signal and its tests) and add the action after it:

```ts
if (isRekeyRequest(plaintext)) {
  config.onEvent({ type: 'rekey-requested' }) // #108 observable signal, retained
  beginRekey()                                // #111 action: start the fresh IK handshake
  return
}
```

The driver still drops `rekey-requested` (`noiseRelayDriver.ts:203`), so the event stays a pure in-main observability signal; the action is entirely internal to the session. `DecryptWithAd` has already advanced the recv nonce for the `rekey_request` frame before `beginRekey` runs — correct, that frame is consumed.

### 3. `beginRekey()` — the fresh handshake as INITIATOR

Module-private function. Contract:

- **Signature:** `function beginRekey(): void`
- **Precondition guard (belt, deterministic):** `if (state !== 'transport' || sendCipher === null || recvCipher === null) return`. It is only ever called from the transport branch, so this is defensive; keep it cheap.
- Build a **fresh** `HandshakeState(NOISE_ROLE_INITIATOR)` from the closed-over `lib`, reusing the exact `NOISE_PROTOCOL` constant (do **not** retype the suite) and the same injected keys: `Initialize(config.prologue.length > 0 ? config.prologue : null, config.staticPrivateKey, config.remoteStaticPublicKey, null)` — byte-identical to the initial `Initialize` at `noiseSession.ts:115-120`.
- Write msg1 with **empty early-data**: `WriteMessage(EMPTY_AD)` — **not** `config.hello`. The rekey handshake carries no `hello` (spec § Re-key; the device token is not re-transmitted on rekey).
- Wrap construct+init+write in a `try`. On any throw the library has already auto-freed the fresh handshake state (typings §`Initialize`/`WriteMessage`), the **old ciphers are untouched**, and `hs` is still `null` → classify `fail('handshake-read-failed')` and **return without changing state** (stays `transport`, usable). This path is practically unreachable for a well-formed empty-early-data write; handle it for atomicity.
- On success, in this order (ordering is load-bearing — see § State + concurrency): assign `hs = fresh`, set `state = 'awaiting-rekey-reply'`, **then** `config.sendFrame(msg1)`.

At the end of `beginRekey` the session holds: `hs` = fresh handshake, `sendCipher`/`recvCipher` = the **still-live OLD ciphers**, `state = 'awaiting-rekey-reply'`.

### 4. `awaiting-rekey-reply` branch in `onFrame` — read reply + atomic swap

Add a branch handling `state === 'awaiting-rekey-reply'` (place it before the `state === 'idle' || hs === null` guard). It mirrors the `awaiting-handshake-reply` block's crypto but differs in its early-data handling and its failure recovery. Contract:

- Read the daemon's reply: `hs.ReadMessage(frame, true)` — the recovered early-data is **discarded** (empty; there is no `hello_ack` on a rekey).
- `const pair = hs.Split()` — consumes + frees `hs`; returns `[send, recv]` role-adjusted for the initiator (same mapping as the initial handshake, **no pair swap**; see `fakeDaemon.ts:179`).
- **Atomic swap** (this is the AC2/AC4 invariant). `ReadMessage` and `Split` are the only fallible wasm ops; assignments cannot throw. So once `pair` exists, install the new ciphers and only then free the old:
  1. capture the old refs into locals,
  2. assign `sendCipher = pair[0]; recvCipher = pair[1]` (two synchronous assignments, nothing between them can throw or await),
  3. guarded-free the two **old** ciphers (mirror `freeAll`'s `try { obj?.free() } catch {}` discipline).
- On success: `hs = null`, `state = 'transport'`. **Emit no event** — the swap completes silently; the implicit ack is the resumed round-trip (spec § Re-key: no `rekey_ack`, no wire marker).
- **Failure** (`ReadMessage` or `Split` throws — malformed reply, wrong suite, or a mid-session peer swap so the pinned static no longer completes the handshake): the library auto-freed `hs`, and **no assignment to `sendCipher`/`recvCipher` happened**, so both still hold the OLD keys. Set `hs = null`, `state = 'transport'` (usable — **not** `closed`), and `fail('handshake-read-failed')`. This is the load-bearing difference from the initial-handshake failure path (`noiseSession.ts:196-200` → `closed`).

Because the swap installs both new ciphers before freeing either old one, and no fallible op runs after the first assignment, the session is **never** left with one new cipher and one old — on success both are new, on failure both are old.

### 5. Error reason — reuse `handshake-read-failed`, add nothing

Every rekey-handshake failure (the unreachable build/write in `beginRekey`, and the reachable read/split of the reply) classifies as the existing `handshake-read-failed`. **No new `NoiseSessionErrorReason` member.** Rationale:

- It is accurate: the fresh handshake's message read/derive failed.
- It stays within "no driver change in scope": `RelaySessionErrorReason ⊇ NoiseSessionErrorReason` (`noiseRelayDriver.ts:48-49`), so reuse forwards through the driver untouched.
- A consumer that needs to distinguish "rekey failed, session still alive" from "initial handshake failed, session dead" can already tell them apart by the **recovery state** — a failed rekey leaves the session `transport` and usable; a failed initial handshake leaves it `closed`. Introducing a distinct `rekey-failed` reason is an unobserved need (evidence-based-defer); if a later ticket wants rekey-failure telemetry it adds the member then.

### 6. `sendMessage` during the rekey window

Unchanged. `sendMessage`'s guard is `if (state !== 'transport' || sendCipher === null) return` (`noiseSession.ts:208`), so it is already **inert** while `state === 'awaiting-rekey-reply'`. This is the deliberate choice: an app send during the sub-second rekey window is dropped at the session layer rather than sent under an ambiguous key. Any cross-rekey send queueing is a store/driver concern, out of scope (see Open questions).

### 7. Module header update

The header (`noiseSession.ts:1-23`) describes exactly one handshake. Add one sentence: in `transport` state, on a recognized `rekey_request`, the session runs a **fresh in-session IK handshake as initiator** (empty early-data, same injected static keys) and atomically swaps its cipher states. Keep the LOG-FREE and transport-out-of-the-window notes intact.

### Data flow

```
transport state, inbound frame → recvCipher.DecryptWithAd → plaintext
  isRekeyRequest(plaintext)?
    └ true → onEvent({rekey-requested})            [#108 signal, driver drops it]
             beginRekey():
               fresh HandshakeState(INITIATOR), same keys, WriteMessage(EMPTY_AD)
               hs=fresh; state='awaiting-rekey-reply'; sendFrame(msg1)   [OLD ciphers retained]

awaiting-rekey-reply, inbound frame (daemon reply)
  hs.ReadMessage(frame,true)  [discard early-data] ; hs.Split() → [newSend,newRecv]
    ├ throws → hs=null; state='transport'; fail('handshake-read-failed')  [OLD ciphers intact, usable]
    └ ok → prev=(sendCipher,recvCipher); sendCipher=newSend; recvCipher=newRecv;  free(prev)
           hs=null; state='transport'                                    [resume under NEW keys, no event]
```

## State + concurrency model

No new store slice, no new async, no `await` added — the session stays single-threaded with synchronous `noise-c.wasm` crypto (the module's existing invariant, pinned by the close-during-handshake block).

**Re-entrancy (load-bearing).** In the unit tests (and the real driver) `config.sendFrame` may be a synchronous callback that drives the peer, which synchronously calls back `onFrame` with the reply — the whole rekey can complete inside `beginRekey`'s `sendFrame(msg1)` call. So `beginRekey` **must** set `hs` and `state = 'awaiting-rekey-reply'` **before** `config.sendFrame(msg1)` — exactly as `start()` sets `state` before `sendFrame` (`noiseSession.ts:158-159`). If it sent first, the re-entrant reply would arrive with `state` still `transport` and be mis-dispatched.

**Atomicity under teardown.** `freeAll()` frees `[hs, sendCipher, recvCipher]`; during `awaiting-rekey-reply` that is the fresh handshake plus the two old ciphers — all still owned, all freed, no leak. `close()` sets `state = 'closed'` first, so a reply arriving after close hits the `state === 'closed'` short-circuit at the top of `onFrame` and never touches freed wasm. The new branch adds no new teardown surface.

**Cipher lifecycle.** The old ciphers live continuously from before the trigger until the swap frees them (success) or the session resumes on them (failure). At no instant does a cipher reference dangle or point at freed wasm: `Split()` frees the fresh `hs` internally; the old ciphers are freed only after the new pair is installed.

## Error handling

| Situation | Classification | Session after |
|---|---|---|
| Recognized `rekey_request`, fresh handshake completes | (no error; no event on swap) | `transport`, new keys |
| Fresh-handshake reply malformed / wrong-suite / MAC fail (incl. mid-session peer swap) | `handshake-read-failed` | `transport`, **old keys, usable** |
| `beginRekey` build/write throws (practically unreachable) | `handshake-read-failed` | `transport`, old keys, usable |
| A frame that fails AEAD open arrives in `transport` (never reaches recognition) | `transport-decrypt-failed` (unchanged, #108) | `transport`, unchanged |
| `close()` during `awaiting-rekey-reply` | (none) | `closed`, all wasm freed, inert |

The mid-session peer-static swap is handled **implicitly** by reusing the pinned `remoteStaticPublicKey`: as the IK initiator the session commits to that static in msg1 (`es`/`ss`), so a responder presenting a different static produces diverging DH and the session's `ReadMessage` of the reply fails MAC → `handshake-read-failed` → old ciphers intact. **Do not add a phantom client-side "compare the daemon static" check** — the client supplies `rs` and never re-learns it; reusing the pinned static *is* the continuity. The explicit peer-static continuity check is the daemon's (pyrycode #452/#453).

LOG-FREE preserved: no `console.*`; the failure classification is a static reason carrying no bytes; the `rekey-requested` event stays byte-free.

## Testing strategy

`vitest`, extending `noiseSession.test.ts`. Add one describe block; reuse `collector`, `enc`, `bytes`, `initErrors`, `plaintexts` unchanged. Existing coverage (mode-1/2, #108 recognition, error classification, close-during-handshake, log-free) must stay green.

**Test responder extension (for the success path).** Extend `createNoiseResponder` (`noiseSession.test.ts:46-124`), additively:
- Add responder state `'awaiting-rekey-init'`.
- Add a method `initiateRekey(rekeyRequestBytes: Uint8Array)`: AEAD-seal the bytes via the current `send` cipher and `sendFrame` them (the daemon sealing `rekey_request` under the current keys), then set state to `'awaiting-rekey-init'`.
- In `onFrame`, when `state === 'awaiting-rekey-init'`, treat the frame as the client's fresh msg1: build a fresh `HandshakeState(NOISE_ROLE_RESPONDER)`, `Initialize(prologue, staticPrivateKey, null, null)` (same static as the initial handshake), `ReadMessage(msg1, true)` (discard early-data), `WriteMessage(EMPTY_AD)` (empty reply), `Split()`, **atomically swap its own ciphers** (install new, then free old — mirror the session's discipline), `sendFrame(msg2)`, return to `transport`. On a throw, surface a responder-side error and do not corrupt its ciphers.

This mirrors the daemon's `awaitingRekeyInit` substate (protocol § Re-key step 3) so the JS↔JS rekey round-trip closes synchronously, exactly as the mode-2 initial handshake does.

**Scenarios** (developer writes bodies in the file's idiom):

1. **Complete the re-handshake + swap, resume under new keys (AC1/AC2/AC3).** `pair()` to `transport` (keys K0). Call `responder.initiateRekey(enc({ id, type: 'rekey_request', ts, payload: { reason: 'scheduled' } }))`; the synchronous cascade drives the full rekey. Assert: the initiator collector has exactly one `{type:'rekey-requested'}`; then `responder.sendMessage(app)` surfaces as `{type:'message'}` on the initiator with `bytes` equal to `app`; and `initiator.sendMessage(app2)` surfaces as `{type:'message'}` on the responder with `bytes` equal to `app2` (round-trip under the new keys, both directions). No `error` on the initiator.

2. **A frame sealed under the old keys no longer opens (AC3).** Wire the responder's `sendFrame` through a small capture indirection so one K0-sealed responder frame can be **captured, not delivered**, before the rekey. Do scenario 1's successful rekey (K0 → K1). Then feed the captured K0 ciphertext to `initiator.onFrame` and assert the initiator emits `transport-decrypt-failed` — proving the recv cipher was actually replaced (a K0 frame does not open under K1).

3. **A failed fresh handshake leaves the session usable on the old keys (AC4).** Use a bespoke wiring where the initiator's `sendFrame` routes through a toggle: during the initial handshake it delivers to `responder.onFrame` (normal); before triggering the rekey, flip the toggle so the fresh msg1 is captured-and-dropped (the responder never rekeys, stays pristine on K0). Drive the trigger with `responder.sendMessage(enc({...rekey_request...}))` (plain seal — **not** `initiateRekey`), so the session recognizes it, emits `rekey-requested`, sends the (dropped) fresh msg1, and parks in `awaiting-rekey-reply`. Then feed garbage directly: `initiator.onFrame(new Uint8Array(64).fill(0x5a))`. Assert: exactly one `handshake-read-failed`; **no** `handshake-complete`; the session is still usable on the OLD keys — a following `responder.sendMessage(app)` (sealed under K0) surfaces as `{type:'message'}` on the initiator with matching bytes. The old-key round-trip succeeding is the proof both ciphers stayed K0 (never half-swapped) and the session did not close.

Confirm `npm run build` (typecheck; exercises the driver's unchanged `route` against the new `SessionState`) and `npm test` are green.

## Open questions

- **Should a store/driver ticket queue app sends across the rekey window?** Not here — `sendMessage` is inert during `awaiting-rekey-reply` (§6). The window is sub-second; whether a queued send should replay after the swap is a driver/store concern for a later ticket if the milestone surfaces dropped mid-rekey sends. Evidence-based-defer.
- **Client-side rekey rate-limiting?** Not here. Only the AEAD-authenticated daemon can seal a `rekey_request` (a relay cannot forge one — it fails the AEAD open). A compromised daemon already holds the session, so a rekey flood is not a new relay-exploitable surface; the daemon owns rekey rate-limiting (`noise.rekey_failed`, protocol line 715). Add a client-side cap only if a flood is ever observed.
- **Should the successful swap emit an observable event (e.g. `rekey-complete`)?** No — the protocol has no `rekey_ack` and the implicit ack is the resumed round-trip; emitting one would fan out the event union and the driver's `route`. #112+ can add it if the UI needs "rekeying…" affordance.

## Security review

**Verdict:** PASS

Adversarial re-read of the spec. This ticket runs an in-session re-handshake on an internet-exposed transport and mutates live cipher state, so the review centers on (a) who can trigger it, (b) atomicity of the swap, and (c) key/nonce hygiene across the swap.

- **[Trust boundaries] No findings.** `beginRekey` is reached only from the `transport`-branch recognition seam, i.e. strictly **downstream of `recvCipher.DecryptWithAd`** — only plaintext already authenticated under the session's AEAD key (held solely by the IK-authenticated daemon, whose static is pinned from the QR record) can reach it. A content-blind on-path relay cannot forge a `rekey_request`: a frame it fabricates fails the AEAD open and takes the unchanged `transport-decrypt-failed` path, never reaching recognition. The fresh handshake's reply is authenticated by IK itself — the session commits to the pinned daemon static (`rs`) in msg1, so a mid-session peer swap yields diverging DH and fails `ReadMessage` (→ `handshake-read-failed`, old ciphers intact). Reusing the pinned static **is** the client-side continuity guarantee; there is deliberately no phantom client-side static-compare (the client supplies `rs` and never re-learns it — the explicit continuity check is the daemon's, pyrycode #452/#453).
- **[Tokens, secrets, credentials] No findings.** The rekey handshake carries **empty early-data** in both directions — the device token / `hello` is **not** re-transmitted on a rekey (spec § Re-key; `WriteMessage(EMPTY_AD)`, not `config.hello`). Static keys are reused from the existing factory closure; none is read from storage, compared, or logged. `REKEY_REQUEST_TYPE` is a static wire string, not a secret.
- **[Cryptographic primitives] No findings.** The fresh handshake derives brand-new `(k_send, k_recv)` from a new ephemeral DH via `Split()` — advancing forward secrecy, which is the point of rekey. There is **no (key, nonce) reuse across the swap**: the old ciphers are discarded wholesale and freed; the new ciphers begin at nonce 0 under new keys. The `[send, recv]` mapping is identical to the initial handshake (role-adjusted, no pair swap; `fakeDaemon.ts:179`), so no crossed-cipher hazard. The Noise suite (`NOISE_PROTOCOL`) is reused verbatim, never retyped (ADR 0002 — a mismatch fails silently).
- **[Atomicity / half-swap wedge] No findings — this is the ticket's core guard.** `ReadMessage` and `Split` are the only fallible wasm ops; both run **before** any assignment to `sendCipher`/`recvCipher`. On success, both new ciphers are installed (two synchronous assignments, nothing throwing or awaiting between them) **before** either old cipher is freed; on any failure, no assignment ran and both old ciphers remain. The session is therefore never left with one new and one old cipher, and a failed rekey never wedges the session — it resumes on the intact old keys (state `transport`, not `closed`). A `close()` mid-rekey frees the fresh `hs` plus both old ciphers via `freeAll` with no leak and leaves every entry point inert.
- **[Network & I/O] No findings.** Each recognized `rekey_request` emits exactly one outbound frame (the fresh msg1). Amplification: only the AEAD-authenticated daemon can seal a `rekey_request`, so a rekey flood is not relay-exploitable; a compromised daemon already controls the session. No new size cap needed — the reply is a bounded Noise handshake message read by `ReadMessage`, and the trigger plaintext is already bounded upstream (`MAX_PLAINTEXT_BYTES`). Client-side rekey rate-limiting is evidence-based-deferred (Open questions).
- **[Inter-process / Electron attack surface] No findings.** Entirely main-process transport crypto. Nothing crosses `contextBridge`/`ipcMain`; no new IPC channel; the `rekey-requested` event stays in main (the driver drops it) and keys/ciphers/plaintext never move toward the renderer.
- **[Error messages, logs, telemetry] No findings.** LOG-FREE preserved: no `console.*`; the failed-rekey classification reuses the static `handshake-read-failed` reason and carries no bytes; the trigger event is byte-free. No new `NoiseSessionErrorReason`.
- **[Concurrency] No findings.** Synchronous, single-threaded, no `await`, no new timer/listener. The one subtlety — a synchronous re-entrant `sendFrame` completing the rekey inside `beginRekey` — is handled by setting `hs`/`state` before `sendFrame`, mirroring the audited `start()` ordering. The `state === 'closed'` short-circuit keeps a post-close reply inert.
- **[Threat model alignment] Addressed / bounded.**
  - *Malicious / content-blind relay:* cannot forge or smuggle a `rekey_request` (fails AEAD → `transport-decrypt-failed`); cannot complete the fresh handshake without the pinned daemon static (→ `handshake-read-failed`, old ciphers intact). Drop/delay of the reply: the session parks in `awaiting-rekey-reply` on old keys; if the ~30 s window lapses the daemon closes WS 4426 and the supervisor reconnects — a lost-rekey recovery hardening (mobile #495) is explicitly out of scope, blocked on #112.
  - *Mid-session peer swap:* surfaces as the existing handshake-read failure; no phantom compare, no wedge.
  - *Hostile / confused daemon (authenticated, malformed reply):* every reachable reply is read defensively; any throw → `handshake-read-failed`, old ciphers intact, session usable.
  - *Renderer compromise reaching the transport:* out of reach — main-process only.
  - *#112 (driver `noise_init` framing + fakeDaemon e2e) and #495 (lost-rekey recovery)* are out of scope; each gets its own security review when built.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-07
