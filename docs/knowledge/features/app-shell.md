# App shell (router)

`App` is the renderer's root and its router: at launch it picks between the two built screens — the [pairing input screen](pairing-input-screen.md) and the [conversation shell](conversation-shell.md) — and it advances from one to the other in-session. This is the composition that assembles the finished slices into a runnable whole; it is the app-shell assembly the end-to-end milestone (#13) waits on.

Introduced as a router in [#80](../codebase/80.md), consuming the launch-time [pairing-status signal](pairing-status-signal.md) ([#79](../codebase/79.md)) and the pairing screen's `onPaired` seam ([#55](../codebase/55.md)). Renderer-only — nothing here touches keys, sockets, or the Noise handshake (ADR [0002](../decisions/0002-remote-head-over-relay-shared-wire.md); those stay in the background process).

## What it does

- **On launch**, before first paint, it asks the background process "does a stored pairing already exist?" and shows the **conversation screen** if — and only if — the answer is a genuine `paired`; otherwise it shows the **pairing screen**. A fresh install lands on pairing; a returning paired user lands directly on the conversation, with no pairing flash.
- **In-session**, when the user completes a pairing (the confirm step fires `onPaired`), it leaves the pairing screen and shows the conversation screen — no restart, no file edit.
- **In-session, in reverse** ([#166](../codebase/166.md)): when the user unpairs from the conversation screen and the clear succeeds, it fires `onUnpaired` and flips back to the pairing screen — no restart, the exact mirror of `onPaired`.
- **While the launch answer is still resolving**, it shows neither screen — a neutral dark canvas — so first paint is never the eventually-wrong screen.

The load-bearing invariant ([ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md)): the conversation screen is reachable **only** on a genuine `paired`. Every other resolved launch outcome — `not-paired`, an unreadable stored pairing (`error`), or even a rejected IPC call — routes to the pairing screen. The re-pair surface is the fail-safe default; the conversation screen is never the fallback.

## How it works

Three parts, mirroring the codebase's established split — pure logic in a tiny testable module, a pure props-in/markup-out view, and a thin untested async container:

```
src/renderer/src/
├── appRoute.ts        # AppRoute type + routeForStatus (pure, React-free)
├── appRoute.test.ts   # the status→screen mapping, all three outcomes
├── App.tsx            # AppView (pure view) + App (router container)
└── App.test.tsx       # AppView per-route markers + App neutral-first-paint smoke
```

### The route model + decision (`appRoute.ts`)

```ts
export type AppRoute = 'pending' | 'pairing' | 'conversation'

export function routeForStatus(status: PairingStatus): Exclude<AppRoute, 'pending'> {
  return status.status === 'paired' ? 'conversation' : 'pairing'
}
```

`routeForStatus` is the pure launch-status→screen map — a total function tested without React, store, or Electron (the `composerSend.ts` precedent). Its whole job is the AC2 fail-safe: **the ternary is deliberate over a per-arm `switch`** — `paired ? conversation : pairing` structurally guarantees that anything not exactly `paired` (`not-paired`, `error`, or any future `PairingStatus` member) falls safe to `pairing`. `pending` is not a `routeForStatus` output — it is the container's *initial* state, before any status has resolved.

### The pure view (`AppView`, exported from `App.tsx`)

A hookless, effectless component that maps a route to a screen — living beside `App` exactly as `PairingView` lives beside `PairingScreen`:

```ts
export function AppView(props: {
  route: AppRoute
  onPaired: () => void
  onUnpaired: () => void
}): JSX.Element | null {
  switch (props.route) {
    case 'pending':      return null
    case 'pairing':      return <PairingScreen onPaired={props.onPaired} />
    case 'conversation': return <ConversationScreen onUnpaired={props.onUnpaired} />
    default:             return assertNever(props.route)
  }
}
```

`onUnpaired` is **required** on `AppView` — symmetric with `onPaired` — while `ConversationScreen`'s own `onUnpaired?` prop stays **optional**, so its pre-#166 bare `<ConversationScreen />` server-render tests keep compiling ([#166](../codebase/166.md)).

`pending` renders `null` (see [Pending phase](#pending-phase-neutral-first-paint)). The `switch` closes over the three `AppRoute` members with an **`assertNever` default** — a new route without a case is a compile error (the `reduceSession` / `toMessageViewModel` exhaustiveness guard). Note the two different exhaustiveness strategies: `routeForStatus` fails *safe* on an unknown member (it maps an external, possibly-growing union), while `AppView` fails *at compile time* (it switches over an internal union we fully own). See [#80 notes](../codebase/80.md) for why.

The pairing branch deliberately does **not** pass `onCancel` — see [Why `onCancel` is unwired](#why-oncancel-is-unwired).

### The container (`App`, default export)

```ts
function App(): JSX.Element {
  useDaemonEventBridge()
  const [route, setRoute] = useState<AppRoute>('pending')

  useEffect(() => {
    let active = true
    window.pyry.pairingStatus()
      .then((status) => { if (active) setRoute(routeForStatus(status)) })
      .catch(() => { if (active) setRoute('pairing') })
    return () => { active = false }
  }, [])

  return (
    <AppView
      route={route}
      onPaired={() => setRoute('conversation')}
      onUnpaired={() => setRoute('pairing')}
    />
  )
}
```

The container owns three things and nothing else:

1. **The daemon bridge, unchanged.** `useDaemonEventBridge()` stays the unconditional first line — see [Where the daemon bridge lives](#where-the-daemon-bridge-lives).
2. **Route state** — one `useState<AppRoute>('pending')` (ephemeral shell-local UI state → `useState`, not the store; [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)).
3. **The launch effect** — a single `[]`-deps mount effect that reads `pairingStatus()` once and sets the route via `routeForStatus`, or fails safe to `pairing` on rejection. `onPaired` (the whole of AC4 in #80) flips the route to `conversation`, unmounting the pairing screen and mounting the conversation screen with no restart. `onUnpaired` ([#166](../codebase/166.md)) is its exact reverse: a successful unpair flips back to `pairing`. Neither handler does any clearing itself — `onPaired` only navigates (the pairing IPC handler already persisted), and `onUnpaired` only navigates too (the [unpair channel](unpair-channel.md)'s `clear()` and the [session store](session-store.md)'s `reset` both complete in `runUnpair` *before* `onUnpaired` is called), so the launch-status invariant "conversation only when paired" still holds if the user relaunches immediately after either flip.

### Data flow

```
launch → App mounts, route = 'pending'  → AppView renders null (dark canvas)
       → window.pyry.pairingStatus()  ── invoke ──▶ #79 handler (store.load())
       ◀────────── PairingStatus ──────────────────┘
       → routeForStatus(status)
            paired      → 'conversation' → <ConversationScreen />
            not-paired  → 'pairing'      → <PairingScreen onPaired />
            error       → 'pairing'      → <PairingScreen onPaired />
            (rejected)  → 'pairing'      → <PairingScreen onPaired />

in-session, on the pairing screen:
       confirm succeeds → PairingScreen fires onPaired → setRoute('conversation')
                        → pairing screen unmounts, conversation screen mounts

in-session, on the conversation screen (#166):
       unpair confirmed → window.pyry.unpair() → ok → session store reset → onUnpaired
                        → setRoute('pairing') → conversation screen unmounts, pairing screen mounts
```

### Pending phase (neutral first paint)

While `pairingStatus()` is unresolved the route is `pending` and `AppView` renders `null` — the AC3 "neutral/pending state." It is genuinely neutral rather than a white flash: `:root { color-scheme: dark }` (`tokens.css:13`) with neither `body` nor `#root` setting a background means the UA paints a dark canvas until a screen mounts. The window shows dark, then the correct screen — never the wrong screen, not even briefly. The query is a single local `store.load()` over IPC, so `pending` is a sub-frame-to-few-ms sliver in practice. No loading spinner, no placeholder component (that would be new visual the ticket excludes).

### Where the daemon bridge lives

`useDaemonEventBridge()` is called **unconditionally**, above the route branch — not moved inside the conversation branch. It is an app-lifetime subscription (subscribe on mount, unsubscribe on unmount, already StrictMode-safe). Keeping it app-level means one stable listener for the whole session, with no subscribe/unsubscribe churn as the route flips pairing→conversation — and it is already mounted before `onPaired` fires, so when connect-on-pair ([#82](https://github.com/pyrycode/pyrycode-desktop/issues/82)) later starts the connection at pair time, no early daemon event can be missed in the gap between the pair completing and the conversation screen mounting. While on the pairing screen no connection is running yet, so the [session store](session-store.md) simply sits idle — harmless.

### Why `onCancel` is unwired

The pairing branch passes only `onPaired`, never `onCancel`. When unpaired the pairing screen is the app root — there is no screen to cancel *back* to. Cancel's correct app-shell behavior is "stay on the pairing screen," which is exactly what happens when `App` does not navigate on cancel: `PairingScreen`'s internal reducer resets itself to the editing phase and the route stays `pairing`. Wiring an `onCancel` that navigated anywhere would risk exposing the conversation screen before pairing, which AC5 forbids. The correct wiring is the *absence* of a navigating handler — documented, not accidental.

## State + concurrency model

- **Single source of route state:** `App`'s `route` `useState`. No store slice — this is ephemeral screen-selection UI state ([ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)); the session store remains the single source of *conversation* state, untouched here.
- **Launch effect: once, cancellable.** `[]` deps; a local `let active = true` guards both `.then` and `.catch`, cleaned up by `return () => { active = false }`. Under React 18 StrictMode (dev) the effect mounts→unmounts→remounts; the first run's promise is cancelled, so only the second resolution applies its `setRoute`. Each `pairingStatus()` call is an idempotent local read, so a duplicate in-flight call is benign regardless.
- **No clobber between the two `setRoute`s.** `onPaired` can only fire *after* the pairing screen is mounted, which only happens *after* the launch query has already resolved to a non-paired route. So the launch `setRoute` has always completed before `onPaired`'s `setRoute('conversation')` is reachable — no ordering hazard, no functional-update guard needed. The `active` flag is StrictMode hygiene only.

## Edge cases and limitations

- **`error` and `not-paired` are visually identical here** — both land on the pairing screen, per ADR 0005 and the ticket. No banner, no "your pairing is unreadable" prompt; that recovery affordance is [#43](../codebase/43.md)/[#44](../codebase/44.md), and may extend this router additively.
- **The async launch effect and `onPaired`→`setRoute` are not integration-tested** — `renderToStaticMarkup` (node vitest, no DOM harness) never runs effects. The coverage sits on the pure seams (`routeForStatus`, `AppView`); the container is smoke-tested only for the neutral first paint. This is the same precedented gap as `useDaemonEventBridge` / `PairingScreen`'s IPC wiring.
- **Landing on the conversation screen does not require a live connection.** Navigation on `onPaired` is independent of the main-process connect-after-pair choreography (#34/[#82](https://github.com/pyrycode/pyrycode-desktop/issues/82)); the [composer is gated on connection status](composer-send.md) ([#31](../codebase/31.md)), so a conversation screen mounted before the socket is up is safe (the composer shows a disabled state with a reason).

## Related

- [Pairing-status signal](pairing-status-signal.md) / [#79](../codebase/79.md) — the launch-time `paired`/`not-paired`/`error` signal the router consumes; the data-path half to this routing half
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md) — the screen the router mounts when unpaired; source of the `onPaired`/`onCancel` seams (`onPaired` wired, `onCancel` deliberately not)
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md), [#69](../codebase/69.md) — the `paired` destination; source of the `onUnpaired` seam as of [#166](../codebase/166.md)
- [Unpair channel](unpair-channel.md) / [#173](../codebase/173.md) — the main-side bridge `runUnpair` calls before firing `onUnpaired` ([#166](../codebase/166.md))
- [Session store](session-store.md) — reset via `{ type: 'reset' }` before `onUnpaired` fires, so the flip and the state clear are never observed out of order ([#166](../codebase/166.md))
- [Daemon-event bridge](daemon-event-bridge.md) / [#19](../codebase/19.md) — the app-lifetime subscription kept at shell level, above the route branch
- [Composer send](composer-send.md) / [#31](../codebase/31.md) — why landing on the conversation screen before the socket is up is safe
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — an unreadable record is never masked as never-paired; why `error` routes to pairing
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — ephemeral screen-local state → `useState`, not the store
- [#80 codebase notes](../codebase/80.md) · [#166 codebase notes](../codebase/166.md) · Spec: `docs/specs/architecture/80-app-shell-pairing-then-conversation.md`
