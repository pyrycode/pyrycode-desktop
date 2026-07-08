# #168 — Debug-bundle download: the typed IPC command/event contract + renderer tolerance

**Size:** S (confirmed — 3 production files, ~70 lines total, 4 new exported members; no edit fan-out)

## Context

The transport half of the debug-bundle download already exists on `main`: the bare request frame is sent (#115), streamed chunks are reassembled into the archive and handed to an injected `BundleConsumer` (#116), and the archive is written collision-safe to the downloads directory (#117). What is missing is the **typed IPC contract** that lets the renderer *trigger* the download and lets the main process report *progress* and the *terminal result* back to the window.

This slice ships only that contract — **inert but fully typed**. Nothing emits the new events yet, and the command is an unhandled no-op: `src/main/index.ts:206`'s `onCommand` switch has no `default` arm (verified), so an unmatched `requestDebugBundle` falls through harmlessly. The orchestrator that wires request → reassemble → save → emit is a separate slice that depends on this one (#169). Shipping the contract first keeps the seam small and lets both `npm run typecheck` and `npm run build` pass standalone.

Split from #118. This is the standalone contract child (A); #169 is the orchestrator child (B, blocked-by this one). The download button + progress UI is #72 (a separate, UI-visible ticket). **This slice touches no user-visible surface** — it is a store-layer bridge change only.

## Files to read first

- `src/shared/ipc/commands.ts` (whole file, 73 lines) — the `RendererCommand` union, `isRendererCommand` guard, the file-header + docblock comments that go stale. The new bare member and its guard case land here.
- `src/shared/ipc/events.ts` (whole file, 38 lines) — the `DaemonEvent` union and the two comments that go stale. The three new members + `DebugBundleFailure` export land here.
- `src/renderer/src/store/daemonEventBridge.ts` (whole file, 64 lines) — `translateDaemonEvent` (the **only** exhaustive `DaemonEvent` consumer, `assertNever` at line 45) and `useDaemonEventBridge` (line 57, the sole production caller — dispatches unconditionally at line 60). Both change here.
- `src/renderer/src/store/sessionStore.ts:40-51` — the `SessionAction` union; confirm the three new events map to **no** action arm (they return `null`, not a new `SessionAction` member — so `SessionAction` exhaustiveness stays intact).
- `src/main/index.ts:199-213` — the `onCommand` switch; confirm it is non-exhaustive (no `default`), so `requestDebugBundle` is a safe dropped no-op and this slice does **not** touch it (#169 does).
- `src/preload/index.ts:23-25` and `:77-81` — `sendCommand` (generic over `RendererCommand`) and `onDaemonEvent` (generic over `DaemonEvent`); confirm **no preload change** is needed — the bare command rides the existing `sendCommand`, the results ride the existing `onDaemonEvent`.
- `src/main/transport/bundleReassembler.ts:28-49` — the transport's finer `BundleFailReason` (5 values) + save errno; this is the source set that #169 maps onto the coarse `DebugBundleFailure` (3 values). **Read for context only** — the mapping is #169's job, not this slice's.
- `src/shared/ipc/commands.test.ts`, `src/shared/ipc/events.test.ts`, `src/renderer/src/store/daemonEventBridge.test.ts` — existing test precedents to **extend in place**, not recreate. Note `daemonEventBridge.test.ts` currently dispatches `translateDaemonEvent(...)` directly into the store — the return-type widening (below) forces a touch-up at all six existing call sites.
- `docs/knowledge/features/command-channel.md`, `daemon-event-channel.md`, `daemon-event-bridge.md` — the design intent behind these three files; the touched-up comments should stay consistent with them.
- `docs/knowledge/decisions/0004-renderer-session-store-reducer-wire-types.md` and `0007-content-free-diagnostics-by-construction.md` — the store-reducer contract and the secret-free-by-construction philosophy this contract embodies.

## Design

Three production files change. No new file, no new IPC channel, no new preload method.

### 1. `src/shared/ipc/commands.ts` — the bare command member

Add one **bare** member to `RendererCommand` (no payload — the bundle is daemon-global, nothing to parameterise):

```ts
export type RendererCommand =
  | { type: 'sendMessage'; payload: SendMessagePayload }
  | { type: 'requestDebugBundle' }
```

Add the matching runtime-guard case to `isRendererCommand` — literally `case 'requestDebugBundle': return true` (no payload to validate; structural-minimum acceptance, consistent with the existing `sendMessage` arm accepting extra harmless fields).

**Comment touch-ups (light, semantic — do not just tack on):** two claims go stale once a payload-free member exists.
- File-header (lines 10–13): the "every member reuses a wire payload type … verbatim" claim is now false for the bare member. Revise to note one member is payload-free. The invariant that *actually* matters is unchanged and must remain stated: **never a token, key, or raw frame** — the bare member reuses no wire type, so there is nothing to leak.
- `RendererCommand` docblock (lines 24–33): "First (and, per #17, only) member" and "Carries ONLY wire payload types" are now stale. Revise to describe a two-member union where the second is bare, preserving the secret-free-by-construction statement.

### 2. `src/shared/ipc/events.ts` — the three result members + the failure enum

Add three members to `DaemonEvent` and export the coarse failure enum:

```ts
export type DebugBundleFailure = 'unavailable' | 'stream-corrupt' | 'write-failed'

export type DaemonEvent =
  | /* …existing six… */
  | { type: 'debugBundleProgress'; chunksReceived: number }
  | { type: 'debugBundleSaved'; path: string }
  | { type: 'debugBundleFailed'; reason: DebugBundleFailure }
```

Each new member carries a count / a local filesystem path / a local category enum — **never** a token, key, raw frame, or bundle bytes. `DebugBundleFailure` is the user-facing category set only; #169 owns mapping the transport's `BundleFailReason` (5 values) + any save errno onto these three — that mapping is **out of scope here**; this slice only declares the enum.

**Comment touch-ups (light, semantic):**
- File-header (lines 4–8): the "reuses a wire payload … verbatim" claim is now false for the three new members. Revise; keep the real invariant stated — **never a token, key, raw frame, or bundle bytes**.
- `DaemonEvent` docblock (lines 19–30): "exactly one member per SessionAction arm … no gaps and no spares" is now stale — the three new members map to **no** `SessionAction` (they are consumed by the download UI #72, not the session store). Revise to state that the transport-lifecycle/message members map 1:1 onto `SessionAction` while the debug-bundle members map to none.

### 3. `src/renderer/src/store/daemonEventBridge.ts` — renderer tolerance

`translateDaemonEvent` is the only exhaustive `DaemonEvent` consumer (the `assertNever` default arm makes any unhandled variant a compile error). Adding three `DaemonEvent` members therefore fails `npm run typecheck` until the switch handles them.

- Widen the return type: `translateDaemonEvent(event: DaemonEvent): SessionAction | null`.
- Add three cases for `debugBundleProgress` / `debugBundleSaved` / `debugBundleFailed`, each `return null` (they produce no session-store action — they are consumed by #72's download UI, not the session store). Grouped fall-through or individual cases both fine.
- **Keep the `default: return assertNever(event)` arm** so a *future* variant is still a compile error. This is the load-bearing invariant of the change — do not weaken it.
- Update `useDaemonEventBridge` (line 59–61) to skip the dispatch on `null` (it currently dispatches unconditionally):

  ```ts
  const off = window.pyry.onDaemonEvent((event) => {
    const action = translateDaemonEvent(event)
    if (action) sessionStore.getState().dispatch(action)
  })
  ```

- Update the `translateDaemonEvent` docblock (lines 16–22): the "total by construction, maps to a SessionAction" framing now needs to note the three debug-bundle arms return `null` (no action) while the `assertNever` guard stays.

**Forced consequence — flag it before you start.** Widening the return type to `SessionAction | null` breaks the **six existing call sites** in `daemonEventBridge.test.ts` (lines 27, 33, 43, 49, 64, 72), which do `store.getState().dispatch(translateDaemonEvent(...))` — `dispatch` accepts `SessionAction`, not `SessionAction | null`, so all six stop type-checking. These six events are statically known to map to an action, so append a non-null assertion (`translateDaemonEvent(...)!`) at each site, or thread them through a small `dispatchIfAction` helper (see Testing strategy). This is a within-one-file, mechanical six-site touch-up — expect the typecheck break, don't hunt for a deeper cause.

### What does NOT change

- **`src/preload/index.ts`** — no change. `sendCommand` is generic over `RendererCommand`; `onDaemonEvent` is generic over `DaemonEvent`. Both new surfaces ride the existing channels.
- **`src/main/index.ts`** — no change. The `onCommand` switch is non-exhaustive; the unhandled `requestDebugBundle` is a safe no-op. Wiring it up is #169.
- **`src/main/emitDaemonEvent.ts` / `daemonConnection.ts` / `receiveCommand.ts`** — no change. They *construct* or *accept* the unions but never switch over them exhaustively, so additive members don't force a change.
- **`App.tsx` / `PairingScreen.tsx` / `composerSend.ts` / `sessionStore.ts`** — no change. They call the bridge hook or hold their own unrelated `assertNever` switches (none over `DaemonEvent`); `SessionAction` gains no arm, so `sessionStore`'s exhaustiveness stays intact.

## State + concurrency model

None. This slice adds **inert type declarations and one pure-function tolerance change**. No store slice is added, no async task is launched, no stream is consumed, nothing is emitted. The `useDaemonEventBridge` subscription lifecycle (mount/unmount teardown) is unchanged — only the per-event dispatch decision gains a `null` skip. The three new events have no producer until #169.

## Error handling

- `DebugBundleFailure` is a **coarse, closed** three-value enum by design — the user-facing categories only. It carries no transport-internal detail; #169 collapses the finer `BundleFailReason` + save errno onto it, which is a deliberate information-minimisation boundary (the renderer never learns transport internals).
- No runtime failure path exists in this slice — the contract is inert. `translateDaemonEvent` returning `null` for the three new events is not an error branch; it is the defined "no session-store action" outcome.

## Testing strategy

Extend the three existing test files **in place** (vitest, `npm test`). Scenarios, not full bodies:

**`src/shared/ipc/commands.test.ts`:**
- `isRendererCommand({ type: 'requestDebugBundle' })` → `true` (bare, no payload).
- (Optional, cheap type-lock) a `const c: RendererCommand = { type: 'requestDebugBundle' }` assignment — compile-time proof the bare member is part of the union and thus reachable through the generic `sendCommand`; no new preload method exists to test.

**`src/shared/ipc/events.test.ts`:**
- Currently pins only the channel constant (`events.ts` has no runtime behaviour). Add compile-time shape locks: a `const` typed as `DaemonEvent` for each of the three new members (`{ type: 'debugBundleProgress', chunksReceived: 0 }`, `{ type: 'debugBundleSaved', path: '/x' }`, `{ type: 'debugBundleFailed', reason: 'unavailable' }`), plus a value sample per `DebugBundleFailure` literal. These are no-ops at runtime but fail `npm run typecheck` if the shape drifts. Keep it minimal.

**`src/renderer/src/store/daemonEventBridge.test.ts`:**
- For each of the three new events, `translateDaemonEvent(event)` returns `null` — the pure contract that guarantees the bridge dispatches nothing.
- Belt-and-suspenders (mirrors production): a fresh store, feed each new event through a `null`-guarded dispatch (the same skip the bridge applies), assert `status` and `messages` equal `initialSessionState` — i.e. the three new events dispatch **nothing** into the session store.
- The six existing events (`connecting` / `connected` / `disconnected` / `failed` / `messageReceived` / `messagesReceived`) still map to their session actions unchanged (existing tests already assert this — update their `dispatch(translateDaemonEvent(...))` call sites for the widened return type per the forced-consequence note above; a small local `dispatchIfAction(store, action)` helper keeps all nine tests uniform and mirrors the bridge's real null-skip).
- **Do not** add a React-rendering test for `useDaemonEventBridge` — the hook is untested React wiring by precedent (see the module docblock and `PairingScreen.tsx:168`); the `null`-skip is fully covered by the pure-function `toBeNull()` assertions.

Gates: `npm run typecheck` and `npm run build` (the QA/salvage gate) both pass with the contract inert — nothing emits the events, the command is an unhandled no-op.

## Design source

N/A — store-layer IPC contract, no user-visible surface. The download button and progress UI (visual design) land in #72; the ticket body explicitly scopes all UI out of this slice.

## Open questions

- **`events.test.ts` extent.** `events.ts` is pure types + a const, so there is no runtime behaviour to assert beyond the channel pin. The compile-time shape locks above honour "extend the precedent in place" and give a real drift guard; if the developer judges them redundant with `daemonEventBridge.test.ts`'s coverage, leaving `events.test.ts` at just the channel pin is acceptable. Not a gate.
- **`dispatchIfAction` helper vs. inline `!`.** Either satisfies the forced six-site touch-up. The helper is marginally more code but mirrors the bridge's real behaviour and keeps the nine tests uniform; inline `!` is the smaller diff. Developer's call — no correctness difference.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — the `requestDebugBundle` command crosses the untrusted renderer→main boundary through the single pre-existing gate (`receiveCommand.ts:34` applies `isRendererCommand` before anything downstream sees the command). The bare member has no payload, so `case 'requestDebugBundle': return true` is complete validation with zero injection surface; a structurally-extra `payload` smuggled onto the command is inert (the `onCommand` switch no-ops it, and #169's handler is bare). This slice adds no new boundary and no new event-side producer.
- **[Tokens, secrets, credentials]** N/A by construction — no token/key/credential is generated, stored, logged, or compared. The whole point of keeping the contract in `commands.ts`/`events.ts` is that no union member exposes a field on which a developer could serialize a secret. The bare command reuses no wire type; the three events carry a count / a local path / a closed enum.
- **[File / storage operations]** No findings for this slice — it writes nothing to disk. `debugBundleSaved.path` is a `string` *type declaration*, not populated here (#117 save + #169 orchestrator populate it from `app.getPath('downloads')`); path-traversal / TOCTOU / atomic-write live in those merged/separate slices.
- **[Inter-process / Electron attack surface]** No findings — **no new IPC channel, no new preload method, no `webPreferences` change**. The command rides the existing `sendCommand`/`COMMAND_CHANNEL`; results ride the existing `onDaemonEvent`/`DAEMON_EVENT_CHANNEL`. The renderer gains exactly one parameterless, daemon-global capability (trigger a bundle download); a compromised renderer reaches no key, token, socket, or path through it. Strength worth naming: bundle **bytes never cross into the renderer** — only a chunk count and the saved path do — so the archive stays in the main process.
- **[Cryptographic primitives]** N/A — no RNG, hashing, key handling, or Noise code in this slice.
- **[Network & I/O]** N/A — no socket, no WebSocket, no frame handling; the request-frame send (#115), relay socket, and `maxPayload` are upstream and unchanged.
- **[Error messages, logs, telemetry]** No findings — this slice emits and logs nothing at runtime (inert contract). `DebugBundleFailure` is a **closed** three-value enum by design, carrying no transport-internal detail, stack trace, or secret. Hand-off to #169: when it populates `debugBundleSaved.path`, the path is a local FS string that may include the username — it must flow through the content-free-diagnostics discipline (decision 0007 / #134) if logged, not verbatim into a shared log.
- **[Concurrency]** N/A — no async task, timer, listener, or shared-state mutation added. `useDaemonEventBridge`'s subscription lifecycle is unchanged; the only new logic is a pure, synchronous `null`-skip on dispatch.
- **[Threat model alignment]** No findings — hostile-daemon string injection into the renderer is **structurally prevented**: `debugBundleFailed.reason` is a closed `DebugBundleFailure` union, so a raw daemon `error` string (a `string`) cannot be assigned to it; #169 must map the transport's `BundleFailReason` + save errno onto the three coarse categories (out of scope here, but the type enforces the minimisation boundary). Malicious/compromised relay and token-theft-from-disk are irrelevant to this wire-free, storage-free slice.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-08
