# #392 — Push-notify renderer trigger (turn-end + prompt, gated by the push toggle)

**Size:** S. One new filter-bridge file (`pushNotifyBridge.ts`: pure translate fn + React-free subscribe fn + thin mount hook, ~35 lines) plus a one-line mount in `PairedShell`. Its unit test roughly doubles the diff. No new type, no wire change, no new exhaustive-switch case, no consumer cascade. Two production files touched (`pushNotifyBridge.ts` new, `PairedShell.tsx` modified) — well under the split red lines.

**Not security-sensitive** (no label). The trigger reads already-decoded, already-validated daemon events and sends a closed-enum, MAIN-LOCAL command that never reaches the transport; it touches no socket, key, or wire frame. The closed-set boundary guard (`isNotifyPayload`) already lives main-side (#391). No security-review pass runs.

**Not UI.** No `## Figma` section in the ticket body and nothing visible renders — this slice is a headless daemon-event → command bridge. No Design source section.

## Files to read first

- `src/renderer/src/store/notificationActivatedBridge.ts:1-50` — **the nearest clone template.** The `default:null`-style FILTER bridge: React-free `subscribe*` (injected `onDaemonEvent`, returns the off handle) + thin `use*Nav` hook that derefs `window.pyry` **only inside the effect**. Copy this shape; the difference is our bridge owns *two* arms and *sends a command* instead of invoking a caller callback.
- `src/renderer/src/store/conversationCreatedBridge.ts:23-69` — **two precedents in one file.** `requestNewConversation` (23-31) inlines `{ type: 'createConversation', payload: {...} }` typed as `RendererCommand` with **no constructor helper** — the inline-command-literal precedent this slice follows. `translateConversationCreated` (41-50) is the `switch … default: return null` filter precedent for `notifyKindForEvent`.
- `src/renderer/src/store/notificationActivatedBridge.test.ts:1-77` — **the test idiom to clone.** Framework-free, injected spies: `fakeBridge()` captures the listener and hands back an `off` spy; assert "subscribes once", "invokes on the owned arm", "ignores a sample of unrelated events", "returns off as cleanup". Extend for the toggle + command-send.
- `src/renderer/src/store/pushNotificationPrefStore.ts:116-132` — **the toggle read surface (#408, landed).** Read via `pushNotificationPrefStore.getState().pushNotificationsEnabled` (or `selectPushNotificationsEnabled(pushNotificationPrefStore.getState())`). Default is enabled; the store never surfaces `null`.
- `src/shared/ipc/commands.ts:53-146` — `NotifyKind` (`'turn-complete' | 'prompt'`), `NotifyPayload` (`{ kind: NotifyKind }`), and the `notify` arm on `RendererCommand` (line 146). Confirm there is **no `notifyCommand()` helper** today — inline the literal (do not add one; that would touch a shared file for a single call site).
- `src/shared/ipc/events.ts:104-282` — the two arms the filter owns: `turnEnd` (line 110, `{ turnId; stopReason }`) and `modalShown` (274-282, `{ modalId; class; title; prompt; options; defaultOptionId }`). **The trigger reads only `event.type`** — never `turnId`, `stopReason`, `title`, `prompt`, etc. (AC4 by construction).
- `src/shared/wire/types.ts:416` — `WireModalClass = 'permission' | 'trust'`. Exactly two values, no destructive class (ADR 0009). Every `modalShown` *is* a permission/trust prompt, so **no class-narrowing filter is needed**.
- `src/renderer/src/PairedShell.tsx:81-113` — the mount site: add `usePushNotify()` beside `useConversationCreatedNav` / `useNotificationActivatedNav` in the `PairedShell` container.
- `src/renderer/src/PairedShell.test.tsx:113-118` — the container mount test that server-renders `<PairedShell />` **without a `window` stub**. This is the invariant your hook must not break: `window.pyry` may be dereferenced **only inside the effect** (effects don't run under `renderToStaticMarkup`), so the new mount keeps this test green.

## Context

Desktop push rides the relay socket the app already holds open (no Firebase; decided 2026-07-08). Two dependencies have **landed**:

- **#391 (MERGED)** — the main-process delivery primitive. It raises the OS notification *only when the window is unfocused*, keyed by the closed `NotifyKind` enum, mapping each kind to a static copy table so no daemon text can ride in. The `notify` command already exists on `RendererCommand`.
- **#408 (MERGED)** — the readable `pushNotificationPrefStore` (renderer-local, default **enabled**).

This slice is the **renderer trigger**: it watches the already-decoded daemon events for the two notify-worthy moments (turn-end, permission/trust prompt) and sends a `notify` command asking main to raise the OS notification — gated by the Settings push toggle.

**Two deterministic gates, different fabric.** Main gates on *window focus* (it owns focus, #391). This slice gates on the *Settings push toggle* (the renderer owns settings state, #408). Belt-and-suspenders with distinct fabric — neither gate is a stochastic agent rule.

## Design

### New module: `src/renderer/src/store/pushNotifyBridge.ts`

Three exports, mirroring the `notificationActivatedBridge` / `conversationCreatedBridge` split (pure filter → React-free subscribe → thin hook):

**1. The filter** — `notifyKindForEvent(event: DaemonEvent): NotifyKind | null`

A `switch` on `event.type` that owns exactly the two arms and no-ops everything else via `default: return null` (the `translateConversationCreated` precedent):

- `case 'turnEnd': return 'turn-complete'`
- `case 'modalShown': return 'prompt'`
- `default: return null`

This is the **filter-not-exhaustive** crux (ticket technical note): it introduces no new `DaemonEvent` arm, so it must NOT be an `assertNever` exhaustive switch — that would force matching no-op cases into `modalBridge`, `timelineBridge`, AND `daemonEventBridge`. `default: null` is the intended, permanent behaviour (this path deliberately consumes only its two arms). It reads only the discriminant — the returned value is always a closed `NotifyKind` literal, never a daemon-supplied field (AC4 by construction; a `typeof`-widened string cannot escape here because the return type is `NotifyKind | null`).

**2. The subscribe seam** — `subscribePushNotify(onDaemonEvent, sendCommand, isPushEnabled): () => void`

Injected-deps signature (the sibling-bridge idiom, all three are spies in the test):

- `onDaemonEvent: (listener: (event: DaemonEvent) => void) => () => void`
- `sendCommand: (command: RendererCommand) => void`
- `isPushEnabled: () => boolean`

Behaviour: subscribe once; per event → `notifyKindForEvent(event)`; if `null`, no-op; **then** read `isPushEnabled()`; if `false`, no-op; else `sendCommand({ type: 'notify', payload: { kind } })` as an inline `RendererCommand` literal (no `notifyCommand()` helper). Returns the `onDaemonEvent` off handle as the cleanup. ~8 lines.

- **Filter-first, then toggle** — short-circuits the common case (most events are neither arm) before touching the store, and keeps "every other daemon event no-ops" literally true regardless of toggle state.
- **`isPushEnabled` is a thunk read PER-EVENT**, not a boolean captured at subscribe time. This is load-bearing for AC3: a user who flips the toggle off in Settings mid-session must see the *next* turn-end/prompt not fire. Production passes `() => pushNotificationPrefStore.getState().pushNotificationsEnabled`, which reads current store state on each call.
- **Fresh `{ kind }` literal** — the payload is constructed from the closed `kind` alone; no daemon field is copied in. Combined with the `NotifyKind | null` return type, this makes AC4 ("only the closed literal, never daemon text") a compile-time + construction guarantee.

**3. The mount hook** — `usePushNotify(): void`

An empty-dep `useEffect` returning `subscribePushNotify(window.pyry.onDaemonEvent, window.pyry.sendCommand, () => pushNotificationPrefStore.getState().pushNotificationsEnabled)`.

- **No `useRef` ceremony** — unlike `useNotificationActivatedNav` / `useConversationCreatedNav`, there is no per-render caller callback to hold in a ref: all three deps are module-level singletons, so the effect closure is stable and self-contained. This is a deliberate *simplification* from the sibling shape, not a divergence.
- `window.pyry` is dereferenced **only inside the effect** → `PairedShell` stays server-renderable (the `PairedShell.test.tsx:113-118` container test has no `window` stub) and the empty-dep effect + off-handle cleanup nets exactly one live listener under a StrictMode double-mount (AC5).

### Mount: `src/renderer/src/PairedShell.tsx`

Add `usePushNotify()` to the `PairedShell` **container** function (~line 99, beside `useNotificationActivatedNav`), plus the import. One line + one import. The subscription lives only while the paired shell is on screen — unpair tears it down (off handle), re-pair mounts a fresh one.

## State + concurrency model

No store slice is added or written — the trigger only *reads* `pushNotificationPrefStore` (via `getState()`) and *emits* a command. It is a third **independent** subscriber on the `onDaemonEvent` fan-out channel, alongside the timeline bridge (which also consumes `turnEnd`, #202) and the modal bridge (which also consumes `modalShown`, #223). Independent subscriptions on the same channel are the established pattern (`notificationActivatedBridge` is already a peer subscriber); no arm is "claimed" and no exhaustive switch is widened. Cancellation/teardown: the effect's returned off handle unsubscribes on unmount (unpair / window close). No fire-and-forget promise outlives the window — `sendCommand` is synchronous fire-and-forget `void`.

## Error handling

None to add. `sendCommand` is fire-and-forget `void` (the composer-send convention); there is no reply to await and no failure to surface. The main side already fail-closes: a `notify` payload that fails `isNotifyPayload` (#391) is dropped at the untrusted boundary, and a well-formed one raises a notification only when unfocused. The trigger cannot construct an invalid payload — `notifyKindForEvent` returns a closed `NotifyKind`. The listener only ever calls `sendCommand` inside the two owned arms and never throws into React (the sibling-bridge guarantee).

## Testing strategy

`npm test` (vitest, `node` env), framework-free with injected spies — clone `notificationActivatedBridge.test.ts`'s `fakeBridge()` (captures the listener, hands back an `off` spy) and add a `sendCommand` spy plus a mutable `isPushEnabled` fake. Scenarios (bullet form; developer writes the test bodies in the project idiom):

- **subscribes exactly once** — `onDaemonEvent` called once (sibling parity).
- **turnEnd + toggle enabled → command sent (AC1)** — emit `{ type: 'turnEnd', turnId, stopReason }`; assert `sendCommand` called once with exactly `{ type: 'notify', payload: { kind: 'turn-complete' } }`. Use distinctive `turnId`/`stopReason` values and assert they do **not** appear in the sent payload (AC4 — no daemon field leaks).
- **modalShown + toggle enabled → command sent (AC2)** — emit a `modalShown` with a distinctive `title`/`prompt`; assert `sendCommand` called once with exactly `{ type: 'notify', payload: { kind: 'prompt' } }`, and the title/prompt do not appear.
- **turnEnd + toggle disabled → no command (AC3)** and **modalShown + toggle disabled → no command (AC3)** — `isPushEnabled` returns false; `sendCommand` not called.
- **toggle read is per-event (AC3, mid-session flip)** — enabled → emit turnEnd (fires); flip the fake to disabled → emit again (no second call). Proves the thunk is read at emit time, not captured at subscribe.
- **unrelated events no-op (AC4)** — emit a sample (`connecting`, `messageReceived`, `turnState`, `conversationCreated`, `toolUse`, `notificationActivated`) with the toggle enabled; `sendCommand` never called.
- **returns off as cleanup** — `off` not called until the returned cleanup runs, then called once (StrictMode/unmount teardown, AC5).
- **`notifyKindForEvent` mapping (direct unit)** — `turnEnd → 'turn-complete'`, `modalShown → 'prompt'`, a sample of others → `null`. Pins the closed mapping (AC4's "only the closed kind literal").

`npm run typecheck` covers the type-level guarantee: `notifyKindForEvent`'s `NotifyKind | null` return and the `RendererCommand`-typed inline literal make a non-closed `kind` a compile error.

The **hook** (`usePushNotify`) is proven by composition, not a jsdom harness (the `notificationActivatedBridge` posture): the subscribe seam is unit-tested above; server-render safety is covered by `PairedShell.test.tsx`'s existing container test (which must stay green with the new mount — no `window` deref at render).

## Open questions

None. Both dependencies are merged; the read surface, the command shape, and the mount site are all confirmed against current `main`. The design is a direct clone of an established filter-bridge with two owned arms plus a toggle read.
