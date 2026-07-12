# Spec #311 — fakeRoutingRelay close-only-envelope test: absorb the dial-time HTTP-upgrade parse race

**Ticket:** #311 · **Size:** XS (test-only) · **Labels:** `bug`, `size:xs`, `security-sensitive`

One-line: the failing test flakes because a raw client/server dial can throw an HTTP-upgrade
`Parse Error` **before** the socket opens, under parallel-worker CPU contention. The test file's own
`connect()` retry ladder already re-dials past three sibling pre-open transients; it just doesn't
classify this fourth one. The fix is a single added clause in `isTransientDialError` — **test-only,
no production change, no touch to the behaviour under test.**

## Files to read first

- `src/main/transport/fakeRoutingRelay.test.ts:18-48` — the `connect()` retry ladder + the
  `isTransientDialError(err)` classifier. **This is the sole edit site.** Extract: how the three
  existing transients (`ECONNRESET` / `ECONNREFUSED` / `socket hang up`) are matched, and that
  `onDialError` is attached with `ws.once('error', …)` and **removed on `'open'`** (line 43–44) — so
  the classifier is only ever consulted for *pre-open* errors.
- `src/main/transport/fakeRoutingRelay.test.ts:194-209` — the failing test
  `closes a client with no prior frame on a close-only envelope`. Extract: the two **teeth** that
  must stay byte-identical — `expect(await closed).toBe(4408)` and `expect(gotFrame).toBe(false)`.
- `src/main/transport/fakeRoutingRelay.ts:1-22` — the module's content-blindness / log-free /
  token-non-leak header contract. The fix **must not touch this file at all**; verifying it is
  untouched is part of the security check below.
- (context only, do NOT port) QMD `pyrycode-docs` specs `371-fakerelay-waitbinary.md` and
  `789-fakerelay-waitbinary-gate.md` — the Go `WaitBinary` barrier precedent the ticket cites. Read
  to understand **why the barrier does not apply here** (§ Root-cause confirmation). Do not add a
  barrier.

## Context

`fakeRoutingRelay.test.ts` → `startFakeRoutingRelay — server → client unwrap + close_code (AC3)` →
`closes a client with no prior frame on a close-only envelope` fails intermittently with
`Error: Parse Error: Expected HTTP/, RTSP/ or ICE/`. It flakes **only** under full `npm test`
(parallel workers); it is 10/10 clean single-file on both `main`@`24c713c` and PR #310. QA
established the transport is byte-identical between `main` and `feature/278`, so the flake is
pre-existing — PR #310 (renderer-only) merely surfaced it by running the full suite.

