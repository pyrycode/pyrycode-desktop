# #167 — Offer re-pair when the connection persistently fails or the daemon rejects the pairing

Split from #120. Renderer-only. Adds a pure predicate `shouldOfferRepair` beside `composerAvailability`, and a conditionally-shown re-pair affordance on the conversation screen that reuses the merged `runUnpair` flow. **No transport change.**

## Files to read first

- `src/renderer/src/screens/conversation/composerSend.ts:70-108` — `ComposerAvailability` + `composerAvailability`; the new `shouldOfferRepair` predicate sits directly beside it, same pure/React-free discipline.
- `src/renderer/src/store/sessionStore.ts:15-32` — `ConnectionStatus` (4 arms) and `ConnectionError { code, message, retryable }`; the exact shape the predicate reads. `selectStatus` at `:170`.
- `src/renderer/src/screens/conversation/unpairAction.ts` (whole file, 60 lines) — `runUnpair({ unpair, dispatch, onUnpaired })` and `UNPAIR_FAILED_ERROR` (`code: 'unpair'`, `retryable: false`). The affordance reuses `runUnpair` verbatim; the `'unpair'` literal is the predicate's self-loop guard — **read the constant, don't hardcode a remembered value.**
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:25-50` (render tree), `:160-235` (`Composer`, whose error `hint` this extends), `:242-297` (`UnpairControl` — the existing `runUnpair` wiring to mirror). Note `selectStatus` is already imported (`:4`).
- `src/renderer/src/screens/conversation/ConversationScreen.test.tsx:1-3,52-75,83-153` — the server-render idiom (`renderToStaticMarkup`), the exported-pure-view test pattern (`MessageThread`, `StatusSheet`), and the store-binding smoke block. **Load-bearing gotcha at `:114-118`** (see State model below).
- `src/renderer/src/screens/conversation/composerSend.test.ts:113-160` — the `composerAvailability` describe block; add a sibling `shouldOfferRepair` describe in the same style.
- `src/renderer/src/screens/conversation/conversation.css:44-76` — `.conversation__unpair` de-emphasized text-button treatment to reuse (or mirror) for the re-pair button. CSS carries no theme-token risk here; no new tokens.

## Design source

N/A — the mobile Figma has no connection-failure / re-pair-prompt design (confirmed in the ticket body: the Status Sheet node `20-100` is run-configuration; the only re-pair CTA is Settings → "Pair another server", node `17-18`). This affordance surfaces on the conversation screen (node `16-8`), extending its existing composer error state and reusing existing conversation styles. A bespoke error/re-pair visual is a recommended Figma-side follow-up.

## Context

Hit live 2026-07-07 (#120): the daemon was unreachable, the app held the stored pairing, and the user sat on the conversation screen with a disabled composer and no recovery. #166 (merged) added a **manual** `Unpair` control the user must know to reach. This ticket makes the app **proactively** surface the same clear-and-return-to-pairing path when it detects a terminal failure or a non-retryable daemon rejection — instead of sitting silently.

The signal already exists in the renderer: `sessionStore`'s `ConnectionStatus` has an `error` arm carrying `ConnectionError { code, message, retryable }`. This ticket reads that state and offers re-pair. It does **not** touch the transport, sockets, keys, or the Noise handshake.

### What actually reaches the `error` arm (the three-source retryability model)

Validated against the merged transport; this is the discriminant the predicate keys on.

1. **A transient transport drop never surfaces as `error` at all.** `relaySupervisor.ts` absorbs retryable disconnects and silently re-dials with backoff; the renderer stays `connecting`. So AC3's "a blip does not yank the user to pairing" is **already guaranteed by the transport** — this ticket must simply not *re-introduce* over-firing.
2. **A terminal transport / handshake failure** (supervisor gave up, or a fatal close code — `4401` unauthorized, `4421` protocol mismatch, `4426` handshake — from `DEFAULT_FATAL_CLOSE_CODES`) reaches the store as `error` with `retryable: false`, **always** (`daemonConnection.ts` `emitFailed` hardcodes `retryable: false`; `code` synthesized as `'transport'` or `'handshake'`). This is the daemon-rejects-stale-device case: the daemon reloads its device registry at handshake and refuses an unknown device (pyrycode ADR 029), closing `4401`. **→ offer re-pair.**
3. **A daemon wire `error` envelope** over an already-live session copies the daemon's own `retryable` verbatim (`daemonEventBridge.ts`). These **can** be `retryable: true` (e.g. `server.binary_offline`, `rate_limited`) — a transient daemon-side condition. **→ must NOT offer re-pair.**

## Design

Two additions, both additive; `composerAvailability`, `Composer`, and the transport are untouched.

### 1. The predicate — `shouldOfferRepair` in `composerSend.ts`

A pure `shouldOfferRepair(status: ConnectionStatus): boolean` beside `composerAvailability`, same React-free/store-free discipline. Contract:

```
shouldOfferRepair(status) === status.type === 'error'
  && !status.error.retryable          // primary gate: excludes binary_offline / rate_limited (source 3)
  && status.error.code !== 'unpair'   // self-loop guard: see below
