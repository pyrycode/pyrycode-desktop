# #519 — Point window-bound calls at the live window, and converge a fresh one

**Size:** S (2 production files + 1 comment-referent fix, 2 test files, ~330 LOC total). **Security-sensitive:** yes — review pass at the end.
**Split from** #503. **Blocked by** #518 (merged, PR #520) — this spec reads its output.

## Design source

N/A — main-process wiring. The renderer is not edited at all (see "The renderer needs no change"),
and no new pixel appears; the user-visible effect is an existing screen showing the state it should
already have shown. Code-review's visual-fidelity check is intentionally skipped.

## Files to read first

Codegraph is still not initialized for this repo (`codegraph_context` errors with "CodeGraph not
initialized", same as #518), so this list was built by grep + Read.

**Every anchor below was re-read at `3ab9c46` (current `main`), not carried from the ticket body.**
The body verified against `b02e7b4`; #504 merged after that (`26f8aeb`, `8da605f`) and shifted
`index.ts` by ~+11 lines. Body → actual: `:174`→`:165`, `:191`→`:182`, `:222`→`:233`, `:235`→`:246`,
`:369`→`:380`, `:372-373`→`:383-384`, `:360`→`:371`, `:391-393`→`:402-404`, `:396-398`→`:407-409`.

| Path | What to extract |
|---|---|
| `src/main/index.ts:165`, `:182`, `:233`, `:246`, `:380`, `:383-384` | The six captured-window consumers. All six are rewired; the `mainWindow` binding itself disappears. |
| `src/main/index.ts:34-89` | `createWindow()` — unchanged. Note it already returns the window and owns its own local binding. |
| `src/main/index.ts:402-404` | The `activate` handler that currently discards its new window. |
| `src/main/index.ts:407-409` | `window-all-closed` — non-darwin quits. Untouched; AC5's invariant. |
| `src/main/emitDaemonEvent.ts:15-23` | `DaemonEventSink` — the interface the router implements. **No edit.** |
| `src/main/emitDaemonEvent.ts:43-46` | The guard + send. The router forwards *through* this, so the guard stays load-bearing. |
| `src/main/fireNotification.ts:73-77`, `:101-111` | `FocusableWindow`, `ActivatableWindow` — the other two interfaces the router's window face satisfies. **No edit.** |
| `src/main/fireNotification.ts:90-93`, `:123-128` | `windowHasFocus` / `activateWindow` — both guard on `isDestroyed()` first. That is what the window face must answer honestly. |
| `src/main/daemonConnection.ts:102` | `sink: DaemonEventSink` — captured once at construction. **No production edit in this file.** |
| `src/main/daemonConnection.ts:438`, `:457`, `:1468` | The three status emits (`failed`, `connected`, `connecting`) — every one passes through the injected sink. |
| `src/main/daemonConnection.ts:1477-1482` | `start()` — `if (started \|\| stopped) return`. The idempotence AC4 rests on. |
| `src/main/daemonConnection.test.ts:777-784` | `'is idempotent: a second start() does not construct a second driver'` — **already green.** AC4 needs no new test here. |
| `src/shared/ipc/events.ts:77-81` | `DaemonEvent`'s four status members — the set the recorder keys on. |
| `src/renderer/src/store/sessionStore.ts:112-118`, `:135` | Status reduction + the `{ type: 'disconnected' }` initial state. Read-only: proves AC2 needs no renderer change. |
| `src/renderer/src/store/conversationListBridge.ts:120-129` | The connected rising-edge request. Read to understand what a replayed `connected` sets in motion. |
| `src/main/emitDaemonEvent.test.ts:9-21` | `fakeSink()` — the fixture idiom the new test's fake follows. |
| `src/main/fireNotification.test.ts:40-56`, `:65-70` | `fakeWindow` / `fakeFocusableWindow` — the other half of the fixture idiom. |
| `src/main/debugBundleDownload.ts:29` | A doc comment quoting the root's wiring verbatim — goes stale (see "Comment referents"). |
| `docs/specs/architecture/518-destroyed-window-guard.md` | The blocker. Its "Open questions" §3 asks whether these interfaces collapse; this spec answers. |
| `docs/knowledge/codebase/518.md:100-111` | The three carried-forward gaps. Only the first is in scope, and it is the one this spec closes. |

## Context

`src/main/index.ts:165` captures the window once and hands that one reference to everything
window-bound: the connection's sink (`:182`), the load gate (`:233`), the bundle orchestrator's
emitter (`:246`), and the `notify` closure's focus query and click activation (`:380`, `:383-384`).

On macOS the app outlives its window (`:407-409` quits only on non-darwin) and the connection keeps
running until `will-quit` (`:234`). The `activate` handler makes a replacement window and throws the
reference away (`:402-404`), so all six consumers still point at the destroyed original. #518 made
that safe — every one of them is now a no-op rather than a crash — but safe is not working: the new
window subscribes to the daemon-event channel and receives nothing, forever.

Routing alone is still not enough. Connection state reaches the renderer only as discrete events, and
a fresh window's session store starts at `{ type: 'disconnected' }` (`sessionStore.ts:135`). On a
stable connection no further status event may ever be emitted, so a correctly-routed new window would
sit at "disconnected" while the background process holds a healthy session. The window has to be
*told*, not merely subscribed.

`DaemonConnection` exposes no state accessor (`:132-143`), so the state has to be observed where it
already flows: all three status emits go through the injected sink (`:438`, `:457`, `:1468`). The
composition root's own sink position sees every transition pass by.

## Design

### One module, one wiring site: `src/main/liveWindow.ts`

An Electron-free factory holding the current window behind two faces. It is the only thing in the
root that knows which window is current, and — because it sits in the sink position — the only thing
that sees every status event go past.

```ts
/** What the root routes through. A real BrowserWindow satisfies it structurally, as it already
 *  satisfies all three constituents. The answer to #518's open question 3: the interfaces do NOT
 *  collapse — they intersect, here, in the one module that needs all of them at once. */
export type WindowTarget = DaemonEventSink & FocusableWindow & ActivatableWindow

export interface LiveWindow {
  /** Make `window` the current one. Replaces any predecessor; never touches the old window. */
  attach(window: WindowTarget): void
  /** The process-lifetime sink handed to the connection and the bundle orchestrator. */
  readonly sink: DaemonEventSink
  /** The current-window stand-in for focus / activation. */
  readonly window: FocusableWindow & ActivatableWindow
  /** Re-deliver the last recorded status event into the current window. No-op if none. */
  replayStatus(): void
}

export function createLiveWindow(): LiveWindow
```

Behaviour, one line each — the developer writes the bodies:

- **`sink.webContents.send(channel, event)`** — record `event` if it is one of the four status
  members, then forward via `emitDaemonEvent(target, event)` when a target has been attached.
- **`sink.isDestroyed()`** — always `false`. See "Why the sink is never destroyed" below.
- **`window.isDestroyed()`** — `true` when no window has been attached *or* the attached one reports
  destroyed. Honest, queried at call time.
- **`window.isFocused` / `isMinimized` / `restore` / `show` / `focus`** — delegate to the attached
  window; inert (`false` / no-op) when there is none, so the face is total rather than relying on
  its callers' guard ordering.
- **`replayStatus()`** — forward the recorded status event, if any, the same way `send` does.
- **`attach`** — assign. It does **not** clear the recorded status (connection state is independent
  of windows) and does **not** replay (the renderer has not subscribed yet).

### Why two faces, and why the sink is never destroyed

This is the one non-obvious decision in the design, and it is forced rather than chosen.

The recorder **must sit above** #518's destroyed-window guard. If the sink answered `isDestroyed()`
honestly, `emitDaemonEvent` would return early (`emitDaemonEvent.ts:44`) and the router would never
see events emitted while no window exists — so a status change during the closed-window gap would be
missed and `replayStatus()` would deliver a stale value into the new window. That is not a
theoretical gap: unpair (#504) tears the session down and settles permanently at `failed(not-paired)`
with no further event ever. A window reopened after that would be told `connected` and would keep
saying so forever. **Replaying a stale status is worse than replaying none.**

So the sink is not a window and must not pretend to be one. It is the process-lifetime channel *to*
whatever window is current; it is never destroyed, it accepts every event, and it drops one hop down
— inside the forward, through `emitDaemonEvent`, whose guard therefore stays load-bearing rather than
becoming dead code. `DaemonEventSink` is a sink interface, not a window interface (a non-window
already satisfies it in every test fixture), so this is a legitimate implementation of it.

The focus/activate face has the opposite requirement: `windowHasFocus` and `activateWindow` decide
whether to act by asking `isDestroyed()` first (`fireNotification.ts:91`, `:124`), so there the
truthful "there is no window right now" is exactly what AC3's parenthetical asks for.

### `src/main/index.ts` — the rewire

The local `mainWindow` binding is **deleted**. After this change no `BrowserWindow` reference
survives in the `whenReady` scope, so there is nothing left that can go stale — that is the
structural form of AC1, and it is grep-checkable (`grep -n mainWindow src/main/index.ts` returns only
`createWindow`'s own local, `:34-89`).

- `:165` — `const mainWindow = createWindow()` is removed. Add `const live = createLiveWindow()` in
  its place (it must exist before the connection, which captures its sink).
- `:182` — `sink: live.sink`.
- `:233` — replaced by a root-local `openWindow(): void` that creates a window, attaches it, and
  registers its load handler; called once here for the first window. Window creation moves down to
  this point because `openWindow` needs `connection`; nothing between `:165` and here uses the window
  any more, and the whole `whenReady` callback is synchronous — `grep -n "await\|async"
  src/main/index.ts` is **empty** — so no observable ordering changes.
- `:246` — `emit: (event) => emitDaemonEvent(live.sink, event)`.
- `:380` — `isWindowFocused: () => windowHasFocus(live.window)`.
- `:383-384` — `activateWindow(live.window)` and `emitDaemonEvent(live.sink, { type: 'notificationActivated' })`.
  The click emit goes through the sink like every other emit; it is not a status event, so recording
  it is a no-op by construction.
- `:402-404` — the `activate` handler calls `openWindow()` instead of discarding `createWindow()`.
  Its `getAllWindows().length === 0` condition is unchanged.

`openWindow`'s load handler is the single point where both halves of this ticket meet:

```ts
window.webContents.on('did-finish-load', () => {
  live.replayStatus() // no-op on the first window: nothing recorded yet
  connection.start() // idempotent (daemonConnection.ts:1479); the first call dials, later ones return
})
```

One uniform path for every window, with no "is this the first one?" branch — the first window records
nothing and dials; every later window replays and no-ops. **`reconnect()` is never called from this
path**, which is the whole of AC4: it re-dials (`:143`) and would kill a streaming turn.

`.on`, not the previous `.once`: the listener is registered per window on a fresh `webContents`, so
the HMR-reload concern the `.once` guarded against is now answered by `start()`'s proven idempotence
instead — and `.on` additionally converges a window that reloads (dev HMR, or Cmd-R via Electron's
default View menu), whose renderer store is just as empty as a new window's. Recorded in Open
questions as a deliberate, one-word, reversible choice.

**Attach at creation, not at load.** Between `createWindow()` and `did-finish-load` the new window is
already the current one, so a notification click during that window is activated correctly (AC3).
Daemon events arriving in that gap are forwarded into a renderer that has not subscribed yet and are
dropped there — identical to the pre-existing behaviour of the very first window, and the reason
`start()` waits for the load in the first place. Status is not among the losses: `replayStatus()`
runs at the load.

### Comment referents that go stale

Three one-line, in-place corrections. Bounded list — not an invitation to sweep.

- `src/main/index.ts:371` — "Dormant — no renderer sends `notify` yet (the trigger is #392)" is
  false: #392 shipped and `pushNotifyBridge.ts:64` sends it. Replace with the live reachability: the
  click path is reachable when a notification is raised while the window is open but unfocused, the
  window is then closed, and the notification is clicked afterwards.
- `src/main/debugBundleDownload.ts:29` — quotes `e => emitDaemonEvent(mainWindow, e)`; repoint to
  `live.sink`.
- `src/main/debugBundleDownload.test.ts:204` — same quoted expression in the #518 AC4 test's comment.

### Explicitly rejected

- **A state accessor on `DaemonConnection`.** It would mean tracking status inside a 1500-line
  transport module, editing its interface, and duplicating state that already flows through the sink
  — for a value the root can observe for free from the position it already occupies. Zero production
  edits in `daemonConnection.ts` is a deliberate outcome.
- **A renderer-facing invoke channel** (the `registerPairingStatusHandler` shape). It would fan out to
  `src/shared/ipc`, the preload bridge, and a renderer store, pushing this past S — the ticket says so
  and the ticket is right. The replayed event reaches the same renderer bridge the live path uses, so
  the query buys nothing.
- **Buffering or re-requesting the events dropped while no window existed.** Out of scope per the
  ticket body; the recorder holds exactly one status event, never a queue. See "Scope boundary".
- **Counting or logging dropped events** (#518 open question 1). No observed failure asks for it and
  the emit path is log-free by construction.
- **Creating a window from a notification click when none exists.** Out of scope per the ticket body;
  `activateWindow(live.window)` stays the no-op #518 made it.
- **Detaching on window close (a `'closed'` listener).** A cached flag would be a second source of
  truth that can disagree with the object. `attach` overwrites; `isDestroyed()` is queried at call
  time. Same discipline #518 chose, for the same reason.
- **Collapsing `DaemonEventSink` / `FocusableWindow` / `ActivatableWindow` into one interface**
  (#518 open question 3). They are intersected in `WindowTarget` where all three are needed at once;
  merging them would force every leaf consumer to depend on members it does not use, and would widen
  the four existing sink fixtures for no gain. Zero interface edits also means zero fixture cascade.

## State + concurrency model

- **Exactly two mutable cells**, both in the new module, both plain fields: the current window and the
  last status event. No store, no timer, no listener, no async work, no `AbortController`.
- **Every read is a call-time query**, so the answer is correct regardless of when the window was
  destroyed relative to the last event.
- **No check-then-act gap.** Recording, the destroyed check, and the send are consecutive synchronous
  statements with no `await` between them, and window destruction happens on the same thread. The
  root's `whenReady` callback is likewise fully synchronous (`grep "await\|async" src/main/index.ts`
  is empty), so `openWindow()` and every handler registration below it complete in one tick — long
  before any renderer IPC or `did-finish-load` can arrive.
- **Connection lifecycle untouched.** `will-quit` still stops the connection (`:234`) and unregisters
  every handler; no lifetime is lengthened or shortened. The module has no reference to the connection
  at all, which is what makes AC4 structural rather than behavioural.
- **The recorded status survives windows deliberately.** It is connection state; `attach` does not
  clear it. That is precisely what makes the gap case correct.
- **Non-darwin is untouched** (`:407-409`): the app still quits when the last window closes, so
  `activate` never fires there and no reopen path is introduced. AC5 is an invariant of *not* editing
  that block.

## Error handling

| Failure mode | Behaviour |
|---|---|
| Daemon event, window destroyed, no replacement yet | Recorded if it is a status event; forwarded into `emitDaemonEvent`, whose guard drops it. No throw. |
| Daemon event before any window is attached | Recorded if status; not forwarded. Unreachable in production (`openWindow()` runs synchronously before any emit) but total by construction. |
| `replayStatus()` with nothing recorded | No-op. This is the first window's normal path. |
| `replayStatus()` with no live window | Forwarded into the guard and dropped. No throw. |
| `notify` fires, no live window | `windowHasFocus(live.window)` → `false` (a window that does not exist cannot be focused) ⇒ the notification does fire. Unchanged from #518. |
| Notification clicked, no live window | Total no-op — activation and the paired emit both drop. AC3's parenthetical. |
| Notification clicked, window reopened since | Activates the **new** window and emits into it. This is the fix. |
| Window reopened mid-turn | Status converges; the deltas that arrived while it was shut are gone. Accepted — see below. |
| `isDestroyed()` itself throws | Not defended; it is the one member documented safe post-destruction. Same stance as #518. |

**Replay is indistinguishable from a live connect.** A fresh window's stores are empty, so a replayed
`connected` is that window's first `connected` and drives exactly what a real one would — including
`conversationListBridge`'s rising-edge conversation request (`:120-129`). That is intended and costs
no renderer code. Only one window exists at a time (`activate` creates one only when the count is
zero), so there is no fan-out of duplicate requests.

## Scope boundary

Restating the ticket's exclusions, because the mechanism makes them tempting:

- **In:** connection-status convergence only (AC2). The recorder holds **one** event, not a queue.
- **Out:** recovering daemon events dropped while no window existed. A turn streaming through the gap
  still loses its deltas. Recorded in `docs/knowledge/codebase/518.md:100-105` as a decision; no
  follow-up ticket filed yet. A buffer, or a snapshot re-request on reattach (`requestSnapshot` /
  `requestConversations` already exist), is a separate slice with its own sizing.
- **Out:** counting or logging drops.
- **Out:** creating a window from a notification click when none exists — a distinct behaviour change
  that drags in a delivery race (the paired `notificationActivated` would fire before the new
  renderer subscribes, so the nav signal would need queueing). `fireNotification.ts:83-84` and `:121`
  gesture at #519 for this; they are pointing past this slice.

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. Scenarios only — the developer writes them in the house
idiom. **No `daemonConnection.test.ts` edit**: AC4's load-bearing property is already pinned green at
`:777-784`.

**`src/main/liveWindow.test.ts`** (new). One `fakeWindow()` factory returning a `WindowTarget` plus
stable spy handles, modelled on `emitDaemonEvent.test.ts:9-21` and `fireNotification.test.ts:40-56`.
Two fixture requirements, both learned from #518: expose `send` (and the focus/activate spies) as
**handles on the factory's return**, never reached through `win.webContents.send`; and make
`webContents` a **getter that throws** once destroyed, so the fake is a faithful stand-in.

*Routing (AC1)*
- Emit through `live.sink` with window A attached → A receives it on `DAEMON_EVENT_CHANNEL`, same
  object reference.
- Attach A, destroy A, attach B, emit → **B receives it and A does not.** The core AC1 assertion.
- Emit with A attached but destroyed and no replacement → does not throw, A's `send` not called.
- Emit before any attach → does not throw, nothing sent.

*Convergence (AC2)*
- Emit `connected` while A is attached; attach B; `replayStatus()` → B receives that exact event.
- **The gap case:** emit `connected`, destroy A, emit `failed` **while no window is attached**, attach
  B, `replayStatus()` → B receives `failed`, not `connected`. This is the one test that fails if the
  recorder is placed below the guard, and it is the reason the sink reports itself never destroyed.
- A non-status event between two replays does not overwrite the record (`connected`, then
  `messageReceived`, then replay → `connected`).
- Each of the four status members is recorded, last write wins (table-driven over `events.ts:77-81`).
- `replayStatus()` before anything is recorded → nothing sent (the first window's path).

*Window face (AC3)* — compose the **real** `windowHasFocus` / `activateWindow` from
`fireNotification.ts`, the way #518's AC4 test composes the real `emitDaemonEvent`. That is what
proves the face genuinely satisfies both interfaces rather than merely type-checking.
- `live.window.isDestroyed()` → `true` before any attach, `false` with a live window, `true` once the
  attached window reports destroyed.
- `windowHasFocus(live.window)` → `false` with no window; delegates to the attached window when live;
  after re-attach it queries the **new** window.
- `activateWindow(live.window)` → drives `restore`/`show`/`focus` on the current window; after
  re-attach drives the new one and never the old; total no-op when there is no live window.

**AC4 has no new test, deliberately.** It is enforced structurally and each leg is checkable by
reading rather than by assertion: `liveWindow.ts` has no connection dependency (it cannot restart what
it cannot reach); the root's load handler calls only `start()`; `grep -n "reconnect()" src/main/index.ts`
returns exactly two call sites — the pairing and unpair handlers (`:206`, `:226`) — plus two comment
mentions (`:191`, `:217`), and this ticket adds none; and `start()`'s idempotence is already
green at `daemonConnection.test.ts:777-784`. Adding a fourth assertion of the same fact would also
collide with in-flight PR #500 (below) for no gain.

**Not covered by any test:** the `index.ts` rewire itself — the root still has no peer `.test.ts`, and
adding an Electron/Playwright window-lifecycle harness is its own slice. This is why the mechanism
lives in an injectable module and the root keeps only assignment and one listener registration. The
real dock-reopen round trip remains manual-verification territory.

## In-flight overlap — noted, not blocking

The prescribed branch-overlap check (`origin/feature/<N>`) is **clean**. One branch outside that
naming convention overlaps and is worth recording: `origin/feature/491-run-config-read` (open PR #500,
issue #491 open) also edits `src/main/index.ts`, adding a `requestSessionSettings` case to the
`onCommand` switch at `:253-258`. This spec's nearest hunk is `:246`, four lines clear of it, and
every other hunk is 100+ lines away — no textual conflict, and #518 and #504 both merged `index.ts`
changes past that branch already. The test-file overlap that *would* have mattered
(`daemonConnection.test.ts`, which PR #500 also edits) is avoided outright: this spec adds no test
there. Whichever merges second rebases cleanly.

## Open questions

1. **`.on` vs `.once` for `did-finish-load`.** Specified as `.on`, which additionally converges a
   reloaded window. Safe because `start()` is idempotent (`daemonConnection.ts:1479`, tested at
   `:777`). If a reviewer prefers minimal behavioural delta, `.once` still satisfies every AC — it
   only forfeits the reload case. One word, reversible.
2. **Naming.** `createLiveWindow` / `live.sink` / `live.window` follows the house `createX` factory
   idiom. `live.window` reads slightly redundantly; rename the face freely (`live.current` was the
   alternative). The contract is what matters.
3. **Should `replayStatus()` be folded into `attach()`?** No — attach happens at window creation,
   replay must happen after the renderer subscribes. Keeping them separate is also what keeps the
   module free of any Electron event knowledge. Noted because the two calls sit adjacent in
   `openWindow` and look mergeable.
4. **The dropped-event gap is now the only one left** from #518's three. When a follow-up is filed,
   the seam is `replayStatus()`: the same call site that converges status is where a snapshot
   re-request would go. Deliberately not built here.

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings. No boundary is added, moved, or widened. The router sits
  strictly *downstream* of every validation: wire bytes are parsed and validated in
  `daemonConnection.ts` before a `DaemonEvent` exists, and renderer commands are validated by
  `isRendererCommand` before reaching the `notify` closure. Nothing attacker-influenced reaches
  `attach`, whose only caller is `openWindow()` in the root, with a window the root just constructed.
  The one genuinely new information flow is a **re-delivery**: a status event the main process already
  chose to send to a renderer is sent to a renderer again. It crosses the same `contextBridge`
  channel, in the same direction, carrying a value that already crossed it.
- **[Tokens, secrets, credentials]** Reviewed as the sharpest question in this spec, because the
  design introduces the first main-process cache of a daemon event. The recorded value is a
  `DaemonEvent` status member (`events.ts:77-81`): `connecting` and `disconnected` are nullary,
  `failed` carries `ErrorPayload`, `connected` carries `HelloAckPayload`. None is a token, key, or
  message body — `DaemonEvent`'s own contract (`events.ts:64-68`) is that it never carries a token,
  key, raw frame, or bundle bytes, and the recorder holds a reference to an event that already
  satisfies it rather than constructing anything new. **The design deliberately records only status
  members, not `messageReceived`** — had it cached the last event of any type, `MessagePayload.text`
  would have been retained in main-process memory beyond its delivery, which would have been a MUST
  FIX. It is a one-event-deep cell, not a queue, so retention is bounded and does not grow. Nothing is
  written to disk, and no lifecycle/rotation question arises: the cell is overwritten by the next
  status transition and dies with the process.
- **[File / storage operations]** N/A by design — no filesystem path is constructed, read, or written
  anywhere in this change. The adjacent paths (`saveDebugBundle`, `diagnosticLog`'s rotating sink)
  are untouched; `debugBundleDownload.ts`'s only edit is one doc-comment referent.
- **[Inter-process / Electron attack surface]** Reviewed as the highest-risk category, since the whole
  change is `BrowserWindow` lifecycle. No findings.
  - No `webPreferences` change. `createWindow()` (`:34-89`) is untouched, so every window this design
    creates — including the reopened one — keeps `sandbox: true`, `contextIsolation: true`, and the
    default `nodeIntegration: false`. Worth stating explicitly: because reopening reuses the same
    `createWindow()`, a reopened window is byte-identically hardened, and cannot drift from the
    original's settings.
  - `will-navigate` and `setWindowOpenHandler` (`:55`, `:78`) are likewise inside `createWindow()`
    and applied to every window it makes. No navigation or window-open policy changes.
  - **No new IPC surface at all** — no `contextBridge` member, no `ipcMain.handle`/`on` registration,
    no new channel. This is the direct benefit of rejecting the renderer-facing invoke query: the
    renderer's capability set is byte-identical, and the convergence signal arrives on the existing
    daemon-event channel as an ordinary event. A query channel would have added a renderer-reachable
    handler for connection state; this design adds none.
  - No custom protocol or deep-link handler.
  - Process placement holds: `liveWindow.ts` imports no `electron` module (it is typed against the
    three structural interfaces), and nothing crypto-, socket-, or key-shaped moves toward the
    renderer. Keys and raw frames remain unreachable from the window face, which exposes only
    `isDestroyed`/`isFocused`/`isMinimized`/`restore`/`show`/`focus`.
  - One property to *not* regress, checked: the router does not hold or expose `webContents` to
    anything but `emitDaemonEvent`.
- **[Cryptographic primitives]** N/A — no RNG, hashing, key handling, or comparison of
  attacker-controlled values. The Noise handshake is not touched, and critically **not restarted**:
  the design's central AC4 property is that no reopen path calls `reconnect()`, so no window action
  can force a re-handshake. That is a security-relevant negative, not merely a UX one — a
  window-driven re-handshake loop would mean repeated static-key operations and fresh nonce sequences
  on demand. The design forbids it structurally (the module cannot reach the connection).
- **[Network & I/O]** No findings. No socket, URL, timeout, `maxPayload`, or TLS setting is read or
  written, and no reconnect/backoff behaviour changes. The adversarial question here is whether a
  window lifecycle can be turned into network activity: it cannot. Closing and reopening a window
  performs zero network operations — `start()` on an already-started connection returns at
  `:1479` — so an attacker (or a user) toggling the window cannot drive relay traffic, and there is no
  reconnect-storm surface. The one renderer-side consequence of a replayed `connected` is
  `conversationListBridge`'s single rising-edge request, which is rate-limited by its own `requested`
  ref and by there being at most one window.
- **[Error messages, logs, telemetry]** No findings. Zero log lines are added and zero error messages
  are added or changed; the emit path stays log-free by construction, and the deliberate rejection of
  drop-logging (#518 open question 1) keeps it that way — a content-free counter would have needed
  `diagnosticLog` injected into the emit path, and a *content*-ful one would have leaked event bodies
  to stdout. No new field reaches the diagnostic log, the log file under `userData`, or the renderer
  console. Nothing about the drop or the replay is acknowledged back onto the wire, so a hostile relay
  gains no oracle: the replay is triggered by a local window load, not by anything remote, and
  produces no observable timing, network, or disk signal.
- **[Concurrency]** No findings; this is the category the module was shaped around. It adds no async
  task, timer, listener, or `AbortController`, so there is nothing new to cancel and no new leak
  surface — the one listener added (`did-finish-load`) is registered on a window's own `webContents`
  and dies with that window. The check-then-act question ("could the window be destroyed between the
  guard and the send?") is answered structurally, exactly as in #518: consecutive synchronous
  statements, no `await`, destruction on the same thread. The recorder's ordering (record, *then*
  forward) means a throw in the forward path could not desynchronise the cache — and there is no such
  throw. Shutdown safety is unchanged: `will-quit` still stops the connection and unregisters every
  handler, and the module holds nothing that needs finalising. Duplicate-window safety rests on the
  unchanged `getAllWindows().length === 0` condition (`:403`); if that were ever removed, two windows
  would both receive events, which is a correctness question rather than a security one and is
  out of this ticket's edit surface.
- **[Threat model alignment]** Desktop-specific threats walked:
  - *Malicious / compromised relay* — it can flood events at a client whose window is closed. Each is
    recorded-if-status (a single-cell overwrite, constant space) and dropped at the guard in constant
    time. No queue, no allocation growth, so the flood cannot be turned into memory exhaustion via the
    new cache. This is the design property that made a buffer the wrong answer for the dropped-event
    gap as well.
  - *Hostile daemon response* — unchanged. Every payload is still parsed and validated upstream before
    a `DaemonEvent` exists; the recorder sits strictly downstream and cannot be used to bypass
    validation. A hostile `connected` ack is exactly as (in)effective replayed as it was live.
  - *Token theft from disk* — untouched; no storage path in this diff.
  - *Renderer compromise reaching the transport* — untouched and slightly narrowed in the sense that
    no new renderer-reachable handler exists. A compromised renderer cannot destroy its own window,
    cannot call `attach`, and cannot trigger `replayStatus()` other than by finishing a document load.
    The worst it can do with that is receive a status event it already receives.
  - **Availability** — the ticket's substance. #518 stopped the crash; this ticket stops the silent
    dead window that replaced it. Neither introduces a new denial surface.
- **[Out of scope — named]** Recovery of daemon events dropped while no window existed remains
  deferred, now as the sole survivor of #518's three gaps; the seam for it is `replayStatus()`. Named
  here so it stays a recorded decision rather than an oversight: after this ticket a user who closes
  the window mid-turn and reopens it sees the correct connection state but still returns to a timeline
  missing whatever streamed while it was shut. No follow-up ticket is filed yet.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-30
