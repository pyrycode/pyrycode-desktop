# #518 — Guard every main-process reach into a destroyed BrowserWindow

**Size:** S (3 production files, 5 test files, ~280 LOC total). **Security-sensitive:** yes — review pass at the end.
**Split from** #503. **Sibling:** #519 (live-window holder) is `blocked_by` this ticket.

## Design source

N/A — main-process defensive guard. There is no visible change while a window is alive (AC5 makes that
an explicit invariant), so there is nothing to reproduce from Figma. Code-review's visual-fidelity
check is intentionally skipped.

## Files to read first

Codegraph is not initialized for this repo (`codegraph_context` errors with "CodeGraph not initialized"),
so this list was built by grep + Read against `main` at `8c0d013`. Every anchor below was re-read during
this pass.

| Path | What to extract |
|---|---|
| `src/main/emitDaemonEvent.ts:9-25` | The whole module. `DaemonEventSink` (`:15-17`) and the one-line body (`:24`) are the primary edit. |
| `src/main/emitDaemonEvent.test.ts:6-10` | `fakeSink()` — the fixture factory that gains the new member. |
| `src/main/fireNotification.ts:55-93` | `fireNotification`'s `deps` shape (`:57-61`), `ActivatableWindow` (`:75-80`), `activateWindow` (`:89-93`). |
| `src/main/fireNotification.test.ts:34-46` | `fakeWindow(isMinimized)` — the one `ActivatableWindow` fixture. |
| `src/main/index.ts:174` | `const mainWindow = createWindow()` — the single window binding every guarded site closes over. |
| `src/main/index.ts:356-373` | The `notify` closure. `:366` focus query, `:369` activation, `:370` already-covered emit. |
| `src/main/index.ts:188-195`, `:231-236` | `sink: mainWindow` at construction; `emit: (event) => emitDaemonEvent(mainWindow, event)`. |
| `src/main/index.ts:393-395` | `window-all-closed` quits only on non-darwin — why this guard is a macOS-only path. |
| `src/main/daemonConnection.ts:101-102` | `sink: DaemonEventSink` field. **No production edit here** — see "Fan-out" below. |
| `src/main/daemonConnection.test.ts:111-118` | `fakeSink()` + the `emitted(sink)` reader. One factory serves ~30 assertions. |
| `src/main/daemonConnection.test.ts:178-188` | `tick()` and `reachConnected()` — the harness the AC2 regression test builds on. |
| `src/main/daemonConnection.test.ts:666-672` | `'drops a malformed inbound frame … and emit() does not throw'` — **copy this shape** for AC2. |
| `src/main/daemonConnection.roundtrip.test.ts:201-210`, `:883-892` | The two hand-written sink literals (real `send` methods, not `vi.fn()`). |
| `src/main/debugBundleDownload.ts:72-114` | The `active` flag and the three terminal sites (`:94-95`, `:99-100`, `:106-107`). **Read-only — no edit.** |
| `src/main/debugBundleDownload.test.ts:38-54` | `setup(overrides?: Partial<DebugBundleDownloadDeps>)` — the seam AC4's test uses to inject a real `emit`. |
| `src/main/transport/relayConnection.ts:194-197` | The un-try/caught `config.onEvent` call. Read to confirm **no edit belongs here**. |
| `src/main/transport/noiseRelayDriver.ts:97` | The "must not throw" sink contract this ticket makes true rather than defends against. |
| `docs/specs/architecture/18-typed-daemon-event-channel.md:109`, `:149` | The two recorded deferrals this ticket closes. Historical spec — **do not edit it.** |

## Context

On macOS, closing the window destroys the `BrowserWindow` but leaves the app and the daemon connection
running (`index.ts:393-395` quits only on non-darwin; the connection stops on `will-quit`, `index.ts:223`).
The connection captured the window as its event sink at construction (`index.ts:191`), so it keeps emitting
into a destroyed object. `emitDaemonEvent` does a bare `sink.webContents.send` (`emitDaemonEvent.ts:24`),
and on a destroyed window **the `webContents` accessor itself throws** `Object has been destroyed` — before
`send` is ever reached. Nothing catches it: `relayConnection.ts:194-197` invokes the event callback inside
the ws `message` handler with no try/catch, and `noiseRelayDriver.ts:97` documents its sink as "must not
throw" rather than defending against it. The next daemon event after the window closes becomes an uncaught
main-process exception.

