# Pairing input screen

The desktop's paste-only pairing screen: the user pastes the payload printed by `pyry pair --print` on pyrybox, reviews the server-key **fingerprint** the background process derives, and explicitly **confirms** to persist the pairing — or **cancels**, discarding the paste. It is the renderer equivalent of mobile's "Paste pairing code" dialog (Figma node `19-54`), plus the desktop-specific human fingerprint-verify step mobile's paste path skipped ([#53](pairing-confirmation.md)).

Introduced in [#55](../codebase/55.md). Lives entirely under `src/renderer/src/screens/pairing/` — it never touches the token, server key, socket, or Noise handshake; those stay in the background process (ADR [0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "keep the transport out of the window"). It drives the existing [pairing IPC channel](pairing-ipc-channel.md) (#54) and holds only the paste string it collects and the fingerprint/reason it gets back.

## What it does

Gives a fresh-install user a terminal-free way to pair the app with their daemon:

1. **Paste** the `pyry pair --print` payload into a monospace field.
2. **Submit** — the pasted payload crosses the bridge to main, which parses it, validates the relay against the allowlist, and derives the server-key fingerprint; the screen displays the **fingerprint** for review.
3. **Review** — the user compares the displayed fingerprint byte-for-byte against what `pyry pair` printed / what the phone shows.
4. **Confirm** — the pairing is persisted (in main, via `safeStorage`) only on explicit confirm; **Cancel** discards the paste without persisting.

A typed validation error (malformed payload, disallowed relay, malformed key, expired pending, or persist failure) is surfaced **inline** and nothing is stored. The screen never receives or renders the `token` or `server_static_pubkey` — only the fingerprint (a hash) and a value-free error category cross the bridge.

**Where the screen mounts:** #55 built this screen as a self-contained, testable unit exposing optional `onPaired` / `onCancel` seams, deferring app-level navigation. The [app shell](app-shell.md) wired those seams in [#80](../codebase/80.md): `App` shows this screen on any non-`paired` launch outcome and advances to the [conversation screen](conversation-shell.md) when `onPaired` fires. `onCancel` is deliberately left unwired — when unpaired this screen is the app root, so cancel stays put.

## How it works

The screen decomposes into a **pure, React-free core** (`pairingState.ts`) and a **thin React container + pure view** (`PairingScreen.tsx`) — the tested-choke-point / untested-wiring split the codebase uses for [session store](session-store.md) vs [daemon-event bridge](daemon-event-bridge.md).

### Module structure

```
src/renderer/src/screens/pairing/
├── pairingState.ts        # phase machine + effect-runners + formatter (pure, React-free)
├── pairingState.test.ts   # reducer + runners + formatter tests (node env, no DOM)
├── PairingScreen.tsx       # PairingView (pure) + EntryCard/ReviewCard + PairingScreen (container)
├── PairingScreen.test.tsx  # renderToStaticMarkup per-phase render tests
└── pairing.css             # card + field + buttons + fingerprint, all token-based
```

### Phase machine (`pairingState.ts`)

State and events are discriminated unions on a discriminant field (`phase` / `type`), per CLAUDE.md's sealed-shape convention.

```ts
type PairingState =
  | { phase: 'editing';    paste: string; error: PairingErrorReason | null }
  | { phase: 'submitting'; paste: string }
  | { phase: 'reviewing';  paste: string; fingerprint: string }
  | { phase: 'confirming'; paste: string; fingerprint: string }
  | { phase: 'paired' }
```

`paste` is threaded through `editing → submitting → reviewing → confirming` so a confirm failure can return to `editing` with the paste intact for a one-click retry. It embeds the token, so it is the **only** field that transitively holds a secret — it never leaves this module except via the single `submitPairingPaste` call. `error` lives only on `editing` (the sole phase that renders an inline message); `fingerprint` only on `reviewing`/`confirming`. `paired` is terminal and carries **nothing** — no secret, no record.

`pairingReducer(state, event)` is a pure `switch (event.type)` with an `assertNever` exhaustiveness guard (same shape as `reduceSession`). Each arm guards on the current `phase` and returns `state` unchanged for an out-of-phase event (a stray event is a safe no-op).

| Current phase | Event | → Next state |
|---|---|---|
| `editing` | `paste-changed{paste}` | `editing{paste, error: null}` (typing clears the prior error) |
| `editing` | `submit` | `submitting{paste}` |
| `submitting` | `submit-succeeded{fingerprint}` | `reviewing{paste, fingerprint}` |
| `submitting` | `submit-failed{reason}` | `editing{paste, error: reason}` (paste preserved) |
| `reviewing` | `confirm` | `confirming{paste, fingerprint}` |
| `confirming` | `confirm-succeeded` | `paired` |
| `confirming` | `confirm-failed{reason}` | `editing{paste, error: reason}` (paste preserved) |
| any | `cancel` | `initialPairingState` (paste **discarded**) |
| any other (phase, event) | — | `state` unchanged |

**Why `confirm-failed → editing`, not `→ reviewing`:** the main handler consumes its pending record *before* awaiting the persist (#54, consume-before-await). After any confirm failure the pending record is already gone, so a retry must be a **fresh submit** (which re-prepares a new pending record on main). Returning to `editing` with the paste preserved makes that a single Pair click; routing to `reviewing` would offer a Confirm structurally guaranteed to fail with `no-pending-pairing`.

### Effect-runners + injected bridge

```ts
interface PairingBridge {
  submitPairingPaste(paste: string): Promise<PairingSubmitResponse>
  confirmPairing(): Promise<PairingConfirmResponse>
}

runSubmit(bridge, paste): Promise<PairingEvent>   // ok → submit-succeeded{fingerprint}; !ok → submit-failed{reason}
runConfirm(bridge):       Promise<PairingEvent>   // ok → confirm-succeeded;             !ok → confirm-failed{reason}
```

The two IPC calls are wrapped in pure async functions that map a typed response to the reducer event it produces — the tested seam that proves "submit invokes the IPC" and "confirm triggers persist" without a DOM. `PairingBridge` is the injected seam; **`window.pyry` is structurally assignable** to it (it has these two methods plus extras from #54), so the container defaults `bridge = window.pyry` and tests pass a `{ submitPairingPaste: vi.fn(), confirmPairing: vi.fn() }` fake. The preload methods resolve to a typed response for *every* domain outcome (they don't reject on a domain error), so there is **no `try/catch`** in the screen — an actual IPC transport rejection (unmodelled) is left to surface rather than caught speculatively.

### Fingerprint formatter

`groupFingerprint(fingerprint)` splits the daemon's fixed 23-char form `aa:bb:cc:dd:ee:ff:11:22` (8 colon-separated lowercase-hex byte-pairs) into its 8 **verbatim** groups so the view can render them as spaced monospace segments. Decoration is **spatial only** — characters, case, and order are never altered (`groups.join(':')` equals the input), because the operator compares the string byte-for-byte against pyrybox/the phone. Grouping / decoration for display was handed forward from #53/#54 as this screen's concern.

### View + container (`PairingScreen.tsx`)

- **`PairingView`** — a pure presentational component (props in, markup out; no hooks, no state, no effects). It renders the card `<div className="pairing">` and switches on `state.phase`: the `EntryCard` (title, `pyry pair --print` instruction with a mono accent, controlled `<textarea>`, inline error row, `[Cancel, Pair]`) for `editing`/`submitting`, the `ReviewCard` (title, fingerprint block, caption, `[Cancel, Confirm]`) for `reviewing`/`confirming`, and a success marker for `paired`. This is what `renderToStaticMarkup` renders in tests, one call per phase.
- **`PairingScreen`** — the thin container: `const [state, dispatch] = useReducer(pairingReducer, initialPairingState)`, plus handlers that dispatch the intent then dispatch the awaited runner result. Async is **handler-driven, not effect-driven** — there is no `useEffect`, so no StrictMode double-invoke concern (the deliberate divergence from `daemonEventBridge`, which subscribes for its display lifetime). `onConfirm` fires `onPaired?.()` on `confirm-succeeded`; `onCancel` fires `onCancel?.()`.

**Error-reason → inline copy** is a value-free `Record<PairingErrorReason, string>` in the view — the five coarse #54 categories mapped to fixed copy, no interpolation of any inbound value:

| reason | inline message |
|---|---|
| `invalid-paste` | "That doesn't look like a valid pairing code — check you copied the whole thing." |
| `invalid-key` | "The server key in that code is malformed." |
| `malformed-request` | "Something went wrong sending the code. Try again." |
| `no-pending-pairing` | "The pairing expired — paste the code again." |
| `persist-failed` | "Couldn't save the pairing — your system keychain may be unavailable." |

### Styling

`pairing.css` renders the Figma node `19-54` card (`surface-container-high` background, `--radius-lg` corners, `--space-6` padding) stretched to the window with a `max-width: 420px`. Every color/type/spacing resolves to a `tokens.css` token; only bare structural geometry is literal. The screen needs three tokens #55 added to `tokens.css`: `--color-primary` (`#9dcbfc`, button labels), the `--text-headline-small-*` set (title), and the `--text-label-large-*` set (button labels). The inline error reuses `--color-tertiary` (no dedicated error token exists — see [#55 notes](../codebase/55.md)). See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

## State + concurrency model

- **Single source of screen state:** the `useReducer` state; the view is stateless (reads `state`, calls handler props — no two-way binding). See [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) for why this is `useReducer`, not a store.
- **No streams, subscriptions, or timers.** Two one-shot request/response IPC calls, each triggered by a click and awaited in the handler. Nothing to cancel on teardown — no `AbortController`, no listener to remove.
- **In-flight re-entrancy** is blocked at the view: Pair/Confirm are `disabled` while `submitting`/`confirming` (and Pair is disabled on an empty/whitespace paste). Even a slipped-through duplicate submit is idempotent on main (supersede-on-submit, #54).
- **Unmount mid-call:** the awaited `dispatch` is a React-18 no-op on an unmounted reducer — no warning, no leak.

## Security posture

- **No secret can reach the renderer — enforced by construction upstream (#54).** `PairingSubmitResponse` / `PairingConfirmResponse` have no `token` / `server_static_pubkey` / record field, so the screen has no code path that could obtain one. The only inbound values are `fingerprint` (a hash) and `reason` (a value-free category).
- **The paste is the user's own input, handled as sensitive** because it embeds the token: transient reducer state only, single-use via one `submitPairingPaste` call, never logged / persisted / re-routed, cleared on `cancel` and on `paired`. The inline error uses only the value-free `reason`.
- **The fingerprint compare is the trust anchor.** Display decoration is spatial only; never change case/order/characters or the human compare against pyrybox/the phone breaks.
- The screen adds **no new IPC channel and no new preload API** (both exist from #54); it calls only the two typed methods, never `ipcRenderer`. Fingerprint and error copy render as escaped React text nodes (no `dangerouslySetInnerHTML`).

## Edge cases and limitations

- **Empty / whitespace-only paste** — Pair is `disabled` (deterministic guard against an empty submit).
- **A failed confirm** cannot retry with Confirm — the main pending record is already consumed, so the screen returns to `editing` for a fresh submit (paste preserved).
- **`paired` renders a success marker** ("Paired ✓"), but the [app shell](app-shell.md) unmounts this screen the moment `onPaired` fires ([#80](../codebase/80.md)) — `confirm-succeeded` both flips the reducer to `paired` and calls `onPaired`, and `App`'s `setRoute('conversation')` swaps the screen out — so the marker is effectively superseded by navigation rather than lingering.
- **Container interaction is not click-simulated** — no DOM harness. The interaction is proven on the pure `runSubmit`/`runConfirm`/`pairingReducer` seams; only the thin container glue is untested (the precedented gap, mirroring `useDaemonEventBridge`).
- **Dark scheme only**; the card is dialog-shaped (`max-width` + centered margin). Its placement is now decided by the [app shell](app-shell.md) ([#80](../codebase/80.md)): when unpaired it is the full-window app root, not a dialog over another screen.

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md) — the router that mounts this screen when unpaired and consumes its `onPaired` seam to advance to the conversation screen.
- [Pairing IPC channel](pairing-ipc-channel.md) / [#54](../codebase/54.md) — the typed request/response channel + preload methods this screen drives; the held-state model behind `confirm-failed → editing`.
- [Pairing-confirmation](pairing-confirmation.md) / [#53](../codebase/53.md) — where the 23-char fingerprint is derived; the human-verify step this screen presents.
- [Pairing-payload gate](pairing-payload-gate.md) / [#52](../codebase/52.md) — the parse + relay-allowlist stage behind the submit path.
- [Session store](session-store.md) / [Daemon-event bridge](daemon-event-bridge.md) — the pure-reducer / untested-wiring precedent this screen mirrors.
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the sibling renderer screen; the `renderToStaticMarkup` + theme-token discipline reused here.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — `useReducer` for ephemeral screen state · [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the store shape this deliberately does *not* use.
- [#55 codebase notes](../codebase/55.md) · Spec: `docs/specs/architecture/55-pairing-input-screen.md`
