# Spec: Pairing input screen (#55)

**Size:** S (confirmed — PO sized S). One renderer screen following the existing screen pattern, consuming the preload invoke methods that already exist from #54. Two production modules, one stylesheet, two test files. No transport, no preload, no new dependency.

**Split from #9.** Upstream #52 (parse), #53 (fingerprint/confirm gate), #54 (typed pairing IPC channel + preload bridge) are all merged. This slice is **only the screen** that drives the existing `window.pyry.submitPairingPaste` / `window.pyry.confirmPairing` methods.

---

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=19-54

A single dialog **card** (vertical column; `surface-container-high` `#272a2f` background, 28px radius, 24px padding, 16px gaps) holding: a `headline-small` title "Paste pairing code"; a `body-medium` instruction line with an inline **monospace** `pyry pair --print` accent in `tertiary` `#ffb59f`; a bordered multiline paste field (`outline` `#8c9199` border, ~4px radius, monospace placeholder `pyry://home.lan:7117?token=…` at 55% opacity); and a right-aligned row of two pill **text buttons** with `primary` `#9dcbfc` `label-large` labels — "Cancel" and "Pair". The `reviewing` state (not drawn in this node — desktop-specific, since desktop adds the human fingerprint-verify step) reuses the same card, swapping the paste field for a prominent monospace fingerprint block and the button labels for "Cancel" / "Confirm".

---

## Files to read first

- `src/shared/ipc/pairing.ts` — **the contract this screen consumes.** `PairingSubmitResponse` (`{ ok:true; fingerprint } | { ok:false; reason }`), `PairingConfirmResponse` (`{ ok:true } | { ok:false; reason }`), and `PairingErrorReason` (5 value-free categories). The renderer imports these three types via `@shared/ipc/pairing`. **Note there is no `token`/`server_static_pubkey` field on any response arm — AC4 is secure by construction upstream.**
- `src/preload/index.ts:34-43` — the two methods this screen calls: `submitPairingPaste(paste): Promise<PairingSubmitResponse>` and `confirmPairing(): Promise<PairingConfirmResponse>`. **Do not touch this file** — the methods already exist.
- `src/preload/index.d.ts` — how `window.pyry` is typed (`interface Window { pyry: PyryApi }`). The screen reads `window.pyry` for the default bridge; extra methods on `PyryApi` are fine (structural typing).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx` — **the screen pattern to mirror:** a `*.tsx` with small in-file subcomponents, a co-located `*.css`, all styling via theme tokens.
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx` — **the render-test idiom:** `renderToStaticMarkup(...)` + string assertions in the `node` vitest environment (no DOM harness). Your `PairingView` tests follow this exactly.
- `src/renderer/src/store/sessionStore.ts:39-121` — **the pure-reducer idiom** (`SessionAction` discriminated union, `reduceSession` switch, `assertNever` exhaustiveness guard, DI-friendly factory). `pairingReducer` mirrors this shape.
- `src/renderer/src/store/daemonEventBridge.ts:23-64` — **the "pure choke point is tested, thin React wiring is not" precedent.** `translateDaemonEvent` (pure) is unit-tested; `useDaemonEventBridge` (the effect hook) is untested. Your `runSubmit`/`runConfirm`/`pairingReducer` are the tested choke points; the `PairingScreen` container glue is the untested wiring.
- `src/renderer/src/theme/tokens.css` — the theme tokens. **This screen needs 3 tokens that don't exist yet** — see § Theme tokens for the exact values to add.
- `vitest.config.ts` — confirms `environment: 'node'`; render tests use `renderToStaticMarkup`. **Do not add a DOM harness** (see § Testing strategy for why the pure-decomposition approach covers AC5 without one).
- `docs/knowledge/features/pairing-ipc-channel.md` — the full upstream contract, held-state model, and the four hand-off requirements #54 honours (read § "Held state" — it explains why a failed `confirm` requires a fresh `submit`, which drives the `confirm-failed → editing` transition below).

---

## Context