Two sites reach the window outside the emitter: the `notify` focus query (`index.ts:366`) and the
notification-click activation (`index.ts:369` → `activateWindow`'s `isMinimized`/`restore`/`show`/`focus`).

`docs/specs/architecture/18-typed-daemon-event-channel.md:109` and `:149` record this guard as *deliberately
deferred* until a real window was wired, with lifecycle ownership assigned to the composition root. The
window was wired; the guard never followed. This ticket closes that deferral.

This slice is purely defensive. It adds **no state** — no cached destroyed-flag, no `'closed'` listener, no
window re-creation. Reconnecting a live window after reopen is #519's job.

## Design

### The shape: one predicate, read at call time, on three narrow interfaces

`isDestroyed()` is the only `BrowserWindow` member that is safe to call after destruction — that is its
purpose. Every guard is therefore the same two-token check, placed **before** any other member access, and
declared on the minimal structural interface each unit already owns. No new module, no shared base interface:
`DaemonEventSink` and `ActivatableWindow` are already independent stand-ins for the same real `BrowserWindow`
(`fireNotification.ts:71` says so explicitly), and duplicating a one-line method declaration is cheaper than
coupling two leaf modules.

The check is a **query at call time**, matching the existing focus-query discipline (`fireNotification.ts:6-8`:
"Focus is read at fire-time … there is no stateful focus tracker"). No `'closed'` event subscription, no flag.

#### 1. `src/main/emitDaemonEvent.ts` — the funnel guard (AC1, AC2, AC4)

```ts
export interface DaemonEventSink {
  /** True once the window has been destroyed. The ONE member safe to call on a destroyed
   *  BrowserWindow — every other access, `webContents` included, throws. */
  isDestroyed(): boolean
  webContents: { send(channel: string, event: DaemonEvent): void }
}

export function emitDaemonEvent(sink: DaemonEventSink, event: DaemonEvent): void
```

Behaviour: `if (sink.isDestroyed()) return` — then the existing single `send` line, unchanged.

- **Required member, not optional.** Measured fan-out is four fixture literals in three files; the house
  prefers compile-forced correctness (`assertNever`, `Record<NotifyKind, …>`). An optional `isDestroyed?()`
  would let a future sink silently opt out of the guard. Required makes an unguardable sink unconstructible.
- **MUST: nothing may read `sink.webContents` above the guard.** No `const { webContents } = sink` hoist, no
  early alias. The property read *is* the throw. The test below pins this with a throwing getter.
- **No try/catch.** Rejected: it cannot distinguish destruction from a genuine `send` fault (a non-cloneable
  payload, a channel-name bug), so it would convert real defects into silent drops. A positive `isDestroyed()`
  pre-empts the throw deterministically; exception control flow is not the house idiom.
- **No logging on drop.** The module is documented log-free by construction (`emitDaemonEvent.ts:3-4`: a
  `console.log` of the event would leak `MessagePayload.text` to stdout). A content-free drop line would
  require injecting `diagnosticLog` into the emitter — a signature change across a 32-site funnel for a
  diagnostic no observed failure asks for. Noted in Open questions for #519.

#### 2. `src/main/fireNotification.ts` — the two direct-touch sites (AC3)

```ts
/** The minimal surface the fire-decision reads. Parallel to ActivatableWindow; a real
 *  BrowserWindow satisfies both. */
export interface FocusableWindow {
  isDestroyed(): boolean
  isFocused(): boolean
}

/** A destroyed window is not focused — report false without touching isFocused(). */
export function windowHasFocus(win: FocusableWindow): boolean

export interface ActivatableWindow {
  isDestroyed(): boolean // NEW — declared first, checked first
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}
```

- `windowHasFocus`: `if (win.isDestroyed()) return false` then `return win.isFocused()`. Reporting *unfocused*
  is the semantically right answer, not a fudge — a closed window cannot hold focus, and it is exactly the
  condition under which a notification should fire. (Whether that notification's click can then surface a
  window is #519's concern; here the click is a safe no-op.)
- `activateWindow`: `if (win.isDestroyed()) return` as the first statement, above `isMinimized()`.
- `fireNotification` itself is **unchanged**. Its `isWindowFocused: () => boolean` dep stays a closure; the
  guard lives in the injectable predicate the root passes into it.
- **Why extract `windowHasFocus` instead of inlining `!mainWindow.isDestroyed() && mainWindow.isFocused()`
  at the root:** `src/main/index.ts` has no peer `.test.ts` and the house pattern for testable main-process
  logic is the Electron-free module with injected dependencies. AC3 names both halves as testable outcomes;
  an inline root expression leaves the focus half unverified by any test. The extracted predicate sits next
  to `activateWindow`, the sibling half of the same `notify` closure.

#### 3. `src/main/index.ts` — one line plus one import

`:366` becomes `isWindowFocused: () => windowHasFocus(mainWindow)`; add `windowHasFocus` to the existing
`./fireNotification` import. `:369` (`activateWindow(mainWindow)`) and `:370` (`emitDaemonEvent(mainWindow, …)`)
are **untouched** — their guards now live inside the callees. Extend the `:362-364` comment to record that
all three window touches in this closure are destroyed-safe.

`:191` (`sink: mainWindow`) and `:235` (`emit: (event) => emitDaemonEvent(mainWindow, event)`) are untouched:
the real `BrowserWindow` satisfies the widened `DaemonEventSink` structurally, since `isDestroyed()` is a real
method on it.

### Fan-out — measured, zero forced production edits outside the three files

`grep webContents src/` returns exactly one production read outside `index.ts`'s own window setup:
`emitDaemonEvent.ts:24`. `daemonConnection.ts` holds the sink (`:102`) and passes it to `emitDaemonEvent` at
**32 call sites spanning `:438`–`:1468`** — including the `relayLinkChanged` pair (`:846`, `:856`) and
`connecting` (`:1468`) — but never dereferences `.webContents` itself. One guard covers all 32, plus the
bundle orchestrator's injected `emit` (`index.ts:235`).

`DaemonEventSink` census: the emitter's own parameter, `daemonConnection.ts:102`, and four test literals
(`emitDaemonEvent.test.ts:8`, `daemonConnection.test.ts:112`, `daemonConnection.roundtrip.test.ts:203` and
`:885`). **Zero in `e2e/`** — `e2e/fixtures/electronApp.ts:37` mentions `BrowserWindow` only in a comment, and
drives the real Electron binary whose window satisfies the widened interface natively. `ActivatableWindow`
census: the interface, `activateWindow`, `index.ts:369`, and one fixture (`fireNotification.test.ts:37`).
This is what makes AC5's "no edits beyond the sink fixtures" a checkable claim.

### Explicitly rejected

- **A guard inside `debugBundleDownload.ts`.** The emitter guard makes the throw unreachable; a second
  defense for a failure mode that can no longer occur is not warranted, and it would add a window concept to
  a deliberately Electron-free orchestrator. AC4 is a *regression test over the real wiring*, not a
  production change — see below.
- **A try/catch in `relayConnection.ts:194-197` or `noiseRelayDriver.ts`.** The sink contract is "must not
  throw" (`noiseRelayDriver.ts:97`). This ticket makes that contract *true*. A catch-all there would swallow
  every future sink defect across the whole transport, in the one place with no test visibility.
- **Reordering the bundle orchestrator's emit-then-clear-flag pairs** (`debugBundleDownload.ts:94-95`,
  `:99-100`, `:106-107`). Clear-before-emit would also fix AC4 — but by hiding the second-order fault rather
  than removing its cause, and it would perturb a module with a documented single-in-flight invariant for no
  net gain once the emitter cannot throw.
- **A shared `DestroyableWindow` base interface.** One method declaration duplicated across two 5-line
  interfaces beats an import edge between two leaf modules.
- **Editing `docs/specs/architecture/18-typed-daemon-event-channel.md`.** Historical specs are immutable
  records; this document is the new one.

## State + concurrency model

- **No state added anywhere.** No store, no flag, no listener, no async work. Each guard is a synchronous
  query at the moment of use, so it is correct regardless of when the window was destroyed relative to the
  last event — including the interleaving that produces the bug (window alive at handshake, destroyed by the
  time a delta arrives).
- **No cached destroyed-flag, deliberately.** A flag set from a `'closed'` listener would be a second source
  of truth that can disagree with the object. `isDestroyed()` is authoritative and free.
- **Teardown unchanged.** `will-quit` still stops the connection (`index.ts:223`) and unregisters every
  handler. Nothing here shortens or lengthens any lifetime.
- **`window-all-closed` untouched** (`index.ts:393-395`) — non-darwin still quits, so in practice this guard
  is exercised only on macOS. That asymmetry is intentional and must survive.
- **AC4's mechanism, for the record.** With the guard in place, `emit` on a destroyed window returns normally,
  so the statement after it runs: `active = false` at each of the three terminals. The single-in-flight flag
  can no longer strand. Nothing in `debugBundleDownload.ts` changes.

## Error handling

| Failure mode | Behaviour after this change |
|---|---|
| Daemon event arrives, window destroyed | `emitDaemonEvent` returns having done nothing. Event dropped. No throw, no log, no reconnect side effect. |
| Same, arriving on the transport inbound path | The throw that previously escaped `relayConnection.ts:194-197` no longer exists. The connection stays usable. |
| `notify` fires, window destroyed | `windowHasFocus` → `false` (window unfocused ⇒ the notification does fire, which is correct). |
| Notification clicked, window destroyed | `activateWindow` returns immediately; the paired `emitDaemonEvent` drops. Click is a total no-op. |
| Bundle download reaches a terminal, window destroyed | Terminal event dropped, `active` cleared, a later request starts. |
| Window alive, any of the above | Byte-for-byte unchanged: one `send` on `DAEMON_EVENT_CHANNEL`, same event reference. |
| `isDestroyed()` itself throws | Not defended. It is the one member documented safe post-destruction; a throw there is an Electron-contract violation, not a modelled failure mode. |

**Dropped events are not recovered.** An assistant delta emitted while the window is destroyed is lost, and
the renderer that eventually reopens will not see it. That is the accepted cost of this slice — the
alternatives (buffering, snapshot-on-reattach) belong to #519, which owns getting a live window back.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. All five files below are tests; scenarios only — the developer
writes them in the house idiom.

**`src/main/emitDaemonEvent.test.ts`** — extend `fakeSink()` (`:8`) with `isDestroyed`, default `false`, plus a
way for a test to flip it. The three existing tests must pass unedited beyond that factory.
- Destroyed sink, any event → `webContents.send` not called, function returns normally.
- **Ordering pin (the real regression):** a sink whose `webContents` is a *getter that throws*
  `Object has been destroyed` and whose `isDestroyed()` returns `true` → `emitDaemonEvent` does not throw.
  This is the only assertion that catches a guard placed after a `webContents` hoist. A throwing getter body
  satisfies the declared property type, so no cast is needed.
- Live sink → unchanged: exactly one call, `(DAEMON_EVENT_CHANNEL, event)`, same object reference.

**`src/main/fireNotification.test.ts`** — extend `fakeWindow` (`:36`) with `isDestroyed` (default `false`) and
add a `FocusableWindow` fixture.
- `windowHasFocus` on a live focused window → `true`; live unfocused → `false`; **destroyed → `false` and
  `isFocused` was never called** (spy on it — this is what proves the guard precedes the touch).
- `activateWindow` on a destroyed window → none of `isMinimized`/`restore`/`show`/`focus` called.
- Existing minimized / not-minimized activation tests unchanged.

**`src/main/daemonConnection.test.ts`** (AC2) — extend `fakeSink()` (`:112`) with `isDestroyed` plus a
`destroy()` that flips it; one factory covers ~30 existing assertion sites, all of which keep passing.
- Reach connected via `reachConnected()` (`:182`), call `ctx.sink.destroy()`, then drive one inbound daemon
  message through `drivers[0].emit({ type: 'message', plaintext: messagePlaintext(…) })`. Assert
  `.not.toThrow()` and that `sink.webContents.send.mock.calls.length` is unchanged. Shape-copy
  `:666-672`. This is the AC2 requirement that the regression drives the *connection's* sink, not the
  emitter alone.
- Second leg in the same test or a sibling: with the sink destroyed, drive `{ type: 'relay-link-down', code: 4404 }`
  — the relay-link trigger the Context names — and assert the same. Cheap, and it proves the `:846`/`:856`
  emissions really are inside the funnel.

**`src/main/daemonConnection.roundtrip.test.ts`** — add `isDestroyed: () => false` to the two hand-written
literals (`:203`, `:885`). These are real `send(_channel, event)` methods, not `vi.fn()` spies, so the new
member is hand-written too. No other change; these tests run the genuine handshake and must stay green.

**`src/main/debugBundleDownload.test.ts`** (AC4) — no production change to the orchestrator. One new test
that composes the composition root's real wiring, using the existing `setup(overrides)` seam (`:40`) with
`emit: (e) => emitDaemonEvent(destroyedSink, e)` where `destroyedSink.isDestroyed()` is `true`:
1. `downloader.request()` → `requestDebugBundle` called once.
2. Drive `consumer().fail('daemon-error')` — the synchronous terminal, the simplest of the three.
3. `downloader.request()` again → `requestDebugBundle` called a **second** time (the flag was cleared).

Before this ticket, step 2 throws and step 3 short-circuits forever; after it, step 3 starts. This is the
only place in the suite that imports `emitDaemonEvent` into an orchestrator test, and it is deliberate: the
Technical Notes correctly rule out an orchestrator-local guard, which leaves composing the real emitter as
the one way to observe AC4. Keep it to this single test — the other 8-or-so orchestrator tests keep their
plain collector (`:50`).

**Type-level:** the widened interfaces are compile-forced. `npm run typecheck` fails until all four sink
literals and the `ActivatableWindow` fixture carry `isDestroyed`. That failure list *is* the fan-out
verification.

**Not covered by any test:** `src/main/index.ts:366`'s one-line wiring change (no peer `.test.ts`; that is
why the logic was extracted into `windowHasFocus`) and the real-Electron destroyed-window path (the e2e
suite has no window-close-mid-turn scenario; adding one is out of scope here and belongs with #519, where
window re-creation makes the round trip observable).

