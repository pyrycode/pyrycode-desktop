# Spec — route inbound frames in the rekey window by inner frame type (#532)

**Ticket:** [#532](https://github.com/pyrycode/pyrycode-desktop/issues/532) · **Size:** S · **Labels:** `bug`, `size:s`, `security-sensitive`
**Split from:** #507 · **Predecessors:** [#524](../../knowledge/codebase/524.md) (daemon-side routing by inner type), [#525](../../knowledge/codebase/525.md) (fake tags handshake replies `noise_resp`)

## Design source

N/A — pure main-process transport change. No renderer surface, no UI, no visual output. The
`security-sensitive` label is the gate that applies here, not a Figma anchor.

## Files to read first

Codegraph is not initialized for this repo (`codegraph_context` → *"CodeGraph not initialized"*),
so this list is hand-assembled from the ticket's anchors, re-verified against `main` at `8fa1b1b`.

| Path | What to extract |
|---|---|
| `src/main/transport/noiseSession.ts:232-308` | `onFrame`'s whole state machine. `:234-255` is the `transport` branch (the shape the new window-transport path mirrors); `:256-287` is the `awaiting-rekey-reply` branch this ticket splits. |
| `src/main/transport/noiseSession.ts:79-89` | The `NoiseSession` interface — `onFrame` is the one signature that changes. |
| `src/main/transport/noiseSession.ts:98-117` | `REKEY_REQUEST_TYPE` + `isRekeyRequest` — the existing module-private wire-constant idiom the new `noise_resp` constant copies. |
| `src/main/transport/noiseSession.ts:1-32` | Module header. Its "peeks the decrypted envelope's `type`" claim is now incomplete — the session also reads an *outer* inner-frame label in exactly one state. |
| `src/main/transport/noiseSession.ts:162-179` | `fail` / `failWithFrame` — the new reject path reuses `failWithFrame`, whose bytes-are-safe rationale (pre-decryption AEAD ciphertext, Bucket 1) already covers the interleaved-frame case verbatim. |
| `src/main/transport/noiseRelayDriver.ts:144-146` | `let pending: Uint8Array[]` — the replay buffer whose element type has to grow a label. |
| `src/main/transport/noiseRelayDriver.ts:252-254` | The replay loop `for (const raw of buffered) s.onFrame(raw)`. |
| `src/main/transport/noiseRelayDriver.ts:261-288` | `onMessage` — the untrusted→trusted boundary. `:264-265` is the "the inner `type` label is NOT branched on" threat-model comment that must be rewritten; `:269` is the discard site. |
| `src/main/transport/fakeDaemon.ts:415-425` | **The mirror-image threat-model paragraph, already written.** Reuse this reasoning on the client side rather than deriving it fresh. |
| `src/main/transport/fakeDaemon.ts:426-443` | `onMessage` — the daemon-side precedent for routing one state on the inner type while leaving interpretation to the AEAD. |
| `src/main/transport/fakeDaemon.ts:445-451` | `pushFrame` and its `state !== 'transport'` gate — harness gap 1. |
| `src/main/transport/fakeDaemon.ts:290-344` | `initiateRekey` + `handleRekeyInit` — proof the fake's old send cipher stays live across `awaiting-rekey-init` (the swap happens only inside `handleRekeyInit`). |
| `src/main/transport/noiseSession.test.ts:64-165` | `createNoiseResponder`, the in-file responder double. `:139-142` `sendMessage`'s `state !== 'transport'` gate is harness gap 2; `:143-150` `initiateRekey` parks it in `awaiting-rekey-init`; its four `config.sendFrame(...)` sites are where tags get attached. |
| `src/main/transport/noiseSession.test.ts:450-480` | `pair()` — the fixture the new tests extend. |
| `src/main/transport/noiseSession.test.ts:494-519` | The clean-rekey test (nothing interleaved) — the baseline that must stay green. |
| `src/main/transport/noiseSession.test.ts:521-582` | The capture-and-replay AC3 test, and at `:522-530` **the nonce-lockstep note** explaining why the interleaved frame must be sealed *during* the window, not held back. |
| `src/main/transport/noiseSession.test.ts:584-636` | The AC4 regression guard. Untouched behaviour; its `initiator.onFrame(garbage)` call is unlabelled, which is exactly what the defaulted parameter has to keep working. |
| `src/main/transport/noiseRelayDriver.test.ts:44-72` | `makeFakeSession` — the only other `NoiseSession` implementation in the tree. |
| `src/main/transport/noiseRelayDriver.test.ts:220-222` | `wrapInbound(type, raw)` — already builds an inbound frame with an arbitrary inner type. |
| `src/main/transport/noiseRelayDriver.test.ts:498-513` | The `pending`-replay ordering test — the home for the "the label survives buffering" assertion. |
| `src/main/transport/fakeDaemon.test.ts:141-153` | `peekInnerType` (#525) — the inbound tagging tap. |
| `src/main/transport/fakeDaemon.test.ts:222-231` | `deliverFrame` — decodes the inner frame and **discards `type`**, mirroring the pre-#532 production driver. This is the one line that makes the fake-daemon suite blind to the new routing. |
| `src/main/transport/fakeDaemon.test.ts:176-190` | The `holdInbound` / `resumeInbound` / `held` / `deliverHeld` / `inboundTypes` harness surface (#524/#525) — everything the integration test needs already exists. |
| `src/main/transport/fakeDaemon.test.ts:423-483` | The clean-rekey integration test, including the `inboundTypes` `toEqual` tag-sequence assertion at `:477-482`. |
| `src/main/daemonConnection.roundtrip.test.ts:335-350` | **The highest-altitude existing regression guard.** `daemon.initiateRekey()` at `:343` drives a real rekey through the real `daemonConnection` → real `noiseRelayDriver` → real `noiseSession` over the real codec and forwarder — so it is the one place the production label plumbing is exercised end-to-end today. It must stay green untouched. |
| `src/main/transport/codec.ts:94-101` | `decodeInnerFrame` — note `:98` rejects a non-string `type`, which is why the production driver can never hand `onFrame` an absent label. |
| `docs/knowledge/features/noise-session.md`, `noise-relay-driver.md`, `fake-daemon.md` | Evergreen behaviour docs for the three production modules. **Read-only** — the documentation phase owns them; do not edit. |
| `docs/knowledge/codebase/525.md` | Why the fake now tags handshake replies `noise_resp`, and the `OutboundInnerType` alias precedent. |

Upstream authority (`pyrycode` repo, via QMD `pyrycode-docs`): `docs/protocol-mobile.md` §
Inner-frame discriminator fixes the closed set `noise_init` / `noise_resp` / `noise_msg`;
`knowledge/codebase/450.md` confirms the daemon keeps forwarding app frames sealed under the old
`s.send` for the whole awaiting-reply window, and only `handleRekeyInit` swaps.

## Context

`noiseSession.onFrame` in `awaiting-rekey-reply` feeds **whatever frame arrives next** into
`hs.ReadMessage` as the daemon's rekey reply (`noiseSession.ts:256-268`). The daemon does not stop
the world for a rekey: any app frame it fanned out after emitting `rekey_request` but before
processing the client's `noise_init` is TCP-ordered ahead of the reply, and lands while the client
is parked in that state.

The result is not a dropped frame — it is a permanent desync followed by a relay teardown.
`ReadMessage` MAC-fails, the fresh handshake is freed, the client falls back to `transport` on the
**old** ciphers and surfaces `handshake-read-failed`; meanwhile the daemon has already completed its
swap to the **new** ciphers. The client's next send is sealed under the dead old key, fails the
daemon's new `s.recv`, and hits the daemon's tampered-frame branch: `closeWith(4421)` and session
removal.

The client cannot disambiguate today by deliberate design — `noiseRelayDriver.onMessage` decodes the
inner frame's `type` and discards it (`:264-265`, `:269`) so that a hostile label cannot misroute.
That rationale holds in every state **except this one**, where two different frame kinds are
legitimately in flight at once and only the label separates them. The real daemon already resolved
the mirror-image problem the same way (`v2session.go:664-669`), and `fakeDaemon` was corrected to
match in #524.

**Why now, and why it's cheap now.** #525 (`8fa1b1b`) made the disambiguation signal real on both
sides: the real daemon marshals all three IK handshake replies as `TypeNoiseResp`
(`v2session_handshake.go:241`, `v2session_rekey.go:146`), the fake now matches exactly
(`fakeDaemon.ts:335` / `:337` / `:450`), and the real daemon rejects an *inbound* `noise_resp` from
a client as a state-machine violation (`v2session.go:669-676`) — making `noise_resp` an
unambiguously daemon→client-only tag.

## Design

### 1. `NoiseSession.onFrame` gains an optional inner-type label

```ts
interface NoiseSession {
  /** Feed one inbound frame. `innerType` is the frame's InnerFrameV2 `type` label when the caller
   *  has one; it is consulted in EXACTLY ONE state (see § routing rule). Omitted → unlabelled. */
  onFrame(frame: Uint8Array, innerType?: string): void
}
```

**Optional, not required — this is the sizing constraint.** 35 existing test call sites feed
`onFrame` with no label (`noiseSession.test.ts` ×30, `noiseSession.interop.test.ts` ×3,
`fakeDaemon.test.ts` ×2). A required parameter turns an S ticket into a fixture cascade. An optional
one is a zero-cascade, additive change: every existing call site compiles and behaves identically,
and `makeFakeSession`'s `onFrame(frame)` in `noiseRelayDriver.test.ts:56` stays assignable
(TypeScript accepts a narrower-arity function).

The parameter type is `string`, not a narrow union: `InnerFrameV2.type` is a bare `string` on the
wire (see `525.md`), the driver hands through whatever the relay sent, and inventing a union here
would only force a cast at the one production call site. Add a module-private
`const NOISE_RESP_TYPE = 'noise_resp'`, sibling to the existing `REKEY_REQUEST_TYPE`
(`noiseSession.ts:103`), for the same reason that constant exists: one spelling, one place.

### 2. The routing rule — one state, positive test, unlabelled defaults to today's behaviour

`innerType` is consulted **only** in `awaiting-rekey-reply`. In every other state (`idle`,
`awaiting-handshake-reply`, `transport`, `closed`) it is ignored outright — the Noise state machine
plus AEAD remain the sole authority, exactly as before.

Inside `awaiting-rekey-reply`:

```
isReply  ⇔  innerType === undefined  ||  innerType === NOISE_RESP_TYPE
```

- **`isReply` → the existing reply path, byte-for-byte unchanged.** `hs.ReadMessage` → `Split` →
  atomic swap, or on throw: `hs = null`, `state = 'transport'`,
  `failWithFrame('handshake-read-failed', frame)`. Not one line of `:256-287` changes semantically.
- **otherwise → a new old-cipher transport path** (§ 3).

Three properties of this rule, each load-bearing:

- **Unlabelled ⇒ reply** is what makes the parameter free. Every pre-#532 caller passes nothing and
  keeps its current behaviour, including the AC4 regression guard at `noiseSession.test.ts:623`,
  which feeds garbage with no label and must still produce `handshake-read-failed`. It is also
  *honest*: "an unlabelled frame in the rekey window is the reply" was precisely the pre-#532
  assumption, now written down instead of implied. **In production the default is unreachable** —
  `decodeInnerFrame` rejects a non-string `type` (`codec.ts:98`), so the driver either hands over a
  real label or never reaches the session at all. The `undefined` arm is a unit-test affordance, and
  the spec's security posture does not depend on it.
- **The labelled test is positive on `noise_resp`**, not negative on `noise_msg`. An unknown or
  hostile label therefore takes the *gentler* branch (non-terminal transport-decrypt, reply slot
  preserved) rather than burning the one-shot handshake read. This is the broader reading of AC5,
  and it mirrors the daemon's own positive dispatch on `noise_init`.
- **The label chooses a path, never a key.** Both paths were already reachable; the label only
  decides which of two *already-existing* rejections an undecryptable frame receives. See §
  Threat model.

### 3. The new old-cipher transport path in the rekey window

Behaviour, in order:

1. If `recvCipher === null`, return (defensive; unreachable — `beginRekey` at
   `noiseSession.ts:206` requires both ciphers non-null and never clears them).
2. `recvCipher.DecryptWithAd(EMPTY_AD, frame)`.
3. On throw → `failWithFrame('transport-decrypt-failed', frame)` and **return without touching
   `hs` or `state`**. The session stays parked in `awaiting-rekey-reply`; the reply slot survives.
   This is AC5.
4. On success → `config.onEvent({ type: 'message', plaintext })`. This is AC1 — the same event, the
   same consumer, as outside the window.

**Deliberate asymmetry with the `transport` branch: `isRekeyRequest` is NOT re-run here.** A
`rekey_request` interleaved into an already-open rekey window is not representable — `beginRekey`'s
own `state !== 'transport'` guard would no-op — but emitting `{type:'rekey-requested'}` would still
arm the driver's `rekeyInitPending` latch (`noiseRelayDriver.ts:225-227`), which would then mis-tag
the *next* outbound app frame as `noise_init` after the swap completes, and the daemon would route
that app frame into `handleReconnect` and fail closed. So the window path decrypts and emits, and
nothing else. A faithful daemon never sends this (in `awaitingRekeyReply` it emits only msg2 and the
resume frame); a hostile one gets its frame surfaced as an ordinary unmodeled envelope to
`parseInboundMessage`, which is benign. Write this rationale into the comment — it reads as an
oversight otherwise.

`failWithFrame` (not bare `fail`) is correct: `frame` here is pre-decryption AEAD ciphertext, the
exact Bucket-1 category `noiseSession.ts:166-170` already authorises for the inbound-read catches.

### 4. `noiseRelayDriver` — thread the label through live delivery *and* the replay buffer

- `onMessage` (`:266-288`): keep the decoded `type` alongside `.data` instead of discarding it, and
  pass it to `session.onFrame(raw, type)`. Pass-through only — the driver makes **no** routing
  decision and adds no branch.
- `pending` (`:146`): `Uint8Array[]` → `Array<{ raw: Uint8Array; type: string }>`. Push both at
  `:285`; replay both at `:254`. `MAX_PENDING_FRAMES` and the bound check are unchanged.

The buffer change is not defensive speculation: `onFrame`'s contract now reads a label, so a buffer
that silently drops it is an inconsistency by construction — the replay path would feed
`undefined` where the live path feeds the real tag. Three lines, and it removes the whole class.
(No rekey can occur during the async-create gap today, so nothing observable changes now; the point
is that the two delivery paths stay indistinguishable.)

- **Rewrite the threat-model comment at `:261-265`.** It currently states the old model flatly
  ("The inner `type` label is NOT branched on"). The successor must say: the label is forwarded
  verbatim and is consulted by the session in exactly one state, for routing only; interpretation
  stays with the Noise state machine + AEAD. Lift the reasoning from `fakeDaemon.ts:415-425` — it is
  the same argument in the mirror direction, already reviewed — rather than deriving it fresh.

### 5. Harness gap 1 — `fakeDaemon.pushFrame` in `awaiting-rekey-init`

`pushFrame` no-ops outside `transport` (`fakeDaemon.ts:449`), so the fake can never emit the very
frame AC1 is about. Relax the gate to admit `awaiting-rekey-init` as well.

Safe and faithful by construction: the fake's cipher swap happens **only** inside `handleRekeyInit`
(`:323-333`), so in `awaiting-rekey-init` `sendCipher` is still the live old cipher — the seal is
mechanically available and matches the real daemon per pyrycode #450. The tag is unchanged:
`sendNoise`'s `noise_msg` default (`:261`), which is exactly what the real daemon emits for a
transport frame in that window. `state === 'closed'` and `sendCipher === null` stay excluded.

**Blast radius of the relaxation is one file.** `fakeDaemon` is test/e2e infrastructure — it is
imported only by `fakeDaemon.test.ts`, `daemonConnection.roundtrip.test.ts` and
`e2e/fixtures/launchPairedApp.ts`, never by production code. The new arm is reachable only while the
fake sits in `awaiting-rekey-init`, which requires `initiateRekey()`; of the many `pushFrame`
consumers across `e2e/`, none call `initiateRekey`, and the two that do
(`fakeDaemon.test.ts`, `daemonConnection.roundtrip.test.ts:343`) never push during the window today.
So no existing caller's behaviour changes.

### 6. Harness gap 2 — `createNoiseResponder` in `noiseSession.test.ts`

Two changes to the in-file responder double, mirroring what #525 did to `fakeDaemon`:

- **Relax `sendMessage`'s gate** (`:139-142`) from `state !== 'transport'` to also permit
  `awaiting-rekey-init`, on the same rationale as § 5 (the double swaps only inside its
  `awaiting-rekey-init` handler at `:93-121`).
- **Make it tag its own frames.** Widen the config to
  `sendFrame: (frame: Uint8Array, type: string) => void` and pass a tag at each of its four send
  sites: initial msg2 (`:132`) and rekey msg2 (`:115`) → `'noise_resp'`; `sendMessage` (`:141`) and
  `initiateRekey` (`:149`) → `'noise_msg'`. This matches the real daemon and `fakeDaemon` exactly.

**Widening the callback type forces no call-site edits** — an existing `sendFrame: (f) => …` lambda
is assignable to a two-parameter signature. Only `pair()` (§ 7) opts in.

### 7. Data flow — the interleaved-frame sequence the tests reproduce

```
daemon (fake/double)                          client (real createNoiseSession)
────────────────────                          ────────────────────────────────
initiateRekey()
  seal rekey_request under K0
  state → awaiting-rekey-init
  send  ──── noise_msg ──────────────────────▶ transport: decrypt K0, isRekeyRequest ✓
                                               emit rekey-requested; beginRekey()
                                               state → awaiting-rekey-reply (K0 held live)
        ◀─── noise_init (rekey msg1) ────────  send
        ✋ WITHHELD by the test
                                                    ← the window is now open on both sides
sendMessage(app) / pushFrame(app)
  seal under K0 (still live)
  send  ──── noise_msg ──────────────────────▶ awaiting-rekey-reply + label ≠ noise_resp
                                               → decrypt K0 → emit {type:'message'}   ← AC1, AC3
        ▶ RELEASE the withheld noise_init
handleRekeyInit: swap K0 → K1
  send  ──── noise_resp (msg2) ──────────────▶ label = noise_resp → ReadMessage → Split
                                               → atomic swap → state = transport      ← AC2
  send  ──── noise_msg (resume, K1) ─────────▶ transport: decrypt K1 → message
        ◀─── noise_msg (app, K1) ───────────   sendMessage works under K1              ← AC2
```

Withholding the client's msg1 is the only way to open the window: the responder→client AEAD stream
is nonce-lockstep, so the interleaved frame cannot be sealed early and delivered late
(`noiseSession.test.ts:522-530`). It must be sealed **during** the window, which is why both harness
gates are in scope. The pattern already exists in the tree — `dropInitiatorFrames` at
`noiseSession.test.ts:592-603` and `holdInbound`/`deliverHeld` in `fakeDaemon.test.ts:176-188`. No
timers.

The AC4 test's plain-seal workaround (`:617-619`, `rekey_request` via `sendMessage` so the responder
stays in `transport`) is **not** an alternative: it leaves the responder unable to produce the
genuine reply AC2 needs. Weighed and rejected.

## State + concurrency model

Unchanged. The session is synchronous and single-threaded; no new async task, no timer, no
`AbortController`, no cancellation surface. `SessionState` gains no member — `awaiting-rekey-reply`
simply gains a second exit that is not an exit (it decrypts and stays). The state graph:

| From | Frame | To |
|---|---|---|
| `awaiting-rekey-reply` | reply, reads OK | `transport` (new ciphers) — unchanged |
| `awaiting-rekey-reply` | reply, read throws | `transport` (old ciphers) + `handshake-read-failed` — unchanged |
| `awaiting-rekey-reply` | labelled non-`noise_resp`, decrypts | `awaiting-rekey-reply` + `message` — **new** |
| `awaiting-rekey-reply` | labelled non-`noise_resp`, throws | `awaiting-rekey-reply` + `transport-decrypt-failed` — **new** |

Both new rows are self-loops: the one-shot handshake read is never consumed and `hs` is never freed
by them, which is exactly AC5's "does not consume the reply slot".

Cipher-state ownership is untouched: the swap remains the single atomic block at
`noiseSession.ts:270-286` (install both, then free both old), and the old `recvCipher` the window
path uses is the same live object `beginRekey` deliberately holds.

**Known, pre-existing, explicitly out of scope:** `sendMessage` is inert while
`state !== 'transport'` (`:311`), so a user message composed *during* the rekey window is silently
dropped. Real and worth a ticket; not this one. Do not fix it here.

## Error handling

| Failure | Layer | Result | Terminal? |
|---|---|---|---|
| Interleaved frame fails old-cipher AEAD | session, window path | `error{transport-decrypt-failed}` + content-free `noise-frame-failed` diagnostic | No — state and reply slot intact |
| Genuine reply malformed / wrong suite | session, reply path | `error{handshake-read-failed}`, old ciphers intact, `state = 'transport'` | No — unchanged from today |
| Inner frame fails to decode | driver `onMessage` | `error{inbound-frame-decode-failed}`, frame never reaches the session | No — unchanged |
| Missing label (buffered or legacy caller) | session | Treated as the reply — pre-#532 behaviour | Unchanged |

No new error reason is introduced. `NoiseSessionErrorReason` (`:67-70`) is unchanged, so
`RelaySessionErrorReason`'s superset relationship (`noiseRelayDriver.ts:213-215`) holds and the
renderer surfaces nothing new.

## Testing strategy

`npm test` (vitest) and `npm run typecheck` / `npm run build`. Scenarios, not test bodies.

### `noiseSession.test.ts` — unit, in the `rekey re-handshake` describe

Extend `pair()` (`:450-480`) with (a) label threading on the responder→client leg
(`sendFrame: (f, t) => initiator.onFrame(f, t)`) and (b) an opt-in gate that **captures** the
client's outbound frames into an array with a test-callable release, modelled on
`dropInitiatorFrames` at `:592-603` but capturing rather than dropping. Exact shape is the
developer's call; the capability is what matters.

1. **AC1 + AC2 + AC3 — interleaved app frame, then a real reply.** Open the window (withhold the
   client's rekey msg1); `responder.sendMessage(appBytes)`; assert exactly one `message` event whose
   plaintext equals `appBytes`, and **zero** error events of any reason. Release the msg1; assert the
   swap completes; assert a K1 round-trip in both directions (responder→client message decodes;
   `initiator.sendMessage` opens on the responder). Assert still zero errors and exactly one
   `rekey-requested`.
2. **AC5 — undecryptable non-reply in the window is non-terminal and preserves the reply slot.**
   Open the window; `initiator.onFrame(garbageBytes, 'noise_msg')`; assert exactly one
   `transport-decrypt-failed` and **no** `handshake-read-failed`. Then release the withheld msg1 and
   assert the genuine reply still completes the swap and a K1 round-trip succeeds.
3. **AC4 — the label, not the bytes, chooses the path.** Same setup, but feed the garbage labelled
   `'noise_resp'`: assert `handshake-read-failed` exactly once, `state` usable in `transport` on the
   old keys (a following K0-sealed responder message still surfaces). This is the routing mutation
   control — under a negative-on-`noise_msg` rule or a swapped comparison it fails.
4. **Regression, no edit:** `:494-519` (clean rekey, nothing interleaved) and `:584-636` (AC4's
   unlabelled-garbage guard) must stay green untouched. The second is the proof that the defaulted
   parameter preserves every legacy caller. **`src/main/daemonConnection.roundtrip.test.ts:335-350`
   must also stay green untouched** — it is the only test that drives a real rekey through the whole
   production stack (`daemonConnection` → `noiseRelayDriver` → `noiseSession` → real codec →
   forwarder), so it is the end-to-end proof that the driver's new label plumbing routes a genuine
   `noise_resp` reply to the reply path. If it goes red, the plumbing is wrong, not the test.

### `noiseRelayDriver.test.ts` — the label survives both delivery paths

5. **Live delivery.** `supervisor().emit({type:'message', frame: wrapInbound('noise_msg', raw)})`
   with a resolved session; assert the fake session recorded `('noise_msg', raw)`. Repeat with
   `'noise_resp'`. Requires `makeFakeSession.onFrame` (`:56-59`) to record the second argument —
   additive.
6. **`pending` replay.** Extend the existing buffering test (`:498-513`): the buffered frame's label
   must arrive at `onFrame` intact after `start()`, not `undefined`. Ordering assertion at `:511`
   unchanged.

### `fakeDaemon.test.ts` — end-to-end through the real codec and a real socket

7. **Thread the label in `deliverFrame`** (`:222-231`): `initiator.onFrame(base64StdDecode(data),
   inner.type)`. Without this the whole fake-daemon suite stays blind to the routing, and this line
   is also what makes `driveClient` faithful to the post-fix production driver.
8. **Interleaved-frame rekey, whole-array tag assertion.** A sibling of the clean-rekey test at
   `:423-483`: baseline handshake + K0 round-trip → `daemon.initiateRekey()` with `holdInbound()`
   armed so the client's msg1 is not what stalls — instead use the existing hold surface to open the
   window, `daemon.pushFrame(appEnvelope)` (now permitted by § 5), then release. Assert: the
   interleaved envelope surfaces as a `message`; the resume frame surfaces after the swap; a K1
   round-trip succeeds; `events.some(e => e.type === 'error')` is `false`;
   `daemon.whenSettled()` is `{ok:true}`; and `inboundTypes` matches the full expected sequence with
   `toEqual` — the ordered-equality oracle #525 established, which catches a handshake site
   regressing to `noise_msg` *and* a transport site wrongly becoming `noise_resp` in one assertion.

### Non-vacuity — run before opening the PR, and record the result in the PR body

- **Positive control:** scenarios 1, 2 and 8 must be **red** against unmodified `noiseSession.ts`
  (scenario 1 red with `handshake-read-failed`; that failure *is* the bug).
- **Mutation control on the crux line:** invert the routing predicate (make `noise_resp` route to
  transport and everything else to the reply path). Scenarios 1 and 3 must both die. A mutation that
  kills nothing means the label is not actually being read.
- **Mutation control on the label plumbing:** drop the second argument at
  `noiseRelayDriver.ts`'s live-delivery call site, and separately at the replay site. Scenarios 5, 6
  and 8 must catch each independently.

## Scope self-check

Production `.ts` files (excluding `*.test.ts`): **3** — `noiseSession.ts`, `noiseRelayDriver.ts`,
`fakeDaemon.ts`. Under the ≥5 gate. Test files: 3. New files: 0. New exported types: 0 (`onFrame`
gains an optional parameter; `NoiseSessionEvent`, `NoiseSessionErrorReason`, `SessionState`,
`RelaySessionEvent` and `InnerFrameV2` are all unchanged). New reject branches: 1. Consumer call
sites *forced* to change by the signature: **0** — the whole point of the defaulted parameter;
the ~5 sites that do change are chosen, not compelled. Projected total written work ~300 lines
(~65 production, ~230 test). Every red line clear.

## Open questions

1. **`pair()`'s withhold-and-release shape.** Spec fixes the capability (capture the client's
   outbound frames, release on demand), not the API. Take whichever reads closest to the existing
   `dropInitiatorFrames` idiom at `:592-603`.
2. **Scenario 8's window-opening mechanism.** `driveClient`'s `holdInbound`/`deliverHeld` gates the
   *inbound* direction, so opening the window there may be cleaner via the outbound side (delaying
   the client's msg1) or via ordering `pushFrame` against the hold gate. Both are available; pick
   whichever needs no new harness surface, and if neither does, prefer extending the existing gate
   over adding a second one. If it turns out to need genuinely new machinery, scenarios 1–3 already
   carry AC1/AC2/AC5 at the unit level — say so in the PR rather than growing the harness.
3. **`fakeDaemon`'s inbound `noise_resp` laxity.** The real daemon rejects an inbound `noise_resp`
   from a client (`v2session.go:669-676`); the fake still accepts one as an ordinary transport
   frame. Recorded as a pre-existing gap in `525.md` § Deferred and already noted for a PO
   follow-up. Out of scope here — this ticket reads the tag on the *client* side only.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings, and the boundary gets *narrower*, not wider. The
  untrusted→trusted boundary is still the single `noiseRelayDriver.onMessage` decode
  (`:266-288`), unchanged and fail-closed. What crosses it grows by one field: the inner-frame
  `type`, a `string` the relay could set to anything. That string is consumed at exactly one site,
  in exactly one state, by exactly one comparison against a module-private constant — it is never
  parsed, never concatenated, never indexed with, never logged, and never used to select a key. The
  session's own doc-comment must say so; the spec requires that comment (§ 4).
- **[Cryptographic primitives]** No findings. No new primitive, no new key, no new nonce, no new
  handshake. `noise-c.wasm` remains the sole implementation. The label cannot influence key
  selection: on the reply path the frame goes to `hs.ReadMessage` on the pinned static, on the
  window path to the already-installed `recvCipher`, and both objects existed before the frame
  arrived. **Nonce discipline is preserved in both directions**: the window path advances the old
  `recvCipher` counter exactly once per successfully-opened frame, which is the same counter the
  `transport` branch would have advanced for the same frame — the daemon's send stream stays
  lockstep with the client's receive stream, which is precisely what today's bug breaks. A failed
  open advances nothing (AEAD failure leaves the counter untouched), so a hostile injected frame
  cannot desync the stream. The atomic swap block (`:270-286`) is untouched.
- **[Threat model alignment / malicious relay]** Walked exhaustively; the residual is DoS-only, and
  strictly not worse than today. A hostile on-path relay can rewrite `type` on any frame. Three
  cases: **(a) a genuine reply relabelled non-`noise_resp`** → old-cipher decrypt MAC-fails →
  `transport-decrypt-failed`, non-terminal, client parked in `awaiting-rekey-reply` with the reply
  slot preserved; the rekey stalls and the daemon's 30 s reply timer eventually closes at 4426
  (pyrycode #450). **(b) an app frame relabelled `noise_resp`** → fed to `ReadMessage` → MAC-fails →
  `handshake-read-failed`, old ciphers intact, session usable in `transport` — *identical to today's
  behaviour for every frame*, so this case is strictly not a regression. **(c) a frame with a
  garbage/unknown label** → the gentler window-transport path (§ 2), non-terminal. In no case does
  the label produce a downgrade, a transport bypass, a plaintext leak, or a key/nonce reuse; it only
  picks which of two pre-existing rejections an already-doomed frame receives. A relay that can
  relabel can already drop and reorder, so it already had this DoS. This is the same argument
  `fakeDaemon.ts:415-425` records in the mirror direction; § 4 requires it be written on the client
  side too.
- **[Error messages, logs, telemetry]** No findings. The new reject path reuses `failWithFrame`
  (`:171-179`), whose Bucket-1 justification covers the interleaved frame verbatim: `frame` is
  pre-decryption AEAD ciphertext, never client plaintext and never a secret, and it is emitted
  capped-hex through the optional injected `DiagnosticLog`, never through `onEvent`. **The label
  itself is deliberately not logged** — it is relay-controlled attacker-typed data and would put an
  unbounded attacker string into a diagnostic sink; the static reason code already distinguishes the
  two paths, so logging it would add nothing. The error surfaced to the renderer is the existing
  static `transport-decrypt-failed` reason with no bytes attached. `NoiseSessionErrorReason` is
  unchanged, so no new string reaches the UI.
- **[Inter-process / Electron attack surface]** No findings. Entirely within `src/main/transport/`.
  No IPC channel added, no `contextBridge` surface, no `BrowserWindow` option, no new preload
  export. Keys, sockets and Noise state stay in the background process; the renderer's view is
  unchanged (same `RelaySessionEvent` union, same reason set). No renderer file is touched.
- **[Network & I/O — timeout discipline]** **OUT OF SCOPE, named because this change widens it.**
  The client has no timeout on `awaiting-rekey-reply`: nothing on the desktop side ever gives up on
  a rekey. Today the window is closed by the *next frame of any kind*; after this change a
  `noise_msg`-labelled frame no longer closes it, so the set of inputs under which the client stays
  parked grows — a hostile relay that relabels the genuine reply keeps the client waiting rather
  than erroring. The exposure is bounded and unchanged in the ways that matter: the daemon owns a
  30 s reply timer and closes at WS 4426 on expiry (pyrycode #450), which reaches the client as the
  existing `terminal{code}` teardown; and a relay that can relabel could already achieve the same
  park by simply dropping the reply, which is possible today. So this is not a new capability, only
  a second route to one the attacker already had. A client-side rekey-window deadline is a real
  hardening item and should be a PO follow-up ticket — it is a new timer with its own teardown
  semantics, well outside an S bug fix, and shipping one here would be exactly the unobserved-failure
  -mode defense the pipeline's evidence rule warns against.
- **[Network & I/O]** No further findings. No socket option, URL, timeout, `maxPayload`, TLS setting
  or reconnect policy is touched. The one bound in the blast radius, `MAX_PENDING_FRAMES = 8`
  (`noiseRelayDriver.ts:47`), still applies: the buffer element grows from a `Uint8Array` to
  `{raw, type}`, but the **count** cap is what bounds the flood vector and it is unchanged, and the
  added `type` string is itself bounded by the codec's frame-size limit. Memory per buffered frame
  rises by one already-allocated substring — not a new exhaustion vector.
- **[Concurrency]** No findings. No async task, timer, listener, or `AbortController` is added;
  `onFrame` remains synchronous with no `await`, so no check-then-act gap exists across the new
  branch. The new reject path is a self-loop that mutates nothing, which removes a state
  transition rather than adding one. Teardown is unchanged: `close()` still frees every wasm object
  and leaves every entry point inert, and the window path's first act is the existing
  `state === 'closed'` early return at `:233`.
- **[Tokens, secrets, credentials]** Not applicable by design, stated rather than skipped: no token
  or credential is read, written, compared or transported on any path this ticket touches. The one
  token in this module rides in handshake message 1 (`config.hello`), on the *outbound* side, which
  is untouched — and `failWithFrame` is still confined to the inbound catches for exactly that
  reason (`:166-170`).
- **[File / storage operations]** Not applicable by design: no filesystem access, no path
  construction, no `safeStorage` interaction, no persistence. The change is memory-resident within
  one session's lifetime.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
