# App shell (router)

`App` is the renderer's root and its router: at launch it picks between the three built screens — the [welcome screen](welcome-screen.md), the [pairing input screen](pairing-input-screen.md), and the [conversation shell](conversation-shell.md) — and it advances between them in-session, on both user action and daemon-driven events. This is the composition that assembles the finished slices into a runnable whole; it is the app-shell assembly the end-to-end milestone (#13) waits on.

Introduced as a router in [#80](../codebase/80.md), consuming the launch-time [pairing-status signal](pairing-status-signal.md) ([#79](../codebase/79.md)) and the pairing screen's `onPaired` seam ([#55](../codebase/55.md)). [#662](../codebase/662.md) relocated the unpaired launch destination from the pairing screen to the [welcome screen](welcome-screen.md) (shipped dormant in [#657](../codebase/657.md)) and wired the pairing screen's previously-dormant `onCancel` seam back to it. Renderer-only — nothing here touches keys, sockets, or the Noise handshake (ADR [0002](../decisions/0002-remote-head-over-relay-shared-wire.md); those stay in the background process).

## What it does

- **On launch**, before first paint, it asks the background process "does a stored pairing already exist?" and shows the **conversation screen** if — and only if — the answer is a genuine `paired`; otherwise it shows the **welcome screen**. A fresh install lands on welcome; a returning paired user lands directly on the conversation, with no welcome or pairing flash.
- **In-session, from welcome** ([#662](../codebase/662.md)): the welcome screen's primary CTA is a user action, not a status mapping — it flips the route to `pairing`. This is deliberately kept out of `routeForStatus`.
- **In-session, on pairing** ([#662](../codebase/662.md)): Cancel flips the route back to `welcome`, never to `conversation`. Before this ticket `onCancel` was deliberately left unwired, because while pairing was the app root there was nowhere safe for cancel to go; welcome-as-root is what gives it a destination.
- **In-session**, when the user completes a pairing (the confirm step fires `onPaired`), it leaves the pairing screen and shows the conversation screen — no restart, no file edit.
- **In-session, in reverse** ([#166](../codebase/166.md)): when the user unpairs from the conversation screen and the clear succeeds, it fires `onUnpaired` and flips back to the **pairing** screen — not welcome. This is a deliberate, pinned exception: an operator who just unpaired is re-pairing, so the pairing screen (not the first-run welcome explanation) is the right destination for this one flip. [#662](../codebase/662.md) left it untouched and uses `unpair-repair.spec.ts` staying green *and* byte-unchanged as the negative control proving that pin held.
- **While the launch answer is still resolving**, it shows neither screen — a neutral dark canvas — so first paint is never the eventually-wrong screen.

The load-bearing invariant ([ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md)): the conversation screen is reachable **only** on a genuine `paired`. Every other resolved launch outcome — `not-paired`, an unreadable stored pairing (`error`), or even a rejected IPC call — routes to the **welcome** screen (**pairing** before [#662](../codebase/662.md)). The re-pair surface is one hop away, never the fallback itself; the conversation screen is never the fallback either.

## How it works

Three parts, mirroring the codebase's established split — pure logic in a tiny testable module, a pure props-in/markup-out view, and a thin untested async container:

```
src/renderer/src/
├── appRoute.ts        # AppRoute type + routeForStatus (pure, React-free)
├── appRoute.test.ts   # the status→screen mapping, all three PairingStatus outcomes
├── App.tsx            # AppView (pure view) + App (router container)
└── App.test.tsx       # AppView per-route markers + App neutral-first-paint smoke
```

### The route model + decision (`appRoute.ts`)

```ts
export type AppRoute = 'pending' | 'welcome' | 'pairing' | 'conversation'

export function routeForStatus(status: PairingStatus): Exclude<AppRoute, 'pending' | 'pairing'> {
  return status.status === 'paired' ? 'conversation' : 'welcome'
}
```

`routeForStatus` is the pure launch-status→screen map — a total function tested without React, store, or Electron (the `composerSend.ts` precedent). Its whole job is the AC2 fail-safe: **the ternary is deliberate over a per-arm `switch`** — `paired ? conversation : welcome` structurally guarantees that anything not exactly `paired` (`not-paired`, `error`, or any future `PairingStatus` member) falls safe to `welcome`. `pending` is not a `routeForStatus` output — it is the container's *initial* state, before any status has resolved.

[#662](../codebase/662.md) moved the fallback from `pairing` to `welcome` and narrowed the return type to exclude `'pairing'` as well as `'pending'`: after that ticket, pairing is never a *launch* destination, only a place reached by user action (the welcome CTA, or the mid-session `onUnpaired` flip below). Keeping `'pairing'` out of the return type means reintroducing a launch→pairing mapping is a compile error, not a silent behaviour change.

### The pure view (`AppView`, exported from `App.tsx`)

A hookless, effectless component that maps a route to a screen — living beside `App` exactly as `PairingView` lives beside `PairingScreen`:

```ts
export function AppView(props: {
  route: AppRoute
  onPaired: () => void
  onUnpaired: () => void
  onPairRequested: () => void      // welcome screen's CTA pressed (#662)
  onPairingCancelled: () => void   // pairing screen's Cancel fired (#662)
}): JSX.Element | null {
  switch (props.route) {
    case 'pending':      return null
    case 'welcome':      return <WelcomeScreen onPair={props.onPairRequested} />
    case 'pairing':      return <PairingScreen onPaired={props.onPaired} onCancel={props.onPairingCancelled} />
    case 'conversation': return <PairedShell onUnpaired={props.onUnpaired} />
    default:             return assertNever(props.route)
  }
}
```

`onUnpaired` is **required** on `AppView` — symmetric with `onPaired` — while `ConversationScreen`'s own `onUnpaired?` prop stays **optional**, so its pre-#166 bare `<ConversationScreen />` server-render tests keep compiling ([#166](../codebase/166.md)). [#662](../codebase/662.md)'s two new props, `onPairRequested` and `onPairingCancelled`, are likewise **required, not optional** — the whole value of the `assertNever` guard below is that it compile-forces the wiring, and an optional prop would let `App` forget the CTA handler and still build a dead-end root. They are named after *the event that occurred*, matching `onPaired`/`onUnpaired` — deliberately not `onPair`, one letter from the adjacent `onPaired` in a five-prop object. `WelcomeScreen`'s own prop stays named `onPair`; it is shipped surface #662 does not rename.

As of [#140](../codebase/140.md), the `conversation` case mounts the [paired shell](paired-shell.md) — the second-level `list ⇄ thread` router — rather than `ConversationScreen` directly; `ConversationScreen` is now `PairedShellView`'s `'thread'` case, one level down. `onUnpaired` threads through `PairedShell` unchanged.

`pending` renders `null` (see [Pending phase](#pending-phase-neutral-first-paint)). The `switch` closes over the four `AppRoute` members with an **`assertNever` default** — a new route without a case is a compile error (the `reduceSession` / `toMessageViewModel` exhaustiveness guard). Note the two different exhaustiveness strategies: `routeForStatus` fails *safe* on an unknown member (it maps an external, possibly-growing union), while `AppView` fails *at compile time* (it switches over an internal union we fully own). See [#80 notes](../codebase/80.md) for why.

The pairing branch now passes both `onPaired` and `onCancel` — see [Why `onCancel` now navigates](#why-oncancel-now-navigates).

### The container (`App`, default export)

```ts
function App(): JSX.Element {
  useDaemonEventBridge()
  const [route, setRoute] = useState<AppRoute>('pending')

  useEffect(() => {
    let active = true
    window.pyry.pairingStatus()
      .then((status) => { if (active) setRoute(routeForStatus(status)) })
      .catch(() => { if (active) setRoute('welcome') })
    return () => { active = false }
  }, [])

  return (
    <AppView
      route={route}
      onPaired={() => setRoute('conversation')}
      onUnpaired={() => setRoute('pairing')}
      onPairRequested={() => setRoute('pairing')}
      onPairingCancelled={() => setRoute('welcome')}
    />
  )
}
```

The container owns three things and nothing else:

1. **The daemon bridge, unchanged.** `useDaemonEventBridge()` stays the unconditional first line — see [Where the daemon bridge lives](#where-the-daemon-bridge-lives).
2. **Route state** — one `useState<AppRoute>('pending')` (ephemeral shell-local UI state → `useState`, not the store; [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)).
3. **The launch effect** — a single `[]`-deps mount effect that reads `pairingStatus()` once and sets the route via `routeForStatus`, or fails safe to `welcome` on rejection ([#662](../codebase/662.md); was `pairing` before). This catch arm is the one non-paired path that bypasses `routeForStatus` entirely, so it's spelled out rather than inferred, and it stays deliberately **silent** — no `console.error`/`console.warn` — because a rejection from the pairing-status invoke can carry a userData path or internal state, and the renderer console is readable by anything that can open DevTools (flagged and re-checked at #662's code review). `onPaired` (the whole of AC4 in #80) flips the route to `conversation`, unmounting the pairing screen and mounting the conversation screen with no restart. `onUnpaired` ([#166](../codebase/166.md)) is its exact reverse: a successful unpair flips back to `pairing` — **not** `welcome`, a deliberate, pinned exception (see [What it does](#what-it-does)). `onPairRequested` and `onPairingCancelled` ([#662](../codebase/662.md)) are the two new user-action arrows: welcome's CTA into `pairing`, and pairing's Cancel back to `welcome`, never to `conversation`. None of the four handlers does any clearing itself — `onPaired` only navigates (the pairing IPC handler already persisted), and `onUnpaired` only navigates too (the [unpair channel](unpair-channel.md)'s `clear()` and the [session store](session-store.md)'s `reset` both complete in `runUnpair` *before* `onUnpaired` is called), so the launch-status invariant "conversation only when paired" still holds if the user relaunches immediately after either flip.

### Data flow

```
launch → App mounts, route = 'pending'  → AppView renders null (dark canvas)
       → window.pyry.pairingStatus()  ── invoke ──▶ #79 handler (store.load())
       ◀────────── PairingStatus ──────────────────┘
       → routeForStatus(status)
            paired      → 'conversation' → <PairedShell onUnpaired />
            not-paired  → 'welcome'      → <WelcomeScreen onPair />
            error       → 'welcome'      → <WelcomeScreen onPair />
            (rejected)  → 'welcome'      → <WelcomeScreen onPair />

in-session, on the welcome screen (#662):
       CTA pressed      → WelcomeScreen fires onPair → setRoute('pairing')
                        → welcome screen unmounts, pairing screen mounts

in-session, on the pairing screen:
       confirm succeeds → PairingScreen fires onPaired → setRoute('conversation')
                        → pairing screen unmounts, conversation screen mounts
       cancel fired (#662) → PairingScreen fires onCancel → setRoute('welcome')
                        → pairing screen unmounts (reducer state discarded), welcome screen mounts

in-session, on the conversation screen (#166):
       unpair confirmed → window.pyry.unpair() → ok → session store reset → onUnpaired
                        → setRoute('pairing') → conversation screen unmounts, pairing screen mounts
                        (deliberately 'pairing', not 'welcome' — re-pairing, not a cold landing)
```

### Pending phase (neutral first paint)

While `pairingStatus()` is unresolved the route is `pending` and `AppView` renders `null` — the AC3 "neutral/pending state." It is genuinely neutral rather than a white flash: `:root { color-scheme: dark }` (`tokens.css:13`) with neither `body` nor `#root` setting a background means the UA paints a dark canvas until a screen mounts. The window shows dark, then the correct screen — never the wrong screen, not even briefly. The query is a single local `store.load()` over IPC, so `pending` is a sub-frame-to-few-ms sliver in practice. No loading spinner, no placeholder component (that would be new visual the ticket excludes).

### Where the daemon bridge lives

`useDaemonEventBridge()` is called **unconditionally**, above the route branch — not moved inside the conversation branch. It is an app-lifetime subscription (subscribe on mount, unsubscribe on unmount, already StrictMode-safe). Keeping it app-level means one stable listener for the whole session, with no subscribe/unsubscribe churn as the route flips pairing→conversation — and it is already mounted before `onPaired` fires, so when connect-on-pair ([#82](https://github.com/pyrycode/pyrycode-desktop/issues/82)) later starts the connection at pair time, no early daemon event can be missed in the gap between the pair completing and the conversation screen mounting. While on the pairing screen no connection is running yet, so the [session store](session-store.md) simply sits idle — harmless.

### Why `onCancel` now navigates

Before [#662](../codebase/662.md), the pairing branch passed only `onPaired`, never `onCancel`: when unpaired the pairing screen *was* the app root, so there was no screen to cancel *back* to, and cancel's correct app-shell behavior was "stay on the pairing screen" — exactly what happened when `App` did not navigate on cancel (`PairingScreen`'s internal reducer resets itself to the editing phase, route unchanged). Wiring a navigating `onCancel` then would have risked exposing the conversation screen before pairing.

[#662](../codebase/662.md) relocated the root to `welcome`, which is what finally gives cancel a *safe* destination: `onPairingCancelled` flips the route to `welcome`, never to `conversation`, so the fail-safe stays untouched while cancel gains a real navigating behaviour. Cancelling now unmounts `PairingScreen`, destroying its `useReducer` state — belt to the existing suspender, since the reducer's own `cancel` arm already discards the pasted payload independently of unmount (`pairingState.ts`). The correct wiring changed from *absence* of a handler to a *route-limited* one — both documented, neither accidental.

## State + concurrency model

- **Single source of route state:** `App`'s `route` `useState`. No store slice — this is ephemeral screen-selection UI state ([ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md)); the session store remains the single source of *conversation* state, untouched here.
- **Launch effect: once, cancellable.** `[]` deps; a local `let active = true` guards both `.then` and `.catch`, cleaned up by `return () => { active = false }`. Under React 18 StrictMode (dev) the effect mounts→unmounts→remounts; the first run's promise is cancelled, so only the second resolution applies its `setRoute`. Each `pairingStatus()` call is an idempotent local read, so a duplicate in-flight call is benign regardless.
- **No clobber between the two `setRoute`s.** `onPaired` can only fire *after* the pairing screen is mounted, which only happens *after* the launch query has already resolved to a non-paired route. So the launch `setRoute` has always completed before `onPaired`'s `setRoute('conversation')` is reachable — no ordering hazard, no functional-update guard needed. The `active` flag is StrictMode hygiene only.

## Edge cases and limitations

- **`error` and `not-paired` are visually identical here** — both land on the welcome screen (per ADR 0005 and the ticket; was the pairing screen before [#662](../codebase/662.md)). No banner, no "your pairing is unreadable" prompt; that recovery affordance is [#43](../codebase/43.md)/[#44](../codebase/44.md), and may extend this router additively.
- **A late launch-query resolution cannot yank a user off pairing.** The welcome CTA is only clickable once the welcome screen has rendered, which only happens after the launch query has already settled (`pending` renders `null`, so there's no CTA before then), and a settled promise cannot settle again — the race is structurally impossible, not merely unlikely ([#662](../codebase/662.md)).
- **The async launch effect and `onPaired`→`setRoute` are not integration-tested** — `renderToStaticMarkup` (node vitest, no DOM harness) never runs effects. The coverage sits on the pure seams (`routeForStatus`, `AppView`); the container is smoke-tested only for the neutral first paint. This is the same precedented gap as `useDaemonEventBridge` / `PairingScreen`'s IPC wiring. `AC4` (Cancel → welcome) is the one exception with executable e2e coverage — see [Welcome screen](welcome-screen.md) — since the unit tier cannot fire a callback at all.
- **A known-open gap: `e2e/smoke.spec.ts`'s Cancel round-trip test asserts a vacuous `.conversation` count-0** as its guard against Cancel leaking to the conversation screen. `.conversation` is `ConversationScreen`'s own root class, but the `conversation` route mounts `PairedShell`, entering at `'list'` (`.channel-list`) — so the assertion reads 0 regardless of whether the regression it claims to catch occurred. Flagged [SHOULD FIX, unresolved] at [#662's code review](../codebase/662.md#code-review); the fix is asserting `.channel-list` instead, or trimming the claim.
- **Landing on the conversation screen does not require a live connection.** Navigation on `onPaired` is independent of the main-process connect-after-pair choreography (#34/[#82](https://github.com/pyrycode/pyrycode-desktop/issues/82)); the [composer is gated on connection status](composer-send.md) ([#31](../codebase/31.md)), so a conversation screen mounted before the socket is up is safe (the composer shows a disabled state with a reason).

## Related

- [Welcome screen](welcome-screen.md) / [#657](../codebase/657.md), [#662](../codebase/662.md) — the screen the router mounts on any non-paired launch outcome as of #662; source of the `onPair` seam this router's `onPairRequested` consumes.
- [Pairing-status signal](pairing-status-signal.md) / [#79](../codebase/79.md) — the launch-time `paired`/`not-paired`/`error` signal the router consumes; the data-path half to this routing half
- [Pairing input screen](pairing-input-screen.md) / [#55](../codebase/55.md), [#662](../codebase/662.md) — the screen the router mounts on a user-initiated pair request; source of the `onPaired`/`onCancel` seams, both wired since #662
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md), [#69](../codebase/69.md) — the `paired` destination; source of the `onUnpaired` seam as of [#166](../codebase/166.md)
- [Paired shell](paired-shell.md) / [#140](../codebase/140.md) — the second-level `list ⇄ thread` router now mounted on the `conversation` route, nesting the conversation shell one level down
- [Unpair channel](unpair-channel.md) / [#173](../codebase/173.md) — the main-side bridge `runUnpair` calls before firing `onUnpaired` ([#166](../codebase/166.md))
- [Session store](session-store.md) — reset via `{ type: 'reset' }` before `onUnpaired` fires, so the flip and the state clear are never observed out of order ([#166](../codebase/166.md))
- [Daemon-event bridge](daemon-event-bridge.md) / [#19](../codebase/19.md) — the app-lifetime subscription kept at shell level, above the route branch
- [Composer send](composer-send.md) / [#31](../codebase/31.md) — why landing on the conversation screen before the socket is up is safe
- [ADR 0005](../decisions/0005-secret-at-rest-safestorage-fail-closed.md) — an unreadable record is never masked as never-paired; why `error` routes to welcome (was pairing before #662)
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — ephemeral screen-local state → `useState`, not the store
- [#80 codebase notes](../codebase/80.md) · [#166 codebase notes](../codebase/166.md) · [#662 codebase notes](../codebase/662.md) · Spec: `docs/specs/architecture/80-app-shell-pairing-then-conversation.md`, `docs/specs/architecture/662-welcome-as-unpaired-root.md`