`fakeRoutingRelay.ts` / `.test.ts` are **test-only** relay infrastructure (the routing counterpart to
`fakeRelayForwarder.ts`, introduced in #251). The test file already carries an inline transient-dial
retry ladder — `connect()` / `isTransientDialError()`, added for the #104 pre-open-reset race — that
re-dials past `ECONNRESET` / `ECONNREFUSED` / `socket hang up`. It does **not** yet recognise the
HTTP-upgrade `Parse Error`.

**Scope guard:** the sibling `fakeRelayForwarder.test.ts` carries a twin `connect()` helper and has
its own still-live flake (desktop memory "Flaky fakeRelayForwarder socket-hang-up"). That is a
**separate ticket** — do **not** edit `fakeRelayForwarder.test.ts` here.

## Root-cause confirmation (why retry, not a barrier)

The ticket rightly warns against defaulting to the cheaper retry edit and points at the Go project's
`WaitBinary` barrier fix for the same-sounding "full-suite-only fakerelay flake." I confirmed the
root cause and the two are **different-layer** problems; the barrier does not apply.

| | Go `#371`/`#789` (barrier fix) | Desktop `#311` (this fix) |
|---|---|---|
| What the dial does | **Succeeds** — `websocket.Accept` returns `101`, client unblocks | **Fails** — HTTP-upgrade `Parse Error` throws *before* `'open'` |
| Where the race is | **Application state**: server-side `s.binaries[id]` map not yet populated post-Accept, so a *dependent* dial reads stale state → `503` | **Transport / HTTP-upgrade**: the upgrade response is malformed under CPU starvation; the WS never opens |
| Correct remedy | Barrier (`WaitBinary`) that waits for server-side registration before the dependent dial | Re-dial a **fresh** socket; a bounded retry clears the momentary contention |
| Why the other remedy is wrong there | A retry would re-dial a connection that **already succeeded** | A barrier can't wait for a connection that **never establishes** — there is nothing registered to poll for |

Crucially, the desktop already ships the barrier the Go tickets added: **`whenReady()`** (gates on
`serverLeg !== null && clients.size > 0` before any dependent send). The choreography layer is
already correct and is orthogonal to this flake. The remaining failure is one layer down, at dial
establishment, where even the *first* dial — with nothing to wait for — can lose the upgrade race.
Retry is the only remedy that operates at that layer, and it is exactly the mechanism the existing
ladder already implements for its three siblings. This is not "widening a retry list to paper over a
logic bug"; the `Parse Error` is a fourth member of the same pre-open dial-establishment family.

The only dial surface in the failing test is `serverLeg()` / `clientLeg()` → `connect()`;
`learnConnId()` and the `server.send(...)` assertions all run post-`'open'` on already-established
sockets. So the classifier is the single, systemic seam — fixing it once covers this test, the other
AC3 test, and every other test that dials, exactly as the three existing codes already do.

## Design

Extend `isTransientDialError` in `fakeRoutingRelay.test.ts` with one clause recognising the
HTTP-upgrade parse-error family. Contract (this ~1-line change is the whole fix):

```ts
function isTransientDialError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code
  return (
    code === 'ECONNRESET' ||
    code === 'ECONNREFUSED' ||
    /socket hang up/i.test(err.message) ||
    /Parse Error/i.test(err.message) // pre-open HTTP-upgrade parse race under full-suite CPU load
  )
}
```

- **Match on the message, family-style, not the full exact string.** Mirror the existing
  `/socket hang up/i` idiom. `Parse Error:` is llhttp's stable error prefix; matching the family (not
  the version-specific reason text `Expected HTTP/, RTSP/ or ICE/`) is robust across Node versions.
  Evidence-based scope: this is the one message observed in the failure — do not also add speculative
  matches for unobserved parser codes (`HPE_*`) or broaden beyond the `Parse Error` family.
- **No change to the ladder mechanics.** Attempt count (`5`), the `20`ms backoff, the
  `ws.terminate()`-before-redial, and the fresh-socket re-dial are all proven by the three existing
  codes. Touch only the classifier. Do not tune retry counts or delays — that is unrequested scope.

### Why this is teeth-preserving (AC2 + AC3)

- `onDialError` is detached on `'open'` (`ws.off('error', onDialError)`, line 43). The classifier is
  therefore **only** consulted for pre-open errors — it structurally cannot reclassify a post-open
  behavioural error. The behaviour under test (`4408` close, `gotFrame === false`) is exercised
  post-`'open'`, in `onServerMessage`. A genuine relay-teardown or close-code regression manifests
  there and still fails the test unchanged.
