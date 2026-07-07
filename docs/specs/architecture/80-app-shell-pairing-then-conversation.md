# #80 — App shell: pairing screen until paired, then conversation

## Files to read first

- `src/renderer/src/App.tsx:1-9` — the current root. It renders `<ConversationScreen />` directly and calls `useDaemonEventBridge()` unconditionally. This slice turns it into a router; keep the bridge call exactly where it is (see § Design, "Where the daemon bridge lives").
- `src/renderer/src/main.tsx:1-11` — the mount point. Imports `App` as the **default export** and wraps it in `<React.StrictMode>`. Unchanged by this slice — but StrictMode double-invokes effects in dev, which drives the launch-effect cancellation flag (§ State + concurrency).
- `src/renderer/src/screens/pairing/PairingScreen.tsx:161-210` — the `PairingScreenProps` seam (`bridge?`, `onPaired?`, `onCancel?`) this slice consumes. Note line 175: `const target = bridge ?? window.pyry` runs **at render**, so rendering `<PairingScreen>` without a bridge dereferences `window.pyry` — a test-only gotcha in the node vitest env (§ Testing strategy). `onPaired` fires once on a successful confirm (line 192); `onCancel` fires on cancel (line 198) and its only current effect is a reducer reset.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:16-27` — the paired destination. Store-bound but server-renders without a window (proven in its test), so the router's conversation branch is testable.
- `src/shared/ipc/pairingStatus.ts` (whole file, ~50 lines) — the `PairingStatus` union (`paired` / `not-paired` / `error`) and `PAIRING_STATUS_CHANNEL`. **Read the doc-comment on the union**: `error` is deliberately distinct from `not-paired` (ADR 0005) and both must route to the pairing screen here.
- `src/preload/index.ts:54` — the bridge method `pairingStatus(): Promise<PairingStatus>` this slice calls. Registered on `window.pyry` via `contextBridge`; the main handler is registered synchronously in `whenReady` before the window loads, so the first `invoke` always finds it.
- `docs/specs/architecture/79-launch-time-pairing-status-signal.md` — the data-path half this slice consumes. The "Error handling" table there enumerates exactly which `load()` outcomes map to each `PairingStatus`; this slice is the routing half.
- `src/renderer/src/screens/conversation/composerSend.ts` + `.test.ts` — the pure-seam-in-its-own-module + thorough-unit-test pattern to mirror for `appRoute.ts` / `appRoute.test.ts` (`composerAvailability` is the direct analog of `routeForStatus`).
- `src/renderer/src/screens/pairing/PairingScreen.test.tsx:1-24, 68-` and `ConversationScreen.test.tsx:50-63` — the two test idioms to copy: `renderToStaticMarkup` structural assertions for pure views, and "renders without throwing" smoke tests for React containers whose async wiring is left untested.
- `src/renderer/src/theme/tokens.css:12-13` — `:root { color-scheme: dark }` with no body background. This is why a `null` render during the pending phase paints a neutral dark canvas (no white flash) — the basis for AC3 (§ Design, "Pending phase").

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=19-54

This slice adds only routing/gating between two screens that are already designed and built — the pairing screen (node `19-54`, shipped in #55) and the conversation screen (node `16-8`, shipped in #69). The transition itself introduces **no new visual**: no new component, no new token, no splash/loading art. The pending phase renders nothing (the dark canvas from `color-scheme: dark` shows through). No `get_design_context` fetch is needed because there is no new surface to reproduce; the two destination screens own their own fidelity under their own tickets.

## Context

The renderer has both screens built and styled, but `App.tsx` hard-renders `<ConversationScreen />` and never mounts the pairing screen — so there is no in-app way to reach pairing, and a fresh pair is impossible. #79 shipped the launch-time signal (`window.pyry.pairingStatus()`) that answers "does a stored pairing exist?" as a clean, connect-independent, value-free tri-state. This slice is the **routing half**: consume that signal at launch to pick the initial screen, and consume the pairing screen's existing `onPaired` seam to advance to the conversation screen in-session. It is the app-shell composition the end-to-end milestone (#13) waits on. Renderer-only; no main-process code.

The load-bearing invariant (AC2, ADR 0005): the conversation screen is reachable **only** on a genuine `paired` outcome. Every other resolved outcome — `not-paired` or `error` — routes to the pairing screen. `error` is never collapsed into `not-paired`; here they simply share the only re-pair surface. A richer "your pairing is unreadable" recovery prompt is out of scope (#43/#44).

## Design

Three parts: a pure decision function in its own module (`appRoute.ts`), a pure router view, and the `App` container that owns the launch state and the async effect. This mirrors the codebase's established split — pure logic in a tiny testable module (`composerSend.ts`), a pure props-in/markup-out view (`PairingView`, `MessageThread`), and a thin untested async container (`PairingScreen`, `useDaemonEventBridge`).

### Module 1 — pure decision: `src/renderer/src/appRoute.ts` (new)

The route model and the status→screen mapping, no React:

```ts
export type AppRoute = 'pending' | 'pairing' | 'conversation'

