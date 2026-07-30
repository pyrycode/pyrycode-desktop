# #533 — buffer outbound sends during the rekey window, flush after the swap

**Ticket:** [#533](https://github.com/pyrycode/pyrycode-desktop/issues/533) · **Size:** S · **Labels:** `bug`, `security-sensitive`
**Scope:** one production file — `src/main/transport/noiseSession.ts` — plus `src/main/transport/noiseSession.test.ts`.

## Design source

N/A — main-process transport only. This ticket adds no renderer surface and changes no rendered
output; the user-visible symptom it fixes (a timeline echo for an undelivered message) is repaired
entirely below `daemonConnection`. Visual-fidelity review is intentionally not applicable.

## Files to read first

Codegraph is not initialized for this repo (`codegraph_context` → *"CodeGraph not initialized"*), so
this list was assembled by grep + read. It is the developer's turn-1 data load — read these before
editing anything.

| Path + lines | What to extract |
|---|---|
| `src/main/transport/noiseSession.ts:1-39` | The module header's content-free discipline. Every rule there binds the code you add: no `console.*`, no plaintext in any diagnostic, caught library errors classified to a static reason and the error object never forwarded. |
| `src/main/transport/noiseSession.ts:73-84` | `NoiseSessionErrorReason` + `NoiseSessionEvent`. You add two members to the reason union; the event union is untouched. |
| `src/main/transport/noiseSession.ts:161-198` | The closure's mutable state (`sendCipher` / `recvCipher` / `state`), `freeAll`, `fail`, `failWithFrame`. The new buffer is a sibling of these; the new errors go out through `fail`, **not** `failWithFrame` (no inbound frame is involved). |
| `src/main/transport/noiseSession.ts:216-249` | `beginRekey`. Note the ordering comment at `:244-248` — `hs`/`state` are set **before** `sendFrame` precisely because a synchronous sink can re-enter. That hazard is the single most important constraint on this ticket's flush. |
| `src/main/transport/noiseSession.ts:318-347` | The reply path: the `catch` that returns to `transport` on old ciphers (`:323-330`), and the atomic swap (`:331-347`). These are the two exit points where the buffer is discarded / flushed. |
| `src/main/transport/noiseSession.ts:371-380` | `sendMessage` (the bug: a bare `state !== 'transport'` no-op) and `close()`. |
| `src/main/transport/noiseRelayDriver.ts:40-47` | `MAX_PENDING_FRAMES` — the exact shape to copy for the new bound: exported const, rationale written at the declaration, excess dropped fail-safe. Read the *divergence* note in this spec before copying its silence. |
| `src/main/transport/noiseRelayDriver.ts:53-57` | `RelaySessionErrorReason` is **defined as** `NoiseSessionErrorReason \| …`. This is the proof that a new session reason needs zero driver edits. Do not add the literal here. |
| `src/main/transport/noiseRelayDriver.ts:198-214` | The `firstFrame` / `rekeyInitPending` tagging latches. Read to confirm (not assume) that a post-swap flushed frame goes out as `noise_msg`. |
| `src/main/transport/noiseRelayDriver.ts:370-374` | `sendMessage` delegates straight through. No production change here. |
| `src/main/daemonConnection.ts:343-351`, `:438-443`, `:900-905` | `messageFor` (has a `default`), `emitFailed` (`retryable: false`), and the generic `case 'error'` forward. Read together: they are why a new reason propagates for free **and** why it lands as a terminal UI failure. |
| `src/main/transport/noiseSession.test.ts:457-535` | The `pair()` helper for the rekey describe block, including `holdInitiatorFrames` / `releaseInitiatorFrames`. Your AC 1/2 tests are built on it **unmodified**. |
| `src/main/transport/noiseSession.test.ts:627-679` | The `dropInitiatorFrames` failure-path test. Your AC 3 test clones this shape. |
| `src/main/transport/noiseSession.test.ts:690-778` | The three #532 window tests. They must stay green untouched — they are your regression baseline that the window's *inbound* behaviour is unchanged. |
| `docs/knowledge/codebase/532.md` | The predecessor. Read "What it does" for why an old-cipher frame arriving after the daemon's swap ends the session at WS 4421 — the fact that rules out the mirror-image fix. |

## Context

`noiseSession.sendMessage` no-ops in every state but `transport` (`noiseSession.ts:371-374`). During
an in-session rekey the session is parked in `awaiting-rekey-reply` for roughly one relay round-trip,
and every outbound send in that window is discarded with no queue, no retry, and no error. Nothing
above compensates: the driver delegates straight through, and all 22 of `daemonConnection`'s outbound
commands build an envelope, call `driver.sendMessage`, and `catch`-drop. A swallowed send is
indistinguishable from a delivered one at every layer, while `composerSend` posts the optimistic
`userText` echo regardless (`composerSend.ts:67`) — painting a message into the timeline that was
never delivered. A modal answer lost this way is worse: the daemon stays blocked on a prompt the user
already answered.

The window is invisible above the transport — `canSend` is true throughout, because the connection
genuinely *is* connected. So the fix has to live in the session.

## Design

### The shape is buffer-and-flush. Sealing under the old cipher is fatal, not lossy.

#532 fixed the *inbound* half by decrypting window frames under the still-live **old receive**
cipher. The symmetry is tempting and wrong. The client enters `awaiting-rekey-reply` only *after*
handing its own `noise_init` to `sendFrame` (`noiseSession.ts:244-248`), so every send issued in the
window is TCP-ordered **behind** that frame. The daemon swaps **both** ciphers and frees the old pair
the moment it processes `noise_init`. An old-cipher frame arriving afterwards fails the daemon's new
`recv` and takes its tampered-frame branch: `closeWith(4421)` plus session removal — the exact
consequence `docs/knowledge/codebase/532.md` records for the pre-fix desync. That is not a dropped
message; the session is gone.

So: hold the plaintext, seal it under the **new** send cipher once the swap lands.

**Hold plaintext, never a sealed frame.** This is the load-bearing half of the sentence above and the
single most important invariant in the ticket. A Noise `CipherState` is a per-direction nonce counter:
sealing at `sendMessage` time and queueing the ciphertext would burn nonce *n* immediately, and the
frames would then either go out under a cipher that is about to be freed, or leave a gap in the
counter the daemon's receive side cannot tolerate. It is the mirror of the hazard
`noiseSession.test.ts:564-573` documents in the responder direction, where holding one sealed frame
back desyncs the stream so thoroughly that the following `rekey_request` can no longer open. Buffering
plaintext keeps the send-nonce stream contiguous by construction: nothing is sealed until it is sent,
and every seal uses the cipher that is current at that instant.

### Buffer

A closure-local `Uint8Array[]`, a sibling of `sendCipher` / `recvCipher` / `state`. Nothing is
exported but the bound.

```ts
/** Cap on outbound plaintexts held while the session is parked in `awaiting-rekey-reply`. */
export const MAX_BUFFERED_SENDS = 8
```

Write the rationale at the declaration, the way `MAX_PENDING_FRAMES` does
(`noiseRelayDriver.ts:40-47`). It must say two things:

- **Why a bound exists at all.** Nothing on the client ever gives up on `awaiting-rekey-reply` — a
  client-side deadline was deferred by #532 and is not filed. The only backstop is the daemon's own
  30s reply timer closing at WS 4426. The window's worst-case lifetime is therefore a
  relay-controlled interval, and every send inside it accumulates **user plaintext in main-process
  memory**. The bound is a memory-residency limit on secret material, not tidiness.
- **The deliberate divergence from `MAX_PENDING_FRAMES`.** That buffer drops silently because a
  pre-session frame from a hostile relay is already anomalous garbage. Here the dropped item is the
  user's own message, so the drop must be observable (AC 2).

**Copy on buffer** — push `plaintext.slice()`, not the caller's reference. This is not defensive
padding; it repairs a contract the change would otherwise narrow silently. Today `sendMessage`
consumes its argument synchronously, so a caller may legally hand over a scratch buffer it intends to
reuse. Retaining the reference across a round-trip would make that legal caller a corruption bug with
no compile-time signal. One `slice()` on a rare path removes the class, and it means the buffer holds
bytes the session *owns* — which is what makes AC 4's "holds no plaintext" a statement about our own
memory rather than about someone else's array.

**On overflow, drop the incoming send — never evict the oldest.** Eviction would silently violate
AC 1's ordering guarantee and would discard the message the user considers longest-sent. Dropping the
incoming send keeps the error in 1:1 correspondence with the `sendMessage` call that failed. Matches
`MAX_PENDING_FRAMES`'s fail-safe push guard.

### `sendMessage` — three branches, one added

```ts
function sendMessage(plaintext: Uint8Array): void
```

Behaviour, in order:

1. `state === 'awaiting-rekey-reply'` → **new**: buffer a copy if under the bound; otherwise drop the
   send and `fail('rekey-send-buffer-full')`. Return either way.
2. Otherwise the existing guard `state !== 'transport' || sendCipher === null` → return, byte-for-byte
   unchanged. This is what pins AC 5: `idle`, `awaiting-handshake-reply`, and `closed` stay inert, and
   pre-handshake buffering is deliberately *not* added (no session exists — `sendCipher` is null until
   `Split` — and the composer gate is genuinely closed there, since `connected` is only emitted after
   `handshake-complete` is parsed).
3. `transport` → seal and send, unchanged.

### Flush — take the buffer, then drain through the same seal path

Flush runs at the end of the atomic swap (`noiseSession.ts:331-347`), **after** both cipher
assignments and after `state = 'transport'`, so the drained items seal under the new send cipher.

Two constraints, both re-entrancy:

- **Take, then drain.** Move the buffer into a local (`splice(0)` / swap in a fresh array) *before*
  iterating. `config.sendFrame` is a synchronous sink that can drive a reply straight back into
  `onFrame` — the same hazard `beginRekey` documents at `:244-248`, and the same discipline the test
  harness already uses at `noiseSession.test.ts:520`. Iterating the live array while a re-entrant
  call mutates it is the bug this avoids.
- **Drain through `sendMessage`, not a private seal.** Each drained item goes back through the same
  entry point, which re-reads the *live* `sendCipher` on every iteration. This is security-load-bearing,
  not tidiness, and a developer "simplifying" it into a private seal loop would reintroduce two real
  faults. First, a loop that captures a cipher reference before or during the swap can seal under
  `prevSend` — which the swap `free()`s at `:338-344`, making it a use-after-free on a wasm object,
  and a frame the daemon can only reject. Second, if a re-entrant frame opens a *second* rekey
  mid-flush, drain-through-`sendMessage` re-buffers the remaining items and flushes them after the
  second swap — still in issue order — where a captured-cipher loop would seal them under a cipher
  that is no longer current. Both properties fall out for free from reusing the entry point; a private
  loop would have to re-implement them correctly.

Ordering (AC 1) then holds without any extra machinery: the flush completes synchronously inside the
`onFrame` turn that performed the swap, so any send issued after the swap is necessarily issued after
`onFrame` returns, and therefore lands last.

**Frame tagging: verify, don't assume.** The driver tags an outbound frame `noise_init` when
`firstFrame || rekeyInitPending` (`noiseRelayDriver.ts:198-214`). Both latches are one-shot and
`rekeyInitPending` was consumed by the rekey msg1 itself, so a flushed frame goes out as `noise_msg`.
That is what keeps this a session-only change — and it is exactly the hazard `noiseSession.ts:307-314`
documents in the inbound direction, where a mis-armed latch would route an app frame into the daemon's
reconnect handler. Read the latch code and confirm it; do not take this paragraph's word for it.

### Discard — on rekey failure

At the reply-path `catch` (`noiseSession.ts:323-330`), the buffer is discarded and the loss surfaced
as `'rekey-send-abandoned'`.

**Why discard rather than re-send under the surviving old ciphers.** The client cannot distinguish
the two failure shapes. If its `noise_init` never reached the daemon, the daemon never swapped and old
ciphers are still valid there. If the daemon *did* swap and the reply was corrupted in transit, an
old-cipher send is the fatal 4421 case above. Both present identically as a failed `ReadMessage`, so
the only safe branch is the one that assumes the worst.

**Ordering inside the catch: discard before emitting.** `fail()` calls `config.onEvent`, a
synchronous consumer that can re-enter `sendMessage`. By that point `state` is back to `transport`, so
a re-entrant send seals normally — but the buffer must already be empty, or a stale item could be
flushed by some later window. Clear first, emit second. Emit only once per discard, regardless of how
many items were held: the reason is a static string and must never carry a count that correlates with
user activity.

The existing `hs = null` / `state = 'transport'` / `failWithFrame('handshake-read-failed', frame)`
sequence is otherwise untouched — AC 3's "the session remains usable on the old ciphers exactly as it
is today" is satisfied by *not editing* that code.

### Discard — on close

`close()` releases the buffer and emits nothing. AC 4 asks only that the buffer be released; an error
during ordinary teardown would be noise on every window close and on the 4426 path that is the
buffer's own worst-case terminator.

### Exit completeness

`awaiting-rekey-reply` has exactly three exits — the swap (`:346`), the reply-read failure (`:327`),
and `close()` (`:378`). Every other branch in that state returns without touching `state`. All three
are handled above, which is the whole of AC 4: the buffer holds no plaintext once flushed, discarded,
or closed, because there is no fourth way out.

## Error handling

Two new members on `NoiseSessionErrorReason` (`noiseSession.ts:73-77`):

| Reason | Raised when |
|---|---|
| `rekey-send-buffer-full` | A send arrived while the window buffer was at `MAX_BUFFERED_SENDS`. That one send was dropped; the buffered ones are unaffected. |
| `rekey-send-abandoned` | The rekey failed; every buffered plaintext was discarded unsent. |

**Zero fan-out — this is the whole propagation cost.** `RelaySessionErrorReason` is *defined as*
`NoiseSessionErrorReason | <three adapter reasons>` (`noiseRelayDriver.ts:53-57`), so the superset the
driver needs holds by construction. `daemonConnection` forwards `event.reason` generically
(`:900-905`) and `messageFor` has a `default` arm (`:343-351`). Grep confirms
`NoiseSessionErrorReason` has exactly one consumer in the tree — that type alias. **Do not duplicate
either literal into the driver**; an earlier draft of the ticket claimed a new reason "lands in both"
and that edit would itself be the bug.

**The automatic flow is accepted deliberately, including for overflow.** Both reasons reach
`case 'error'` → `emitFailed(reason)` → `{type:'failed', retryable:false}` (`:438-443`): a terminal,
non-retryable connection failure in the UI. For `rekey-send-abandoned` that is already the status quo
— the co-emitted `handshake-read-failed` fails the connection today regardless. For
`rekey-send-buffer-full` it means a full buffer tears down an otherwise-healthy connection, and the
ticket asks for that choice to be made rather than discovered. **Accept it. Do not add a softer
mapping.** Three reasons:

1. **Precedent.** `transport-decrypt-failed` is explicitly non-terminal at the session layer ("cipher
   survives; non-terminal", `:259`) and still produces `failed{retryable:false}` at the UI. The
   pipeline already treats a recoverable session-level anomaly as a hard UI failure. A new reason
   behaving identically is consistent with the existing model; a bespoke soft mapping would invent a
   second severity class that no existing reason has — an architecture change well beyond an S bug fix.
2. **Overflow is genuinely anomalous.** A healthy window is one relay round-trip. Nine sends inside it
   means the window is already stalled toward the daemon's 4426 timeout, i.e. the connection is
   heading for teardown anyway.
3. **Cost.** A soft mapping requires editing `daemonConnection` to special-case the reason, which
   trades this ticket's zero-fan-out property for a speculative benefit against a failure mode nobody
   has observed.

State this choice in the code comment at the reason declaration, so the next reader does not
re-litigate it.

**Content-free discipline.** Both errors go out through `fail()`, not `failWithFrame()` — there is no
inbound frame, and the only bytes in scope are user plaintext, which must never reach a diagnostic.
No count, no length, no envelope id in either reason. The `daemon-failed` diagnostic log gets the
static `code` only, exactly as it does today.

## State + concurrency model

No new async surface, no timers, no `AbortController`. Everything added is synchronous and lives
inside the existing closure; the session remains a pure crypto unit driven entirely by `onFrame` /
`sendMessage` / `close`. The only new invariants are the two re-entrancy disciplines above
(take-before-drain, clear-before-emit), both of which mirror rules the module already documents.

No client-side deadline on `awaiting-rekey-reply` is added — still deferred, still not filed. The
bound is what makes its absence survivable for this buffer.

## Testing strategy

`npm test` (vitest). All new work in the `rekey re-handshake + atomic cipher swap (#111)` describe
block (`noiseSession.test.ts:457-779`), built on the existing `pair()` helper **without modifying
it** — `holdInitiatorFrames` / `releaseInitiatorFrames` already park both peers in the window on live
old ciphers and drain in order, with no timers.

Confirm the harness reaches the flush before writing assertions: `releaseInitiatorFrames` clears the
hold flag *before* draining (`:518-521`), so a frame the flush emits mid-drain goes straight to the
responder rather than back into the held queue, and the responder has already swapped to K1 by then.

Scenarios (write the code in the file's idiom; these are the behaviours, not the source):

- **AC 1 — delivery and ordering.** Hold, `initiateRekey`, issue three distinct sends, release. The
  responder's collector shows all three `message` events with the right bytes in issue order, and a
  fourth send issued after release arrives last. Zero errors on both collectors.
- **AC 1 — positive control (run before the fix).** The same scenario against unmodified
  `noiseSession.ts` must show the responder receiving *zero* window messages. That failure is the bug;
  record it in the PR body.
- **AC 2 — bound.** Hold, `initiateRekey`, issue `MAX_BUFFERED_SENDS + 1` sends. Exactly one
  `rekey-send-buffer-full` error and no other error. After release the responder has exactly
  `MAX_BUFFERED_SENDS` messages, in issue order, and the overflow message is absent. Drive the count
  off the exported const, not a hard-coded 8.
- **AC 3 — rekey failure.** Clone the `dropInitiatorFrames` shape (`:627-679`) so the fresh msg1 is
  lost and the session parks in the window; issue a send; feed a garbage reply. Assert both
  `handshake-read-failed` and `rekey-send-abandoned` surface, the responder never receives the
  buffered plaintext, and — the AC 3 tail — a following K0-sealed responder message still opens,
  proving the old ciphers survived and the session is usable, not closed.
- **AC 4 — close releases.** Hold, `initiateRekey`, issue a send, `close()`. No error is emitted and
  no frame is sent by the close itself; a subsequent release drives no flushed frame to the responder,
  and every entry point stays inert. (Buffer emptiness is not directly observable across the module
  boundary — "no frame ever escapes after close" is the honest proxy, and it is the property that
  actually matters.)
- **AC 5 — inertness unchanged.** `sendMessage` in `idle`, in `awaiting-handshake-reply`, and after
  `close()` still emits no frame and no error, **and buffers nothing** — assert the negative by
  driving the session to `transport` afterwards and showing no deferred frame appears.

Regression baseline, untouched and green: the three #532 window tests (`:690-778`), the #111 swap and
old-key-death tests (`:537-625`), and `daemonConnection.roundtrip.test.ts` /
`noiseSession.interop.test.ts`.

**Non-vacuity controls to run and record in the PR body:** the AC 1 positive control above, plus a
mutation that inverts the new state predicate in `sendMessage` (buffer in `transport` instead of
`awaiting-rekey-reply`) — it must kill tests that *predate* this change, not only the new ones. Per
#532's lesson, a mutation that kills only new tests proves nothing about the rule's direction.

Type-level coverage: `npm run typecheck`. `npm run build` is the salvage gate.

## Open questions

1. **`MAX_BUFFERED_SENDS = 8`** mirrors `MAX_PENDING_FRAMES` for shape consistency and is comfortably
   above any plausible human send rate inside one relay round-trip. The developer may pick a different
   small constant if the tests argue for one; the value is not load-bearing, the bound's *existence*
   is. Whatever is chosen, the rationale goes at the declaration.
2. **A discarded send leaves `daemonConnection`'s reply-correlation state orphaned** — `nextEnvelopeId`
   is consumed, and an entry in `outstandingAnswers` / `pendingCreateFolders` will never resolve. This
   is pre-existing behaviour for *any* dropped send (the `catch`-drop shape at `:1015-1030` and its 21
   siblings) and is not in scope here; both new reasons reach `emitFailed`, which already runs the
   connection-teardown net. Named as a boundary, not a requirement — a PO follow-up if it ever bites.
3. **#510** (a modal answer clicked while *disconnected* is swallowed) is the same class of harm
   through a different door and is not fixed by this ticket.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The design adds no boundary. It changes the *retention* at an
  existing one: `sendMessage` receives plaintext originating in the untrusted renderer, and where it
  previously consumed that plaintext synchronously, it may now hold it across a relay round-trip. Two
  properties keep this closed. (a) The buffer holds a **copy** (`plaintext.slice()`), so the retained
  bytes are session-owned and no untrusted caller retains an alias into main-process state — this is
  why copy-on-buffer is specified as correctness rather than polish. (b) The plaintext is only ever
  *released* by sealing under a cipher pair derived from a fresh IK handshake against the **pinned**
  `remoteStaticPublicKey`. An attacker who cannot complete that handshake gets `handshake-read-failed`
  → discard, never a flush. So buffered plaintext can only reach a peer that has proved possession of
  the pinned daemon static — the buffer creates no disclosure path the pre-change code did not already
  have, it only stops discarding.
- **[Tokens, secrets, credentials]** No findings. No token, key, or credential is read, written, or
  routed. The buffer does hold secret-class material (user message bodies, modal answers), and its
  lifecycle is fully specified: created on a windowed send, destroyed at all three exits from
  `awaiting-rekey-reply` (swap / reply-read failure / `close()`), never serialised, never persisted,
  never crosses to the renderer. **Deliberate decision: the buffer is released by dropping the
  reference, not by zeroing.** JS offers no reliable zeroization — a moving GC may already have copied
  the array — so `.fill(0)` would be theatre, and zeroing a caller-owned array would be a contract
  violation (the copy makes the second point moot, the first still stands). This matches the module's
  existing model, where zeroization of key material is the wasm library's job via `free()`.
- **[File / storage operations]** N/A by construction. The change constructs no path, opens no
  descriptor, and writes nothing. The buffer is process memory that never leaves the closure.
- **[Inter-process / Electron attack surface]** No findings. No `contextBridge` API, no `ipcMain`
  channel, no `BrowserWindow` `webPreferences`, no protocol handler, no navigation surface is touched.
  Process placement is unchanged and correct: the buffer lives in `src/main/transport/`, holds only
  main-process memory, and no plaintext, cipher, or key becomes reachable from the renderer. The one
  new renderer-influenced control-flow edge — a compromised renderer can drive enough windowed sends
  to trip `rekey-send-buffer-full` and thereby tear down its own connection — is not an escalation: a
  renderer with IPC access to the daemon-connection API can already stop the transport directly.
- **[Cryptographic primitives]** No findings, and this is the category the design is built around.
  No primitive is added, chosen, or re-implemented; the vetted `noise-c.wasm` path is untouched.
  **Key/nonce reuse was the specific risk and is closed three ways.** (1) The buffer holds *plaintext,
  never sealed frames*, so no nonce is consumed until the frame is actually sent — the send-nonce
  stream stays contiguous by construction (see the Design section's note, and the mirror hazard at
  `noiseSession.test.ts:564-573`). (2) The flush runs strictly after both cipher assignments and after
  `state = 'transport'`, and drains through `sendMessage`, which re-reads the live `sendCipher` each
  iteration — so no item can be sealed under `prevSend`, which the swap `free()`s at `:338-344` (that
  would be both a use-after-free on a wasm object and a frame the daemon rejects). (3) Take-before-drain
  makes double-drain unrepresentable, so no plaintext is sealed twice. The whole point of rejecting the
  mirror-image fix is that sealing under the old send cipher after the daemon's swap is fatal
  (WS 4421 + session removal), not merely lossy.
- **[Network & I/O]** No findings. No socket, no TLS setting, no `maxPayload`, no timeout, and no
  reconnect policy is touched; all are inherited unchanged. Memory exhaustion from a hostile on-path
  relay holding the window open was the live question, and the arithmetic closes it: `encodeEnvelope`
  rejects an over-cap envelope at `codec.ts:114` against `MAX_PLAINTEXT_BYTES = 65519`
  (`shared/wire/types.ts:30`), and that check runs in `daemonConnection` **upstream** of
  `driver.sendMessage`. Every plaintext reaching the buffer is therefore already ≤ 65519 bytes, and
  the worst case is a deterministic `MAX_BUFFERED_SENDS × 65519` ≈ 512 KiB — bounded in bytes, not
  merely in count, without adding a second cap. A relay that holds the reply forever cannot grow it
  further; it can only trip the overflow error, which it could equivalently achieve by closing the
  socket.
- **[Error messages, logs, telemetry]** No findings. Both new reasons are static members of the closed
  `NoiseSessionErrorReason` union and are raised through `fail()`, never `failWithFrame()` — so no
  bytes, capped or otherwise, accompany them, which is correct because the only bytes in scope are
  user plaintext rather than the pre-decryption material Bucket 1 permits. The spec explicitly forbids
  carrying a buffered-item count in the reason or the diagnostic, since a count correlates with user
  activity in a log that is meant to be content-free. Downstream, `messageFor` has a `default` arm
  (`daemonConnection.ts:343-351`) so the user-facing banner is the existing generic string, and
  `emitFailed` shadows only the static `code` to the diagnostic log (`:438-443`).
- **[Concurrency]** No findings. Nothing async, no timer, no listener, no `AbortController`, no
  `await` — therefore no check-then-act race and no cancellation surface. The entire concurrency story
  is the two synchronous re-entrancy disciplines, both mirroring rules the module already documents
  (`beginRekey`'s set-state-before-`sendFrame` ordering at `:244-248`): take-before-drain on flush, and
  clear-before-emit on discard, the latter because `fail()` invokes a consumer that can re-enter
  `sendMessage` while `state` is already back to `transport`. Shutdown safety is AC 4 — `close()`
  releases the buffer, which is what terminates residency on the daemon's 4426 path.
- **[Threat model alignment]** No findings; each applicable desktop threat is addressed above.
  *Malicious/compromised relay* — bounded memory (512 KiB), no plaintext leak, no new hang, and no
  ability to make the client seal under a dead cipher. *Hostile daemon* — can fail the rekey, which
  reaches the discard path: plaintext dropped unsent, loss surfaced, session left usable on the old
  ciphers; it cannot coax a flush without completing an IK handshake against the pinned static.
  *Renderer compromise reaching the transport* — unchanged, no new reach to keys or socket.
  *Token theft from disk* — N/A, nothing persisted.
- **[Concurrency / Network]** **OUT OF SCOPE** — a client-side deadline on `awaiting-rekey-reply` is
  still unbuilt. Nothing on the desktop side gives up on a stalled rekey; the only backstop is the
  daemon's own 30s reply timer closing at WS 4426. #532's security review named this and it was
  recorded as carried-forward in `docs/knowledge/codebase/532.md` but **has not been filed as a
  ticket**. This spec's bound is what makes its absence survivable for the buffer specifically — the
  residency window stays relay-controlled, but the memory does not. **PO should file it**; it is
  genuine hardening and is deliberately not this S bug fix's job.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
