# #505 — Extend the debug-bundle teardown net to `relay-link-down` and `dial()`

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/505
**Size:** S (1 production file, ~14 production lines, 0 new files, 0 new exports, 0 consumer call sites)
**Labels:** `bug`, `size:s`, `security-sensitive`
**Anchors verified at:** `92aacbf` (the ticket body was written against `3ab9c46`; all `daemonConnection.ts` anchors below re-verified — see § Anchor re-verification)

## Design source

N/A — main-process only. There is no `## Figma` section in the ticket body and none is needed: the fix adds no renderer surface. `debugBundleFailed` is an existing `DaemonEvent` already consumed by `src/renderer/src/screens/conversation/logDataDownload.ts`; this ticket only makes it actually fire on two teardown paths where it currently doesn't. The visual-fidelity check is intentionally skipped.

## Files to read first

| Path | What to extract |
|---|---|
| `src/main/daemonConnection.ts:407-412` | The `reassembler` slot declaration + its stated lifetime contract ("`null` before/between requests; a settled reassembler stays referenced but inert … until the next request replaces it"). This spec adds "…or until a connection teardown releases it." |
| `src/main/daemonConnection.ts:437-442` | `emitFailed` — the small module-local helper the new `failBundleStream()` sits beside (insert the new helper immediately after this one, before `onDriverEvent` at `:445`). |
| `src/main/daemonConnection.ts:842-874` | The four driver-event lifecycle arms: `relay-link-up` (`:842`), `relay-link-down` (`:848-857`, **edit site 1**), `terminal` (`:859-868`, **edit site 2**), `error` (`:869-874`, **edit site 3**). Read the `terminal` arm's two-line pattern (`:862`) — it is the shape being cloned. |
| `src/main/daemonConnection.ts:964-973` | The generation fence inside the `onEvent` closure (`:970`). This is *why* `dial()` needs its own fail site: a superseded driver's `terminal{1000}` never reaches `onDriverEvent`. |
| `src/main/daemonConnection.ts:1413-1436` | `requestDebugBundle` — the `driver === null` → `fail('not-connected')` guard (AC4's second clause) and the arm-before-send ordering (`:1424`). |
| `src/main/daemonConnection.ts:1440-1473` | `dial()` — the `++generation` (`:1441`) / `driver?.stop()` (`:1446`) ordering and the sibling per-connection resets at `:1455-1464` (**edit site 4** goes with them, before the `connecting` emit at `:1468`). |
| `src/main/daemonConnection.ts:520-535` | The daemon `error`-reply arm's `reassembler?.fail('daemon-error')` (`:529`). **Deliberately not touched** — see § Decisions. |
| `src/main/transport/bundleReassembler.ts:64-105` | The `settled` flag. This is what already guarantees "exactly one terminal"; the new code must not re-implement it. |
| `src/main/debugBundleDownload.ts:72-115` | The `active` single-in-flight flag and its three clear sites. This is the state that wedges; the composed tests below drive the real orchestrator so the wedge is actually observable. |
| `src/main/daemonConnection.test.ts:363-382` | `makeBundleConsumer()` — the spy consumer (`completed` / `failed` / `progress` arrays). |
| `src/main/daemonConnection.test.ts:3553-3567` | The bundle `describe` block header + its local `connected()` helper (`build()` → `start()` → `tick()` → `handshake-complete`). New tests go in this block. |
| `src/main/daemonConnection.test.ts:3715-3736` | The two existing mid-stream interruption tests (`terminal`, `error`) — the exact shape the two new interruption tests clone. |
| `src/main/daemonConnection.test.ts:482-507` | The existing `relay-link-down` classification tests. AC1's "otherwise unchanged" is **already covered here** — do not duplicate them. |
| `src/main/daemonConnection.test.ts:900-930` | The `reconnect()` test idiom (`reconnect()` → `await tick()` → `drivers[1].emit(handshake-complete)`). |
| `docs/knowledge/codebase/116.md:39` | "A teardown net belongs at the connection-lifecycle boundary, not inside the accumulator" — the framing this change extends. |
| `docs/knowledge/codebase/169.md:36` | The superseded belief this ticket corrects. Read it so you don't re-derive "already handled." |

## Context

An armed `bundleReassembler` settles its consumer only via chunk / done / fail — it has no timeout. Two connection-teardown paths reach the consumer's `fail` on no path at all:

1. **`relay-link-down` (`:847-857`)** emits `relayLinkChanged` and returns. Unlike `terminal` (`:862`) and `error` (`:871`) it never fails the reassembler. A retryable close is stream-fatal anyway: the supervisor re-dials into a fresh Noise session with no resume, so the daemon-side request dies and the remaining chunks never arrive.
2. **`dial()`** bumps `generation` (`:1441`) *before* `driver?.stop()` (`:1446`), so the superseded driver's `terminal{1000}` is dropped by the fence at `:970` and `:862`'s fail never runs. `dial()` resets `outstandingAnswers` / `pendingSettings` / `pendingCreateFolders` (`:1458-1467`) but not the reassembler slot. Both live triggers are `connection.reconnect()` at the composition root: `onPaired` (`index.ts:243`) and `onUnpaired` (`index.ts:364`).

Either way the consumer built by `createDebugBundleDownload` never gets a terminal, so the orchestrator's `active` flag (`debugBundleDownload.ts:83`, cleared only at `:94-108`) stays `true` and `:79` silently short-circuits every later `requestDebugBundle` for the rest of the process lifetime. One process-lifetime orchestrator sits behind the command.

`stop()` is **already covered** and needs no fourth fail site: it sets `stopped = true` then `driver?.stop()`; that terminal is *not* fenced (`stop()` does not bump `generation`), so `:862` fails the consumer before the `if (stopped) return` on the next line.

## Design

### The one new seam: a module-local teardown helper

Add one parameterless helper inside `createDaemonConnection`, immediately after `emitFailed` (`:443`), before `onDriverEvent`:

```ts
/** The connection-teardown net for an in-flight bundle stream (#116, extended #505). */
function failBundleStream(): void
```

**Behaviour:** release the slot first, then fail what was released with `'connection-lost'`. Three lines: read `reassembler` into a local, set `reassembler = null`, call `local?.fail('connection-lost')`.

Two properties come out of that ordering, and both are load-bearing:

- **Release-then-fail, not fail-then-release.** `consumer.fail` runs synchronously inside this call. Clearing the field *before* handing control to the consumer means the module holds no reference to a stream it has already abandoned at the moment untrusted-adjacent code runs, and it means a future consumer that re-entered `requestDebugBundle` could not have its freshly-armed slot nulled out from under it. (It cannot re-enter today — see § Error handling — but the safe ordering costs nothing.)
- **Idempotent and total.** `fail()` on an already-settled reassembler is inert (`bundleReassembler.ts:99-103`); `?.` on a null slot is inert. Calling it twice, or with nothing armed, is a no-op. This is what makes AC3 fall out for free rather than needing a guard.

Nulling the slot is **byte-release hygiene, not terminal correctness** — `settled` already provides the terminal guarantee. Nulling additionally drops the abandoned stream's accumulated decrypted chunk bytes, which today stay referenced until the next request replaces the slot. See § Testing for why this property must **not** get a test.

### Edit sites (four calls, one helper)

| Site | Change | Ordering constraint |
|---|---|---|
| `relay-link-down` arm (`:848-857`) | Call `failBundleStream()` as the arm's first statement, **before** `const status = …` / the `relayLinkChanged` emit. | Mirrors the `terminal` arm (fail, then emit). AC1's "otherwise unchanged" holds: the close-code classification, the `{ type, status }` payload, and the raw-code drop are all downstream of the inserted line and are not modified. |
| `terminal` arm (`:862`) | Replace `reassembler?.fail('connection-lost')` with `failBundleStream()`. | Same position, same order relative to `if (stopped) return`. Behaviour-identical apart from the slot release. |
| `error` arm (`:871`) | Replace `reassembler?.fail('connection-lost')` with `failBundleStream()`. | Same position, before `emitFailed(event.reason)`. |
| `dial()` (`:1455-1467`) | Call `failBundleStream()` alongside the sibling per-connection resets — after `pendingCreateFolders.clear()` (`:1464`), before the `connecting` emit (`:1468`). | Must be in `dial()` itself, **not** relied upon via `driver?.stop()`: `gen = ++generation` at `:1441` already fenced that terminal. `driver = null` (`:1447`) has already run at this point, which is what makes AC4's second clause exact — a request issued in the synchronous continuation sees `driver === null` and fails `not-connected`. |

The `dial()` call comes with a comment in the register of its three siblings: a reconnect abandons the in-flight bundle stream, whose daemon-side request does not survive the fresh Noise session, so the consumer is failed here rather than waiting for a terminal the generation fence will drop.

### Decisions

- **The daemon `error`-reply arm (`:529`) keeps its inline `reassembler?.fail('daemon-error')` and is not converted.** `failBundleStream()` encodes *the connection-lifecycle teardown net* — one reason, one meaning, matching `116.md:39`. `:529` is a protocol-reply path with its own branchy skip logic, and converting it would mean parameterising the helper and editing adjacent code the ticket does not require (CLAUDE.md: "Don't refactor adjacent code while you are there"). The asymmetry is deliberate; code-review should read it as a decision, not an oversight.
- **No timeout.** Out of scope per the ticket and per #169's security review: a never-terminating or slow-dribble daemon stream is a transport-layer read/idle-deadline problem, not an orchestrator or accumulator guess. No such hang has been observed.
- **No new types, no interface change, no renderer change.** The helper is module-local; `BundleFailReason`, `BundleConsumer`, `DaemonEvent` are all untouched.

## State + concurrency model

`reassembler` remains a single module-local slot with a single writer. Every mutation runs to completion inside one synchronous body (`requestDebugBundle`, an `onDriverEvent` arm, or `dial()`), with no `await` between a read and a write — the same single-writer rationale already documented for `nextEnvelopeId` and `outstandingAnswers`. `failBundleStream()` adds a fourth synchronous writer under the same discipline.

Its lifetime contract becomes: `null` before the first request, between requests, **and after any connection teardown**; non-null only while a request's stream is live or has settled but not yet been released.

## Error handling

- **Re-entrancy.** `consumer.fail` in production is `debugBundleDownload`'s `fail` → `emit(...)` → `emitDaemonEvent(live.sink, …)` → `webContents.send`, which is asynchronous IPC. It cannot synchronously re-enter `daemonConnection`. The release-then-fail ordering means the module would still be consistent if that ever changed.
- **Destroyed window.** `emitDaemonEvent` already guards `isDestroyed()` (#518/#519). A teardown that fires while the window is closed drops the IPC and does not throw; the reassembler is still settled and released, so the transport does not wedge.
- **Double terminal.** Impossible by construction: `settled` (`bundleReassembler.ts:72`) plus the nulled slot. A `terminal` / `error` / daemon `error` reply arriving after a link-down or re-dial reaches either a null slot or a settled one; a straggler chunk hits the same no-op and produces no `progress` tick.
- **`failBundleStream()` throwing.** It cannot: `?.` handles the null case and `fail()` is a pure state flip plus one consumer call. If a *consumer* threw, it would propagate out of `onDriverEvent` / `dial()` — but that is pre-existing at `:862` / `:871` and the real consumer's `fail` is one `emit` call. Not addressed here.

## Testing strategy

`npm test` (vitest), all in `src/main/daemonConnection.test.ts`. **Every new test must fail on current `main`** — state which assertion is the one that flips, and verify by stashing the production change.

### Direct-consumer tests — add to the existing `requestDebugBundle` describe (`:3553`), beside the two interruption tests at `:3715-3736`

1. **`relay-link-down` mid-stream fails the consumer `connection-lost` and still emits the classified link status.** Arrange via the block's `connected()`; `requestDebugBundle(consumer)`; emit one chunk; emit `{ type: 'relay-link-down', code: 1006 }`. Assert `failed === ['connection-lost']`, `completed === []`, **and** that a `relayLinkChanged{ status: 'offline' }` with exactly `{ type, status }` reached the sink. *Fails on main:* `failed` is `[]`. The second assertion is the AC1 "otherwise unchanged" guard riding along in the same test — do **not** add a standalone classification test, `:482-507` already owns that.
2. **A straggler chunk after a link-down is absorbed, and a later `terminal` adds no second terminal.** Emit chunk `seq 0`; emit `relay-link-down`; assert `failed` is *already* `['connection-lost']` and record `progress.length`; then emit chunk `seq 1` and a `terminal`; assert `progress.length` is unchanged and `failed` is still length 1. *Fails on main:* on main the mid-test assertion sees `failed === []`, and the straggler chunk is **accepted** so `progress` grows. Asserting the fail lands *at the link-down* is what makes this non-vacuous — a bare end-state "exactly one fail" assertion passes on main, because main's later `terminal` supplies that one fail.
3. **`reconnect()` mid-stream fails the consumer `connection-lost`, with the superseded terminal fenced.** `requestDebugBundle(consumer)`; emit one chunk; `connection.reconnect()`. Assert `failed === ['connection-lost']` **synchronously, before `await tick()`** — that ordering is the AC2 "must not depend on a later event from the new driver" clause. Then `await tick()`, `drivers[1].emit(handshake-complete)`, and assert `failed` is still length 1. *Fails on main:* `failed` is `[]` at the synchronous assertion and stays `[]` after.

### Composed-orchestrator tests — a new describe, after the bundle block

These are the only tests that can observe the wedge, because the `active` flag lives in `debugBundleDownload`, not in the reassembler. A test that drives the reassembler's consumer directly cannot distinguish "wedged" from "fine" — the same vacuity trap as #519's sink test. Wire the **real** `createDebugBundleDownload` over the **real** `connection.requestDebugBundle`:

- deps: `requestDebugBundle: (c) => connection.requestDebugBundle(c)`, `save: vi.fn()` (never reached), `emit: (e) => events.push(e)`.

4. **Link-down path unwedges the orchestrator.** `download.request()`; emit a chunk; emit `relay-link-down`; assert `events` contains `debugBundleFailed{ reason: 'unavailable' }`; then `download.request()` again and assert `drivers[0].sent` has **two** `request_debug_bundle` envelopes. *Fails on main:* one envelope — the second `request()` is short-circuited by the stuck `active`.
5. **Re-dial path unwedges the orchestrator, on the new driver.** `download.request()`; emit a chunk; `connection.reconnect()`; `await tick()`; `drivers[1].emit(handshake-complete)`; `download.request()`; assert `drivers[1].sent` has one `request_debug_bundle`. *Fails on main:* `drivers[1].sent` is empty.
6. **AC4's second clause — a request before the new handshake completes fails `not-connected` rather than wedging.** `download.request()`; emit a chunk; `connection.reconnect()`; **without** `await tick()`, call `download.request()` again. Assert the count of `debugBundleFailed` events in `events` is **2** — one from the re-dial teardown, one from the `not-connected` guard (both carry `reason: 'unavailable'`, the coarse category `not-connected` collapses to per `debugBundleDownload.ts:51-63`) — and that no new envelope was sent on `drivers[0]`. *Fails on main:* the count is **0** — the first consumer is never failed, so `active` stays true and the second `request()` is short-circuited before it can reach the guard. The `without await tick()` matters: `dial()` sets `driver = null` (`:1447`) and bootstrap only reassigns it a microtask later, so this is the window where the existing `driver === null` guard is exact. See § Open questions 1 for the window it does **not** cover.

### Do not write

- **"A later download's archive contains only its own bytes."** Vacuous — it passes on `main` unchanged, because `requestDebugBundle` (`:1424`) already replaces the slot on every request. Slot-nulling is byte-release hygiene and is **not observable from a unit test**.
- A standalone `relay-link-down` classification test (already `:482-507`).
- A `stop()` teardown test (already covered by the existing `terminal` path).

`npm run typecheck` covers the type surface; the helper introduces no new types.

## Concurrent-work check

`git fetch origin --prune` then a branch-level overlap scan over `origin/feature/*` found one overlap: **`origin/feature/491-run-config-read`** (open PR #500) touches both `src/main/daemonConnection.ts` and `src/main/daemonConnection.test.ts`.

**Judged non-blocking; no `blockedBy` set.** Evidence:

- `git merge-tree --write-tree origin/main origin/feature/491-run-config-read` → **CLEAN** against current `main`.
- #491 is additive-only (+46 / −0 in `daemonConnection.ts`, +93 / −0 in the test file) and adds a `requestSessionSettings` verb plus a `session-settings` inbound arm. In *its own* file its insertions sit at lines 34, 164, 574, 1043, 1525; this ticket's edit sites sit at 856 (`relay-link-down`) and 1466-1490 (`dial`). Nearest neighbour is ~35 lines — far outside git's 3-line merge context.
- No semantic intersection: #491 touches neither the reassembler slot, nor the driver-event lifecycle arms, nor `dial()`'s reset list.

Same call, same evidence standard as #519's `index.ts` overlap with this branch (7 lines apart, merged clean in PR #522). Code-review should re-run `git merge main` and confirm.

## Anchor re-verification

Re-verified at `92aacbf` (ticket body written against `3ab9c46`). All `daemonConnection.ts` anchors in the body **hold**: `:848-857` `relay-link-down`, `:862` `terminal` fail, `:871` `error` fail, `:970` gen fence, `:1441` `++generation`, `:1446` `driver?.stop()`, `:1455-1464` sibling resets, `:1424` slot arm. `debugBundleDownload.ts:79/83/94-108` hold. `index.ts:243,364` hold. `daemonConnection.test.ts:3715,3727` hold. This repo has a documented history of anchor drift — re-verify before relying on any of them.

## Open questions

1. **A third, adjacent wedge exists and is deliberately NOT fixed here.** `requestDebugBundle` (`:1417`) gates only on `driver === null`. After `dial()`'s bootstrap microtask resolves — and after a `terminal` / `error` — the driver is non-null but **not live**: the reassembler arms, `driver.sendMessage` is silently inert pre-handshake / post-terminal (`noiseRelayDriver.ts:229`), and nothing ever settles the consumer. The orchestrator wedges exactly as it does today. This is reachable from this ticket's own scenario (the user retries the download while the reconnect handshake is still in flight). It is **not** covered by any AC here and the fix is not two lines: it needs a driver-liveness flag set at `handshake-complete` (after the ack parses) and cleared at `dial()`, `terminal`, `error`, and the `malformed-hello-ack` path — a new sub-state-machine across ~6 sites with its own test matrix. The `send` twin's documented "no `connected` flag needed" rationale explicitly does not transfer, because a dropped `send` is harmless whereas a dropped bundle request strands a consumer. **Flagged to PO for its own ticket**; a comment is on #505.
2. **Ordering of `debugBundleFailed` vs `relayLinkChanged` at the window.** This spec emits the bundle failure first (cloning the `terminal` arm). The two land in independent renderer stores (`logDataDownload.ts` and the connection-status surface) with no ordering dependency, so either order is correct. Fixed here only for consistency.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. The change adds no boundary and moves none. The one untrusted input in the touched region — the WS close code on `relay-link-down` — is classified at the existing single choke point (`:855`), and `failBundleStream()` is inserted *above* that line without reading `event.code`. The failure reason it passes is the static literal `'connection-lost'`, a member of the closed `BundleFailReason` set; no wire value, close code, or daemon byte is interpolated into it. The raw close code still never crosses IPC.
- **[Tokens, secrets, credentials]** Not applicable, and verified rather than assumed: neither edit site reads the paired record, the token, or key material. `dial()`'s reset block runs before `bootstrap(gen)` and therefore before `loadDialConfig()` is called on the new dial, so no credential is in scope at the inserted line.
- **[File / storage operations]** Not applicable. No path is constructed, read, or written. `debugBundleDownload`'s `save` is reached only from `complete`, and every path this ticket adds ends in `fail`.
- **[Inter-process / Electron attack surface]** No findings. No new IPC channel, no `contextBridge` addition, no `webPreferences` change. The one IPC consequence is that an *existing* `DaemonEvent` (`debugBundleFailed`, already in the union and already consumed by `logDataDownload.ts`) now fires on two more paths, carrying its existing coarse category enum and nothing else. Two amplification vectors were checked, both bounded: a hostile renderer spamming the download command is still short-circuited by the orchestrator's `active` flag; a hostile relay flooding `relay-link-down` frames emits at most **one** extra IPC message per armed stream, because the first teardown nulls the slot and every subsequent one hits `?.` on `null`. Nulling makes that bound structural rather than dependent on the reassembler's `settled` flag.
- **[Side channels]** Checked and clear: `failBundleStream()` takes no arguments and is inserted *above* the close-code classification at `:855`, so the emitted event is byte-identical for a `4404` (`daemon-absent`) and a `1006` (`offline`) close. The new event's presence therefore discloses nothing about the close code to the renderer, and discloses nothing to the relay that it did not already cause.
- **[Cryptographic primitives]** Not applicable. No RNG, no hashing, no key handling, no Noise state touched. `failBundleStream()` in `dial()` runs before the fresh session is built and does not observe or mutate any handshake state; the generation fence, not this code, remains what isolates a superseded session's events.
- **[Network & I/O]** Deliberate non-finding, stated rather than skipped: this change adds no timeout, and that is the correct call. A never-terminating or dribbling daemon stream needs a per-message read/idle deadline at the transport layer — #169's security review already ruled on this, and no such hang has been observed. Guessing a deadline in the accumulator or the orchestrator would be a defense against an unobserved failure mode and would sit at the wrong layer. Named as out of scope, unchanged from #169.
- **[Error messages, logs, telemetry]** No findings. `failBundleStream()` is log-free, consistent with `bundleReassembler.ts` and `debugBundleDownload.ts`, both of which are log-free *by construction* because they hold decrypted bundle bytes. The `relay-link-down` arm's existing no-log stance is preserved (#127 already logs the close code content-free at `relayConnection.ts`). The user-visible outcome is the pre-existing coarse `unavailable` category — no errno, no close code, no byte count beyond the already-specified chunk count.
- **[Concurrency]** Three points walked, all resolved in the design rather than deferred. (a) *Re-entrancy:* `consumer.fail` runs synchronously inside `failBundleStream()`, and in `dial()` that is mid-way through a per-connection reset sequence. Traced the real consumer to `webContents.send` — asynchronous IPC, so no synchronous re-entry into `daemonConnection` is possible today. The release-then-fail ordering is specified so the invariant survives even if that changed, at zero cost. (b) *A throw on the `dial()` path:* if the consumer's emit threw, `dial()` would abort before `emitDaemonEvent(sink, { type: 'connecting' })` (`:1468`) and before `void bootstrap(gen)` — the connection would never dial. Checked rather than assumed: `emitDaemonEvent` (`src/main/emitDaemonEvent.ts:43-46`) guards `isDestroyed()` then calls `send` synchronously, so there is no check-then-use gap, and `categoryFor('connection-lost')` (`debugBundleDownload.ts:51-63`) is a total switch with no reachable `assertNever`. The inserted call sits on the same synchronous path as the pre-existing `connecting` emit and carries **identical** throw exposure — no new exposure is introduced. (c) *Check-then-act:* `reassembler` has a single writer and every mutation completes inside one synchronous body with no `await` between read and write, matching the documented `nextEnvelopeId` / `outstandingAnswers` discipline. No new async task, timer, listener, or `AbortController` is introduced, so there is nothing new to cancel on teardown.
- **[Threat model alignment]** **Malicious / compromised relay** — directly improved, and this is the security substance of the ticket. An on-path relay can drop or delay at will; today a well-timed retryable drop mid-bundle permanently disables the diagnostics feature for the process lifetime, which is a denial-of-service on the user's ability to *diagnose the relay's own misbehaviour*, achievable by a content-blind attacker with a single close frame. This change removes that. **Renderer compromise reaching the transport** — unchanged; the reassembler, the bytes, and the socket stay in the main process, and the renderer's only new observation is one more coarse category enum. **Hostile daemon response** — `seq` / `total` validation is untouched, and per-frame size is capped by `maxPayload` at `relayConnection.ts:123`. **Named OUT OF SCOPE:** `bundleReassembler.ts` applies no cap to the *total* accumulated archive size, so a hostile in-session daemon could stream unbounded capped frames and exhaust main-process memory. Pre-existing, not introduced or worsened here (this change strictly reduces retention), and the right fix is a total-bytes ceiling in the accumulator plus the transport read-deadline already deferred by #169. Flagged to PO alongside the § Open questions 1 follow-up. **Retention:** releasing the slot means an abandoned stream's decrypted bundle bytes are dropped at teardown instead of being held until the next request — a real reduction in main-process retention of sensitive plaintext, and the reason this ticket is `security-sensitive` rather than a plain bug fix.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