// Fail-safe by construction: ONLY a genuine `paired` reaches the conversation screen;
// every other resolved outcome (not-paired, error, or any future member) routes to pairing.
// This is AC2's "conversation reachable only on paired" enforced as a total function.
export function routeForStatus(status: PairingStatus): Exclude<AppRoute, 'pending'>
```

Body is one line: `status.status === 'paired' ? 'conversation' : 'pairing'`. Prefer the ternary over a per-arm `switch`: it structurally guarantees that anything that is not exactly `paired` fails safe to `pairing`, which is the AC2 security posture. Imports `PairingStatus` from `../../shared/...`? No — the renderer has the `@shared` alias (`import type { PairingStatus } from '@shared/ipc/pairingStatus'`), the same import `PairingScreen.tsx` uses for `PairingErrorReason`.

### Module 2 — pure router view: `AppView` (new, exported from `App.tsx`)

A pure component — no hooks, no effects — that maps a route to a screen. Lives in `App.tsx` alongside `App`, exactly as `PairingView` lives beside `PairingScreen`:

```ts
export function AppView(props: { route: AppRoute; onPaired: () => void }): JSX.Element | null
```

Behavior (a `switch` on `route`, exhaustive over the three members):
- `'pending'` → `null` (render neither screen — § Pending phase).
- `'pairing'` → `<PairingScreen onPaired={props.onPaired} />`. **Do not pass `onCancel`** (see below).
- `'conversation'` → `<ConversationScreen />`.

### Module 3 — the container: `App.tsx` (modify)

`App` (default export, unchanged signature `(): JSX.Element`) becomes the router container. It owns:

1. **The daemon bridge, unchanged.** Keep `useDaemonEventBridge()` as the first line of `App`, called unconditionally — see "Where the daemon bridge lives".
2. **Route state.** `const [route, setRoute] = useState<AppRoute>('pending')`.
3. **The launch effect.** A single mount effect (`[]` deps) that calls `window.pyry.pairingStatus()`, and on resolution sets the route via `routeForStatus`; on rejection sets `'pairing'` (fail-safe). Uses a cancellation flag for StrictMode hygiene (§ State + concurrency).
4. **The render.** `return <AppView route={route} onPaired={() => setRoute('conversation')} />`.

`onPaired` is the whole of AC4: a successful confirm flips the route to `'conversation'`, unmounting the pairing screen and mounting the conversation screen with no restart. Navigation on `onPaired` is independent of the main-process connect-after-pair choreography (#34/#82) — the composer is already gated on connection status (#31), so landing on the conversation screen before the socket is up is safe.

**Why `onCancel` is not wired (AC5).** When unpaired, the pairing screen is the app root — there is no screen to cancel *back* to. Cancel's correct app-shell behavior is "stay on the pairing screen," which is exactly what happens when `App` does not navigate on cancel: `PairingScreen`'s internal handler resets its own reducer to the editing phase and the route stays `'pairing'`. Wiring an `onCancel` that did anything else would risk exposing the conversation screen before pairing, which AC5 forbids. So the correct wiring is the absence of a navigating handler — documented, not accidental.

### Where the daemon bridge lives

`useDaemonEventBridge()` stays at the top of `App`, called unconditionally on every render, above the route branch — i.e. it is **not** moved inside the conversation branch. Rationale:

- It is an app-lifetime subscription (subscribe on mount, unsubscribe on unmount), already StrictMode-safe (returns the exact `off` handle). Keeping it app-level means one stable listener for the whole session, with no subscribe/unsubscribe churn as the route flips pairing→conversation.
- It reads/writes only the session store; while on the pairing screen no connection is running yet (connect-on-pair is #82), so the store simply sits idle — harmless. When #82 later starts the connection at pair time, the listener is already mounted, so no early daemon event can be missed in the gap between `onPaired` firing and the conversation screen mounting.

This is the minimal change: leave the bridge call untouched, add routing around it.

### Pending phase (AC3)

While `pairingStatus()` is unresolved the route is `'pending'` and `AppView` renders `null`. This is the "neutral/pending state" AC3 permits, and it is genuinely neutral rather than a white flash: `:root` sets `color-scheme: dark` (tokens.css:13) and neither `body` nor `#root` sets a background, so the UA paints a dark canvas until a screen mounts. The window shows dark, then the correct screen — never the wrong screen, not even briefly. The query is a single local `store.load()` over IPC, so pending is a sub-frame-to-few-ms sliver in practice. No loading spinner, no placeholder component (that would be new visual the ticket excludes).

