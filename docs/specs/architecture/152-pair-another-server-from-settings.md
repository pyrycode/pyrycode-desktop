# #152 — Pair another server from Settings

**Size:** S (not split). One indivisible navigation unit: a Settings action row plus the paired sub-route that opens the already-built `PairingScreen`. Mirrors #333's route+entry shape; smaller, because the pairing screen already exists (no new screen file). ~50 production LOC across 3 files, ~50 test LOC, ~20 additive CSS.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=17-18

A single Connection-section row (`17:18`): a `px-16 py-10 gap-16` flex row holding a body-large `on-surface` label "Pair another server" (`17:20`) that fills the width, and a trailing 20×20 chevron (`17:21`) pushed to the right edge. Identical row geometry to the existing Server row (#334) and Storage row (#351); the only new decoration is the trailing chevron, which — unlike the static Server row (#334 omitted its chevron `17:16`) — **is kept here** because this row *navigates* (it's a real forward-nav affordance, not a static readout).

## Files to read first

- `src/renderer/src/pairedRoute.ts:11-46` — `PairedRoute` union, `PairedNav` union, `nextPairedRoute` reducer, and the `assertNever` exhaustiveness guard. This is where the new route member + 3 nav arms + 3 cases land. Read the `settings`-was-added comment (lines 9-11, 39) — you are repeating that exact move.
- `src/renderer/src/pairedRoute.test.ts:8-34` — the pure transition-test pattern (no React/store/Electron). Mirror it for the 3 new transitions.
- `src/renderer/src/PairedShell.tsx` — `PairedShellView` pure view (add the `pairServer` case + 3 callback props; the `assertNever` at line 10 forces the case) and `PairedShell` container (wire 3 new dispatches). Note lines 34-35: how the `settings` case renders `SettingsScreen`.
- `src/renderer/src/PairedShell.test.tsx:25-86` — the `renderToStaticMarkup(<PairedShellView route=… />)` per-route render test + the "transition composes" one-liner test pattern. Add the `pairServer` route test (with a `window` stub, below) and the composition assertions.
- `src/renderer/src/screens/settings/SettingsScreen.tsx:34-99` — the Connection `settings__section-body` (48-51) where the row mounts, directly after `<ServerRowControl />`; and `BackControl` (84-99), the inline-component + inline-SVG precedent to mirror for the new row. `SETTINGS_COPY` (9-15) is where the label constant goes.
- `src/renderer/src/screens/settings/SettingsScreen.test.tsx:8-40` — the server-render test + the `render()` helper. Update the helper for the new required prop; add a row-present assertion.
- `src/renderer/src/screens/settings/settings.css:105-163` — the Server-row classes and the token mapping (px-16 py-10 → `--space-3`/`--space-4`; gap-16 → `--space-4`). Mirror for the action-row classes. `.settings__back` (38-59) is the button hover/focus precedent.
- `src/renderer/src/screens/pairing/PairingScreen.tsx:161-210` — the `onPaired` / `onCancel` seams (163-164) and the `target = bridge ?? window.pyry` **render-time** deref (175). Confirms the reuse contract and the window-stub test requirement.
- `src/renderer/src/screens/pairing/pairingState.ts:55-96` — the reducer; `cancel` resets to `initialPairingState` (discards the paste, no persist). This is the non-destructive guarantee behind AC4.
- `src/renderer/src/App.tsx:26-44, 64-83` — `AppView` renders `PairedShell` for the `conversation` route, and `App` reads pairing-status **once** at mount (`useEffect([])`, no resubscribe). So a re-pair does **not** remount `PairedShell`; the inner `pairServer → list` nav is what returns the user to the new server's home.
- `src/renderer/src/App.test.tsx:26-44` — the `globalThis.window = { pyry: {} }` beforeEach/afterEach stub for server-rendering a `PairingScreen`-bearing route in the `node` vitest env. Mirror it in the `pairServer` route test.
- `src/main/index.ts:199-214` — `pairingHandler` wires `onPaired: () => connection.reconnect()` (main-side, automatic on a persisted overwrite). Confirms **no transport/IPC change** in this ticket.
- `src/main/pairedServerStore.ts:34, 77` — single-server overwrite semantics (`PAIRED_SERVER_NAME` is a fixed constant; a second `save` overwrites = re-pair). Confirms "pair another" = switch/replace on desktop.

## Context

Desktop pairs exactly once, at first launch: the pairing screen is the app root only while unpaired (`App.tsx` `pairing` route), with no affordance to reach it again once paired. This ticket adds a "Pair another server" row to Settings → Connection (Figma 17-18, directly below the #334 Server row) that re-opens the existing pairing flow from inside the paired app.

Desktop's paired-server storage is **single-server, overwrite semantics** (`src/main/pairedServerStore.ts`; per-server `.${serverId}` keying is deliberately deferred, out of scope). So "pair another server" means **switch/replace**: confirming a new pairing forgets the current server. This is the honest reading of "reuse the existing pairing screen and storage" — not a multi-server manager.

Everything downstream of a successful confirm already works: `pairingHandler` (`src/main/index.ts:214`) wires `onPaired: () => connection.reconnect()`, so persisting the overwriting record re-sources it (#83 reload-per-dial) and dials the new daemon, tearing down the old connection. **No transport work here.**

## Design

The whole feature is renderer navigation over already-built pieces: reach the existing `PairingScreen` as a new paired sub-route inside `PairedShell`, exactly mirroring how #333 added the `settings` route. Three seams change: the route model (`pairedRoute.ts`), the shell view+container (`PairedShell.tsx`), and the Settings entry (`SettingsScreen.tsx`).

### 1. Route model — `src/renderer/src/pairedRoute.ts`

Add one route member and three nav arms:

```ts
export type PairedRoute = 'list' | 'thread' | 'settings' | 'pairServer'

export type PairedNav =
  | { type: 'open' }
  | { type: 'openSettings' }
  | { type: 'back' }
  | { type: 'openPairServer' }       // Settings row  → pairServer   (entry)
  | { type: 'pairServerCancelled' }  // onCancel       → settings     (AC4, non-destructive)
  | { type: 'pairServerPaired' }     // onPaired       → list         (AC3, new server's home)
```

`nextPairedRoute` gains three cases: `openPairServer → 'pairServer'`, `pairServerCancelled → 'settings'`, `pairServerPaired → 'list'`. The existing `assertNever(nav)` default makes each omission a `npm run typecheck` failure.

**Why three explicit arms and not a reuse of `back`.** The two exits land on *different* routes: cancel → `settings` (return to where the user launched pairing, AC4); a successful pair → `list` (the new server's channel home, AC3). Today's `back` is absolute → `list`, so cancel *cannot* reuse it — it needs its own arm regardless. And `pairServerPaired` is semantically "done, go home to the new server," not "back": keeping it explicit (rather than dispatching `back`) is honest today and forward-safe if `back` ever becomes stack-aware — a stack-aware `back` from `pairServer` would pop to `settings` (its origin), which is the *wrong* destination for a completed pair. Both new exits are self-documenting and forced by the guard.

### 2. Shell — `src/renderer/src/PairedShell.tsx`

`PairedShellView` (pure) gains three callback props and one render case:

```ts
// added props
onOpenPairServer: () => void
onPairServerPaired: () => void
onPairServerCancelled: () => void

// added case (the assertNever at line 10 forces it)
case 'pairServer':
  return <PairingScreen onPaired={props.onPairServerPaired} onCancel={props.onPairServerCancelled} />

// settings case gains the entry callback
case 'settings':
  return <SettingsScreen onBack={props.onBack} onPairAnother={props.onOpenPairServer} />
```

`PairingScreen` takes no `bridge` prop here — production wiring uses its `window.pyry` default (`bridge ?? window.pyry`), the same as the App-level `pairing` route. It derefs `window.pyry` **at render**, which is fine in the real renderer (preload bridge present) and handled in tests by the window stub (see Testing).

`PairedShell` (container) wires the three new dispatches:

```ts
onOpenPairServer={() => dispatch({ type: 'openPairServer' })}
onPairServerPaired={() => dispatch({ type: 'pairServerPaired' })}
onPairServerCancelled={() => dispatch({ type: 'pairServerCancelled' })}
```

No new store, no new effect. The nav state is the same screen-local `useReducer` (ADR 0006) that already resets on remount. `PairingScreen` mounts fresh each time the route enters `pairServer` (its own `useReducer(pairingReducer, initialPairingState)`), so it always opens at an empty paste screen, and unmounts (resetting) on any exit.

### 3. Settings entry — `src/renderer/src/screens/settings/SettingsScreen.tsx`

`SettingsScreen` gains a required `onPairAnother: () => void` prop (alongside `onBack`). Inside the Connection `settings__section-body`, directly **after** `<ServerRowControl />` (Figma "directly below the Server row"), render an inline action-row component (mirroring the inline `BackControl`):

```ts
// signature contract — an inline, non-exported component, like BackControl
function PairAnotherServerRow({ onActivate }: { onActivate: () => void }): JSX.Element
// renders: <button type="button" className="settings__pair-another-row" onClick={onActivate}>
//            <span className="settings__pair-another-label">Pair another server</span>
//            <ChevronRight aria-hidden />        // Material chevron_right, 20×20, currentColor
//          </button>
```

- Add `pairAnother: 'Pair another server'` to `SETTINGS_COPY`.
- The row is a `<button type="button">`: its text content ("Pair another server") is the accessible name — no `aria-label`. The chevron `<svg>` is `aria-hidden="true"`.
- The chevron is the Material `chevron_right` glyph, `viewBox="0 0 24 24"` rendered at 20×20, `fill="currentColor"` (path e.g. `M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z`). Same inline-SVG posture as `BackControl`'s `arrow_back`.

### 4. CSS — `src/renderer/src/screens/settings/settings.css` (additive)

Mirror the Server-row geometry and the `.settings__back` button treatment. No new tokens, no color/type/spacing literals:

- `.settings__pair-another-row` — `display:flex; align-items:center; gap:var(--space-4); padding:var(--space-3) var(--space-4);` plus button resets (`width:100%; border:none; background:transparent; text-align:left; cursor:pointer; color:var(--color-on-surface);`) and hover/focus (`:hover { background:var(--color-surface-container-high); }`, `:focus-visible { outline:1px solid var(--color-outline); }`) — the `.settings__back` precedent.
- `.settings__pair-another-label` — body-large / `on-surface` (the `.settings__server-row-label` treatment), `flex:1 1 auto; min-width:0`.
- The chevron slot — `flex:0 0 auto`, 20×20, `color:var(--color-on-surface-variant)` (muted trailing affordance).

## Data / navigation flow

```
Settings → tap "Pair another server"
  → onPairAnother → dispatch openPairServer → route 'pairServer'
  → PairedShellView renders <PairingScreen> (fresh, editing phase)

paste → submit → review fingerprint → confirm
  ├─ MAIN (automatic, independent of renderer nav): confirm persists the OVERWRITING record
  │     → pairingHandler.onPaired → connection.reconnect() → tears down old conn, dials new daemon (#83)
  │     → ChannelList re-lists on rising-edge-to-connected (#208): new server's channels appear
  └─ RENDERER: confirm-succeeded → PairingScreen.onPaired
        → dispatch pairServerPaired → route 'list' → new server's channel home (AC3)

cancel / dismiss (any phase)
  → PairingScreen.onCancel: reducer 'cancel' resets to initialPairingState (NO persist, NO reconnect)
  → dispatch pairServerCancelled → route 'settings' (AC4: current server still paired + connected)
```

The two branches of a successful confirm are decoupled: the main-side reconnect fires from the pairing-confirm IPC handler in the background process; the renderer-side `onPaired` is a pure navigation seam. Neither imports the other. This is why "no transport work" holds — the reconnect is inherited, not wired here.

## State + concurrency model

- **State store:** none new. Nav is the existing `PairedShell` screen-local `useReducer` over `nextPairedRoute`. `PairingScreen`'s pairing-phase state is its own local reducer, unchanged.
- **No two-way binding, no global mutable state.** The entry dispatches an event; the reducer returns the next route; the view re-renders. Unidirectional (CLAUDE.md).
- **Lifecycle:** `PairingScreen` mounts on entry to `pairServer` and unmounts on exit; its in-flight IPC (`runSubmit`/`runConfirm`) is guarded by the view's disabled controls, and a post-unmount dispatch is a harmless React-18 no-op (as documented in `PairingScreen.tsx`). No timers, sockets, or subscriptions added by this ticket.
- **Re-render seams:** `PairedShellView` is pure and receives narrow callbacks; no store slice widened. Adding props to the pure view does not affect the existing `list`/`thread`/`settings` render paths.

## Error handling

No new failure modes are introduced by the navigation. Pairing's own error handling is unchanged and owned by `PairingScreen` / `pairingState.ts`:

- Bad paste / malformed key / expired pairing / persist failure → surfaced inline by `PairingScreen`'s existing `ERROR_COPY` mapping; the user stays on the pairing screen to retry.
- A `confirm-failed` returns the pairing reducer to `editing` (paste preserved) — the pairing screen stays mounted (route stays `pairServer`); the user is **not** navigated away and the old server is untouched (no persist occurred).
- **AC4 invariant:** the stored record is overwritten *only* inside the main-side confirm persist (reached only via `runConfirm` on a `confirm`). Cancel, dismiss, and every failure path perform no persist and no reconnect, so the current server stays paired and connected. This is the explicit reason the `runUnpair`-first path (RepairControl, #166/#167) is **rejected**: it clears the record *before* showing pairing, so a cancel would strand the user unpaired — a direct AC4 violation.

## Testing strategy

All tests are `renderToStaticMarkup` server-renders in the `node` vitest env (CLAUDE.md test-first; no jsdom harness), mirroring the existing files.

**`pairedRoute.test.ts`** (pure transitions):
- `openPairServer` from `settings` → `'pairServer'`.
- `pairServerCancelled` from `pairServer` → `'settings'`.
- `pairServerPaired` from `pairServer` → `'list'`.

**`PairedShell.test.tsx`**:
- New `describe("route='pairServer'")`: server-render `<PairedShellView route="pairServer" …/>` and assert it contains the pairing marker (`'Paste pairing code'`) and **not** the list/settings markers. **Requires a `window` stub** — add `beforeEach(() => { globalThis.window = { pyry: {} } as … })` / `afterEach(() => Reflect.deleteProperty(globalThis, 'window'))`, exactly as `App.test.tsx:30-35` does, because `PairingScreen` derefs `window.pyry` at render and the node env has no `window`. (The empty `{ pyry: {} }` suffices — no bridge method runs during a static render.)
- Extend the existing per-route render tests' prop lists with the three new no-op callbacks so they still compile.
- Composition one-liners (the #333 posture): document that the Settings-row entry and the pairing exits reuse the separately-tested transitions — e.g. assert `nextPairedRoute('settings', { type: 'openPairServer' })` is `'pairServer'`, and the two exit transitions land on `'settings'` / `'list'`.

**`SettingsScreen.test.tsx`**:
- Update the `render()` helper to pass `onPairAnother={noop}` (new required prop).
- Assert the Connection section contains the "Pair another server" row label. (Interaction — click → callback — is not exercisable under `renderToStaticMarkup`; the wiring is closed by composition: row present here + `openPairServer → pairServer` in `pairedRoute.test.ts` + `pairServer` route renders `PairingScreen` in `PairedShell.test.tsx`. Same server-render-only posture the whole settings suite uses.)

Type coverage: `npm run typecheck` proves both `assertNever` guards (a missing `PairedNav` case in `nextPairedRoute`, a missing `PairedRoute` case in `PairedShellView`) and the new required `SettingsScreen` prop at its one call site (`PairedShell.tsx`) + the test helper.

## Scope / non-goals

- **No main-process change.** No new IPC channel, no `pairedServerStore` change, no transport change. The reconnect-on-confirm is inherited from `pairingHandler` (#82).
- **No multi-server storage.** Per-server `.${serverId}` keying stays deferred (out of scope, per the store's own comment). Desktop remains single-server / overwrite.
- **No credential path added.** The renderer diff is navigation only, over the vetted pairing IPC surface (#54). No token or server key crosses into the renderer (AC5) — see Security review.
- **Transient reconnect UI** (old channels briefly visible before the new server's list arrives) is existing reconnect behavior (#83/#208), not this ticket's concern.

## Open questions

- **Chevron glyph exact path** — I've specified the Material `chevron_right` at 20×20; if the repo later grows a shared icon set, this inline SVG would fold into it (out of scope now, matching `BackControl`'s inline `arrow_back`).
- None blocking.

## Security review

**Verdict:** PASS

Adversarial re-read of this spec (label `security-sensitive`). The design is renderer navigation over already-built, already-vetted pieces; it adds **no IPC channel, no data flow across `contextBridge`, no storage/crypto/socket code, and no new capability to the renderer**. That framing is load-bearing for most categories below — each is a concrete decision, not a blanket "N/A".

**Findings:**

- **[Trust boundaries]** No finding. This ticket adds no boundary. The only main↔renderer crossings in play — `submitPairingPaste(paste)` and `confirmPairing()` — are the pre-existing #54 pairing IPC, unchanged. The renderer passes the paste straight to main (`pairingState.ts` `runSubmit`) without inspecting it; the only values that return are the display `fingerprint` (a hash) and value-free `PairingErrorReason` categories (`pairingState.ts:104-107, 12-17`). My nav reuses these verbatim.
- **[Tokens/secrets]** No finding. No token is generated, stored, logged, or surfaced in the renderer. The overwrite persist runs entirely in main (`pairedServerStore.save` → the fixed `PAIRED_SERVER_NAME` slot, `pairedServerStore.ts:34,77`), so the switch **replaces** the old server's credential in the same slot rather than orphaning it — no lingering old-server token. The paste (which transitively holds the token) lives only in the pairing reducer, exactly as it already does, and leaves only via the existing `submitPairingPaste` call.
- **[File/storage]** No finding. No renderer-side file/path/storage operation is added; no untrusted input is concatenated into a path. The persist and its `safeStorage` backing are main-side and untouched.
- **[Electron attack surface]** No finding, and a MUST-NOT-REGRESS note for the developer: **do not add an IPC channel or a custom-protocol/deep-link handler** to reach pairing. The design reaches it by in-app navigation (a `PairedRoute` member), so the IPC surface and `webPreferences` are unchanged. Keys/socket/Noise stay in main; the `pairServer` route renders `PairingScreen` with its `window.pyry` default, pulling no secret into the renderer.
- **[Cryptographic primitives]** No finding. No crypto touched. The Noise handshake, key storage, and fingerprint derivation are main-side and reused unchanged. The human fingerprint-verify step (`PairingScreen` ReviewCard, #53) — the anti-MITM control — is preserved, so a re-pair cannot silently switch the user to an attacker's daemon: it still requires pasting a `pyry pair --print` payload and confirming the fingerprint against what the server printed.
- **[Network & I/O]** No finding. No socket/WS/timeout/relay-URL code is added. The reconnect to the new daemon is the inherited `connection.reconnect()` (`index.ts:214`), and the new relay URL is validated in main via the existing pairing path (invalid-paste / invalid-key reasons) — my renderer nav cannot bypass it, because the paste still flows through `submitPairingPaste`.
- **[Error messages/logs]** No finding. No log or error string is added; pairing errors reuse the existing value-free `ERROR_COPY` mapping (no secret, no path, `PairingScreen.tsx:28-34`).
- **[Concurrency]** No finding. No new long-lived async task, timer, or listener. Re-entrancy is bounded: the entry is reachable only from `settings`; once on `pairServer`, in-flight Pair/Confirm are disabled (`busy` gates), and during `confirming` **Cancel is also disabled** (`ReviewCard` `disabled={busy}`), so there is no "cancel races the persist" window — the record is overwritten only inside the terminal confirm, after which the phase is `paired` (no Cancel rendered) and `onPaired` navigates away. A post-unmount dispatch is a React-18 no-op.
- **[Threat model]** No finding; two threats named. (a) *Confused-deputy / silent switch* — addressed: the switch is explicit (paste + fingerprint-verify), reusing the existing anti-MITM control; a compromised renderer gains **no new capability**, since it could already call the app-lifetime pairing IPC directly. (b) *Half-cleared credential window* — the chosen non-destructive mechanism (record overwritten only on a successful `runConfirm`; cancel/dismiss/failure perform no persist and no reconnect) **eliminates** the stranded-unpaired window that the rejected `runUnpair`-first path (#166/#167) would open on cancel. AC4 is thus a security property, not just UX.

**Reviewer:** architect (self-review per `architect/security-review.md`)
**Date:** 2026-07-14
