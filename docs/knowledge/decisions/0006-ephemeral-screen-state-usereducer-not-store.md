# 0006 — Ephemeral screen-local state: `useReducer` with a pure reducer, not a module-singleton store

## Status

Accepted, 2026-07-04. First realized in [#55](../codebase/55.md) (the pairing input screen).

## Context

[ADR 0004](0004-renderer-session-store-reducer-wire-types.md) established the renderer's state template: a **module-singleton Zustand store** (`sessionStore`) with a pure exported reducer, a sealed action union, and narrow-slice selectors. That shape is right for the *session* — connection status and message history are app-wide state that multiple components read and that must survive across screens for the whole app lifetime.

The pairing input screen (#55) needed renderer state too — a paste string, a phase (`editing`/`submitting`/`reviewing`/`confirming`/`paired`), a derived fingerprint, and an inline error. The open question: does new screen state also go in a module-singleton store, following the ADR 0004 template, or somewhere narrower?

The distinguishing property: the pairing state is **ephemeral and screen-local**. The paste, phase, fingerprint, and error all belong to *one in-progress pairing attempt*. No other component reads them. And critically, they **must reset when the screen is re-opened** — a stale fingerprint or error from a previous attempt must never bleed into a fresh one. A module-singleton (a module-level variable, which is exactly what `sessionStore` is) would retain the last attempt's values across remounts.

## Decision

**State whose lifetime is one screen's mount — ephemeral, screen-local, read by no other component — uses `useReducer` with a pure reducer, not a module-singleton store.**

The pairing screen holds its state in `const [state, dispatch] = useReducer(pairingReducer, initialPairingState)` inside the `PairingScreen` container. `pairingReducer` is a pure, exported, React-free function (in `pairingState.ts`) — same discipline as `reduceSession`: no mutation, returns fresh state, `switch` on a sealed event union with an `assertNever` exhaustiveness guard, unit-tested with no React and no store.

What is kept from ADR 0004, what changes:

- **Kept:** the pure reducer + sealed discriminated-union events + unidirectional, dispatch-only, no-two-way-binding discipline (CLAUDE.md). The reducer is still the tested seam; the view still reads `state` and calls handler props.
- **Changed:** the *container* is React component state (`useReducer`), not a module-level `createStore` singleton with selectors. State lives at the lowest scope that resets correctly — the component instance.

The dividing line for future renderer state:

- **App-wide, shared across components, lives for the app lifetime** → a module-singleton store (ADR 0004 template): `sessionStore`.
- **Screen-local, read by no other component, must reset on remount** → `useReducer` + a pure reducer at the component scope: `pairingReducer`.

## Rationale

- **Correct reset-on-remount is the deciding property.** A module-singleton store is a module-level variable; re-mounting the screen re-runs the component but re-reads the *same* store, so the previous attempt's fingerprint/error/paste would still be there. `useReducer` initializes from `initialPairingState` on every mount, so a re-opened pairing screen is always clean. Making a store reset correctly would mean a manual teardown action on unmount — a disciplinary rule where component scope gives the guarantee for free.
- **Lowest scope that works.** The session store is a singleton *because* the conversation UI reads connection status from elsewhere in the tree — it earns its module scope. The pairing state has no such reader; hoisting it to a module singleton would be scope the state doesn't need and a stale-state footgun it can't afford.
- **No loss of testability or discipline.** The reason ADR 0004 exported its reducer — "exercise the state with no channel/IPC/transport" — is fully preserved: `pairingReducer` (and the `runSubmit`/`runConfirm` effect-runners) are plain functions tested in the `node` env. The DI/test seam moves from a `createStore` factory to an injected `PairingBridge`; both keep the pure logic free of React and Electron.
- **Handler-driven async fits component state.** The two IPC calls fire from click handlers (not an effect/subscription), so there is no display-lifetime subscription that would argue for a store or an effect. Component state owned by the container is the natural home.

## Consequences

- **The renderer now has two sanctioned state shapes, chosen by lifetime/sharing — not one.** ADR 0004's "the pattern is the template for future renderer stores" is scoped: it is the template for *app-wide, shared* state. Ephemeral screen-local state uses this ADR's `useReducer` shape. A new screen ticket picks by asking "does anything outside this screen read it, and must it survive across screens?" — no ⇒ `useReducer`; yes ⇒ a store.
- **Both shapes share the same reducer discipline**, so the pure-reducer test idiom (`sessionStore.test.ts`, `pairingState.test.ts`) and the sealed-event convention carry across both — only the container wiring differs (a `createStore` singleton + selectors vs. `useReducer` in the component).
- **`useState` is still fine for trivial, single-value local UI state.** This ADR is about *structured* screen state (a phase machine, multiple related fields); it does not push every one-off boolean through a reducer.
- **If ephemeral state later needs to be read by a sibling** (e.g. an app-shell header reacting to the pairing phase), lift it — either to a shared parent via props or, if genuinely app-wide, promote to a store per ADR 0004. The pure reducer moves unchanged; only the container changes.

Related: [0004](0004-renderer-session-store-reducer-wire-types.md) (the module-singleton store template this complements and bounds), the [pairing input screen feature doc](../features/pairing-input-screen.md), the [session store feature doc](../features/session-store.md), and [#55 codebase notes](../codebase/55.md).