## State + concurrency model

- **Single source of route state:** `App`'s `route` `useState`. No store slice — this is ephemeral, screen-selection UI state local to the shell, the same category as the composer's `text` (ADR 0006: screen-local ephemeral state → `useState`, not the store). The session store remains the single source of *conversation* state, untouched here.
- **Launch effect, once, cancellable.** The effect runs on mount with `[]` deps. Standard async-in-effect idiom: a local `let active = true`, guard both `.then` and `.catch` with `if (active)`, and return `() => { active = false }`. Under React 18 StrictMode (dev) the effect mounts→unmounts→remounts; the first run's promise is cancelled by `active = false`, so only the second resolution applies its `setRoute`. Each `pairingStatus()` call is an idempotent local read, so a duplicate in-flight call is benign regardless.
- **No clobber of the paired navigation.** `onPaired` can only fire *after* the pairing screen is mounted, which only happens *after* the launch query has already resolved to a non-paired route. So the launch effect's `setRoute` has always run to completion before `onPaired`'s `setRoute('conversation')` is reachable — there is no ordering hazard between them and no functional-update guard is needed. (The `active` flag exists solely for StrictMode double-mount hygiene, not for this.)
- **Teardown.** The effect's cleanup clears the cancellation flag; `useDaemonEventBridge`'s own effect unsubscribes on unmount. Nothing else to cancel — no timers, no listeners owned by the shell.

## Error handling

There is no transport, socket, or parse in this path — the only failure surface is the `pairingStatus()` promise itself.

