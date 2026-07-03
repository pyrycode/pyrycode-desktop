# Spec — Noise spike (2/2): prove Go↔JS real-stack Noise_IK interop + write the session-module verdict (#30)

**Size:** S · **Kind:** throwaway de-risking spike (matches #29) — **not** production code, **not** wired into `src/main/index.ts`. The vitest run is the only execution path.
**Security:** `security-sensitive` — Noise handshake, key material, token handling. See the § Security review pass below (verdict: **PASS**).

## Files to read first

- `src/main/transport/noiseSpike.ts:28-199` — **the #29 harness this ticket consumes UNCHANGED.** Extract: `NoiseInitiatorConfig` (`staticPrivateKey`, `remoteStaticPublicKey`, `prologue`, `hello`, `sendFrame`, `onEvent`), the `NoiseInitiatorEvent` union (`handshake-complete{helloAck}` / `message{plaintext}` / `error{reason}`), the `NoiseInitiatorErrorReason` set, and `start()`/`onFrame(frame)`/`sendMessage(plaintext)`/`close()`. Also the **exported** `loadNoiseLib()` — the interop test uses it to mint the JS device keypair via `lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)`.
- `src/main/transport/noiseSpike.test.ts` — #29's test idiom. Extract: the `beforeAll` wasm warm-up (loads the lib once so the one-time Emscripten streaming-compile warning fires before any console-spy installs), the console-spy log-free assertion (spies all six `console` methods, asserts none fire), and the JS↔JS inline responder helper — **#30 does not modify #29's file; the real Go responder replaces that JS responder in a new test file.**
- `src/main/transport/relayConnection.ts:34-96,202-225` — #21 `RelayConnectionConfig` (`url`, `headers`, `onEvent`), the `RelayEvent` union (`connected` / `message{frame}` / `closed{code,reason}`), `send(frame)` / `close()`. Extract: how the live path dials and how the terminal `closed{code}` surfaces the **4426** handshake-failure close.
- `src/main/transport/codec.ts:51-101,112-174` — the framing functions the live-path adapter **composes** (do not re-implement): `base64StdEncode` / `base64StdDecode` (strict std alphabet), `encodeInnerFrame({v:2,type,data})→string` / `decodeInnerFrame(bytes)→{v,type,data}`, `encodeEnvelope(Envelope)→Uint8Array`, `makeHelloClientPayload({deviceName,clientVersion,token})`.
- `src/shared/wire/types.ts:11,32-85,119-125` — `NOISE_PROTOCOL` (`Noise_IK_25519_ChaChaPoly_BLAKE2s`; pass verbatim to both stacks), `InnerFrameV2`, `Envelope`, `HelloClientPayload`, `HelloAckPayload`, `QrPayload`.
- `docs/knowledge/codebase/29.md` — the four items carried forward to #30 (§ *Deferred / carried forward*) + the `Split()` asymmetry note + the classify-don't-forward / log-free patterns. The verdict (AC4) must fold these in.
- **Cross-repo interop contract — inlined below** (§ *The proven wire contract*) so no cross-repo read is needed. Sources: pyrycode `internal/noise` (#433, the daemon's `flynn/noise` IK wrapper) and the mobile Noise client spike (Kotlin `noise-java` ↔ Go `flynn/noise`, proven byte-for-byte 2026-05-29 against the live relay).

## Context

#29 landed `noise-c.wasm@0.4.0` and the throwaway `createNoiseInitiator` harness, proving `Noise_IK_25519_ChaChaPoly_BLAKE2s` **conformance** with early-data against JS-only vectors and a JS↔JS round-trip. That proves conformance, **not interop**: a JS-only responder shares one implementation, so it cannot prove the by-value distinction of BLAKE2s from SHA-256 at the Noise layer, and cannot expose a Go↔JS framing/Split wall.

This ticket runs the unchanged #29 initiator against a **genuine `flynn/noise` Go responder** (the daemon's actual library, `v1.1.0`, suite `NewCipherSuite(DH25519, CipherChaChaPoly, HashBLAKE2s)`, pattern IK, empty AD, empty prologue, desktop = **initiator**), proves a byte-identical handshake + one AEAD round-trip, exercises a deliberate mismatch that must be **observed to fail** at MAC verification, provides an operator-gated **live-daemon** path over #21's shipped transport, and writes the **recommend/reject verdict** the #7 session-module architect will read.

**Environment confirmed at spec time:** `go 1.26.2` is on PATH, `github.com/flynn/noise@v1.1.0` is already in the module cache (`~/go/pkg/mod`), and `proxy.golang.org` is reachable (HTTP 200) as a fallback. The automatable Go-responder path is therefore runnable, offline-capable, credential-free, and deterministic.

## The proven wire contract (inlined — the interop is byte-accurate as written)

The mobile team already proved this exact interop (Kotlin initiator ↔ Go `flynn/noise` responder) with **zero byte-level debugging** on the first run. Hold these invariants and the two stacks agree:

| Concern | Value | Source of truth |
|---|---|---|
| Suite | `Noise_IK_25519_ChaChaPoly_BLAKE2s` — BLAKE2**s**, not 2b/SHA-256 | `NOISE_PROTOCOL` in `types.ts:11` |
| Roles | Desktop = **Initiator**, Go responder = **Responder** | — |
| Prologue | **EMPTY** — noise-c passes `null`; flynn leaves `Config.Prologue` nil | `noiseSpike.ts:104-109` |
| Associated data | **EMPTY** on every transport AEAD op (`EMPTY_AD`; flynn `Encrypt(nil,nil,pt)`) | `noiseSpike.ts:26` |
| Early-data | `hello` rides IK **msg 1** payload; `hello_ack` rides IK **msg 2** payload | flynn `Write/ReadMessage(out, payload)` |
| Ciphertext len | plaintext + 16 (Poly1305 tag) | — |

**The one high-risk line — the `Split()` asymmetry (do NOT double-swap):**

- **noise-c (JS initiator, #29):** `HandshakeState.Split()` returns `[send, recv]` **already role-adjusted for both roles**. The JS side does **no** swap. `send` encrypts initiator→responder; `recv` decrypts responder→initiator. (`noiseSpike.ts:173`.)
- **flynn/noise (Go responder):** `WriteMessage`/`ReadMessage` return `(cs1, cs2)` where **cs1 carries initiator→responder** and **cs2 carries responder→initiator**, for both roles. So the **responder must map `recv = cs1`, `send = cs2`** (the swap pyrycode's `internal/noise` #433 wrapper does inside `WriteResp`). The initiator side does no swap.
- **Net:** JS `send` (init→resp) pairs with Go `cs1`/`recv`; JS `recv` (resp→init) pairs with Go `cs2`/`send`. Each side swaps at most once. Crossing these = handshake completes but the first transport frame MAC-fails.

**Close codes (live path):** `4426` = Noise handshake failure (wrong server static / suite), `4421` = transport/AEAD failure, `4401` = bad token. The supervisor (#22) already treats `{4401,4421,4426}` as fatal; here we observe them via `RelayEvent {type:'closed',code}`.

## Design

Three test surfaces plus a prose verdict. **The #29 initiator, the #21 `createRelayConnection`, and the #5 codec are all consumed unchanged** — this ticket adds only a throwaway Go responder and a new test file whose helpers are test-scoped (matching #29's in-test responder).

### 1. Throwaway Go responder — `src/main/transport/noiseSpikeResponder/`

A minimal, single-handshake `flynn/noise` responder over a stdio line protocol. Files: `main.go`, `go.mod`, `go.sum` (the last two generated by `go mod init pyrycode/noise-spike-responder && go get github.com/flynn/noise@v1.1.0` and committed — `flynn/noise v1.1.0` is the pin; no other direct dep).

**Line protocol** (parent = JS test; child = Go responder):
- Child stdout, once at startup: `PUB <base64-std 32-byte responder static public key>`.
- Parent → child stdin: one line per outbound Noise frame, `<base64-std raw frame>` (msg 1, then transport frames).
- Child stdout: `FRAME <base64-std raw frame>` for msg 2 and each transport echo.
- Child stdout on any failure: `ERR <static-reason>` (e.g. `handshake-read-failed`, `transport-decrypt-failed`) — **static reasons only, never bytes/keys** — then exit non-zero.
- Child flag: `--hash blake2s|blake2b` (default `blake2s`) — selects `HashBLAKE2s` vs `HashBLAKE2b` for the negative suite-mismatch case. One binary drives every scenario.

**flynn/noise call sequence** (contract sketch — mirrors #433's `Responder`; the swap is the load-bearing line):

```go
// suite := noise.NewCipherSuite(DH25519, CipherChaChaPoly, HashBLAKE2s|HashBLAKE2b)
// staticKey := suite.GenerateKeypair(rand.Reader)      // print staticKey.Public as PUB
// hs := noise.NewHandshakeState(Config{CipherSuite, Random: rand.Reader,
//                                      Pattern: HandshakeIK, Initiator: false, StaticKeypair})
// hello, _, _, err := hs.ReadMessage(nil, msg1)        // recovers early-data; cs still nil
// msg2, cs1, cs2, err := hs.WriteMessage(nil, hello)   // echo hello as hello_ack; NOW split
// recv, send := cs1, cs2                               // responder maps cs1=recv, cs2=send
// pt, err := recv.Decrypt(nil, nil, ct)  //  AD empty
// echo, _ := send.Encrypt(nil, nil, pt)  //  echo the plaintext back
```

Behavioural contract: recovers the `hello` early-data from msg 1 and **echoes it back as the `hello_ack`** early-data of msg 2 (so a single JS assertion `handshake-complete.helloAck === sentHello` proves both-direction early-data recovery across the two stacks). Then decrypts one inbound transport frame and re-encrypts the same plaintext (the AEAD round-trip). `Random: rand.Reader` explicit in the Config. No `slog`/`fmt.Print` of key material, plaintext, or frame bytes — only the tagged base64 line-protocol frames (synthetic test bytes only; see § Security review) and static `ERR` reasons.

### 2. Automatable loopback harness — new test file `src/main/transport/noiseSpike.interop.test.ts`

Test-scoped helpers (inline, matching #29's in-test responder — not a production module, not wired into composition):

- `beforeAll`: `execFileSync('go', ['build', '-o', <tmpBin>, '.'], {cwd: responderDir})`. On `ENOENT`/build failure, set `goAvailable = false`; the Go-dependent describe block uses `describe.skipIf(!goAvailable)` and logs a single static skip reason. (Cache + network are present at spec time, so this builds; the skip is the graceful fallback for a toolchain-less runner.)
- A `spawnResponder(args)` helper: spawns `<tmpBin>` as a fresh child per test, wires a line reader over stdout, exposes `waitForPub()`, `feed(rawFrame)` (writes `base64StdEncode(frame)+'\n'` to stdin), an inbound `FRAME`/`ERR` event stream, and `kill()` in a `try/finally` so no child outlives the test.
- Frame plumbing to the unchanged initiator: `sendFrame = (frame) => responder.feed(frame)`; responder `FRAME <b64>` → `initiator.onFrame(base64StdDecode(b64))`; responder `PUB <b64>` → `remoteStaticPublicKey = base64StdDecode(b64)`.
- JS device keypair: `const lib = await loadNoiseLib(); const [priv] = lib.CreateKeyPair(lib.constants.NOISE_DH_CURVE25519)` → `staticPrivateKey = priv`.
- A bounded wait (≤ 2 s internal deadline, inside vitest's 5 s default) resolves on `handshake-complete`/`message`, on a responder `ERR`, or on timeout — so the negative tests terminate deterministically.

### 3. Operator-gated live path — same test file, env-gated

The **same** `createNoiseInitiator`, over an unchanged `createRelayConnection`, against the live relay + daemon. A **single-shot** connection (observe one handshake; no #22 reconnect). Gated on env presence; `it.skipIf(!liveEnvPresent)` so default `npm test` skips it and stays deterministic + credential-free.

Env (values read at runtime only; **never** logged, echoed, or committed):
- `PYRY_LIVE_RELAY_URL` — e.g. `wss://pyrycode-relay.pyryco.de/v1/client` (path included verbatim; `createRelayConnection` dials as-is).
- `PYRY_LIVE_SERVER_ID`, `PYRY_LIVE_DEVICE_TOKEN` (hex), `PYRY_LIVE_SERVER_STATIC_PUB` (base64-std, 32 B), optional `PYRY_LIVE_DEVICE_NAME` (default `pyrycode-desktop-spike`).

**Framing adapter (thin glue over #5 codec — the live path's only new logic):**
- Build `hello` early-data: `encodeEnvelope({id:1, type:'hello', ts:<RFC3339>, payload: makeHelloClientPayload({deviceName, clientVersion, token})})` → the `config.hello` bytes.
- Outbound `sendFrame(raw)`: tag the **first** outbound `noise_init`, subsequent `noise_msg`; `relay.send(encodeInnerFrame({v:2, type, data: base64StdEncode(raw)}))`.
- Inbound `relay {type:'message',frame}`: `const {data} = decodeInnerFrame(frame); initiator.onFrame(base64StdDecode(data))`.
- Wire mapping (from #29's note): relay `{type:'connected'}` → `initiator.start()`; relay `{type:'message',frame}` → adapter → `initiator.onFrame(...)`; relay `{type:'closed',code}` → observe (assert 4426 on a deliberate mismatch).
- Headers on `/v1/client`: `X-Pyrycode-Server: <serverId>`, `X-Pyrycode-Token: <token>` (relay requires non-empty but ignores the value under v2 — the token is inside the encrypted `hello`), plus a `User-Agent`.

### 4. The verdict (AC4) — deliverable, not code

A **recommend or reject** verdict for the #7 production session module, consolidated in **the PR body**. The per-ticket knowledge note `docs/knowledge/codebase/30.md` is written by the **documentation phase after merge — NOT by the developer** (do not add it as an AC or write it in this worktree). The verdict must state: the interop result (byte-identical IK handshake + AEAD round-trip achieved or not); the Go↔JS gotchas actually encountered vs. anticipated — framing (`{v:2,type,data}` inner-frame + base64-std at the relay boundary), early-data encoding, nonce/counter handling (library-owned on both sides), empty-AD, and the **`Split()` asymmetry** (flynn `(cs1,cs2)` vs noise-c role-adjusted `[send,recv]` — not double-swapped); and fold in #29's four carried-forward items.

## State + concurrency model

- **No app state, no store, no renderer.** Transport-adjacent throwaway; the vitest process is the only host.
- **Process lifecycle:** the Go responder is a short-lived child, one per test, spawned fresh and `kill()`ed in `finally`. `beforeAll` builds the binary once into a temp path; `afterAll` may remove it. No child outlives its test; no orphan processes.
- **JS initiator lifecycle:** unchanged from #29 — async factory returns an idle handle, `start()` sends msg 1 exactly once, `close()` frees the wasm handshake/cipher states and leaves every entry point inert. The interop test calls `close()` in `finally`.
- **Live path:** exactly one `createRelayConnection`; single-shot; `relay.close()` in `finally`. No reconnect/backoff (that is #22, deliberately excluded).
- **Determinism:** IK message 1 carries the initiator's random ephemeral, so a canned transcript is impossible — the responder must run live against each run's actual bytes (the #29 finding: value-comparisons don't survive random ephemerals; reaching transport state does). This is why the proof is a live subprocess, not a fixture.

## Error handling

- **Initiator reasons (unchanged #29 set):** `handshake-read-failed` (msg 2 failed MAC / malformed / wrong-suite peer), `transport-decrypt-failed`, `unexpected-frame`. Errors leave as **static reasons, never bytes** (classify-don't-forward).
- **Negative-case observability (AC2):** a deliberately mismatched handshake must be **observed to fail at MAC/tag verification**. Two sub-cases share the harness:
  - **Wrong hash suite (load-bearing — the BLAKE2s-vs-SHA-256/BLAKE2b pin):** responder built `--hash blake2b`. Its symmetric state diverges from byte 1, so `ReadMessage(msg1)` MAC-fails; it emits `ERR` and exits with no msg 2. JS observes **no `handshake-complete`, no `message`** (never reaches transport). This is the negative twin of the positive by-value BLAKE2s proof.
  - **Wrong responder static key (cheap additional coverage):** JS passes a random 32-byte `remoteStaticPublicKey` ≠ the responder's real PUB. Per the IK message flow, the wrong peer-static surfaces at the **responder's** `ReadMessage(msg1)` (its `es`/`ss` DH outputs disagree), not the initiator's read — so again responder `ERR`, JS never completes.
  - Both are the AC's "never reaches transport state" observable. A third optional case — feed the initiator a byte-flipped msg 2 to exercise the exact `handshake-read-failed` reason on the JS side — may be added if within budget; it is not required for the verdict.
- **Live path (AC2 extension, when a credential is present):** a deliberate suite/key mismatch yields a **4426-class close** observable via `relay {type:'closed',code:4426}`. Observed only when the live path runs.
- **Go build unavailable:** `beforeAll` catches it, sets `goAvailable=false`, the Go-dependent block skips with a static reason. The verdict records the skip; the live path (if a credential is present) then carries the real-Go-stack proof.

## Testing strategy

`npm test` (vitest, Node env) is the QA/salvage gate. Test file: `src/main/transport/noiseSpike.interop.test.ts`. `#29`'s `noiseSpike.test.ts` is **not touched**. Scenarios (as behaviour, not test bodies):

- **AC1 — positive interop (Go responder, `--hash blake2s`):** the unchanged initiator completes the IK handshake against the real `flynn/noise` responder and reaches transport state — asserted by (a) a `handshake-complete` event whose `helloAck` byte-equals the sent `hello` (proves both-direction early-data across stacks), and (b) one **AEAD round-trip**: `sendMessage(P)` → responder decrypts + echoes → a `message` event whose `plaintext` byte-equals `P`. Reaching transport state is itself the by-value BLAKE2s proof #29 deferred.
- **AC2 — mismatch fails (`--hash blake2b`, and wrong-static):** no `handshake-complete`, no `message`; the responder reports a MAC/read failure (`ERR` / non-zero exit) within the bounded wait. Assert the round-trip does **not** occur.
- **AC3 — live path (env-gated, `it.skipIf`):** with the four env vars set, the same initiator over `createRelayConnection` reaches the daemon's open state with one AEAD round-trip; a deliberate-mismatch variant asserts a `closed{code:4426}`. Skipped (no failure) when env is absent.
- **Log-free (security invariant):** reuse #29's console-spy shape over the interop paths — spy all six `console` methods across handshake + transport + error, assert none fire from the harness/adapter. (The Go child's stdout is the line protocol, out of the JS console-spy's scope; its no-leak is covered by § Security review.)
- Warm the wasm in `beforeAll` (as #29) before any console-spy installs.

Plain function/behaviour assertions over the typed event stream and the responder's line output; no rendering, no store. Type-level coverage via the existing `npm run typecheck` (the new `.ts` test file compiles under the same config #29's test file does).

## Scope / size

- **Total throwaway LOC ≈ 490** (Go responder ~140; generated `go.mod`/`go.sum` ~12; test file incl. loopback helper + 3 scenarios ~300; live-path adapter ~40) — under the 600 ceiling. Consistent with #29 (S, ~730).
- **Production `.ts`/`.tsx` files touched: 0.** `main.go` is Go; the only new `.ts` is a `*.test.ts` (excluded from the production-file self-check). `noiseSpike.ts`, `relayConnection.ts`, `codec.ts`, `types.ts` are **imported unchanged**. `src/main/index.ts` untouched.
- New files: `noiseSpikeResponder/{main.go,go.mod,go.sum}` + `noiseSpike.interop.test.ts` (4; two are generated Go manifests from one `go get`). Zero consumer cascade, zero edit fan-out, additive only.

## Open questions (resolve during implementation; none block)

- **`go run` vs build-once:** spec recommends `go build` once in `beforeAll` + spawn the binary per test (clean per-test process control for stdin feeding + kill). `go run` per spawn is acceptable but complicates child-process teardown.
- **hello_ack shape on the automatable path:** the responder echoes the recovered `hello` as `hello_ack` (minimal; proves the mechanism). The real daemon's `hello_ack` is `{protocol_version,server_id,conn_id}` — shape fidelity is only exercised on the live path, where the daemon supplies it. Fine to keep the echo for the loopback.
- **Live relay reachability + hello_ack gap:** the mobile spike found the production relay does not implement the binary↔relay `hello_ack` and the v2 responder was not yet daemon-wired (pyrycode#549 / pyrycode-relay#105). If those still block the live daemon at run time, the live path is skipped and the automatable Go-responder path carries the real-Go-stack proof (the AC explicitly permits this). Record the outcome in the verdict.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — two boundaries, both explicit. *Automatable path:* the Go child's stdio carries **only synthetic bytes** (a locally-generated responder keypair, an in-process JS device keypair via `CreateKeyPair`, a test `hello` fixture) — no real credential exists on this path, so the tagged base64 line protocol is not a secret leak; the parent decodes via the strict `base64StdDecode` before `initiator.onFrame`. *Live path:* relay socket → main process is parsed at one place — the #5 codec's fail-closed `decodeInnerFrame`/`base64StdDecode` (strict alphabet, category-only errors, no byte echo) — before the unchanged `initiator.onFrame`, which guards state and never touches a freed wasm object (#29).
- **[Tokens, secrets, credentials]** No findings for this ticket. The live device token/server-static/relay-URL/server-id live **only in `process.env`**, are read at runtime, are **never** logged/echoed/written/committed (no `.env` fixture in the repo; the adapter passes env values straight into config without printing), and the token rides **inside the encrypted `hello`** (Noise early-data), never a relay-readable header. OUT OF SCOPE (→ **#7**): token generation/entropy, rotation/revocation, and at-rest storage via `safeStorage` — this spike persists nothing and generates no production key.
- **[File / storage operations]** No findings — nothing is persisted; no credential/key/frame is written to disk. Paths are repo-local and fixed; the only external input to a path is the closed `--hash {blake2s,blake2b}` flag (no untrusted concatenation, no traversal). `go build` output goes to a temp path (not committed).
- **[Inter-process / Electron attack surface]** No findings — no `BrowserWindow`, no IPC, no `contextBridge`, no custom protocol/deep-link, no renderer. The sole subprocess is the Go child: a **repo-local built binary**, fixed arg set, **no shell interpolation**, no network/user-controlled command string, killed in `finally`. Everything stays in the main-process test context; nothing reaches a renderer (there is none).
- **[Cryptographic primitives]** No findings — no hand-rolled crypto. Vetted implementations on both sides (noise-c.wasm per #29; `flynn/noise v1.1.0`, the daemon's own library). The suite pin `Noise_IK_25519_ChaChaPoly_BLAKE2s` is reused verbatim from `types.ts`; the Go responder pins `NewCipherSuite(DH25519, CipherChaChaPoly, HashBLAKE2s)` with `Random: rand.Reader` explicit. Nonces are per-direction 64-bit counters **owned by each library** — the harness never constructs, resets, or reuses a `(key,nonce)` pair. No secret is compared with `===`/`Buffer.equals` (MAC checks live inside the libraries). The mismatch negative is a **deliberate, contained** wrong-hash/wrong-static exercise whose only observable effect is a MAC failure.
- **[Network & I/O]** No findings — the live path consumes `createRelayConnection` (#21) **unchanged**, inheriting its `maxPayload` inbound cap, connect + pong-liveness timeouts, and `wss://` (no `rejectUnauthorized:false` anywhere). Single-shot by design (no reconnect), so no token-exhaustion/backoff loop is reachable here. The relay URL is **operator-supplied via env** (trusted operator context), not parsed from an untrusted QR payload. OUT OF SCOPE (→ pairing ticket): QR-sourced relay-URL scheme/host validation.
- **[Error messages, logs, telemetry]** No findings — the JS harness inherits #29's **log-free-by-construction** posture (zero `console.*`; classify-don't-forward maps a caught crypto-library error — which can echo transcript bytes — to a static reason and drops it), pinned by the reused six-method console-spy assertion. The Go child emits only tagged base64 frames (synthetic bytes) and static `ERR <reason>` strings — no key material, plaintext, or flynn error text. No telemetry; no crash reporter.
- **[Concurrency]** No findings — the Go child is owned by its test and killed in `finally` (no orphan/duplicate); the live socket is single-shot and `close()`d in `finally`; the initiator's `close()` frees wasm state and leaves entry points inert. Negative tests use a bounded (~2 s) deadline inside vitest's 5 s timeout, so no path hangs. No long-lived async task outlives its test.
- **[Threat model alignment]** No findings. *Malicious/on-path relay:* content-blind; the single-shot spike observes one handshake — a hostile relay can only drop/delay, which the bounded wait converts to a deterministic timeout (no hang, no plaintext leak). *Hostile daemon response:* parsed defensively via the #5 codec's fail-closed decoders; the initiator guards state transitions. *Token theft from disk / renderer compromise:* not applicable — nothing persisted, no renderer. OUT OF SCOPE (→ **#7**): at-rest key/token protection and the production entropy gate.

No MUST FIX. **PASS.**

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
