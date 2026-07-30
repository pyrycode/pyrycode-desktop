# #525 — fakeDaemon must tag handshake replies `noise_resp`, not `noise_msg`

**Size:** XS (confirmed — see § Scope check)
**Files touched:** `src/main/transport/fakeDaemon.ts` (1 production file), `src/main/transport/fakeDaemon.test.ts` (1 test file)

## Design source

N/A — test-only transport infrastructure in the Electron main process. No UI surface, no Figma node; the visual-fidelity check is intentionally skipped.

## Files to read first

Line anchors verified at `main` `746c115` (i.e. **after** #524 / PR #526 landed). They will drift again if anything else merges into this file — **re-grep `sendNoise(` and `noise_msg` rather than trusting the numbers.** Same-file anchor drift has burned this repo seven times, most recently self-inflicted inside #524's own spec.

> Codegraph is **not initialized** for this repo (`codegraph_status` → "CodeGraph not initialized"), so this list was assembled by grep + Read rather than `codegraph_context`. Do the same if you need to widen it.

- `src/main/transport/fakeDaemon.ts:1-61` — module header. Lines **20-22** carry the load-bearing safety claim *"every outbound frame stays tagged `noise_msg`"* that this ticket invalidates. Everything else in the header (the #524 routing note, the Split role-mapping note, the TEST-ONLY and LOG-FREE constraints) stays as written.
- `src/main/transport/fakeDaemon.ts:243-250` — the `sendNoise` comment + body. **The single outbound chokepoint.** All eight outbound frames route through it; the AEAD seal happens at the *call sites*, never here.
- `src/main/transport/fakeDaemon.ts:252-330` — `handleMsg1` (`sendNoise` at `:267`), `initiateRekey` (`:292`), `handleRekeyInit` (`:321` reply, `:323` resume). Two of the three retag sites plus one unchanged site, adjacent.
- `src/main/transport/fakeDaemon.ts:332-400` — `handleReconnect` (`:367` msg2, `:370` resends) and `handleTransport` (`:396`). The third retag site plus one unchanged site.
- `src/main/transport/fakeDaemon.ts:402-437` — `onMessage` inbound routing (`:426-427`) and `pushFrame` (`:436`). Read the routing note: the fake reads the **inbound** type for routing only; this ticket does not touch that.
- `src/shared/wire/types.ts:32-38` — `InnerFrameV2.type` is a bare `string`, not a union. This is why a typo compiles clean and why AC3 has to assert on wire bytes.
- `src/main/transport/fakeDaemon.test.ts:148-277` — the `driveClient` harness. The inbound `message` branch is at **`:223-230`** (the hold gate at `:224`, live delivery at `:229`); the returned handle object starts at **`:262`**. This is where the new observation seam goes.
- `src/main/transport/fakeDaemon.test.ts:295-338` (round-trip), `:394-443` (rekey), `:587-682` (reconnect + `pushFrame` at `:622`) — the three existing tests that already reach all eight outbound sites. No new choreography is needed; assertions attach to these.
- `src/main/transport/fakeDaemon.test.ts:528-529` — an **already-existing** wire-type assertion (`expect(served.type).toBe('noise_msg')`, #524's rekey-window served frame). It is a group-B frame and stays green unmodified. Do not touch it.
- `src/main/transport/codec.test.ts:130-140` — `encodeInnerFrame` throws `WireEncodeError` past `MAX_FRAME_BYTES`. Relevant only to the size note in § Error handling.

## Context

`src/main/transport/fakeDaemon.ts` is the in-process Noise responder that the transport and e2e suites drive the real client against. `sendNoise` hardcodes `type: 'noise_msg'` on **every** outbound frame, including the three IK handshake replies. The real daemon marshals those three as `TypeNoiseResp` (`internal/relay/v2session_handshake.go:241`, `internal/relay/v2session_rekey.go:146`); only transport frames and the `rekey_request` control envelope carry `TypeNoiseMsg`.

Today the drift is invisible: `noiseRelayDriver.onMessage` decodes the inbound frame and keeps only `.data`, discarding `type`. That is exactly why this is cheap now — retagging is behaviour-preserving, so no consumer needs editing. The moment the client starts distinguishing the two, every fakeDaemon-based rekey and reconnect test would hang against the drifted fake and the failure would wrongly implicate the client change.

Grep confirms the blast radius on `main` at `746c115`: the only non-test code that reads an inner `type` is `fakeDaemon.onMessage` (inbound `noise_init` routing, `:426-427`) and `noiseRelayDriver.sendFrame` (outbound tagging, `:203`). Neither reads `noise_msg` on the inbound path. The forwarder (`fakeRelayForwarder`) and the routing relay (`fakeRoutingRelay`) are content-blind — they splice frames without inspecting `type`. So nothing outside `fakeDaemon.ts` observes this change except the new assertions.

## Design

### 1. `sendNoise` gains a tag parameter, defaulted to the majority case

```ts
/** The two inner-frame tags this fake ever emits. Narrow on purpose: `InnerFrameV2.type` is a
 *  bare `string`, so this alias is the ONLY compile-time backstop against a typo. Module-local —
 *  not exported. */
type OutboundInnerType = 'noise_resp' | 'noise_msg'

function sendNoise(raw: Uint8Array, type: OutboundInnerType = 'noise_msg'): void
```

Behaviour: unchanged except that the encoded frame's `type` field is now `type` instead of the literal `'noise_msg'`. The `leg === null || readyState !== OPEN` guard, the `base64StdEncode`, and the `encodeInnerFrame` call all stay exactly as they are.

**Why a default rather than a required parameter.** A required second argument would turn "forgot to tag" into a compile error for any *future* call site — a real structural gain. It costs five one-token edits at sites the ticket explicitly asks to leave untouched, and it widens the diff of a behaviour-preserving change. The ticket's constraint wins: **the five non-handshake sites are not edited.** The residual risk is bounded and non-exploitable — a future handshake site that forgets the tag ships `noise_msg`, and once the client distinguishes the two the frame fails AEAD and the session fails closed rather than downgrading. AC3's ordered assertions pin every site that exists today. Flag this trade-off in review rather than re-litigating it in code.

### 2. Exactly three call sites pass `'noise_resp'`

| Function | Frame | Anchor at `746c115` | Change |
|---|---|---|---|
| `handleMsg1` | initial IK message 2 | `:267` | `sendNoise(msg2, 'noise_resp')` |
| `handleRekeyInit` | rekey reply (message 2) | `:321` | `sendNoise(reply, 'noise_resp')` |
| `handleReconnect` | reconnect message 2 | `:367` | `sendNoise(msg2, 'noise_resp')` |

The other five call sites — `initiateRekey` `:292` (`rekey_request` envelope), `handleRekeyInit` `:323` (post-swap resume), `handleReconnect` `:370` (resend frames), `handleTransport` `:396` (transport replies), `pushFrame` `:436` (server push) — are **not edited**. They pick up `noise_msg` from the default.

### 3. Two invariants that must survive the edit

These are the two things a reasonable-looking refactor would break. Both are currently true; neither may change.

- **`sendNoise` never touches a cipher.** Every sealed frame is sealed by its *caller* (`sendCipher.EncryptWithAd(...)` at the call site) and handed to `sendNoise` as opaque bytes. `sendNoise` is pure framing. Do not push the seal into it "now that it knows the frame kind" — the tag and the cipher choice are independent, and coupling them puts key selection behind a defaulted parameter.
- **`sendNoise` stays synchronous, with no buffering.** `handleRekeyInit` emits msg2 and then the resume frame in that order, and the client must process msg2 (swapping ciphers) before the resume frame can decrypt. Any queueing or async in `sendNoise` reorders a load-bearing pair. Same applies to `handleReconnect`'s msg2-then-resends.

### 4. Comment blocks

Two comments assert the old invariant as a deliberate safety claim and must move with it:

- **Module header `:20-22`** — replace the *"every outbound frame stays tagged `noise_msg`"* clause. The replacement states the split (handshake replies `noise_resp`, everything else `noise_msg`), cites the real daemon as the authority (`v2session_handshake.go:241`, `v2session_rekey.go:146` for `TypeNoiseResp`; `v2session.go:913`/`:954`/`:1265` and `v2session_rekey.go:315` for `TypeNoiseMsg`), and records that the client still discards the inbound type today — so the fake is now correct *ahead* of the client, and the change is behaviour-preserving.
- **`sendNoise` comment `:243-245`** — replace the *"Every outbound is tagged `noise_msg` (both msg2 and transport replies)"* claim with the tag rule: the caller names the tag, handshake replies pass `noise_resp`, everything else takes the default. Keep it to the rule; the daemon citations live in the header.

Four other comments name `noise_msg` and **stay accurate as written — do not edit them**: the `buildReplyFrames` docstring (`:119`), the `pushFrame` docstring (`:164`), the `handleTransport` reply comment (`:392`), and the `pushFrame` comment (`:431-433`). All four describe transport-class frames, which keep the `noise_msg` tag.

## State + concurrency model

No state change. `sendNoise` has no state; the tag is a per-call argument. No new async, no new timer, no new listener, no change to the `state` machine (`awaiting-msg1` → `transport` → `awaiting-rekey-init`), and no change to cipher lifetime or the atomic-swap discipline in `handleRekeyInit` / `handleReconnect`.

The test-side observation seam (below) adds one synchronous array push inside an existing event handler. It must not throw — see § Error handling.

## Error handling

- **Encoded frame grows by one byte.** `'noise_resp'` is 10 characters to `'noise_msg'`'s 9, so each retagged frame's JSON is one byte larger. `encodeInnerFrame` throws `WireEncodeError` past `MAX_FRAME_BYTES` (`codec.test.ts:130-140`), and that throw inside `handleMsg1` / `handleReconnect` would be caught by their `try` and mis-classified as `handshake-read-failed`. Not reachable: all three retagged frames are handshake outputs of fixed, small size (message 2 wrapping a `hello_ack`, or a rekey message 2 with empty early-data). The size-variable frames — transport replies carrying arbitrary `buildReplyFrames` payloads — keep the shorter tag and are unaffected. No guard is added; do not add one (no observed failure).
- **Failure classification is unchanged.** `handleMsg1` / `handleRekeyInit` / `handleReconnect` keep their existing `catch` → `settle({ ok: false, reason: 'handshake-read-failed' })` → `close()` path, and the caught object is still dropped rather than logged.
- **The fake stays LOG-FREE.** No `console.*` is added on either side. The test-side tap records only the inner `type` string — never `.data`, which is base64 of the sealed transcript. The existing `held` array already retains whole raw frames; the tap is deliberately narrower than that, not wider.
- **The tap is total.** `peekInnerType` must never throw: a throw inside the relay's `onEvent` handler would break event dispatch and hang unrelated tests. On a decode failure it returns a static placeholder and drops the caught object — mirroring the fake's own classify-and-drop discipline. (In practice unreachable: every daemon outbound goes through `encodeInnerFrame`.)

## Testing strategy

`npm test` (vitest). All changes land in `src/main/transport/fakeDaemon.test.ts`. There is **no behavioural oracle** — the client discards the inbound type — so the assertions must read the encoded wire bytes.

### The observation seam

`driveClient` already funnels every inbound frame through one place: the `message` branch of the relay `onEvent` handler (`:223-230`). Add a passive tap there, **above** the hold gate at `:224`, so a held frame is recorded too:

```ts
/** The inner `type` of a raw InnerFrameV2, or a static placeholder if it will not decode. Total by
 *  construction — a throw here would break the relay's event dispatch. Records the type only,
 *  never `.data` (sealed transcript bytes). */
function peekInnerType(frame: Uint8Array): string

// added to driveClient's returned handle:
/** Every inbound frame's inner `type`, in arrival order. The ONLY oracle for the daemon's outbound
 *  tagging, since the client discards it (#525). */
inboundTypes: string[]
```

Determinism note: on the bounded pre-`connected` re-dial path (#336) the replaced relay's closure shares this array, exactly as it already shares `held`. Safe — no inbound frame can arrive before `connected`, because the daemon's first outbound answers a msg1 the client only sends from the `connected` handler.

### Assertions — ordered equality, not membership

Assert the **whole array** with `toEqual`, not individual indices. Ordered equality pins both directions at once (AC3): a handshake site that regresses to `noise_msg` and a transport site that wrongly becomes `noise_resp` both fail the same assertion.

Three existing tests already reach all eight outbound sites, so no new choreography is written:

| Test (anchor) | Where the assertion goes | Expected `inboundTypes` | Sites covered |
|---|---|---|---|
| round-trip `:295` | after the `message` assertion | `['noise_resp', 'noise_msg']` | `handleMsg1`, `handleTransport` |
| rekey `:394` | at the end, after the K1 reply assertion | `['noise_resp', 'noise_msg', 'noise_msg', 'noise_resp', 'noise_msg', 'noise_msg']` | + `initiateRekey`, `handleRekeyInit` reply, `handleRekeyInit` resume |
| reconnect `:587` | `first.inboundTypes` right after the push assertion (before `dropClientLeg()`); `second.inboundTypes` after the `reply1` assertion | both `['noise_resp', 'noise_msg', 'noise_msg']` | + `pushFrame`, `handleReconnect` msg2, `handleReconnect` resends |

Each assertion sits after the `await waiter.wait(...)` that delivered its last frame, so every expected frame has provably arrived — no polling, no timer.

### Non-vacuity — run this before opening the PR

The assertions must be able to fail. **Mutation check:** drop the `'noise_resp'` argument from `handleMsg1`'s `sendNoise` call (so it falls back to the default) and re-run. All three tests must fail on the first array element. Restore, then repeat for `handleRekeyInit`'s reply — only the rekey test should fail. **Positive control:** these assertions must be red against the pre-change fake; confirm by stashing the production edit and running the tests alone. State in the PR body which run the numbers came from.

### Regression surface (AC4)

No edits beyond the new assertions. Confirm green, unchanged:

- `src/main/daemonConnection.roundtrip.test.ts` (imports the fake directly, drives `pushFrame` at `:763`/`:812`)
- `e2e/` — twelve specs reach the fake transitively through `e2e/fixtures/launchPairedApp.ts` and never import it themselves. `npm run build` first; the e2e suite launches `out/`.
- `src/main/transport/fakeDaemon.test.ts:529`'s existing `expect(served.type).toBe('noise_msg')` — a group-B frame, still correct.

Type-level: `npm run typecheck`. Note that `e2e/` is not covered by either project tsconfig; nothing in this ticket touches `e2e/`.

## Scope check

| Red line | Limit | This ticket |
|---|---|---|
| New files | ≤ 3 | 0 |
| Total written LOC (production + tests + helpers + comments) | ≤ ~600 | ~45 |
| New exported types / components | ≤ 5 | 0 (`OutboundInnerType` is module-local) |
| Consumer call sites needing simultaneous update | ≤ 10 | 0 — the signature change is source-compatible via the default, and `sendNoise` is module-local |
| Acceptance criteria | ≤ 5 | 4 |
| Distinct error/reject branches | ≤ ~10 | 0 new |
| Production source files (§4 commit gate) | < 5 | 1 |

No rationalization was needed to fit — the raw counts are an order of magnitude under every line. XS confirmed, matching PO's `size:xs`.

**File-overlap check (§1.5):** `git fetch origin --prune` then a scan of every `origin/feature/*` branch (suffixed branches included — the `feature/[0-9]+$` form misses `feature/491-run-config-read`) for diffs against `main` touching `src/main/transport/fakeDaemon.ts` or `fakeDaemon.test.ts`. **No overlap.** The one open PR, #500 (`feature/491-run-config-read`), touches neither file. #524 — the declared blocker, which edits this file's header and the `driveClient` harness — merged as `746c115` and is already in this branch's history.

## Open questions

1. **Should `handleTransport`'s reply inside the rekey window carry a distinct tag?** No — spec #450 has transport frames continuing under the old ciphers as ordinary transport, and the real daemon marshals them `TypeNoiseMsg`. `fakeDaemon.test.ts:529` already pins this. Raised only because it is the one place where "handshake window" and "transport frame" overlap; the answer is that the tag follows the *frame*, never the *state*.
2. **Follow-up for the reply direction.** The real daemon treats an *inbound* `noise_resp` from a client as a protocol violation and closes the session (`v2session.go:669-676`); this fake accepts it as a transport frame. Explicitly out of scope per the ticket body. Worth a PO ticket: the fake is lax in the same direction as the client, so a client bug that emitted `noise_resp` would pass CI silently — the exact shape #524 hit with `driveClient`'s outbound tagging.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The one untrusted→trusted boundary is `onMessage` (`:412-428`), which this ticket does not touch — the inbound `type` is still consulted for routing only, and transport-frame interpretation still rests solely on the Noise state machine + AEAD. The change is strictly on the *outbound* side. Checked the adversarial case: can the fake now emit an unsolicited `noise_resp` into a client that is not expecting a handshake reply? No — all three retag sites are strict replies to a client-sent init (`handleMsg1` ← msg1, `handleRekeyInit` ← rekey msg1, `handleReconnect` ← reconnect msg1). A hostile injected `noise_init` fails closed *before* any reply is written: `handleReconnect` runs `ReadMessage` then `decodeEnvelope(hello)` and only then `WriteMessage`, so a malformed init produces `handshake-read-failed` and zero outbound bytes.
- **[Tokens, secrets, credentials]** No findings — nothing in this change reads, stores, derives, or transmits a token. The daemon's Noise static and the harness's dummy token literal are untouched.
- **[File / storage operations]** Not applicable — no filesystem access is added or modified. `fakeDaemon.ts` performs no I/O beyond its WebSocket leg.
- **[Inter-process / Electron attack surface]** No findings. `fakeDaemon.ts` is TEST-ONLY and must never enter the production graph; this ticket adds no import anywhere and does not alter the exported `FakeDaemon` handle (`sendNoise` is module-local). No `BrowserWindow`, no `contextBridge`, no `ipcMain` surface is involved. Keys and sockets stay in the main process.
- **[Cryptographic primitives]** No findings, and this is the category with the most exposure, so two constraints were written into § Design rather than left implicit: (a) `sendNoise` must stay cipher-free — every seal happens at the call site, so a defaulted parameter can never influence key selection; (b) `sendNoise` must stay synchronous and unbuffered, because `handleRekeyInit`'s msg2-then-resume and `handleReconnect`'s msg2-then-resends are ordering-critical and the client's cipher swap depends on that order. No key material, no nonce, no AEAD input changes: the tag lives in the outer JSON wrapper, outside the sealed bytes. No `(key, nonce)` pair is reused.
- **[Network & I/O]** One considered-and-dismissed finding, documented in § Error handling: `'noise_resp'` is one byte longer, and `encodeInnerFrame` throws past `MAX_FRAME_BYTES`, which inside `handleMsg1`'s `try` would mis-classify as `handshake-read-failed`. Not reachable — all three retagged frames are fixed-size handshake outputs; the size-variable transport replies keep the shorter tag. No new socket, no change to the leg's `readyState` guard, no timeout or reconnect-discipline change.
- **[Error messages, logs, telemetry]** No findings. The fake stays LOG-FREE by construction — no `console.*` added, error classification unchanged, caught objects still dropped. The new test-side tap deliberately records **only** the inner `type` string and never `.data` (base64 of the sealed transcript); it is strictly narrower than the pre-existing `held` array, which retains whole frames.
- **[Concurrency]** No findings. No async, timer, listener, or shared-state mutation is added on the production side. The single test-side risk — a throw inside the relay's `onEvent` handler breaking event dispatch and hanging unrelated tests — is mitigated by specifying `peekInnerType` as a total function that returns a static placeholder on decode failure.
- **[Threat model alignment]** The desktop threats (hostile relay, token theft from disk, hostile daemon response, renderer compromise) all sit on production paths this ticket does not touch; the change strictly *increases* the fidelity of the security-relevant tests that run against this fake (rekey nonce-lockstep, the fail-closed paths). **OUT OF SCOPE:** the fake does not mirror the real daemon's rejection of an inbound `noise_resp` from a client (`v2session.go:669-676`) — a laxness in the same direction as the client, so a client bug emitting `noise_resp` would pass CI silently. Explicitly deferred by the ticket body; recorded as Open question 2 for PO to file. A separate pre-existing gap, also unchanged here: anyone who can reach the fake's leg can complete a fresh IK handshake and force a cipher swap (the #416 reconnect design, test-only, no production exposure).

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
