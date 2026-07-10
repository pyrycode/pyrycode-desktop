# Spec — #223 Modal store + bridge (DaemonEvent → ModalEvent)

**Ticket:** [#223](https://github.com/pyrycode/pyrycode-desktop/issues/223) · **Size:** S · **Security-sensitive:** no · **UI-visible:** no (headless)

Fold the decoded modal `DaemonEvent` arms into an id-addressed Zustand `modalStore`. This is the **missing middle** of the modal vertical: #122 shipped the pure model (`reduceModal`, `ModalEvent`, `ModalState`), #201 shipped the transport decode that emits the `modalShown` / `modalDismissed` `DaemonEvent` arms; this slice adds the Zustand container over `reduceModal` plus the `DaemonEvent → ModalEvent` bridge that dispatches into it. It is a **piece-for-piece clone of #202** (`timelineStore` + `timelineBridge`), which did the identical job for the interactive-stream arms.

Two new production files, two new test files, **zero existing files touched** (Strangler Fig, ADR 0009). The two modal arms already return `null` in both existing bridges — `daemonEventBridge.ts:69-73` and `timelineBridge.ts:67-68` — and **stay that way**; this bridge is a *third independent subscriber* on the same channel that owns those two arms.

## Design source

N/A — headless store + bridge; nothing renders yet. The interactive render slice (#224) owns all visuals and its own Figma anchor. No visual-fidelity check applies here.

## Files to read first

- `src/renderer/src/store/timelineStore.ts` (all, 52 lines) — **the store to clone near-verbatim.** DI-factory → singleton → hook → re-exported selector. Swap `reduceTimeline`/`ThreadEvent`/`TimelineState` → `reduceModal`/`ModalEvent`/`ModalState`.
- `src/renderer/src/store/timelineStore.test.ts` (all, 47 lines) — the store-test shape to clone. Tests only the *wiring* (initial state, dispatch→reduce, isolation), never the reducer branches.
- `src/renderer/src/store/timelineBridge.ts` (all, 111 lines) — **the bridge to clone near-verbatim.** `translate…` pure choke point + `subscribe…` inject seam + `use…React` binding. Note the fresh-literal arm-copy discipline in the doc-comment and the explicit-fall-through + `assertNever` switch.
- `src/renderer/src/store/timelineBridge.test.ts` (all, 267 lines) — the bridge-test shape to clone: owned-arm translate tests, the inverse-filter null test, the `fakeBridge()` spy idiom, and store-integration tests.
- `src/renderer/src/store/modalPrompts.ts` (all, 106 lines) — **the model to wrap.** Import `reduceModal`, `ModalEvent`, `ModalState`, `ModalPrompt`, `initialModalState`, `selectOutstanding` from here. `reduceModal` is fully covered by `modalPrompts.test.ts` — do **not** re-test its branches.
- `src/renderer/src/store/modalPrompts.test.ts` (skim) — confirms what the reducer already covers so the new store test stays wiring-only.
- `src/shared/ipc/events.ts:98-113` — the two owned `DaemonEvent` arms (`modalShown` / `modalDismissed`) and their exact field shapes.
- `src/shared/wire/types.ts:232-250` — `WireModalClass` / `WireModalSource` / `WireModalOption`; read to confirm structural equality with the `ModalEvent` field types (drives the **no-cast** decision below).
- `src/renderer/src/store/daemonEventBridge.ts:69-73` **and** `src/renderer/src/store/timelineBridge.ts:56-72` — confirm both already `null` the modal arms. **Do NOT edit either file.**
- `docs/knowledge/decisions/0009-modal-prompt-model.md` — reserves the `modalStore.ts` name for exactly this container (§ Decision) and fixes the append/remove-by-id semantics.

## Context

By the time a modal reaches the renderer it is already a typed `DaemonEvent` with **camelCase** fields (the snake→camel decode is #201's, done at the transport). So this bridge is **not a rename** — it is a filter + fresh-literal arm-selection copy, exactly like `translateTimelineEvent`'s `toolUse` arm: select the two owned arms, rebuild each as a fresh literal, `null` for everything else.

Precedent mapping (verified against the tree):

| Timeline (#202, shipped) | Modal (#223, this slice) |
|---|---|
| `timelineStore.ts` — Zustand over `reduceTimeline` | `modalStore.ts` — Zustand over `reduceModal` |
| `timelineBridge.ts` — `translateTimelineEvent` + `subscribeTimeline` + `useTimelineBridge` | `modalBridge.ts` — `translateModalEvent` + `subscribeModal` + `useModalBridge` |
| Headless; 0 files touched. `useTimelineBridge` mounted later by the render slice (#203, `App.tsx:52`) | Headless; 0 files touched. `useModalBridge` mounted later by the render slice (**#224**) |

## Design

### File 1 — `src/renderer/src/store/modalStore.ts` (new, ~40 LOC)

A vanilla Zustand store wrapping `reduceModal`, structurally identical to `timelineStore.ts`. Contracts:

- `type ModalStore = ModalState & { dispatch: (event: ModalEvent) => void }` — state + the single mutation entry point. `dispatch` is the sole write path; the only read surface is the re-exported `selectOutstanding`. No exposed setter, no two-way binding (CLAUDE.md unidirectional rule, AC1).
- `createModalStore(init: ModalState = initialModalState)` — DI-friendly, React-free factory; one isolated instance per test. Body mirrors `createTimelineStore`: `dispatch: (event) => set((s) => reduceModal(s, event))`. No diagnostics observer param — the #134 seam is session-only; a speculative observer would defend an unobserved need (the #202 call, ADR 0009).
- `export const modalStore = createModalStore()` — the app-wide singleton the bridge dispatches into and #224 reads.
- `useModalStore<T>(selector: (s: ModalStore) => T): T` — narrow-slice React binding via `useStore(modalStore, selector)`.
- `export { selectOutstanding } from './modalPrompts'` — re-export the read surface from one site; never redefine it.

### File 2 — `src/renderer/src/store/modalBridge.ts` (new, ~90 LOC)

Structurally identical to `timelineBridge.ts`. Three exports:

- `translateModalEvent(event: DaemonEvent): ModalEvent | null` — the pure choke point. Owns exactly `modalShown` / `modalDismissed`; every other arm returns `null` via **explicit fall-through cases guarded by `assertNever`** — never a catch-all `default: return null` (AC3). Contract sketch:

  ```ts
  export function translateModalEvent(event: DaemonEvent): ModalEvent | null {
    switch (event.type) {
      case 'modalShown':
        return { type: 'shown', modalId: event.modalId, class: event.class,
                 title: event.title, prompt: event.prompt,
                 options: event.options, defaultOptionId: event.defaultOptionId }
      case 'modalDismissed':
        return { type: 'dismissed', modalId: event.modalId,
                 outcome: event.outcome, source: event.source }
      /* …15 non-modal arms fall through… */ :
        return null
      default:
        return assertNever(event)
    }
  }
  ```

  **The one non-obvious detail (do not clone timelineBridge blindly here):** the discriminant *name changes across the boundary* — `modalShown` → `type: 'shown'`, `modalDismissed` → `type: 'dismissed'`. This differs from `translateTimelineEvent`, where the discriminant is identical on both sides (`assistantDelta` → `assistantDelta`). Field **names** are unchanged (already camelCase, field-for-field identical); only the arm tag changes.

- `subscribeModal(onDaemonEvent, dispatch): () => void` — subscribe via the injected `onDaemonEvent`; translate each event and dispatch non-null results; return the exact unsubscribe handle from `onDaemonEvent` as the cleanup. Injecting `onDaemonEvent` + `dispatch` keeps it React-free and unit-testable with plain spies (the `subscribeTimeline` idiom). Signature mirrors `subscribeTimeline` with `ThreadEvent` → `ModalEvent`.
- `useModalBridge(): void` — `useEffect(() => subscribeModal(window.pyry.onDaemonEvent, (e) => modalStore.getState().dispatch(e)), [])`. `window.pyry` is dereferenced only inside the effect, never during render. Returning `subscribeModal`'s off-handle as the effect cleanup gives the StrictMode mount→cleanup→mount → exactly-one-live-listener guarantee (AC4), identical to `useTimelineBridge`.

**The 15 arms that fall through to `null`** (the full `DaemonEvent` union minus the two owned modal arms) — enumerate all of them so the exhaustive switch compiles first try:

`connecting`, `connected`, `disconnected`, `failed`, `messageReceived`, `messagesReceived`, `debugBundleProgress`, `debugBundleSaved`, `debugBundleFailed`, `snapshotReceived`, `assistantDelta`, `turnEnd`, `turnState`, `toolUse`, `conversationsReceived`.

(Note the mirror: `assistantDelta`/`turnEnd`/`turnState`/`toolUse` are *owned* by `timelineBridge` but *nulled* here — two independent subscribers each own a disjoint arm-set on the same channel.)

### No cast — verified

The fresh-literal copy compiles clean with **no `as`** (the codebase bans unchecked `as` in prod, #121 rework). The owned `DaemonEvent` arm field types are structurally equal to the `ModalEvent` field types (verified in `src/shared/wire/types.ts:232-250`):

- `class: WireModalClass` (`'permission' | 'trust'`) → `ModalClass` (`'permission' | 'trust'`)
- `source: WireModalSource` (`'remote' | 'local' | 'timeout'`) → the inline `'remote' | 'local' | 'timeout'` on `ModalEvent`'s `dismissed`
- `options: readonly WireModalOption[]` (`{ id; label }`) → `readonly ModalOption[]` (`{ id; label }`)

`options` may pass through **by reference** in the fresh `shown` literal — both `reduceModal`'s `shown` arm and `translateTimelineEvent`'s `toolUse` copy nested fields by reference, not deep-clone. No spread, no `return event`; name each field explicitly so the translator stays immune to a `DaemonEvent` arm gaining an unrelated field later.

## State + concurrency model

- **Single source of state:** the `modalStore` singleton. `outstanding` is the whole slice; `dispatch(event: ModalEvent)` the only write. No parallel mutable state. `daemonEventBridge` (→ `sessionStore`) and `timelineBridge` (→ `timelineStore`) are unaffected — three stores, three disjoint arm owners.
- **Subscription lifecycle:** `useModalBridge` opens one listener on mount, tears it down on unmount via the returned off-handle. Not mounted in this slice — `useModalBridge` is exported and dormant until #224 mounts it (mirroring #203 mounting `useTimelineBridge` at `App.tsx:52`). **Do not edit `App.tsx`.**
- **Reduce semantics (already shipped in #122, unchanged):** `shown` plain-appends; `dismissed` removes by `modalId` or is a same-reference no-op on an unknown/already-dismissed id (so an unchanged slice does not churn selectors). `modalId` is the sole correlation key — no `conversation_id`.
- **Out of scope:** reconnect re-delivery idempotency (a re-sent `modalShown` with a known `modalId`) is **#195** (match-and-replace), layered on this store later. Here `shown` plain-appends.

## Error handling

No new failure modes. All inputs are already-typed, renderer-local `DaemonEvent`s — no network, socket, parse, or permission surface (that boundary is #201's transport decode). The only guard is the compile-time `assertNever` exhaustiveness check: a future `DaemonEvent` arm with no case is a *type error* in this bridge (and in `daemonEventBridge` + `timelineBridge`), forcing each to declare its mapping. `title` / `prompt` / `options[].label` are untrusted `claude` free text but are carried **opaquely** here — the render slice (#224) owns escaping them (plain text, never HTML).

## Testing strategy

`npm test` (vitest), plain function + store tests, no React render. Clone the two #202 test files.

**`modalStore.test.ts`** (wiring only — `reduceModal`'s branches are owned by `modalPrompts.test.ts`):
- `createModalStore()` starts at `{ outstanding: [] }` (assert via `selectOutstanding(store.getState())` → `[]`).
- dispatch threads the reducer: a `shown` event appends one `ModalPrompt` with the copied fields.
- dispatch a `dismissed` for that `modalId` empties `outstanding`.
- dispatch a `dismissed` for an unknown `modalId` is a no-op — same state reference (assert `store.getState()` unchanged, matching the timeline `no-churn` test).
- two `createModalStore()` instances are isolated — dispatching into one leaves the other at initial state.

**`modalBridge.test.ts`** (clone `timelineBridge.test.ts`, including the `fakeBridge()` spy idiom):
- `translateModalEvent(modalShown)` → `{ type: 'shown', … }` with all six fields copied, `toEqual` the expected literal, and `not.toBe(event)` (fresh object). **Assert `type` is `'shown'`, not `'modalShown'`** — pins the discriminant rename.
- `translateModalEvent(modalDismissed)` → `{ type: 'dismissed', modalId, outcome, source }`, fresh object.
- Inverse filter: `translateModalEvent` returns `null` for **all 15 non-modal arms** — build the array of the 15 fixtures (include `assistantDelta` / `toolUse` explicitly, since those are the arms `timelineBridge` owns but this one must null) and assert each is `null`.
- `subscribeModal` subscribes exactly once.
- `subscribeModal` dispatches a translated event for `modalShown`; dispatches nothing for an unowned arm (e.g. `connecting`).
- `subscribeModal` returns the off-handle from `onDaemonEvent` as cleanup — calling it invokes `off` once (the one-listener guarantee behind AC4; `useModalBridge` is a structural clone of `useTimelineBridge` and is not rendered directly because it dereferences `window.pyry`).
- Store integration (no React): emit `modalShown` then `modalDismissed` with the same `modalId` → `selectOutstanding` goes `[1 prompt]` → `[]`.
- Store integration: emit `modalShown`, then `modalDismissed` with an unknown id → `outstanding` stays `[1 prompt]`, same-state no-churn.

Type coverage under `npm run typecheck` (both sides) and `npm run build` (the salvage/QA gate) — both must be green (AC5).

## Open questions

None blocking. Two forward pointers, both already ticketed: reconnect re-delivery idempotency is #195; the interactive render + `useModalBridge` mount is #224.
