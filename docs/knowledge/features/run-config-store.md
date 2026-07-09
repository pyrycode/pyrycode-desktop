# Run configuration store

The renderer's held copy of the active session's **Model / Effort / YOLO** settings — a dedicated,
unidirectional Zustand store fed by an on-open `screen_snapshot` fetch, so the [Run configuration
sheet](conversation-shell.md#run-configuration-sheet-177) can display how the session is running.

Introduced in [#187](../codebase/187.md), split A (data path) of
[#181](https://github.com/pyrycode/pyrycode-desktop/issues/181) — itself split from
[#156](../codebase/156.md). Consumes the transport [#180](../codebase/180.md) already shipped
(`requestSnapshot` command, `snapshotReceived` event). Delivers **no visible surface**; the sibling
[#188](https://github.com/pyrycode/pyrycode-desktop/issues/188) renders the three sections from the
values this store holds.

## What it does

Requests a fresh `screen_snapshot` every time the Run configuration sheet opens, and holds the
arriving `model` / `effort` / `yolo` in a read-only store until the next one arrives. Deliberately
**not** a [session store](session-store.md) facet: a snapshot never touches connection/messages
state and vice versa, so a snapshot arrival re-renders only components selecting this slice.

## How it works

### The store (`src/renderer/src/store/runConfigStore.ts`)

```ts
export interface RunConfigSnapshot { model: string; effort: string; yolo: boolean }
export interface RunConfigState { snapshot: RunConfigSnapshot | null }  // null = not yet loaded
export type RunConfigStore = RunConfigState & { setSnapshot: (s: RunConfigSnapshot) => void }

createRunConfigStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
runConfigStore                  // app-wide singleton
useRunConfigStore(selector)     // React binding: useStore(runConfigStore, selector)
selectSnapshot(s)                // the only read surface
```

Mirrors [`sessionStore.ts`](session-store.md)'s DI-factory → singleton → hook → selectors
structure, but with a **single setter** rather than a reducer: there is exactly one mutation
("record the latest snapshot"), so a discriminated-union action set would be a one-member union —
ceremony without benefit. `setSnapshot` replaces the whole `snapshot` object unconditionally (the
most recent snapshot always wins — no merge, no dedupe) and never coerces or validates the fields:
an empty `model`, an empty `effort` (inherited default), and `yolo: false` (permissions enforced)
are held **verbatim**. `snapshot: null` is the distinct "no snapshot received yet" state, so a
received all-defaults snapshot (`{ model: '', effort: '', yolo: false }`) is never confused with
"nothing loaded" — #188 needs to tell those two apart.

### The data path (`src/renderer/src/screens/conversation/runConfigSnapshot.ts`)

Framework-free, effects injected (the `composerSend.ts` / `logDataDownload.ts` idiom), so the whole
path unit-tests with plain spies — no React, no store, no Electron:

```ts
toRunConfigSnapshot(event: DaemonEvent): RunConfigSnapshot | null
// snapshotReceived → {model, effort, yolo} verbatim (explicit copy, not a spread — keeps the store
// shape immune to DaemonEvent gaining an unrelated field later); every other event → null.

requestRunConfigSnapshot(sendCommand): void
// Fires one requestSnapshot command for MILESTONE_CONVERSATION_ID (imported from composerSend.ts —
// the single source of truth a future conversation-selection ticket replaces). Inline typed literal,
// no shared constructor — commands.ts has no requestSnapshot builder and adding one would touch a
// shared file for a one-line nicety.

subscribeRunConfig(onDaemonEvent, setSnapshot): () => void
// onDaemonEvent(event => { const s = toRunConfigSnapshot(event); if (s) setSnapshot(s) }) — returns
// the off handle (the daemonEventBridge cleanup idiom).
```

`toRunConfigSnapshot` returns `null` via a plain `default`, not `assertNever` — this filter
intentionally consumes only `snapshotReceived`; permanent, not a gap to close. Exhaustiveness over
`DaemonEvent` is enforced exactly once, in `daemonEventBridge.ts`.

### The React binding (`src/renderer/src/screens/conversation/RunConfigData.tsx`)

A **headless container** (`RunConfigData(): null`) mounted as the first child of `<StatusSheet>` in
`ConversationScreen.tsx`, ahead of `<LogDataSection />`. Because the sheet body is conditionally
mounted (`{sheetOpen && <StatusSheet>…}`), the container's mount **is** the sheet's open transition
— no separate `isOpen`-tracking is needed. `window.pyry` is dereferenced only inside its two mount
effects, never during render, so it server-renders to empty markup without a bridge mock.

Two effects, each with its own StrictMode-correct idiom:

- **Subscription** — `subscribeRunConfig(window.pyry.onDaemonEvent, s => runConfigStore.getState().setSnapshot(s))`
  in a `useEffect(() => …, [])` returning the off handle as cleanup. Nets exactly one live listener
  across a StrictMode double-mount (the `daemonEventBridge` idiom).
- **Request** — `requestRunConfigSnapshot(window.pyry.sendCommand)`, guarded by a `useRef(false)`
  one-shot flag so the effect (which has no symmetric "un-request" cleanup) fires the request
  exactly once even under the StrictMode dev double-invoke. A genuine close→reopen is a *new*
  component instance with a fresh ref, so it re-requests — exactly one request per open.

### Data flow

```
sheet opens → <RunConfigData/> mounts
  → subscribeRunConfig(onDaemonEvent, setSnapshot)         [listener live before the request goes out]
  → requestRunConfigSnapshot(sendCommand)                  [one requestSnapshot, guarded by useRef]

daemon → screen_snapshot → snapshotReceived{model,effort,yolo}
  → onDaemonEvent → toRunConfigSnapshot → setSnapshot(s)
  → runConfigStore                                          [most recent snapshot wins]
  → #188's sections: useRunConfigStore(selectSnapshot)
```

## Configuration and usage

- **Import surface for a future reader** (#188's sections):
  `import { useRunConfigStore, selectSnapshot } from '@renderer/store/runConfigStore'`.
- **Mount point:** `src/renderer/src/screens/conversation/ConversationScreen.tsx`, inside
  `<StatusSheet>`, first child.
- **Conversation id:** `MILESTONE_CONVERSATION_ID` (`'default'`) from `composerSend.ts` — the one
  place a future conversation-selection ticket replaces.

## Edge cases and limitations

- **No reset on sheet close.** The store keeps its last snapshot across a close→reopen, so #188 can
  show the last-known values immediately on reopen while a fresh request is in flight. Revisit only
  if #188 surfaces a stale-value concern.
- **A response landing after an instant close is simply dropped** — the listener unsubscribed with
  the container; the store keeps its prior value and the next open re-requests. No app-level
  always-on listener; `screen_snapshot` is request/response, so it only arrives while a request is
  outstanding (sheet open).
- **No correlation.** Same as [#180](../codebase/180.md): any `screen_snapshot` that arrives is
  decoded and emitted unconditionally — safe today given a single in-flight fetch against a single
  conversation.
- **Fire-and-forget request.** `sendCommand` is `void`; a bridge failure is swallowed upstream — no
  result to await, no error surface in this store.

## Related

- [Session store](session-store.md) — the structural precedent this store's DI-factory → singleton
  → hook → selectors shape mirrors, contrasted on reducer-vs-single-setter.
- [Daemon-event bridge](daemon-event-bridge.md) — the `assertNever`-guarded consumer whose
  `snapshotReceived → null` arm (added in [#180](../codebase/180.md)) reserved this feature's
  consumer role.
- [Screen snapshot fetch](screen-snapshot-fetch.md) — the transport half: the `request_snapshot` /
  `screen_snapshot` wire round trip and the content-minimisation seam that keeps the rendered screen
  `text` off this event.
- [Conversation shell](conversation-shell.md) — the Run configuration sheet
  `RunConfigData` mounts inside.
- [Composer send](composer-send.md) — hosts `MILESTONE_CONVERSATION_ID`, the single source of truth
  for the conversation id this store's fetch uses.
- [#187 codebase notes](../codebase/187.md) — implementation summary and patterns established.
- Blocks [#188](https://github.com/pyrycode/pyrycode-desktop/issues/188) — the three read-only
  sections that read `selectSnapshot`.
