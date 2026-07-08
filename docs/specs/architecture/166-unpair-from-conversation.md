# #166 — Unpair from the conversation screen and return to pairing

The renderer half of the unpair flow (split from #120). The main-side capability already
ships: `window.pyry.unpair(): Promise<UnpairResult>` (#173, on top of #172's
`ClearablePairedServerStore.clear()`). This ticket wires the visible control + the route flip
back to pairing. **Renderer-only — nothing new on the main side.**

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-12

Node `17-12` is the mobile Settings → Connection **server row**: a list row with a "Server"
title, the paired device name as subtitle (`juhana-mac-2026`), a status line (● Relay ● Pyrycode
dots), and a trailing chevron into detail. Desktop has **no Settings screen and no top app bar
yet**, so this ticket does **not** port that row — it anchors labeling/intent only. Realize the
smallest unpair affordance on the conversation screen (node `16-8`; the mobile home is its top-bar
overflow menu, node `16-16`, not built). Carry forward the "forget this pairing / re-pair" wording
(node `17-18` = the "Pair another server" CTA). Style with existing conversation theme tokens — do
**not** add a new `--color-error` token (the mobile `#BA1A1A` destructive color has no desktop
token, and a minimal de-emphasized control needs none).

## Files to read first

- `src/renderer/src/App.tsx:19-66` — `AppView` (pure route→screen switch) + `App` (owns `route`
  via `useState`, wires `onPaired={() => setRoute('conversation')}`). You add the mirror
  `onUnpaired` seam here.
- `src/renderer/src/appRoute.ts` — `AppRoute` union + `routeForStatus`. **Do not change** —
  unpair is a runtime action, not a launch-status mapping (Technical Notes).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:16-49` — the `.conversation`
  shell (`MessageThread` + in-file `Composer`). Add an in-file unpair control the same way
  `Composer` lives in-file; take `onUnpaired` as a prop.
- `src/renderer/src/screens/conversation/composerSend.ts:38-108` — **the pattern to copy**: a
  pure, React-free helper with injected effects (`submitMessage`) tested by plain spies, and
  `composerAvailability` (the AC5 error affordance: `error` status → send disabled + `'Connection
  error'` hint).
- `src/renderer/src/store/sessionStore.ts:40-129` — `SessionAction` union, `reduceSession`,
  `initialSessionState`, `ConnectionError`. Add the `reset` action + case here.
- `src/renderer/src/store/sessionDiagnostics.ts:25-44` — the passive observer. It reads
  `action.type` as a plain string, so a new `reset` action needs **no change here** and does not
  break the #131 boundary pin (verified). Read only to confirm.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:161-210` — the precedent for optional
  navigation-seam props (`onPaired?` / `onCancel?`) + a container that fires an injected callback
  from an interaction handler and dispatches a phase. Mirror its shape.
- `src/renderer/src/screens/conversation/conversation.css:1-16,124-157` — token discipline
  ("every value references a theme token") + the send-button + disabled treatment to style the
  unpair control against. Add `.conversation__header` here.
- `src/renderer/src/theme/tokens.css` — available tokens. Use `--color-on-surface-variant`
  (muted) / `--color-on-surface`, `--space-*`, `--text-label-large-*`. **No `--color-error`
  exists — do not reference one.**
- `src/renderer/src/App.test.tsx` + `src/renderer/src/screens/conversation/ConversationScreen.test.tsx`
  — the server-render (`renderToStaticMarkup`) test style; no jsdom. `composerSend.test.ts` is the
  spy-based pure-helper test style for the new `unpairAction.test.ts`.
- `src/shared/ipc/unpair.ts` — the contract you consume: `UnpairResult = { result: 'ok' } |
  { result: 'error' }`, value-free by construction.

## Context

Today the shell routes to the conversation screen whenever any pairing record exists
(`routeForStatus`), with no in-app way back (#120). A stale/wrong record traps the user on a dead
conversation screen with a disabled composer. This adds the manual escape hatch: an unpair control
that clears the stored pairing via `window.pyry.unpair()` and flips the route back to pairing
in-place, plus a reset of in-memory session state so a later re-pair starts clean.

## Design

Three seams, mirroring the existing `onPaired` flip in reverse.

### 1. Pure interaction helper — `src/renderer/src/screens/conversation/unpairAction.ts` (NEW)

The one place with decision logic (server-render tests can't drive an async click → branch), so it
is extracted and unit-tested, exactly like `submitMessage`. Injected effects keep it React/store/
Electron-free.

Contract (signatures only — the developer writes the bodies):

```ts
export interface UnpairDeps {
  unpair: () => Promise<UnpairResult>          // window.pyry.unpair in the container
  dispatch: (action: SessionAction) => void    // session store dispatch
  onUnpaired: () => void                        // the App route flip → 'pairing'
}

// Performs the effects; returns the outcome so the container can reset its confirm phase.
export function runUnpair(deps: UnpairDeps): Promise<'ok' | 'error'>
```

Behavior:
- `await deps.unpair()` inside a `try/catch`. A thrown/rejected call is **coerced to the error
  outcome** — fail-safe: never flip the route on a failed clear (AC5, "no cleared-in-UI-but-still-
  on-disk half-state").
- `result: 'ok'` → dispatch `{ type: 'reset' }` **then** call `deps.onUnpaired()`, in that order
  (reset the store before the route flips so neither the pairing screen nor an immediate relaunch
  observes stale session state); return `'ok'`.
- `result: 'error'` (or a rejection) → dispatch `{ type: 'failed', error: UNPAIR_FAILED_ERROR }`;
  do **not** call `onUnpaired` (stay on the conversation screen); return `'error'`.

Module const for AC5's synthesized failure, reusing the existing `ConnectionError` shape:

```ts
const UNPAIR_FAILED_ERROR: ConnectionError = {
  code: 'unpair',
  message: 'Could not forget this pairing.',
  retryable: false
}
```

`composerAvailability` maps **any** `error` status to the `'Connection error'` hint + disabled
send — it does not read `.message` — so dispatching `failed` reuses the existing affordance
verbatim (AC5). The `message` populates the store shape for a future banner only.

### 2. Store reset — `src/renderer/src/store/sessionStore.ts` (EDIT)

`SessionAction` has no reset today and `disconnected` deliberately preserves `messages`, so AC4
needs a new mutation path that clears both facets:

- Add union member: `| { type: 'reset' }`.
- Add reducer case: `case 'reset': return initialSessionState` — back to
  `{ status: { type: 'disconnected' }, messages: [] }` in one step. `initialSessionState` is an
  immutable shared const; returning it is safe and makes a second reset a no-op reference
  (idempotent).

Only `reduceSession` is exhaustive over `SessionAction` (verified — `sessionDiagnostics` and
`daemonEventBridge` do not switch exhaustively), so this is a single case with no fan-out.

### 3. The control + route wiring — `ConversationScreen.tsx` + `App.tsx` (EDIT)

**Placement (AC1).** A slim header row at the top of `.conversation`, above the thread — the
minimal seed of the future top app bar — holding a right-aligned unpair control. New in-file
component (like `Composer`), e.g. `UnpairControl`, owning:
- a confirm phase: `useState<'idle' | 'confirming' | 'unpairing'>` (trivial glue, not extracted —
  see Testing). Idle shows the trigger (`Unpair`); `confirming` shows a lightweight inline confirm
  (`Forget this pairing?` + `Confirm` / `Cancel`) — this is the AC3 guard; `unpairing` disables
  Confirm while the promise is in flight (mirrors PairingScreen disabling during `confirming`).
- `handleConfirm` → phase `'unpairing'`, then
  `runUnpair({ unpair: window.pyry.unpair, dispatch, onUnpaired }).then(outcome => { if (outcome
  === 'error') setPhase('idle') })`. On `'ok'` the route flips and the screen unmounts (a setState
  after unmount would be a harmless React-18 no-op, so no `'ok'` branch is needed).
- `window.pyry` is dereferenced **only in the handler** (interaction time), never during render —
  so the server-rendered container smoke test never touches the bridge (same discipline as
  `Composer.handleSubmit`).

Give the trigger a stable accessible name (`aria-label="Unpair"` or literal `Unpair` text) so the
server-render test can assert its presence.

**Prop threading (AC2), mirroring `onPaired` exactly:**
- `ConversationScreen` gains `onUnpaired?: () => void` — **optional** (mirrors PairingScreen's
  `onPaired?`/`onCancel?`), so the existing bare `<ConversationScreen />` server-render tests stay
  green. The control calls `onUnpaired?.()` via `runUnpair`.
- `AppView` gains `onUnpaired: () => void` (required, symmetric with `onPaired`), passed to the
  `conversation` branch: `<ConversationScreen onUnpaired={props.onUnpaired} />`.
- `App` wires `onUnpaired={() => setRoute('pairing')}` — the exact reverse of
  `onPaired={() => setRoute('conversation')}`.

`routeForStatus` / `AppRoute` are unchanged — this is a runtime user action, not a launch-status
mapping (Technical Notes). The launch-status invariant "conversation only when paired" still holds:
`clear()` resolves `ok` **before** the flip, so an immediate relaunch reads a genuinely not-paired
record.

### Data flow

```
[Unpair] → confirm → [Confirm]
  → runUnpair → window.pyry.unpair()  (main clears stored pairing, #173)
       ok    → dispatch {reset} → store = initialSessionState → onUnpaired() → setRoute('pairing')
       error → dispatch {failed} → status=error → composer shows "Connection error" (stays on screen)
```

## State + concurrency model

- Session state stays the single Zustand source of truth; the new `reset` action is the only added
  mutation, dispatched through the existing `dispatch` entry point (observed by the #134 diagnostics
  logger for free).
- The confirm phase is ephemeral screen-local UI state → component `useState` at the lowest scope
  (ADR 0006 precedent: `Composer`'s `text`), never the store.
- In-flight guard: the `unpairing` phase disables Confirm so a double-click cannot launch a second
  `runUnpair`. `clear()` is idempotent regardless, so this is belt-and-suspenders, not correctness-
  critical.
- No new async subscription, timer, or `AbortController` — `runUnpair` is a single awaited
  request/response with no teardown surface. The app-level `useDaemonEventBridge` listener is
  untouched.

## Error handling

| Failure | Result type | UI surface |
|---|---|---|
| `clear()` throws in main | `{ result: 'error' }` (value-free) | `dispatch({failed})` → `error` status → composer disabled + `'Connection error'` hint (AC5). Route does **not** flip. |
| `unpair()` invoke rejects (handler absent) | promise rejection | Coerced to the error path in `runUnpair`'s `catch` — same as above; never throws into the window. |
| `clear()` succeeds | `{ result: 'ok' }` | `dispatch({reset})` then route flips to pairing (AC2/AC4). |

Fail-safe by construction: the route flips **only** on `result: 'ok'`. Any other outcome keeps the
user on the conversation screen with the failure visible — no "cleared in the UI but still on disk"
half-state.

## Testing strategy

Vitest, server-render + pure-helper style (no jsdom — mirrors the existing suites).

- **`unpairAction.test.ts` (NEW — pure, plain spies, like `composerSend.test.ts`):**
  - `ok` → dispatches exactly one `{ type: 'reset' }`; calls `onUnpaired` once; resolves `'ok'`.
  - **ordering:** on `ok`, `reset` is dispatched **before** `onUnpaired` (record call order on a
    shared mock).
  - `error` → dispatches one `failed` whose `error.code === 'unpair'`; `onUnpaired` **not** called;
    resolves `'error'`.
  - `unpair()` rejects → same as the error path (dispatch `failed`, no `onUnpaired`, resolves
    `'error'`, does not throw).
- **`sessionStore.test.ts` (EDIT — reducer):**
  - `reset` from a populated state (non-empty `messages` + `connected` status) → `status.type ===
    'disconnected'` and `messages.length === 0` (=== `initialSessionState`).
- **`ConversationScreen.test.tsx` (EDIT — server-render):**
  - the conversation shell renders the unpair trigger (assert markup contains its accessible name);
    existing bubble/composer assertions unchanged.
  - (only the idle phase is reachable under server render; the confirm-toggle transitions are
    trivial `useState` glue, unit-tested nowhere — same as `Composer`'s `text` and PairingScreen's
    container wiring, which are smoke-only. Call this out so review does not flag missing coverage.)
- **`App.test.tsx` (EDIT):** add `onUnpaired={noop}` to the three `AppView` call sites (compile
  fix for the new required prop); existing assertions unchanged.

Type coverage: `npm run typecheck` guards the `reset` exhaustiveness case and the prop threading;
`npm run build` is the salvage/QA gate.

## Open questions

- **Live transport not torn down.** Unpair clears the *stored* pairing and resets *renderer*
  state; it does not proactively tear down an already-live Noise session in main (that would be a
  main-side change, explicitly out of scope — "nothing new is needed on the main side"). In the
  target scenario (stale/wrong record, dead screen) the session is not live, so this is a
  no-observed-failure edge; a subsequent re-pair supersedes any stale session via connect-on-pair
  (#82). Deferred, not defended.
- **Error copy precision.** AC5 mandates reusing the composer path, which shows the generic
  `'Connection error'` for an unpair failure. Branching the hint on `error.code` for unpair-
  specific copy would touch `composerAvailability`'s contract — out of scope; the ticket chose this
  path deliberately.
- **Control copy.** `Unpair` / `Forget this pairing?` are the proposed strings (from the Figma
  intent); final wording is the developer's within that intent.
