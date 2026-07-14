# #393 — Push notifications C: clicking a notification focuses the window and shows the conversation

**Ticket:** https://github.com/pyrycode/pyrycode-desktop/issues/393
**Size:** S · **Security-sensitive:** No · **UI-visible (new visual surface):** No · **Split from:** #158 · **Depends on:** #391 (merged)

## Design source

N/A — this slice introduces **no new visual surface**. It adds a second trigger (notification click) for the existing `open` → `thread` transition and reuses the already-built thread screen (`ConversationScreen`, #69/#141/#203). PO classified this NOT-UI; there is no Figma anchor and code-review's visual-fidelity check is intentionally N/A here. The only observable change is *behavioral*: the window comes forward and the paired region navigates to the existing thread view.

## Context

Desktop push rides the relay socket the app already holds open (no Firebase; decided 2026-07-08). The merged sibling #391 owns the notification-**creation** site — `src/main/fireNotification.ts` fires an OS notification only while the main window is unfocused, with its Electron dependencies (`isWindowFocused`, `Notification`) injected so it unit-tests with fakes and never imports `electron`.

This slice makes that notification **actionable**: attach a `click` handler that (a) restores / shows / focuses the main window and (b) signals the renderer to navigate to the active conversation's thread.

Desktop uses a **single-active-conversation model** — daemon events carry no `conversation_id`, and the paired region has one `thread` view. So "open the originating conversation" is "focus the window and navigate to the thread view," not per-conversation routing. The nav reuses the existing `open` → `thread` transition (`pairedRoute.ts`) that `useConversationCreatedNav` (#242) already drives; this ticket adds a second trigger for it, not a new view or transition.

Ships **dormant** until #392 (independent sibling; sends the `notify` command that causes a real fire) lands. The click handler is exercised in tests with a fake notification, so this slice does not wait on #392.

## Files to read first

| Path (lines) | What to extract |
|---|---|
| `src/main/fireNotification.ts` (1–55) | The #391 inject-Electron-as-deps idiom. `OsNotification` (`show()`-only) and `OsNotificationConstructor` are the surfaces to **widen** for a click listener; `NOTIFICATION_COPY` and the focus gate stay unchanged. This is where `activateWindow` + `ActivatableWindow` are added. |
| `src/main/fireNotification.test.ts` (1–59) | The `fakeNotification()` helper — a `vi.fn()` constructor capturing options + a spied `show`. Extend it to also capture the `on('click', …)` listener so a test can simulate a click with no Electron harness. |
| `src/main/index.ts` (356–366) | The `notify` case where `fireNotification` is wired. This is the sole composition site: add the `onClick` dep that composes `activateWindow(mainWindow)` + `emitDaemonEvent(mainWindow, …)`. |
| `src/main/index.ts` (34–50, 174, 188–195, 231–236) | `createWindow` / `mainWindow` / the `emitDaemonEvent` sink wiring. `mainWindow` (a `BrowserWindow`) structurally satisfies both the new `ActivatableWindow` and the existing `DaemonEventSink`. |
| `src/main/emitDaemonEvent.ts` (1–26) | The single main→renderer emit path the click handler reuses. Note its header line "nothing else sends on the channel" — see **Design note: the semantic stretch** below. |
| `src/shared/wire/events.ts` (76–121, 199, 244–257) | The `DaemonEvent` union. Add the new arm. The nullary `stallDetected` arm (`:121`) and the bare `workspaceFolderRejected` arm (`:257`) are the closest content-free precedents to mirror for the doc-comment house style + AC3 framing. |
| `src/renderer/src/store/conversationCreatedBridge.ts` (1–87) | The filter-bridge + `useXxxNav` React-glue pattern to clone. **Drop** the command-send half (`requestNewConversation`) and the payload return — the new arm is nullary and consume-only. |
| `src/renderer/src/store/conversationCreatedBridge.test.ts` (1–108) | The `fakeBridge()` capture-listener test idiom to clone (subscribes-once / owned-arm-invokes / unrelated-arms-ignored / off-handle-cleanup). |
| `src/renderer/src/store/daemonEventBridge.ts` (27–141) | Exhaustive `assertNever`-guarded bridge. Add one `case 'notificationActivated': return null` with a one-line rationale comment (the #382/#396 no-op precedent). |
| `src/renderer/src/store/timelineBridge.ts` (92–135) | The null fall-through `case` list. Add `case 'notificationActivated':` to it. |
| `src/renderer/src/store/modalBridge.ts` (61–98) | The null fall-through `case` list. Add `case 'notificationActivated':` to it. |
| `src/renderer/src/PairedShell.tsx` (80–107) | The container. Mount the new hook beside `useConversationCreatedNav`. Note it must **not** call `setActiveConversation` — nullary arm, no payload. |
| `src/renderer/src/pairedRoute.ts` (46–69) | `nextPairedRoute`: confirm `open` → `thread` is absolute (lands on `thread` from any route), which is what makes AC2's "regardless of which paired view" hold for free. |
| `src/renderer/src/PairedShell.test.tsx` (113–158) | The compose-the-tested-reducer-with-the-view seam-test idiom (no jsdom). Add "`open` from settings/archive → thread" assertions for AC2. |
| `CLAUDE.md` | Conventions: sealed discriminated unions on `type`, transport/Electron out of the renderer, test-first. |

## Design

Four coordinated pieces plus the compile-forced cascade. The whole path is a near-clone of the #242 create-nav slice, adapted for a **nullary, main-local** signal.

### 1. Main — widen `fireNotification` for a click listener (`src/main/fireNotification.ts`)

Widen the injected notification surface and add the click dep. Contract sketch (behavior, not full body):

```ts
export interface OsNotification {
  show(): void
  on(event: 'click', listener: () => void): void   // NEW — Electron's Notification (EventEmitter) satisfies this structurally
}

export function fireNotification(
  kind: NotifyKind,
  deps: {
    isWindowFocused: () => boolean
    Notification: OsNotificationConstructor
    onClick: () => void                              // NEW — invoked when the fired notification is clicked
  }
): void
```

Behavior: unchanged focus gate (`if (isWindowFocused()) return`); then construct the notification with the kind's copy, **register `notification.on('click', onClick)` before `notification.show()`**, and show. The `onClick` callback is opaque to this module — it does not know about window activation or IPC; the composition root supplies it. Asserted by *"a simulated click invokes onClick"* and *"no notification / no click when focused"* in `fireNotification.test.ts`.

### 2. Main — the window-activation helper (`src/main/fireNotification.ts`, co-located)

A pure, injected-window helper (the "activate on click" main concern), kept in this module to avoid a new file and match the #391 "OS-side effects live here" framing:

```ts
export interface ActivatableWindow {
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function activateWindow(win: ActivatableWindow): void
```

Invariant (AC1): after `activateWindow`, the window is un-minimized (if it was minimized), visible, and focused. Reference sequence (≤3 lines): `if (win.isMinimized()) win.restore(); win.show(); win.focus()`. `show()` covers the hidden case and also focuses; `restore()` covers minimized; explicit `focus()` covers already-visible-but-behind. `isVisible` is deliberately **not** in the interface — `show()` is safe to call unconditionally. A real `BrowserWindow` satisfies `ActivatableWindow` structurally, so no `electron` import reaches this unit. Asserted by *"activateWindow un-minimizes, shows, and focuses"* and *"shows + focuses without restore when not minimized"*.

### 3. Shared — one nullary DaemonEvent arm (`src/shared/wire/events.ts`)

Add exactly one arm to the `DaemonEvent` union:

```ts
| { type: 'notificationActivated' }
```

Nullary by construction (AC3): it carries **no payload**, so no daemon-relayed content, conversation id, or wire field can ride it. Doc-comment it in the house style, mirroring `stallDetected` (`:121`) and `workspaceFolderRejected` (`:257`): note that (a) this is the **first main-local** signal on the channel — it is *not* derived from a validated wire envelope but emitted by the main-process notification click handler; (b) it is content-free; (c) it is consumed by the `notificationActivatedBridge` (#393) → drives the paired `open` nav, so all three exhaustive bridges no-op it.

### 4. Renderer — the consumer filter-bridge (NEW: `src/renderer/src/store/notificationActivatedBridge.ts`)

A near-clone of `conversationCreatedBridge`, minus the command-send half and minus the payload (nullary → the callback takes no args). Two exports:

```ts
export function subscribeNotificationActivated(
  onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void,
  onActivated: () => void
): () => void          // subscribes; on each `notificationActivated` event invokes onActivated(); returns the off handle

export function useNotificationActivatedNav(onActivated: () => void): void   // React glue
```

`subscribeNotificationActivated` inlines the `event.type === 'notificationActivated'` filter (no separate payload-returning `translate` — there is no payload). `useNotificationActivatedNav` is the exact `useConversationCreatedNav` React-glue shape: latest-callback ref + a single empty-dep effect that returns the off handle as cleanup (StrictMode double-mount nets one live listener), dereferencing `window.pyry` only inside the effect so the mounting component stays server-renderable. This is a `default:null`-style **filter** bridge, not an exhaustive one — it deliberately consumes only its one arm, like `conversationCreatedBridge`.

### 5. Renderer — mount it in PairedShell (`src/renderer/src/PairedShell.tsx`)

One import + one line beside `useConversationCreatedNav`:

```ts
useNotificationActivatedNav(() => dispatch({ type: 'open' }))
```

Crucially, **no `setActiveConversation`** — unlike the created-event nav, the click carries no conversation payload. In the single-active model, "open" means "show the existing active conversation's thread," so it just dispatches the existing `open` nav. Because `nextPairedRoute`'s `open` arm is absolute (→ `thread` from `list` / `settings` / `archive` / `pairServer`), AC2's "regardless of which paired view was showing" holds with no new route or nav arm.

### 6. Main — compose the click handler at the wiring site (`src/main/index.ts`, the `notify` case)

Widen the existing `fireNotification` call with the composed `onClick` and import `activateWindow`:

```ts
fireNotification(command.payload.kind, {
  isWindowFocused: () => mainWindow.isFocused(),
  Notification,
  onClick: () => {
    activateWindow(mainWindow)                                  // AC1
    emitDaemonEvent(mainWindow, { type: 'notificationActivated' })  // AC2/AC3
  }
})
```

`mainWindow` satisfies both `ActivatableWindow` and `DaemonEventSink` (already used at `index.ts:235`). This is the sole place the two effects are composed; each composed piece is independently covered (activateWindow tested; `emitDaemonEvent` is the already-tested one-line forwarder; the bridge tested), so the un-unit-tested composition is glue only — the root-composes-effects idiom (`downloadsDir` → `saveDebugBundle`).

### The compile-forced cascade (atomicity)

Adding the `DaemonEvent` arm forces a one-line no-op in each of the three `assertNever`-guarded exhaustive bridges (`daemonEventBridge` / `timelineBridge` / `modalBridge`) — the same cascade every prior arm-adding slice paid (#316, #285, #382, #396). `daemonEventBridge` gets an explicit `case 'notificationActivated': … return null` with a rationale comment; `timelineBridge` and `modalBridge` add `case 'notificationActivated':` to their existing null fall-through groups. These are compile-atomic (the arm cannot land without them or the build breaks) and carry zero design fan-out.

### Design note: the semantic stretch (chosen over a dedicated IPC channel)

The ticket offers two options for the main→renderer signal: (a) a new `DaemonEvent` arm, or (b) a dedicated main→renderer IPC channel. **This spec chooses (a).** Trade-off:

- **(a) DaemonEvent arm** — reuses the exact #242 filter-bridge pattern; the renderer bridge subscribes to the same `window.pyry.onDaemonEvent` as every other bridge (zero new preload surface); AC3 satisfied by construction (nullary arm). Cost: a mild semantic stretch — this is the first *main-local* (non-wire-derived) event on a channel whose emit-helper comment says "nothing else sends." Mitigated by documenting the exception at the arm-definition site.
- **(b) dedicated channel** — semantically cleaner, but widens the renderer's trusted `window.pyry` surface with a new one-way method, needs preload wiring + a `Window['pyry']` typing augmentation + a channel constant, and fragments "main→renderer typed events" across two channels, breaking the "all bridges subscribe to `onDaemonEvent`" symmetry.

(a) is simpler and more idiomatic for this codebase (more code reuse, less new surface), so it wins. Keep the `emitDaemonEvent.ts` "nothing else sends" nuance honest by noting the one main-local sender in the **new arm's doc comment** in `events.ts` (no need to also edit `emitDaemonEvent.ts` — the arm-site note is sufficient and keeps scope tight).

## State + concurrency model

No new store, no new Zustand slice. The nav is ephemeral — PairedShell's existing `useReducer` over `nextPairedRoute` (ADR 0006, screen-local). The arm is a transient signal, not stored state. Concurrency: the click handler is a synchronous main-process callback; the emit is fire-and-forget on the existing IPC channel; the renderer bridge subscribes on mount and tears down via the off handle on unmount (unpair) — no `AbortController` needed (Electron IPC subscription, the `useDaemonEventBridge` StrictMode-safe idiom). If a `notificationActivated` is emitted while PairedShell is not mounted (app not paired), it is a harmless no-op (no subscriber) — but in practice notifications only fire during a paired session.

## Error handling

No failure modes to surface. Window activation is best-effort Electron UI (on macOS, `show()`+`focus()` may not steal focus from a foreground app depending on OS settings — acceptable, matches AC intent). The emit is a pure forwarder. The arm is nullary. The bridge listener only dispatches a nav event — it never throws into React. No banner / dialog / silent-error path is introduced.

## Security (not security-sensitive — no `security-sensitive` label)

No socket, key, token, or wire frame is touched; the click originates from a **local OS notification** (not a relay peer); window activation is pure Electron UI; the nullary arm carries nothing untrusted (AC3 by construction). **Guardrail (from the ticket):** window activation must show / focus / navigate only — it must **not** un-gate any paired-only routing guard. This holds structurally: `dispatch({ type: 'open' })` transitions only *within* the paired region (`list`↔`thread`↔…), and PairedShell is only mounted when the app is already paired (App gates paired vs not-paired on the persisted pairing record, upstream of PairedShell). The `open` nav cannot cross the App-level pairing gate. The §3 security-review pass is skipped (label-gated; label absent).

## Testing strategy

Unit tests only (`npm test`, vitest); no Electron harness, no jsdom (composition-seam idiom).

**`src/main/fireNotification.test.ts` (extend `fakeNotification` to capture the `on('click', …)` listener):**
- A simulated click on a fired notification invokes `onClick` exactly once (unfocused + `onClick` spy → capture listener → invoke → assert). Also assert the click listener is registered on the constructed notification (before/at `show()`).
- When the window is focused: no notification is constructed, no click listener registered, `onClick` never invoked (extends the existing "no fire when focused" test).
- `activateWindow` with a fake window (`isMinimized: () => true`): `restore`, `show`, and `focus` are all invoked (AC1).
- `activateWindow` with `isMinimized: () => false`: `show` and `focus` invoked, `restore` **not** invoked.
- (Integration-flavor, satisfies AC4 clause 1 end-to-end) compose `onClick: () => activateWindow(fakeWindow)`, fire unfocused, simulate the captured click, assert `fakeWindow.show`/`focus` invoked — proving *simulated click → window show/focus* with no Electron.

**`src/renderer/src/store/notificationActivatedBridge.test.ts` (NEW; mirror `conversationCreatedBridge.test.ts`'s `fakeBridge`):**
- Subscribes exactly once.
- Invokes `onActivated` once per `notificationActivated` event (nullary — called with no args).
- Ignores a sample of unrelated daemon events (`connecting`, `messageReceived`, `conversationCreated`, `turnState`) — `onActivated` not called.
- Returns the `onDaemonEvent` off handle as the cleanup (assert `off` called once after cleanup).

**`src/renderer/src/PairedShell.test.tsx` (add AC2 seam assertions):**
- `nextPairedRoute('list', { type: 'open' })` → `'thread'` (the notification reuses the existing transition — already asserted for #242; may reference rather than duplicate).
- `nextPairedRoute('settings', { type: 'open' })` → `'thread'` (proves "regardless of view" from settings, AC2).
- `nextPairedRoute('archive', { type: 'open' })` → `'thread'` (proves "regardless of view" from archive, AC2).

Type coverage under `npm run typecheck` (both sides). `npm run build` is the salvage/QA gate.

## Scope & sizing — atomicity exception (auditable)

The §4 raw production-file count is **8** (`fireNotification.ts`, `index.ts`, `events.ts`, three bridges, the new `notificationActivatedBridge.ts`, `PairedShell.tsx`), which trips the ≥5 self-check. This is the **documented atomicity false-positive**, not genuine multi-concern scope:

- 4 of the 8 files — `events.ts` (one arm) + the 3 exhaustive bridges (one one-line no-op each) — are a **compile-atomic cascade**: they must land in one commit or the build breaks, and each is a mechanical one-liner with zero design fan-out. Same shape and precedent as #241 (5-file), #380 (10-file), #381 (~10-file), #396 (5-file) — all shipped and merged as single S tickets.
- Genuine design surface = `fireNotification.ts`, `notificationActivatedBridge.ts`, `index.ts` (3 files); `PairedShell.tsx` is a one-line mount.
- **Every §1 red line passes**: 1 new file (≤3), ~280 total LOC (≤600), 4 new exported symbols (≤5), 3 forced consumer edits (≤10), 4 ACs, 0 reject branches. The turn-budget proxies are all comfortably clear.

Splitting a compile-atomic cascade would produce a non-building intermediate ticket and double the coordination overhead for a single coordinated behavior (click → focus + navigate). **Sized S, not split.**

## Open questions

1. **Electron `Notification.on('click')` structural typecheck.** Widening `OsNotification` with `on(event: 'click', listener: () => void): void` should accept Electron's real `Notification` (an `EventEmitter` with a `'click'` overload) as `OsNotificationConstructor` at `index.ts:362` — return-type `this`→`void` and the fewer-params listener are assignable. Confirm at `npm run typecheck`; if it rejects, prefer loosening the listener param structurally over an `as` cast (the codebase bans unchecked casts).
2. **`activateWindow` sequence robustness.** `restore()` → `show()` → `focus()` is the intended order (un-minimize before show/focus). Confirm against current Electron behavior; the invariant (un-minimized-if-was, visible, focused) is what the tests pin, not the exact call list.