| Outcome of `pairingStatus()` | Route | Screen |
|---|---|---|
| resolves `{ status: 'paired' }` | `conversation` | conversation |
| resolves `{ status: 'not-paired' }` | `pairing` | pairing |
| resolves `{ status: 'error' }` | `pairing` | pairing |
| rejects (should not happen — #79's handler always resolves) | `pairing` | pairing |

The `.catch(() => setRoute('pairing'))` is the renderer-side belt to #79's suspenders: even if the invoke channel itself failed (handler absent — impossible in the normal boot order, but not asserted here), the shell must not fall through to the conversation screen. The fail-safe direction is always toward the pairing screen; the conversation screen is never the default. This slice surfaces no error UI (no banner, no dialog) — `error` and `not-paired` are visually identical here, both landing on the re-pair surface, per the ticket and ADR 0005. The "your pairing is unreadable" recovery affordance is #43/#44.

## Testing strategy

`npm test` (vitest, `environment: 'node'`, no DOM harness — assertions via `renderToStaticMarkup`), plus `npm run typecheck`. Following the codebase split: pure seams tested hard, async React container smoke-tested only.

**`src/renderer/src/appRoute.test.ts` (new)** — `routeForStatus`, the analog of `composerSend.test.ts`:
- `{ status: 'paired' }` → `'conversation'`.
- `{ status: 'not-paired' }` → `'pairing'`.
- `{ status: 'error' }` → `'pairing'` — the fail-safe invariant; assert this explicitly, it is AC2's core.
- (Optional but cheap) a table-driven assertion that *only* `paired` yields `'conversation'`.

**`src/renderer/src/App.test.tsx` (new)** — two describe blocks:
- **`AppView` (pure view, server-rendered):**
  - `route='pending'` → `renderToStaticMarkup` returns `''` (empty) — neither screen (AC3 rendering).
  - `route='pairing'` → markup contains the pairing screen's marker (`'Paste pairing code'`) and does **not** contain a conversation marker (e.g. `aria-label="Send"`) — AC2 at the view level. **Gotcha:** `PairingScreen` dereferences `window.pyry` at render, but the node env has no `window`. Define a minimal stub in `beforeEach` and remove it in `afterEach`: `globalThis.window = { pyry: {} } as unknown as Window & typeof globalThis`. An empty `pyry` suffices because `PairingScreen` only *reads* `window.pyry` at render (no method call until interaction). The `pairing` and `conversation` markers are the only assertions; do not drive interaction.
  - `route='conversation'` → markup contains a conversation marker (`aria-label="Send"`) and not the pairing title. Needs no window stub (`ConversationScreen` reads only the session store at render). Reset the store in `beforeEach` as `ConversationScreen.test.tsx:51-54` does if you assert bubble counts; not required for the marker check.
- **`App` (container smoke):**
  - `renderToStaticMarkup(<App />)` does not throw and returns `''`. Under server rendering effects do not run, so the route stays `'pending'` → `AppView` renders `null`, and `useDaemonEventBridge`'s effect never fires (so `window.pyry.onDaemonEvent` is never touched — safe without a window stub). This asserts App composes cleanly and that the **initial paint is neutral** (AC3's "no flash of the eventually-wrong screen at first paint").

**Not separately tested (documented wiring guarantees, per the container-smoke precedent):** the async launch effect resolving and calling `setRoute`, and `onPaired`→`setRoute('conversation')`. These are untested React glue exactly like `useDaemonEventBridge` and `PairingScreen`'s IPC handlers — `renderToStaticMarkup` never runs effects, so an integration assertion is not possible in this harness, and the codebase deliberately leaves this layer to the pure seams (`routeForStatus`, `AppView`) it is composed from. AC1/AC4 are guaranteed by the trivial composition `AppView(route, onPaired=…setRoute('conversation'))` over the tested `routeForStatus` mapping; AC5 by the deliberate absence of a navigating `onCancel`.

## Out of scope (do not implement here)

- Any main-process code — no keys, sockets, crypto, or IPC handler changes. Renderer-only. (Not security-sensitive per the ticket.)
- Error-recovery UI for the `error` outcome (re-pair prompt vs. hard error) — #43/#44.
- Connect-after-pair choreography — #34/#82. Landing on the conversation screen does not require the socket to be up (#31 gates the composer).
- Any redesign of either screen, any new visual/loading art, any new design token.
- A `docs/knowledge/codebase/<N>.md` note — owned by the documentation phase, not a developer deliverable.

## Open questions

- **Pending render: `null` vs. a neutral container.** Spec recommends `null` (dark canvas via `color-scheme: dark`). If in-app testing reveals any perceptible flash, a `<div className="app-pending" />` with `background: var(--color-surface); height: 100%` is an acceptable additive follow-up — but not needed for AC3 and not part of this slice. Developer's call if empirically warranted; default is `null`.
- None blocking.