```

- **`!retryable` is the primary gate.** It admits source 2 (always non-retryable) and excludes the retryable class of source 3. Source 1 never reaches `error` at all, so it is out of scope for the predicate.
- **`code !== 'unpair'` is the non-obvious guard.** `runUnpair` dispatches `UNPAIR_FAILED_ERROR { code: 'unpair', retryable: false }` when the clear itself fails. Without this clause, a **failed** re-pair would immediately re-satisfy the predicate and re-offer itself — a tight loop of a broken capability. Confirm the `'unpair'` literal against `unpairAction.ts` at implementation time. (AC5.)

Returns `false` for `connected` / `connecting` / `disconnected` because they are not the `error` arm — no per-arm branching needed; a single boolean expression suffices. No exhaustiveness `switch` is required (this is a boolean over one arm, not a total mapping like `composerAvailability`).

### 2. The affordance — pure `RepairPrompt` view + in-file `RepairControl` container in `ConversationScreen.tsx`

Split along the file's established **pure-view / store-bound-container** seam (as `MessageThread` and `StatusSheet` already are), because visibility must be rendering-tested across the true/false matrix and the container's populated branch is not server-render-reachable (see State model).

- **Exported pure view** `RepairPrompt({ status, onRepair }: { status: ConnectionStatus; onRepair: () => void }): JSX.Element | null` — returns `null` when `!shouldOfferRepair(status)`, else a single text button. Visible text **`Re-pair`** (accessible name via text content, no `aria-label`, mirroring #166's `Unpair`). Reuses/mirrors the `.conversation__unpair` treatment (or a small new `.composer__repair` class); no new theme tokens. This is where AC1's present/absent rendering is proven.
- **In-file container** `RepairControl({ onUnpaired }: { onUnpaired?: () => void })` — selects `status` via `useSessionStore(selectStatus)` and `dispatch` via `useSessionStore(s => s.dispatch)`, and renders `<RepairPrompt status={status} onRepair={handleRepair} />`. `handleRepair` calls `runUnpair({ unpair: window.pyry.unpair, dispatch, onUnpaired: () => onUnpaired?.() })` — the **same** wiring `UnpairControl` uses. `window.pyry` is dereferenced only inside `handleRepair` (interaction time), never during render, so the container smoke-render never touches the bridge (same discipline as `Composer.handleSubmit` / `UnpairControl.handleConfirm`).

**Reuse, not duplication (AC2):** `runUnpair` is the single clear-and-return-to-pairing path. No second clear path, no new IPC, no touch to `window.pyry.unpair`. `RepairControl` is a second, conditionally-shown *trigger* for the identical flow.

**No confirm phase, no busy state — deliberate.** Unlike `UnpairControl` (which guards an accidental destructive click while everything works), `RepairControl` only appears in an already-terminal error state; its whole purpose is escape, so a confirm step is pure friction. A busy guard is unnecessary for correctness: `runUnpair`'s clear is idempotent and `onUnpaired` (route flip) is idempotent, and the affordance **self-hides on both outcomes** — on `ok` the store resets to `disconnected` (predicate → false) and the route unmounts the screen; on `error` the store lands on `code: 'unpair'` (predicate → false). So `handleRepair` fires `void runUnpair({...})` and needs no `.then`. (`runUnpair` never rejects — it catches internally and returns `'ok' | 'error'` — so the floating promise raises no unhandled rejection.)

### Placement in the render tree

Add `<RepairControl onUnpaired={onUnpaired} />` immediately after `<Composer />` in `ConversationScreen` (before the `{sheetOpen && …}` sheet). It extends the composer's existing error state: in a terminal-error status the `Composer` still shows its `'Connection error'` hint (unchanged) **and** the `Re-pair` button appears beneath it — together satisfying AC1's "in addition to / extending the existing disabled-composer error hint." Exact visual placement/styling is developer discretion given Figma N/A.

## State + concurrency model

- **Single source of state** unchanged: `sessionStore` is the only session state; `RepairControl` reads `status` and `dispatch`, dispatches nothing itself (the dispatch happens inside the reused `runUnpair`). No new store slice, no parallel state.
- **Re-render seam preserved.** `ConversationScreen` still selects only `selectMessages`; it does **not** select `status`. `RepairControl` selects `status` independently, so a status change re-renders `Composer` and `RepairControl` only — **not** `ConversationScreen` or `MessageThread`. Do not lift the `status` read into `ConversationScreen`; that would recompute `messages.map(...)` and re-render the thread on every status change.
- **zustand v5 server-snapshot gotcha (load-bearing for testing).** Under `renderToStaticMarkup`, zustand v5's `useStore` returns `getInitialState()`, not the `setState`-mutated state (`ConversationScreen.test.tsx:114-118`). So a store-bound container always server-renders the **initial `disconnected`** state — a `sessionStore.setState({ status: error… })`-then-render assertion would silently keep rendering `disconnected`. This is exactly why `RepairPrompt` takes `status` as a **prop**: the populated true-branch is proven by directly server-rendering the pure view with an arbitrary `status`, per the repo's pure-view/container convention.
- **Concurrency:** none new. `runUnpair` is a single already-tested async action; `RepairControl` fires it as `void` (idempotent, self-hiding, non-rejecting). No `AbortController`, no subscription, no teardown to add.

## Error handling

All failure surfaces are inherited from `runUnpair` (`unpairAction.ts`) and are unchanged:

- **Clear succeeds** (`result: 'ok'`) → `dispatch({ reset })` (store → `disconnected`) → `onUnpaired()` flips the route to pairing → screen unmounts.
- **Clear fails** (`result: 'error'`, or the invoke rejects because the handler is absent) → `dispatch({ failed, error: UNPAIR_FAILED_ERROR })` (store → `error` with `code: 'unpair'`) → route does **not** flip → the composer shows its plain `'Connection error'` hint and, because the predicate now excludes `code: 'unpair'`, the `Re-pair` button **disappears** (loop-prevention, AC5). The user still has the manual header `Unpair` control.
- The predicate itself is total and cannot throw (a boolean over one arm; no I/O).

## Testing strategy

`npm test` (vitest) + `npm run typecheck`. No jsdom / client-render harness (none exists; do not add a dependency for one — AC2's click path is covered structurally, as `UnpairControl`'s is).

**Predicate — `composerSend.test.ts`, new `describe('shouldOfferRepair')` beside `composerAvailability` (AC3/AC4/AC5):**
- `true` for a terminal transport error `{ type: 'error', error: { code: 'transport', message: …, retryable: false } }`.
- `true` for a terminal handshake error `{ …, error: { code: 'handshake', …, retryable: false } }`.
- `false` for each non-error arm: `connected` (with an `ack`), `connecting`, `disconnected`.
- `false` for a **retryable** daemon error `{ …, error: { code: 'server.binary_offline', …, retryable: true } }` (AC4).
- `false` for the **unpair-failure** error `{ …, error: { code: 'unpair', …, retryable: false } }` (AC5).

**Affordance render — `ConversationScreen.test.tsx`, server-render the exported `RepairPrompt` directly (AC1), the `MessageThread`/`StatusSheet` pattern:**
- `<RepairPrompt status={terminalError} onRepair={() => {}} />` → markup contains the `Re-pair` button text.
- `<RepairPrompt status={{ type: 'error', error: { code: 'server.binary_offline', …, retryable: true } }} onRepair={() => {}} />` → empty markup (renders `null`).
- `<RepairPrompt status={{ type: 'disconnected' }} onRepair={() => {}} />` → empty markup.

**Container smoke — existing `ConversationScreen — store binding` block:** the initial store state is `disconnected`, so the re-pair button is naturally absent; the existing "renders without throwing" test already covers that `RepairControl` mounts safely against the empty store (add an explicit "`Re-pair` absent in the disconnected initial state" assertion if desired). The populated container branch is **not** server-testable (gotcha above) and is intentionally not asserted here.

**Reuse coverage (AC2):** `runUnpair` is already unit-tested in `unpairAction.test.ts`; `RepairControl`'s wiring mirrors `UnpairControl`'s (itself smoke-only for the same server-render reason). No new test of the clear path is needed — asserting the shared helper twice adds nothing.

## Open questions

- **Button copy/emphasis.** Spec prescribes a bare `Re-pair` text button reusing the `.conversation__unpair` treatment. If a filled/emphasized recovery CTA or accompanying explanatory copy is wanted, that is a Figma follow-up (design is N/A today). Keep the accessible name stable as `Re-pair` regardless so the test key holds.
- **Placement.** After `<Composer />` is prescribed; if the team prefers the button *inside* the composer hint block, that requires threading `onUnpaired` into `Composer` and is a larger change — deferred unless a design lands.

## Acceptance criteria

- [ ] When `shouldOfferRepair(status)` is true (a terminal / non-retryable `error` state), the conversation screen shows a `Re-pair` affordance in addition to the existing disabled-composer error hint; when it is false the affordance is absent.
- [ ] Choosing re-pair runs the **same** clear-and-return-to-pairing flow as the manual unpair — it reuses `runUnpair` (`window.pyry.unpair` → `dispatch({ reset })` → `onUnpaired`). No second clear path is introduced.
- [ ] `shouldOfferRepair(status: ConnectionStatus): boolean` is a pure function beside `composerAvailability`, unit-tested without React or a store; `true` only for a non-retryable `error`, `false` for `connected` / `connecting` / `disconnected`.
- [ ] A **retryable** daemon error (`error` with `retryable: true`, e.g. `server.binary_offline`) does NOT trigger the prompt — the composer keeps its plain error hint. Covered by a predicate unit test.
- [ ] The predicate does NOT fire on the synthesized **unpair-failure** error (`{ code: 'unpair', retryable: false }`) — otherwise a failed re-pair would re-offer itself in a loop. Covered by a predicate unit test.