- The retry is **bounded** (5 attempts). A dial failure that is genuinely persistent (a real "relay
  refuses connections" regression) exhausts the ladder and still `reject`s — so that class of real
  failure also still surfaces.

Net: the fix moves only pre-open dial classification; the `4408` and `gotFrame === false` assertions
stay byte-identical.

## State + concurrency model

No new state. The `connect()` recursion already carries `attemptsLeft` and drops the half-open socket
(`ws.terminate()`) before each re-dial, so no socket leaks across retries. The added clause changes
only which errors route into the existing (already correct) re-dial path vs. `reject`. No timers,
stores, or async iterables are introduced.

## Error handling

- **Transient (now including `Parse Error`)** → `ws.terminate()`, wait 20ms, re-dial a fresh socket,
  `attemptsLeft − 1`.
- **Non-transient, or attempts exhausted** → `reject(err)` unchanged. Real establishment failures and
  persistent faults still propagate.
- **Post-open errors** → swallowed by the `ws.on('error', () => {})` handler installed at `'open'`
  (line 44), never seen by the classifier. Unchanged.

## Testing strategy

- **No new test.** The change is a reliability fix to shared test-harness plumbing; adding a unit
  test for "a parse error is classified transient" would require synthesising the race, which the
  ticket's own AC frames as verify-by-repeated-full-suite-run, not by isolated assertion.
- **Verification (AC1, AC4):** run the **full** suite repeatedly — the flake never reproduces
  single-file. Suggested: `npm test` several times back-to-back (e.g. 5–10 runs) and confirm zero
  `Parse Error: Expected HTTP/…` (or equivalent dial-time) failures in the AC3 close-only case. Then
  `npm run build` (typecheck) must pass. Record the run count in the PR.
- **Teeth check (AC2, AC3):** diff the failing test body — the `4408` and `gotFrame === false`
  assertions must be untouched. Confirm `git diff` shows changes to `isTransientDialError` **only**,
  and that `fakeRoutingRelay.ts` and `fakeRelayForwarder.test.ts` are **not** in the diff.

## Open questions

None blocking. If a future Node upgrade changes the llhttp error text away from the `Parse Error:`
prefix, the `/Parse Error/i` match would need revisiting — but that is a hypothetical, not an
observed failure, so no defense is shipped for it now (evidence-based fix selection).

## Security review

**Verdict:** PASS

Adversarial re-read of the one-clause change to `isTransientDialError` (test-file `connect()`
harness). The invariants this `security-sensitive` module guards are the relay *simulator*'s
**content-blindness** and **token-non-leak**. The change is a boolean predicate over a Node-generated
error string; `src/main/transport/fakeRoutingRelay.ts` (the actual relay data path) is not modified.

**Findings:**

- **[Trust boundaries]** No findings — the added clause reads `err.message` of a WebSocket *dial*
  error (a Node/`ws`/llhttp-internal string produced during a loopback upgrade), not any frame
  payload, disk content, or renderer IPC. It crosses only into a `boolean` retry-vs-reject decision.
  No trusted state is derived from relay-origin or attacker-controlled bytes.
- **[Tokens, secrets, credentials]** No findings — the only credential in this module is the client's
  `x-pyrycode-token`, which flows through `onClientMessage`/`encodeRoutingEnvelope` in the untouched
  production file. The classifier never references the token, and adds no logging of it.
- **[File / storage operations]** N/A — the change touches no filesystem path, no `fs` call, no
  path construction. It is a string-regex over an in-memory error.
- **[Inter-process / Electron attack surface]** N/A — test-only harness executed under vitest/Node.
  No `BrowserWindow`, `webPreferences`, `contextBridge`, `ipcMain`, or custom-protocol surface is
  touched or introduced.
- **[Cryptographic primitives]** N/A — no RNG, no Noise handshake, no key/nonce handling, no secret
  comparison. No `Math.random()` and no `===`-on-secret patterns are added.
- **[Network & I/O]** No findings — the retry the clause feeds remains **bounded** (5 attempts) and
  leak-free (`ws.terminate()` drops the half-open socket before each re-dial), so classifying
  `Parse Error` as transient adds no unbounded-retry or socket-exhaustion vector. No `maxPayload`,
  timeout, or TLS setting is touched; this is a `ws://127.0.0.1` loopback test dial, not the
  production `wss://` relay client.
- **[Error messages, logs, telemetry]** No findings — no `console.*` is added. On retry-exhaustion
  the pre-existing `reject(err)` surfaces the error to the test runner unchanged (acceptable for test
  infra); no token, key, or Noise transcript passes through the classifier. The AC5 `is log-free …
  never logging the token` test remains the deterministic guard.
- **[Concurrency]** No findings — no new async task, timer, listener, or shared state. The classifier
  is consulted strictly pre-`'open'` (`onDialError` is `ws.off()`-detached at `'open'`, line 43–44),
  so it cannot re-enter on post-open errors; the retry structure is otherwise unchanged.
- **[Threat model alignment]** No findings — the change is test-only and never runs in production, so
  it does not touch the malicious-relay, token-theft, hostile-daemon, or renderer-compromise surfaces.
  The simulator's content-blind + log-free contract is preserved by construction: the production
  module `fakeRoutingRelay.ts` is byte-identical and no logging is introduced.

No MUST FIX findings.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-12