## Open questions

1. **Should a dropped event be counted or logged?** Rejected here (no observed need, and the emitter is
   log-free by construction). If #519's reattach work needs to know events were missed, a content-free
   counter belongs in that ticket, not retro-fitted here.
2. **`windowHasFocus` naming.** Chosen over `isWindowFocused` to avoid reading as a collision with the
   `deps.isWindowFocused` key it feeds at the call site (`isWindowFocused: () => windowHasFocus(mainWindow)`).
   Rename freely if the developer finds a clearer pair; the contract is what matters.
3. **Does #519 collapse these interfaces?** Once a live-window holder exists, the sink may become a getter
   over the current window and some of these checks may move. Not a reason to shape them differently now —
   #519 is `blocked_by` this ticket and will read this spec.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. This change adds no boundary and moves no data across one. The only
  new information flow is *negative*: a `DaemonEvent` that previously crossed to the renderer now sometimes
  does not. The untrusted→trusted boundaries this code sits between are unchanged: wire bytes are validated
  upstream in `daemonConnection.ts` before any `DaemonEvent` exists, and renderer commands are validated by
  `isRendererCommand` at `receiveCommand.ts` before reaching the `notify` closure. The guard reads only a
  boolean from a main-process-owned Electron object — no attacker-influenced input reaches it.