A desktop user with a fresh install needs to pair the app with their daemon without a terminal. The desktop is **paste-only**: the user runs `pyry pair --print` on pyrybox, copies the printed payload, pastes it here, reviews the **server-key fingerprint** the app derives, and confirms. This screen is the desktop equivalent of mobile's "Paste pairing code" dialog, plus the human fingerprint-verify step mobile's paste path skipped (#53).

Everything security-relevant already lives in the background process (#52/#53/#54). This screen is **renderer-only**: it handles the paste string the user types and the fingerprint that comes back, and nothing else. The token and server key never cross the bridge — the IPC response types have no field that could carry them (#54, AC4 by construction). State follows the app's unidirectional pattern.

**Out of scope (explicit):** where this screen mounts. App-level navigation/gating (show this when unpaired, the conversation screen when paired) is a separate slice. This ticket builds and wires the screen as a self-contained, testable unit; it exposes optional `onPaired` / `onCancel` seams the future navigation slice will wire.

---

## Design

### Module structure

```
src/renderer/src/screens/pairing/
├── pairingState.ts          # NEW — pure, React-free: state machine, effect-runners, formatter
├── pairingState.test.ts     # NEW — reducer + effect-runner + formatter tests (plain functions)
├── PairingScreen.tsx        # NEW — PairingView (pure) + PairingScreen (thin container)
├── PairingScreen.test.tsx   # NEW — PairingView renderToStaticMarkup tests, per phase
└── pairing.css              # NEW — card + field + buttons + fingerprint, all token-based
```

Two production `.ts/.tsx` modules. The split mirrors `sessionStore.ts` (pure logic, React-free, own test) vs the React screen (`ConversationScreen.tsx`). Keeping the state machine and effect-runners in a React-free `.ts` lets them run in the `node` vitest environment with zero React ceremony.

### State machine (`pairingState.ts`)

The screen is a small phase machine over the pairing round-trip. Both state and events are **discriminated unions on a discriminant field** (`phase` / `type`), per CLAUDE.md's sealed-event convention.

```ts
import type { PairingErrorReason, PairingSubmitResponse, PairingConfirmResponse } from '@shared/ipc/pairing'

export type PairingState =
  | { phase: 'editing'; paste: string; error: PairingErrorReason | null }
  | { phase: 'submitting'; paste: string }
  | { phase: 'reviewing'; paste: string; fingerprint: string }
  | { phase: 'confirming'; paste: string; fingerprint: string }
  | { phase: 'paired' }

export type PairingEvent =
  | { type: 'paste-changed'; paste: string }
  | { type: 'submit' }
  | { type: 'submit-succeeded'; fingerprint: string }
  | { type: 'submit-failed'; reason: PairingErrorReason }
  | { type: 'confirm' }
  | { type: 'confirm-succeeded' }
  | { type: 'confirm-failed'; reason: PairingErrorReason }
  | { type: 'cancel' }
```

**Notes on the shape:**
- `paste` is threaded through `editing → submitting → reviewing → confirming` so a `confirm-failed` can return to `editing` with the paste intact (one-click retry). It is **the only state field that transitively contains the token** (the paste embeds it); it never leaves this reducer except via the single `submitPairingPaste` call. It carries no separate token/key field — there is nothing else to carry.
- `error` lives only on `editing` (the only phase that renders an inline message). `fingerprint` lives only on `reviewing`/`confirming`.
- `paired` is terminal and carries nothing — no secret, no record.

### Reducer contract (`pairingReducer`)

```ts
export const initialPairingState: PairingState  // { phase: 'editing', paste: '', error: null }
export function pairingReducer(state: PairingState, event: PairingEvent): PairingState
```

Pure, no mutation, returns fresh state — same shape as `reduceSession`. Implement as `switch (event.type)` with an `assertNever(event)` default (compile-time exhaustiveness, like `sessionStore.ts`). Each arm guards on the current `phase` and returns `state` unchanged for an out-of-phase event (the safe default).

| Current phase | Event | → Next state |
|---|---|---|
| `editing` | `paste-changed{paste}` | `editing{paste, error: null}` (typing clears the prior error) |
| `editing` | `submit` | `submitting{paste}` |
| `submitting` | `submit-succeeded{fingerprint}` | `reviewing{paste, fingerprint}` |
| `submitting` | `submit-failed{reason}` | `editing{paste, error: reason}` (paste preserved) |
| `reviewing` | `confirm` | `confirming{paste, fingerprint}` |
| `confirming` | `confirm-succeeded` | `paired` |
| `confirming` | `confirm-failed{reason}` | `editing{paste, error: reason}` (paste preserved — see below) |
| any | `cancel` | `initialPairingState` (`editing{paste:'', error:null}` — paste **discarded**) |
| any other (phase, event) pair | — | `state` unchanged |

**Why `confirm-failed → editing`, not `→ reviewing`:** the main-side handler consumes its `pendingConfirm` closure **before** awaiting the persist (#54, "consume-before-await"). After any confirm failure the pending record is already gone, so retrying `confirm()` would hit `no-pending-pairing`. The only valid recovery is a **fresh submit** (which re-prepares a new pending record on main). Returning to `editing` with the paste preserved makes that a single Pair click. Do **not** route `confirm-failed` back to `reviewing` — it would offer a Confirm button that is structurally guaranteed to fail.

### Effect-runners + injected bridge (`pairingState.ts`)

The two IPC calls are wrapped in **pure async functions** that map an IPC response to the reducer event it produces. This is the tested seam that proves "submit invokes the IPC" and "confirm triggers persist" without a DOM.

```ts
export interface PairingBridge {
  submitPairingPaste(paste: string): Promise<PairingSubmitResponse>
  confirmPairing(): Promise<PairingConfirmResponse>
}

export function runSubmit(bridge: PairingBridge, paste: string): Promise<PairingEvent>
// calls bridge.submitPairingPaste(paste); ok → {type:'submit-succeeded', fingerprint}; !ok → {type:'submit-failed', reason}

export function runConfirm(bridge: PairingBridge): Promise<PairingEvent>
// calls bridge.confirmPairing(); ok → {type:'confirm-succeeded'}; !ok → {type:'confirm-failed', reason}
```

`PairingBridge` is the injected seam (the `createStore({ transport })` / `PairingHandleTarget` DI pattern). `window.pyry` is **structurally assignable** to it (it has these two methods plus extras), so the container defaults `bridge = window.pyry` and tests pass a `{ submitPairingPaste: vi.fn(), confirmPairing: vi.fn() }` fake. The runners import no React and no `electron`.

### Fingerprint formatter (`pairingState.ts`)

```ts
export function groupFingerprint(fingerprint: string): string[]  // fingerprint.split(':') → 8 two-char groups
```

The channel returns the daemon's fixed **23-char** form `aa:bb:cc:dd:ee:ff:11:22` (colon-separated lowercase hex, 8 groups). "Grouping / decoration for display belongs to this screen" (#53/#54 hand-off). Decoration is **spatial only** — never alter the characters, case, or order (the operator compares this string byte-for-byte against what `pyry pair` printed and what the phone shows). `groupFingerprint` returns the 8 verbatim groups so the view can render them as spaced monospace segments; `groups.join(':')` must equal the input.

### View contract (`PairingView` in `PairingScreen.tsx`)

A **pure presentational component** — props in, markup out, no hooks, no state, no effects. This is what `renderToStaticMarkup` renders in tests, one call per phase.

```ts
export interface PairingViewProps {
  state: PairingState
  onPasteChange: (paste: string) => void
  onSubmit: () => void
  onConfirm: () => void
  onCancel: () => void
}
export function PairingView(props: PairingViewProps): JSX.Element
```

Renders the card (`<div className="pairing">`) and a `switch (state.phase)` body:

- **`editing`** — title, instruction line (with the mono `pyry pair --print` accent), controlled `<textarea className="pairing__paste" value={state.paste} onChange={e => onPasteChange(e.target.value)}>`, an inline error row when `state.error` is non-null (text from the reason map below), and a button row `[Cancel, Pair]`. **Pair is `disabled` when `state.paste.trim() === ''`** (deterministic guard against an empty submit and against double-submit once submitting). Cancel → `onCancel`, Pair → `onSubmit`.
- **`submitting`** — same card; paste field `disabled`, Pair replaced by a busy/disabled state (e.g. "Pairing…"), Cancel disabled. No inline error.
- **`reviewing`** — title (e.g. "Confirm fingerprint"), a prominent monospace fingerprint block rendered from `groupFingerprint(state.fingerprint)` with a one-line "Check this matches what `pyry pair` printed" caption, and a button row `[Cancel, Confirm]`. Cancel → `onCancel`, Confirm → `onConfirm`.
- **`confirming`** — reviewing layout; Confirm busy/disabled.
- **`paired`** — a brief terminal success (e.g. "Paired ✓"). Navigation away is the future slice's job (via `onPaired`); this state just confirms success visually.

**Error-reason → inline copy** (a `Record<PairingErrorReason, string>` in the view; value-free, no secret). Starting copy — PO may refine:

| reason | inline message |
|---|---|
| `invalid-paste` | "That doesn't look like a valid pairing code — check you copied the whole thing." |
| `invalid-key` | "The server key in that code is malformed." |
| `malformed-request` | "Something went wrong sending the code. Try again." |
| `no-pending-pairing` | "The pairing expired — paste the code again." |
| `persist-failed` | "Couldn't save the pairing — your system keychain may be unavailable." |

### Container contract (`PairingScreen` in `PairingScreen.tsx`)

A **thin container** — the untested React wiring (precedent: `useDaemonEventBridge`). It owns the reducer and the async orchestration and renders `PairingView`.

```ts
export interface PairingScreenProps {
  bridge?: PairingBridge      // default: window.pyry
  onPaired?: () => void       // fired once on successful confirm (future navigation seam)
  onCancel?: () => void       // fired on cancel (future dismiss/navigation seam)
}
export function PairingScreen(props?: PairingScreenProps): JSX.Element
```

- `const [state, dispatch] = useReducer(pairingReducer, initialPairingState)`.
- **Async is handler-driven, not effect-driven.** The IPC calls fire from user-interaction handlers (React's idiomatic home for interaction side effects), so there is **no `useEffect` for the async work** and therefore no StrictMode double-invoke concern (contrast `daemonEventBridge`, which legitimately uses an effect because it's a display-lifetime subscription). Handlers:
  - `onPasteChange(paste)` → `dispatch({ type: 'paste-changed', paste })`
  - `onSubmit()` → read `state.paste`, `dispatch({ type: 'submit' })`, then `dispatch(await runSubmit(bridge, paste))`
  - `onConfirm()` → `dispatch({ type: 'confirm' })`, then `const ev = await runConfirm(bridge); dispatch(ev); if (ev.type === 'confirm-succeeded') onPaired?.()`
  - `onCancel()` → `dispatch({ type: 'cancel' })`, then `onCancel?.()`
- The disabled Pair/Confirm buttons (view) prevent a second click while a call is in flight, so no in-flight guard/ref is needed. A `dispatch` after unmount is a harmless no-op in React 18 — no cleanup flag required.

### Why `useReducer`, not a Zustand store

The pairing screen's state is **ephemeral and screen-local** — the paste, phase, fingerprint, and error belong to one in-progress attempt and must reset on remount. It is not app-wide state other components read (unlike `sessionStore`, which is a module singleton precisely because the conversation UI reads connection status). A module-singleton Zustand store here would leak a stale fingerprint/error into a re-opened screen. `useReducer` with the pure `pairingReducer` keeps the state at the lowest scope that resets correctly while preserving the unidirectional, dispatch-only, sealed-event discipline. This is the sanctioned "local UI state at the lowest scope" case.

### Theme tokens

Existing tokens to use (already in `tokens.css`): `--color-surface-container-high` (card bg), `--color-on-surface` (title), `--color-on-surface-variant` (instruction + placeholder), `--color-tertiary` (`#ffb59f`, the mono accent), `--color-outline` (paste-field border), `--font-mono` (accent, placeholder, fingerprint), `--font-sans`, `--text-body-medium-*` (instruction), `--radius-lg` (28px card), `--radius-xs` (~input radius; 6px vs the design's 4px — use the token, the 2px is imperceptible), `--radius-full` (pill buttons), `--space-6` (24px padding), `--space-4`/`--space-3`/`--space-2` (gaps/insets).

**Three tokens are missing and must be ADDED to `tokens.css`** (additive only; the file's own comment invites porting M3 tokens that later screens need). Exact values from Figma node 19-54:

```css
/* M3 Schemes/primary (dark) — text-button label color */
--color-primary: #9dcbfc;

/* M3 Static/headline-small — dialog title */
--text-headline-small-size: 24px;
--text-headline-small-line: 32px;
--text-headline-small-tracking: 0px;
--text-headline-small-weight: 400;

/* M3 Static/label-large — button labels */
--text-label-large-size: 14px;
--text-label-large-line: 20px;
--text-label-large-tracking: 0.1px;
--text-label-large-weight: 500;
```

`pairing.css` references these for: title → `headline-small`; Cancel/Pair/Confirm labels → `label-large` + `--color-primary`. All other color/type/spacing literals must resolve to a token (the conversation.css discipline — only bare structural geometry like `100%`, flex ratios, a fixed paste-field min-height, and the ~55% placeholder opacity may be literals).

---

## State + concurrency model

- **Single source of screen state:** the `useReducer` state. The view is stateless — it reads `state` and calls handler props; no two-way binding, no component-local `useState` shadowing the reducer.
- **No streams, no subscriptions, no timers.** Two one-shot request/response IPC calls (`submitPairingPaste`, `confirmPairing`), each triggered by a user click and awaited in the handler. Nothing to cancel on teardown; no `AbortController`, no listener to remove.
- **No `useEffect`.** Async is handler-driven, so StrictMode's dev effect-double-invoke does not apply. (This is the deliberate divergence from `daemonEventBridge`, which uses an effect because it subscribes for the component's display lifetime.)
- **In-flight re-entrancy** is prevented at the view: Pair/Confirm are disabled while `submitting`/`confirming`. Even if a duplicate submit slipped through, the main handler's supersede-on-submit makes it idempotent (#54).
- **Unmount mid-call:** the awaited `dispatch` is a no-op on an unmounted reducer (React 18) — no warning, no leak.

---

## Error handling

| Failure | Where surfaced | How |
|---|---|---|
| Malformed paste / disallowed relay (`invalid-paste`) | inline in `editing` | `submit-failed{reason}` → `editing{error}` → reason-mapped message under the paste field; paste preserved for correction |
| Malformed server key (`invalid-key`) | inline in `editing` | same path |
| Guard-rejected request (`malformed-request`) | inline in `editing` | same path (should not occur for a well-formed renderer) |
| Keychain unavailable at persist (`persist-failed`) | inline in `editing` | `confirm-failed{reason}` → `editing{error}`; user re-submits (main pending was consumed) |
| Superseded/expired confirm (`no-pending-pairing`) | inline in `editing` | same path |

All five reasons are the **value-free `PairingErrorReason` categories** — safe to render. The screen never receives a finer/secret detail; it maps the category to fixed copy. There is no `try/catch` in the screen: `runSubmit`/`runConfirm` await the preload methods, which resolve to a typed response (they do not reject on a domain error — every domain outcome is a `{ ok:false, reason }`). If the preload `invoke` itself rejects (IPC transport failure — not a modelled case), let it surface; do not add a speculative catch-all for an unobserved failure mode (evidence-based fix selection).

---

## Testing strategy

`vitest` in the `node` environment — **no DOM harness, no new dependency.** AC5's "component tests" are satisfied by decomposing the interaction into three independently-tested pure layers, exactly as the codebase already does (pure reducer in `sessionStore.test.ts`, pure translate in `daemonEventBridge.test.ts`, `renderToStaticMarkup` structure in `ConversationScreen.test.tsx`). The only untested code is the thin `PairingScreen` container glue — the direct analogue of the untested `useDaemonEventBridge`.

**`pairingState.test.ts` (plain functions):**
- *Reducer transitions* — one case per row of the transition table: `paste-changed` clears error; `editing+submit → submitting`; `submitting+submit-succeeded → reviewing` carrying the fingerprint; `submitting+submit-failed → editing` with the reason and paste preserved; `reviewing+confirm → confirming`; `confirming+confirm-succeeded → paired`; `confirming+confirm-failed → editing` with paste preserved; `cancel` from `reviewing` → `initialPairingState` (paste discarded); an out-of-phase event (e.g. `confirm` while `editing`) leaves state unchanged.
- *`runSubmit`* — with a fake bridge: asserts `submitPairingPaste` called once with the paste (**this proves "submit invokes the IPC"**); `{ ok:true, fingerprint }` → `{ type:'submit-succeeded', fingerprint }`; a `{ ok:false, reason }` (at least `invalid-paste`) → `{ type:'submit-failed', reason }`.
- *`runConfirm`* — with a fake bridge: asserts `confirmPairing` called once (**proves "confirm triggers persist"**); `{ ok:true }` → `{ type:'confirm-succeeded' }`; `{ ok:false, reason }` → `{ type:'confirm-failed', reason }`.
- *`groupFingerprint`* — `'aa:bb:cc:dd:ee:ff:11:22'` → 8 groups; `join(':')` round-trips to the input (no character/order mutation).

**`PairingScreen.test.tsx` (`renderToStaticMarkup(<PairingView state=… …/>)` with no-op handlers):**
- `editing` (empty paste) → renders the title, the instruction, a `<textarea>`, and a disabled Pair button + Cancel.
- `editing` with `error: 'invalid-paste'` → **renders the mapped inline error message** (AC "validation error renders inline").
- `reviewing` → **renders the fingerprint string** (AC "renders the fingerprint") and Cancel/Confirm.
- `paired` → renders the success marker.
- (Optional smoke) `PairingScreen` renders its initial `editing` markup without throwing (mirrors ConversationScreen's "renders without throwing"). Container interaction is not click-simulated — no DOM harness — and that gap is deliberate and precedented.

**AC5 mapping:** paste+submit invokes IPC (`runSubmit` test) → renders fingerprint (reducer `→reviewing` test + view `reviewing` render); confirm triggers persist (`runConfirm` test + reducer `→paired`); cancel discards (reducer `cancel → initial`, no IPC on the path); validation error inline (`runSubmit` error-map + reducer `→editing{error}` + view error render).

---

## Security posture

Headlines (the formal category-by-category pass is the `## Security review` section at the end):

- **No secret can reach the renderer — enforced by construction upstream (#54).** `PairingSubmitResponse`/`PairingConfirmResponse` have no `token`/`server_static_pubkey`/record field, so the screen has no code path that could obtain one. The only inbound values are `fingerprint` (a hash) and `reason` (a value-free category). AC4 holds because the types make a leak unrepresentable.
- **The paste is the user's own input, not a secret flowing *back*.** It embeds the token, so it is handled as sensitive: it lives only in transient reducer state and the single `submitPairingPaste(paste)` call; it is **never logged, never persisted, never sent on any other channel**, and is cleared on `cancel` and on reaching `paired`. The developer must not `console.log` the paste or fold it into any error/telemetry surface — the inline error uses only the value-free `reason`.
- **The fingerprint compare is the trust anchor and must stay byte-faithful.** Display decoration is spatial only (`groupFingerprint` returns verbatim groups); never change case/order/characters, or the human compare against pyrybox/the phone breaks.

---

## Open questions

- **Fingerprint display grouping.** `groupFingerprint` returns the 8 verbatim byte-pairs; the exact visual grouping (e.g. all 8 spaced, or 4+4 on two lines) is a small presentation choice for the developer — any layout is fine as long as the characters/order are unchanged and it's monospace for scannability.
- **Inline error copy.** The reason→message map is a starting point; PO may want to tune wording. The mapping keys (the 5 `PairingErrorReason` values) are fixed.
- **`paired` terminal visual.** Since mounting is out of scope, the `paired` state is a placeholder success marker; the future navigation slice decides whether it lingers or the screen unmounts via `onPaired`.
- **Off-scale radius.** The design's paste-field radius is 4px; the nearest token is `--radius-xs` (6px). Using the token keeps everything tokenized at a 2px cost. If exact fidelity is later required, add a `--radius-2xs: 4px` token — not worth a single-use token now.

---

## Security review

**Verdict:** PASS

**Findings:**

- **[Trust boundaries]** No findings — this screen adds **no** new boundary. It consumes the existing renderer→main boundary (`window.pyry.submitPairingPaste` / `confirmPairing`), which is validated on the main side by `isPairingRequest` (type + `MAX_PASTE_LENGTH`, `src/shared/ipc/pairing.ts:73`). Outbound: the raw paste, once. Inbound: only `{ ok, fingerprint | reason }` — a hash and a value-free category. The renderer holds only parsed, typed, secret-free values.
- **[Tokens, secrets, credentials]** No RNG / generation / storage / rotation here — all live in main (#42/#44/#53). The paste embeds the token, so it is treated as sensitive: transient in reducer state, single-use via one `submitPairingPaste` call, cleared on `cancel`/`paired`. **Requirement stated in-spec:** never `console.log` / persist / re-route the paste; the inline error uses only the value-free `reason`. Code-review must confirm no paste logging.
- **[File / storage operations]** N/A by design — the screen touches no filesystem and builds no path. Persistence is triggered by the bare `confirmPairing()` signal and executed entirely in main (#44/#53, `safeStorage`, atomic/fail-closed). No path-traversal or TOCTOU surface in the renderer.
- **[Inter-process / Electron attack surface]** No findings — **no new IPC channel, no new preload API** (both exist from #54). The screen calls only the two typed methods, never `ipcRenderer`, never a Node primitive. Fingerprint and error copy render as escaped React text nodes; no `dangerouslySetInnerHTML`. `webPreferences` (`contextIsolation`/`sandbox`) are set at window creation, not this ticket.
- **[Cryptographic primitives]** N/A — no crypto in the renderer. The fingerprint is derived (BLAKE2s, `node:crypto`) in main (#53); this screen only **displays** the resulting 23-char hash and must not mutate its characters/case/order. Constant-time compare is N/A — the security-relevant compare is a *human visual* compare, by design (#53).
- **[Network & I/O]** N/A — no socket, no relay URL handling in the renderer. The pasted relay URL is scheme/host-validated in main (#52) before this screen ever sees a fingerprint.
- **[Error messages, logs, telemetry]** No findings, one stated requirement — the screen surfaces only the five value-free `PairingErrorReason` categories (mapped to fixed copy) and the fingerprint (a hash, safe to show). MUST-NOT-log: the paste. No secret reaches the renderer DevTools console because none crosses the bridge.
- **[Concurrency]** No findings — no long-lived async, no timers, no listeners, no `useEffect`. Two one-shot handler-driven awaits; in-flight re-entrancy is blocked by disabled Pair/Confirm buttons; `dispatch` after unmount is a React-18 no-op. `onSubmit` captures `state.paste` into a local before its `await`, so there is no check-then-act race in the renderer. The pending-record race is owned and closed in main (consume-before-await, #54).
- **[Threat model alignment]** The screen **is** part of the mitigation for the ticket's core threat — a tampered/wrong server key trusted without verification: it presents the fingerprint faithfully for the human compare against pyrybox/the phone, and Cancel discards without persisting. *Renderer compromise reaching the transport* is bounded by construction — a compromised renderer still cannot obtain the token/key (the IPC response types expose neither); auto-confirm by a compromised renderer is the inherent, **out-of-scope** bound (sandbox + `contextIsolation`, per #54). *Malicious relay*, *token theft from disk*, and *hostile daemon response* are transport/main concerns (#52/#53/#7), out of scope for this renderer slice.

No MUST FIX. The screen's security burden is inherited almost entirely from #54's by-construction guarantees; its own obligations are (a) never log/persist/re-route the paste and (b) keep the fingerprint display byte-faithful — both stated as requirements above.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-04
