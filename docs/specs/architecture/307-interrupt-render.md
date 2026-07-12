# #307 — Interrupt a running turn from the conversation thread (render slice)

The user-facing slice of the interrupt chain (split from #146: #305 wire+builder → #306 command+IPC → **#307 render**). #305 and #306 are merged: the `interrupt` member is on `RendererCommand`, the `interruptCommand()` factory exists, the IPC pipe carries it, and the background process maps it to a single claude Esc (daemon SSOT pyrycode #707). This slice adds only the on-thread affordance that dispatches it — nothing else in the transport or store changes.

## Files to read first

- `src/renderer/src/screens/conversation/dropQueuedMessage.ts` (whole, ~40 lines) — **the exact seam to clone.** Injected `sendCommand`, guarded send inside try/catch, `console.error` on failure, NO local store dispatch. `sendInterrupt.ts` is a strict simplification of this (bare command, no ids).
- `src/renderer/src/screens/conversation/dropQueuedMessage.test.ts` (whole) — the seam-test shape to clone for `sendInterrupt.test.ts`: inject `sendCommand` as a `vi.fn()`, assert the one call.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:369-392` — the `ThinkingIndicator` container/pure-view idiom to mirror: exported pure view, `isThinking: boolean` (never `phase`), null-on-false posture, client-owned visible label.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:394-489` — `QueuedBacklog` view + `QueuedBacklogControl` container: icon-only `<button>` with `aria-label` from a client-owned constant, a **required injected effect** (`onDrop`), and `window.pyry.sendCommand` dereferenced **only inside the click closure**. `InterruptButton`/`InterruptControl` mirror this pair exactly.
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:51-116` — the `ConversationScreen` container: `phase` is already selected at line 64 (`const phase = useTimelineStore(selectPhase)`); mount `<InterruptControl />` as a sibling **immediately before `<Composer />`** (line 97).
- `src/renderer/src/screens/conversation/ConversationScreen.tsx:577-656` — `Composer` + the `.composer__send` icon button: the markup shape (round icon `<button>`, inline SVG) and the `window.pyry` "dereference only at interaction time" discipline the interrupt button reuses.
- `src/shared/ipc/commands.ts:132-142` — `interruptCommand()` (#306): pure, zero-arg, returns the bare `{ type: 'interrupt' }`. The only thing `sendInterrupt` wraps.
- `src/renderer/src/store/threadTimeline.ts:11` and `:170-213` — `TurnPhase = 'thinking' | 'responding' | 'idle'`; the `turnState` reducer arm (line 171-172) resets `phase` on `turn_state{idle}`; `turnEnd` deliberately does NOT (line 174). `selectPhase` (line 213), `initialTimelineState.phase = 'idle'` (line 209). Confirms AC3: the control retracts through the existing subscription, no new client state.
- `src/renderer/src/store/timelineStore.ts:44-51` — `useTimelineStore` + the `selectPhase` re-export already consumed by the container.
- `src/renderer/src/screens/conversation/conversation.css:341-346` (`.conversation__thinking` region), `:382-407` (`.queued-row__drop` icon button), `:574-606` (`.composer__send` icon button) — the region + icon-button CSS to mirror for `.conversation__interrupt` / `.interrupt-button`.

## Design source

**Figma:** https://www.figma.com/design/g2HIq2UyPhslEoHRokQmHG?node-id=16-8

N/A for the running-turn interrupt state specifically. Node `16-8` is the Conversation Thread Screen this control is added to; the composer is `16-61` and its steady send button is `16-69`. The mobile Figma file (which desktop mirrors) draws the composer only in its steady send state and has **no stop/interrupt affordance and no stop component in the design system** — a genuine mobile-design gap called out in the ticket. Per the ticket, the control is therefore derived from the existing composer icon-button (`.composer__send`, an M3 filled round icon button on `--color-surface-container-high`) with an M3 `stop` glyph (filled square). Keep the button's colour neutral (mirror `.composer__send` tokens) — a distinct "stop"/error colour would be a bespoke visual; **flag to Juhana** that the interrupt-state composer visual can be designed later if wanted.

## Context

A desktop user watching a long or wrong turn run has no way to stop it. The interrupt path exists end-to-end below the UI (#305/#306); this slice exposes it. The design intent (ticket + daemon SSOT #707): interrupt is **fire-and-forget** — one Esc, no daemon reply. The "stopped" state is already surfaced by the existing turn lifecycle: when the interrupted turn ends the daemon emits `turn_state{idle}`, the reducer's `turnState` arm returns `phase → idle`, and any control gating on `phase` retracts through the live store subscription. So this slice introduces **no new "stopping" state** — it reads the existing `phase` scalar and nothing more.

## Design

Four small additions, mirroring the `dropQueuedMessage` + `QueuedBacklog`/`QueuedBacklogControl` triplet one-for-one.

### 1. New effect seam — `src/renderer/src/screens/conversation/sendInterrupt.ts`

The pure, React-free, injected-effect helper. A strict simplification of `dropQueuedMessage.ts`: same guarded-send-no-local-dispatch posture, but the command is bare so there are no ids to thread.

Contract:

```ts
export interface SendInterruptDeps {
  sendCommand: (command: RendererCommand) => void
}
export function sendInterrupt(deps: SendInterruptDeps): void
```

Behaviour: calls `deps.sendCommand(interruptCommand())` inside a `try/catch`; on throw, `console.error(...)` and swallow (a send-bridge failure must not crash the window — the `dropQueuedMessage`/`submitMessage` posture). **No local store dispatch** (AC3: no optimistic/"stopping" state — the control retracts only when the daemon's `turn_state{idle}` actually lands). Imports `{ interruptCommand, type RendererCommand }` from `@shared/ipc/commands` (the `@shared` alias resolves in the renderer, as `dropQueuedMessage.ts` already does).

### 2. Pure gate predicate — in `ConversationScreen.tsx`, exported

```ts
export function isTurnRunning(phase: TurnPhase): boolean
```

Returns `phase === 'thinking' || phase === 'responding'`. This is the **one subtle thing in the ticket**: the interrupt gate is BROADER than `ThinkingIndicator`'s (`phase === 'thinking'` only) — a turn is "running" in either `thinking` or `responding`. Extracting it as a named, exported predicate makes AC1 (both running phases show, idle hides) a deterministic store-free test, rather than a store-mounted render. Import `type TurnPhase` from `../../store/threadTimeline`.

### 3. Pure view — `InterruptButton`, in `ConversationScreen.tsx`, exported

Mirrors `ThinkingIndicator` (null-on-false) + `QueuedBacklog`'s icon button (aria-label from a client-owned constant, required injected effect).

Contract:

```ts
export function InterruptButton({
  isRunning,
  onInterrupt
}: {
  isRunning: boolean
  onInterrupt: () => void
}): JSX.Element | null
```

- `!isRunning` → `null` (zero layout footprint, the `ThinkingIndicator`/`QueuedBacklog` posture — this is the AC1 "absent at idle" guarantee, structural).
- `isRunning` → a wrapper `<div className="conversation__interrupt">` holding one icon-only `<button type="button" className="interrupt-button" aria-label={INTERRUPT_LABEL} onClick={onInterrupt}>` with an inline M3 `stop` SVG (`viewBox="0 0 24 24"`, `fill="currentColor"`, `aria-hidden="true"`, path `M6 6h12v12H6z`).
- `INTERRUPT_LABEL` — a module-scope client-owned constant, e.g. `'Stop the running turn'` (conveys both "stop" and "interrupt", AC4). Never a daemon string.
- Keyboard-activatable is free: a native `<button>` fires `onClick` on Enter/Space (AC4). No custom key handling.
- `isRunning: boolean`, NOT `phase: TurnPhase` — same type-level guarantee as `ThinkingIndicator`: no daemon-supplied string can reach the view because it never receives one.

### 4. Container — `InterruptControl`, in `ConversationScreen.tsx`, in-file, NOT exported

The thin store→bridge glue, mirroring `QueuedBacklogControl`. Reads the existing `phase` slice, derives the boolean, binds the injected effect:

```tsx
function InterruptControl(): JSX.Element | null {
  const phase = useTimelineStore(selectPhase)
  return (
    <InterruptButton
      isRunning={isTurnRunning(phase)}
      onInterrupt={() => sendInterrupt({ sendCommand: window.pyry.sendCommand })}
    />
  )
}
```

`window.pyry` is dereferenced **only inside the click closure** (interaction time, never render), so the existing server-rendered `<ConversationScreen />` smoke tests never touch the bridge. Mount `<InterruptControl />` in the `ConversationScreen` return, immediately before `<Composer />` (line 97). It renders in the composer region, right-aligned to sit over the send side.

## State + concurrency model

- **No new store, no new store slice, no new client state.** The single read is `useTimelineStore(selectPhase)` — the same subscription the container already holds. `phase` is owned solely by `reduceTimeline`; the daemon's `turn_state{idle}` (not `turn_end`) returns it to `idle`, which flows through this subscription and re-renders `InterruptControl` → `InterruptButton` returns `null` → the control disappears (AC3). No `useState`, no "stopping" flag, no timers.
- **Dispatch is fire-and-forget, exactly once per activation** (AC2): one click → one `onInterrupt()` → one `sendInterrupt()` → one `sendCommand(interruptCommand())`. The button is **not** disabled after click and holds no "already interrupted" state — a second Esc is harmless (daemon owes no reply), and adding disable-after-click state would violate AC3's "no new client-side state". The control simply stays until `phase` leaves the running set.
- **Re-render seam:** `selectPhase` returns the scalar; `InterruptControl` re-renders only on a phase change, and re-render is idempotent (same boolean → same markup). It sits beside `ThinkingIndicator`, which gates on the narrower `thinking` — during `thinking` both are visible (in different regions: the thinking bubble in the thread, the interrupt button by the composer); during `responding` only the interrupt control shows. Correct and intended.

## Error handling

The only failure mode is the send bridge throwing (`window.pyry.sendCommand`). `sendInterrupt` catches and `console.error`s it, never propagating — a failed interrupt must not crash the window (the `dropQueuedMessage` AC posture). The honest consequence of a swallowed failure: the turn keeps running and the control stays visible (the daemon never received the Esc), which is the truthful state. No banner/dialog — interrupt is best-effort and the daemon sends no ack to reconcile against.

## Testing strategy (`npm test`, vitest; `npm run typecheck`)

Three deterministic, store-free tests — the `ThinkingIndicator`/`QueuedBacklog`/`dropQueuedMessage` precedent (pure view + pure helper, no store-mounted container render). The `InterruptControl` container is untested glue, exactly like `QueuedBacklogControl`.

- **`sendInterrupt.test.ts`** (new) — clone `dropQueuedMessage.test.ts`:
  - Injects `sendCommand: vi.fn()`; asserts it was called **exactly once** with `interruptCommand()` (i.e. `{ type: 'interrupt' }`). (AC2)
  - A throwing `sendCommand` is swallowed (no rethrow); `console.error` observed (spy). No store touched.
- **`ConversationScreen.test.tsx`** (extend) — `isTurnRunning` + `InterruptButton`, both server-renderable with no store:
  - `isTurnRunning('thinking') === true`, `isTurnRunning('responding') === true`, `isTurnRunning('idle') === false`. (AC1 — the broader-than-indicator gate, both running phases show, idle hidden.)
  - `InterruptButton` with `isRunning={true}` renders a button reachable by its accessible name (`queryByRole('button', { name: INTERRUPT_LABEL })` non-null); with `isRunning={false}` renders nothing (container empty / null). (AC1, AC4)
  - `InterruptButton` with `isRunning={true}` and `onInterrupt: vi.fn()`: a click fires `onInterrupt` **once**. (AC2, AC5 activation wiring)
- No test needs the timeline store, `window.pyry`, or jsdom event plumbing beyond the injected spies — keep the existing bare-`<ConversationScreen />` server-render smoke tests green (the container's `window.pyry` stays inside the click closure).

AC5's "shown while running (thinking and responding), hidden at idle, and dispatches the interrupt command on activation" is satisfied jointly by the three bullets above (gate → view → helper); do NOT add a heavier store-connected container render — it duplicates coverage the pure tests already give deterministically.

## CSS — `conversation.css`

Add two rules, no touch to existing ones:

- `.conversation__interrupt` — the region wrapper. Mirror `.conversation__thinking` (`flex: 0 0 auto; display: flex; padding: var(--space-2) var(--space-4)`) but `justify-content: flex-end` so the button sits on the composer's send side.
- `.interrupt-button` (+ `.interrupt-button` `:hover` / `:focus-visible`, and a `display: block` icon rule) — clone the `.composer__send` rule set verbatim (48px round icon button, `--radius-full`, `--color-surface-container-high` fill, `--color-on-surface` content, `--color-outline` focus outline). Token names only, no colour/size literals (file convention). Neutral colour, per the Design source note.

## Open questions

- **Placement precision.** Spec mounts the control as a standalone block immediately above the composer (right-aligned), rather than integrating it into the composer row / swapping the send button. This keeps `Composer` and its tests untouched and preserves the pure-view + injected-effect split. If Juhana later wants a composer-integrated send⇄stop toggle, that is the deferred bespoke visual flagged in Design source — a follow-up, not this slice.
- **Multi-conversation.** Like every sibling control in this file today, the interrupt is milestone-single-conversation (the daemon's running turn is global; the bare `interrupt` carries no conversation selector by design, #306). No conversation-id plumbing needed here.