- **[Tokens, secrets, credentials]** No findings. No token, key, or credential is read, stored, logged, or
  compared. The one place secrets could have leaked is the drop path, and the design explicitly forbids
  logging there (`emitDaemonEvent` stays log-free; see Design §1) — which *preserves* the existing
  `MessagePayload.text` non-leak property rather than weakening it. Had the guard logged the dropped event,
  that would have been a MUST FIX; it is the reason the no-logging decision is recorded as a constraint and
  not left to developer discretion.
- **[File / storage operations]** N/A by design — this ticket touches no filesystem path. Adjacent code
  does (`saveDebugBundle`, `diagnosticLog`'s rotating sink) and neither is modified: the AC4 fix is a
  regression test plus the emitter guard, with `debugBundleDownload.ts` unedited, so the save path, its
  errno-dropping behaviour, and the downloads-dir closure are all untouched.
- **[Inter-process / Electron attack surface]** Reviewed as the highest-risk category here, since the whole
  change is about `BrowserWindow` lifecycle. No findings, and one property is *improved*:
  - No `webPreferences` change. `contextIsolation` / `nodeIntegration` / `sandbox` are set at
    `createWindow()` and not in this ticket's diff.
  - No new IPC channel, no new `contextBridge` member, no new `ipcMain.handle`/`on` registration. The
    renderer's capability surface is byte-identical. `DaemonEventSink` gaining a member widens a
    *main-process-internal* structural type only — it is never exposed across the bridge.
  - **Improvement:** an uncaught main-process exception is itself an availability-class Electron weakness —
    it can leave the app in a half-initialised state with handlers registered, the relay socket open, and a
    live Noise session, while the process is unwinding. Removing it narrows attack surface rather than
    widening it.
  - No navigation, protocol-handler, or `setWindowOpenHandler` change (`index.ts:55`, `:78` untouched).
  - Process placement holds: `emitDaemonEvent.ts` and `fireNotification.ts` remain Electron-free
    (`isDestroyed()` is declared on a structural interface, not imported from `electron`), and nothing
    crypto- or socket-shaped moves toward the renderer.
- **[Cryptographic primitives]** N/A — no RNG, no hashing, no key handling, no comparison of
  attacker-controlled values, and no change anywhere near the Noise handshake or its nonce counters. The two
  roundtrip tests that exercise the genuine `Noise_IK_25519_ChaChaPoly_BLAKE2s` handshake gain a one-line
  fixture member only; the design explicitly forbids touching `noiseRelayDriver.ts`.
- **[Network & I/O]** No findings. No socket, URL, timeout, `maxPayload`, or TLS setting is read or written.
  Reconnect discipline is deliberately untouched: the guard does **not** call `reconnect()`, `stop()`, or any
  connection method on drop, so a destroyed window cannot become a driver of reconnect activity — which
  rules out a window-close → reconnect-storm interaction with the relay.
- **[Error messages, logs, telemetry]** No findings. Zero log lines added; zero error messages added or
  changed; no field newly reaches the diagnostic log, the log file under `userData`, or the renderer console.
  The one adversarial question worth stating: could a hostile relay/daemon use the silent drop as an
  oracle? No — the drop is a pure local no-op with no observable timing, network, or disk consequence, and
  nothing acknowledges it back onto the wire.
- **[Concurrency]** No findings, and this is the category the design was shaped around. The guard adds no
  async task, timer, listener, or `AbortController`, so there is nothing new to cancel and no new leak
  surface. The check-then-act question — "could the window be destroyed in the gap between `isDestroyed()`
  and `webContents.send`?" — is answered structurally: both are synchronous statements in one function with
  no `await` between them, and window destruction happens on this same thread, so no interleaving exists.
  This is precisely why the design mandates a call-time query over a cached flag (a flag set from a
  `'closed'` listener *would* introduce a real stale-read window). Shutdown safety is unchanged:
  `will-quit` still stops the connection and unregisters every handler.
- **[Threat model alignment]** Desktop-specific threats walked:
  - *Malicious / compromised relay* — can flood events at a closed-window client. Previously that flood
    produced an uncaught exception on the first frame; now each frame is dropped in constant time with no
    allocation and no state. Strictly more robust.
  - *Hostile daemon response* — unchanged. Every daemon payload is still parsed and validated upstream in
    `daemonConnection.ts` before a `DaemonEvent` is constructed; the guard sits strictly downstream of
    validation and cannot be used to bypass it.
  - *Token theft from disk* — untouched; no storage path in this diff.
  - *Renderer compromise reaching the transport* — untouched; no new renderer-reachable capability, and the
    guard cannot be triggered from the renderer at all (the renderer cannot destroy the window it runs in
    without the OS/main-process close path).
  - **Availability, explicitly in scope and the point of the ticket:** a remote party that can cause a
    daemon event to be emitted could, before this change, crash the main process of any macOS client whose
    window happened to be closed. That is the vulnerability being closed.
- **[Out of scope — named]** Recovery of events dropped while no window exists (buffer, or snapshot on
  reattach) is deferred to **#519**, which owns the live-window holder and is `blocked_by` this ticket. Named
  here so the gap is a recorded decision, not an oversight: after this ticket the app no longer crashes, but
  a user who closes the window mid-turn still returns to a timeline missing the deltas that arrived while it
  was shut.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
