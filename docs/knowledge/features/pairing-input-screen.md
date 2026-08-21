# Pairing input screen

The desktop's paste-only pairing screen: the user pastes the payload printed by `pyry pair --print` on pyrybox, reviews the server-key **fingerprint** the background process derives, and explicitly **confirms** to persist the pairing — or **cancels**, discarding the paste. The paste phase renders as a full-window page on desktop's own Figma frame (`103-2901`, [#665](../codebase/665.md)); the fingerprint-review phase is still the renderer equivalent of mobile's "Paste pairing code" dialog (Figma node `19-54`), plus the desktop-specific human fingerprint-verify step mobile's paste path skipped ([#53](pairing-confirmation.md)).

Introduced in [#55](../codebase/55.md); the paste phase restyled onto its own frame in [#665](../codebase/665.md). Lives entirely under `src/renderer/src/screens/pairing/` — it never touches the token, server key, socket, or Noise handshake; those stay in the background process (ADR [0002](../decisions/0002-remote-head-over-relay-shared-wire.md); CLAUDE.md "keep the transport out of the window"). It drives the existing [pairing IPC channel](pairing-ipc-channel.md) (#54) and holds only the paste string it collects and the fingerprint/reason it gets back.

## What it does

Gives a fresh-install user a terminal-free way to pair the app with their daemon:

1. **Paste** the `pyry pair --print` payload into the field.
2. **Submit** — the pasted payload crosses the bridge to main, which parses it, validates the relay against the allowlist, and derives the server-key fingerprint; the screen displays the **fingerprint** for review.
3. **Review** — the user compares the displayed fingerprint byte-for-byte against what `pyry pair` printed / what the phone shows.
4. **Confirm** — the pairing is persisted (in main, via `safeStorage`) only on explicit confirm; **Cancel** discards the paste without persisting.

A typed validation error (malformed payload, disallowed relay, malformed key, expired pending, or persist failure) is surfaced **inline** and nothing is stored. The screen never receives or renders the `token` or `server_static_pubkey` — only the fingerprint (a hash) and a value-free error category cross the bridge.

**Where the screen mounts:** #55 built this screen as a self-contained, testable unit exposing optional `onPaired` / `onCancel` seams, deferring app-level navigation. The [app shell](app-shell.md) wired `onPaired` in [#80](../codebase/80.md): `App` advances to the [conversation screen](conversation-shell.md) when it fires. Until [#662](../codebase/662.md), `onCancel` was deliberately left unwired — this screen was the app root for every non-`paired` launch outcome, so cancel had nowhere to go and stayed put instead. #662 relocated the root to the [welcome screen](welcome-screen.md), which is what finally gave `onCancel` a safe destination: `App` now wires it to navigate back to `welcome`, never to `conversation`, so this screen is reached only by user action — the welcome screen's CTA, or the mid-session "Pair another server" / post-unpair flip.

## How it works

The screen decomposes into a **pure, React-free core** (`pairingState.ts`) and a **thin React container + pure view** (`PairingScreen.tsx`) — the tested-choke-point / untested-wiring split the codebase uses for [session store](session-store.md) vs [daemon-event bridge](daemon-event-bridge.md).

### Module structure

```
src/renderer/src/screens/pairing/
├── pairingState.ts        # phase machine + effect-runners + formatter (pure, React-free)
├── pairingState.test.ts   # reducer + runners + formatter tests (node env, no DOM)
├── PairingScreen.tsx       # PairingView (pure) + EntryPage/ReviewCard + PairingScreen (container)
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

The two IPC calls are wrapped in pure async functions that map a typed response to the reducer event it produces — the tested seam that proves "submit invokes the IPC" and "confirm triggers persist" without a DOM. `PairingBridge` is the injected seam; **`window.pyry` is structurally assignable** to it (it has these two methods plus extras from #54), so the container defaults `bridge = window.pyry` and tests pass a `{ submitPairingPaste: vi.fn(), confirmPairing: vi.fn() }` fake. The preload methods resolve to a typed response for *every* domain outcome (they don't reject on a domain error) — that part maps outside any `try`.

**Both runners are total functions ([#513](../codebase/513.md)): they never reject.** A `try` wraps only the bridge call itself (not the response mapping), and a bare `catch {}` — binding nothing — coerces an infrastructure-level rejection (handler absent or already unregistered on `will-quit`, an invoke racing registration, a non-serializable reply) or a synchronous throw into the phase's failure event with reason `malformed-request`, the same reason the handler's own guard produces. This mirrors `runUnpair` (`unpairAction.ts:53-59`). The mapping (`response.ok ? … : …`) stays outside the `try`, so a malformed response object is still a thrown contract violation, not a swallowed "try again". Before #513 a rejected invoke dispatched nothing and the reducer wedged in `submitting`/`confirming` — recoverable only by restart, since `busy` disables Cancel too (see State + concurrency model below).

### Fingerprint formatter

`groupFingerprint(fingerprint)` splits the daemon's fixed 23-char form `aa:bb:cc:dd:ee:ff:11:22` (8 colon-separated lowercase-hex byte-pairs) into its 8 **verbatim** groups so the view can render them as spaced monospace segments. Decoration is **spatial only** — characters, case, and order are never altered (`groups.join(':')` equals the input), because the operator compares the string byte-for-byte against pyrybox/the phone. Grouping / decoration for display was handed forward from #53/#54 as this screen's concern.

### View + container (`PairingScreen.tsx`)

- **`PairingView`** — a pure presentational component (props in, markup out; no hooks, no state, no effects). The root always carries the `.pairing` class — every outside consumer of the screen (`e2e/smoke.spec.ts:81`) binds that one class and expects it present in every phase — plus a phase-derived treatment class, `.pairing-page` or `.pairing-card`:

  ```ts
  const isPaste = state.phase === 'editing' || state.phase === 'submitting'
  // className={`pairing ${isPaste ? 'pairing-page' : 'pairing-card'}`}
  ```

  `editing`/`submitting` render `EntryPage` — the full-window paste page ([#665](../codebase/665.md)) described below. `reviewing`/`confirming` render `ReviewCard` (title, fingerprint block, caption, `[Cancel, Confirm]`) — still the 420px `.pairing-card` dialog inherited from mobile's `19-54`, unchanged since #55. `paired` renders a success marker. This is what `renderToStaticMarkup` renders in tests, one call per phase.

  **`EntryPage`** ([#665](../codebase/665.md)) is a full-window page drawn from desktop's own Figma frame `103-2901` — a radial glow over `--color-surface`, the welcome screen's `--space-7`/`--space-8` frame padding, and a bottom-pinned CTA stack. It replaced the `EntryCard` dialog #55 shipped (card `<h1>`, instruction paragraph, controlled `<textarea>`, inline error row) with:

  - an M3 **filled** text field: a persistent (non-floating) `Pairing code` label as an `aria-hidden` `<span>` above a single-line `<input aria-label="Pairing code">`, a 1px bottom active indicator, and a trailing **clear control** — a 40px round button, present only when the paste is non-empty, that writes a constant `''` through `onPasteChange` and returns focus to the input on click. No wrapping `<label>`: HTML forbids interactive content inside one (the clear button couldn't share the row), and a wrapping label would put a second element under the accessible name "Pairing code", which is exactly the ambiguity [#664](../codebase/664.md) had just removed for the six outside consumers that match the raw `aria-label` attribute.
  - a supporting-text slot below the field holding **either** the instruction (`Run pyry pair --print on your server and paste the output here.`) **or** the mapped error, never both — rendered as two `<p>` elements with **distinct `key`s** (`key="instruction"` / `key="error"`), not a single element whose `role` toggles. This is load-bearing, not stylistic: two same-tag JSX branches at the same position with no key reconcile to *one* DOM node in React, so an unkeyed version was mutating a live node's `role` to `alert` in the same commit that changed its text — an insert-vs-mutate distinction screen readers do not reliably announce. See [#665 codebase notes](../codebase/665.md) for the full reconciliation trace.
  - a three-row CTA stack: the `Pair` pill (full-width, disabled while `paste` is empty/whitespace or while `busy`, shows `Pairing…` in flight), a bare `Cancel` text row, and the `Open source · github.com/pyrycode/pyrycode-desktop` footer.

  No heading — the frame draws none, and the renderer has no visually-hidden utility to compensate with; the screen is left navigable by its one named field and two named buttons.
- **`PairingScreen`** — the thin container: `const [state, dispatch] = useReducer(pairingReducer, initialPairingState)`, plus handlers that dispatch the intent then dispatch the awaited runner result. Async is **handler-driven, not effect-driven** — there is no `useEffect`, so no StrictMode double-invoke concern (the deliberate divergence from `daemonEventBridge`, which subscribes for its display lifetime). `onConfirm` fires `onPaired?.()` on `confirm-succeeded`; `onCancel` fires `onCancel?.()`.

**Error-reason → inline copy** is a value-free `Record<PairingErrorReason, string>` in the view — the five coarse #54 categories mapped to fixed copy, no interpolation of any inbound value:

| reason | inline message |
|---|---|
| `invalid-paste` | "That doesn't look like a valid pairing code — check you copied the whole thing." |
| `invalid-key` | "The server key in that code is malformed." |
| `malformed-request` | "Something went wrong sending the code. Try again." — also the coerced reason for a rejected/throwing invoke ([#513](../codebase/513.md)); indistinguishable by design from the handler's own domain use of the same reason |
| `no-pending-pairing` | "The pairing expired — paste the code again." |
| `persist-failed` | "Couldn't save the pairing — your system keychain may be unavailable." |

### Styling

`pairing.css` now serves **two treatments** from one file, kept deliberately separable (siblings, not overrides — neither undoes a property the other sets) so the confirm phase can be lifted onto the page treatment in one move once it has a frame of its own ([#665](../codebase/665.md)):

- **`.pairing-card`** — the reviewing/confirming/paired phases: the original Figma `19-54` card (`surface-container-high` background, `--radius-lg` corners, `--space-6` padding, `max-width: 420px`), byte-for-byte what `.pairing` carried before #665 split it out.
- **`.pairing-page`** — the paste phase: desktop's own frame `103-2901`. `height: 100%` (rides the `html`/`body`/`#root` chain both mount sites leave bare), `--space-7`/`--space-8` frame padding, and a radial glow **derived from this frame's own Figma matrix, not copied from `welcome.css`** — the two frames' glows are close but not identical (48%×61% here vs. welcome's 48%×56%, same centre, purely vertical delta). The `.pairing-field*` block is the M3 filled field: a `::before` pseudo carries the 72% translucent fill at `opacity` (never a bare `rgba()`/`color-mix()` literal, per the house rule), and the field's row needs `position: relative` because the absolutely-positioned fill would otherwise paint above its non-positioned siblings.

Both `.pairing` (the shared base — box model, colour, font) and the outside-bound contract described above stay constant across the split. Every color/type/spacing resolves to a `tokens.css` token; the file's header names the remaining bare-literal geometry explicitly (the 56/48/40/24px boxes, the 1px indicator, the glow percentages, the 0.72/0.55/0.38 opacities) — no new tokens were added for #665. The inline error still reuses `--color-tertiary` (no dedicated error token exists — see [#55 notes](../codebase/55.md)). The `reuse` of the welcome frame is **token-level and visual only** — this codebase has no shared cross-screen CSS at all, so the page treatment is restated under its own class names rather than importing `welcome.css` or reaching for `.welcome__*`. See [ADR 0003](../decisions/0003-m3-theme-tokens-css-custom-properties.md).

The field's keyboard-focus indicator is an **outset** `box-shadow` on `:focus-within` (doubling the 1px border into a 2px line) rather than a colour change alone — a hue-only flip between `--color-on-surface-variant` and `--color-primary` measured at 1.00:1 luminance contrast, imperceptible in greyscale or under a blue-yellow deficiency ([#665 code review](../codebase/665.md) finding).

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
- **A rejected or throwing bridge invoke** (handler absent/unregistered, invoke racing registration, non-serializable reply) is coerced to `malformed-request` rather than left to wedge the screen in `submitting`/`confirming` with Cancel disabled ([#513](../codebase/513.md)).
- **`paired` renders a success marker** ("Paired ✓"), but the [app shell](app-shell.md) unmounts this screen the moment `onPaired` fires ([#80](../codebase/80.md)) — `confirm-succeeded` both flips the reducer to `paired` and calls `onPaired`, and `App`'s `setRoute('conversation')` swaps the screen out — so the marker is effectively superseded by navigation rather than lingering.
- **Container interaction is not click-simulated** — no DOM harness. The interaction is proven on the pure `runSubmit`/`runConfirm`/`pairingReducer` seams; only the thin container glue is untested (the precedented gap, mirroring `useDaemonEventBridge`). The clear control's click is likewise unexercised at the test tier for the same reason — a recorded gap, not an oversight ([#665](../codebase/665.md)).
- **Dark scheme only.** As of [#665](../codebase/665.md) the paste phase (`editing`/`submitting`) is a full-window page on its own Figma frame (`103-2901`); the reviewing/confirming/paired phases are still the 420px dialog card. The flow is deliberately inconsistent between the two treatments until the confirm phase gets its own frame — recorded as an accepted, temporary state, not a bug. Its placement in the app is decided by the [app shell](app-shell.md): as of [#662](../codebase/662.md) it is reached by user action (no longer the unpaired app root, which is now [welcome](welcome-screen.md)), not a dialog over another screen.
- **Mutually exclusive same-tag JSX siblings need distinct `key`s if either carries insertion-only semantics** (e.g. `role="alert"`). Without a key, React reconciles both branches to one DOM node and mutates it instead of replacing it — see [#665 codebase notes](../codebase/665.md) for the full trace; the fix here is only complete because the reducer forces `error` to `null` between any two errors, so the slot provably alternates and two same-key errors in a row can't occur.

## Related

- [App shell](app-shell.md) / [#80](../codebase/80.md), [#662](../codebase/662.md) — the router that mounts this screen on a user-initiated pair request (was: on any unpaired launch) and consumes both its `onPaired` and, since #662, `onCancel` seams.
- [Welcome screen](welcome-screen.md) / [#662](../codebase/662.md) — the screen this one now follows in the app shell's routing; `onCancel` returns there.
- [Pairing IPC channel](pairing-ipc-channel.md) / [#54](../codebase/54.md) — the typed request/response channel + preload methods this screen drives; the held-state model behind `confirm-failed → editing`.
- [Pairing-confirmation](pairing-confirmation.md) / [#53](../codebase/53.md) — where the 23-char fingerprint is derived; the human-verify step this screen presents.
- [Pairing-payload gate](pairing-payload-gate.md) / [#52](../codebase/52.md) — the parse + relay-allowlist stage behind the submit path.
- [Session store](session-store.md) / [Daemon-event bridge](daemon-event-bridge.md) — the pure-reducer / untested-wiring precedent this screen mirrors.
- [Conversation shell](conversation-shell.md) / [#1](../codebase/1.md) — the sibling renderer screen; the `renderToStaticMarkup` + theme-token discipline reused here.
- [ADR 0006](../decisions/0006-ephemeral-screen-state-usereducer-not-store.md) — `useReducer` for ephemeral screen state · [ADR 0004](../decisions/0004-renderer-session-store-reducer-wire-types.md) — the store shape this deliberately does *not* use.
- [#513 codebase notes](../codebase/513.md) — the rejected-invoke recovery fix that made `runSubmit`/`runConfirm` total functions.
- [#664 codebase notes](../codebase/664.md) — swept every outside consumer onto `aria-label="Pairing code"` alone, ahead of #665's element swap.
- [#665 codebase notes](../codebase/665.md) — restyled the paste phase onto desktop's own Figma frame (`103-2901`); the `EntryCard` → `EntryPage` rewrite, the `.pairing-card`/`.pairing-page` split, the clear control, and the keyed-supporting-slot reconciliation fix described above.
- [#55 codebase notes](../codebase/55.md) · Spec: `docs/specs/architecture/55-pairing-input-screen.md` — the original `EntryCard`/`<textarea>` shipment; left as a historical record of what shipped at the time, superseded by #665 above.
