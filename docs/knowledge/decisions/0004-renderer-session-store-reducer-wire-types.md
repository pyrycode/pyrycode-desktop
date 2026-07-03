# 0004 — Renderer session state: one Zustand store, a pure reducer, sealed actions, wire types reused

## Status

Accepted, 2026-07-03. First realized in [#2](../codebase/2.md).

## Context

The connect-send-stream milestone needs renderer-side state before any transport exists: the active session's connection status and its conversation message list. This is the foundation the typed background↔window channel (#3, explicitly *blocked by* this store) dispatches into, and the conversation UI (#12) reads from. The question was how to shape that state so it is (a) a single unidirectional source of truth, (b) unit-testable in isolation with no channel/IPC/transport, and (c) free of drift from the mobile wire contract.

Mobile's model — ADR 025 in the `pyrycode` repo — is "one state object per screen with a sealed event set." `CLAUDE.md` carries the same conventions forward: unidirectional state, sealed event shapes on a `type` discriminant, single source of state per store, and keep the transport out of the window. Zustand was already chosen as the stack's state library ([0001](0001-stack-electron-react-typescript.md)).

The open architect's-call questions this ADR settles: one store or two (status vs. messages)? Reuse the wire `MessagePayload` or invent a renderer view model? How does state stay testable before the channel exists?

## Decision

A **single** Zustand store, `sessionStore` (`src/renderer/src/store/sessionStore.ts`), owns both the connection status and the conversation message list — they are two facets of one session, not two stores. Its four pieces:

- **`ConnectionStatus`** — a discriminated union on `type`: `disconnected` | `connecting` | `connected` (carries the wire `HelloAckPayload`) | `error` (carries a `ConnectionError`).
- **`SessionAction`** — a sealed discriminated union on `type`: the status transitions (`connecting`, `connected`, `disconnected`, `failed`) plus two message actions (`messageReceived` ← a wire `message` envelope, `messagesReceived` ← a `message_chunk` batch). Nothing mutates state except by dispatching one of these.
- **`reduceSession(state, action)`** — a **pure, exported** reducer: no mutation, returns fresh state, builds results from `state.status`/`state.messages` explicitly (no `...state` spread). This is the unit under test.
- **A vanilla `createStore` factory** (`createSessionStore`) plus the app-wide `sessionStore` singleton and a narrow-slice `useSessionStore(selector)` hook. `selectStatus`/`selectMessages` are the only read surface; `dispatch` is the only write surface. No exposed setter.

**Messages reuse the wire `MessagePayload` verbatim** — no parallel renderer model. The `role: 'assistant'` ↔ UI `'daemon'` and `message_id` ↔ `id` presentation transform is deferred to the #12 component boundary. **`ConnectionError` is the one renderer-owned thin model** — structurally identical to the wire `ErrorPayload`, but owned by the store so that transport/handshake failures, which carry *no* wire `ErrorPayload`, populate the same `status.error` shape the UI banner reads.

## Rationale

- **One store, because status and messages are one session.** Two stores would fragment the "single source of truth" and force the UI to coordinate two subscriptions for one screen. The mobile precedent (ADR 025) is one state object per screen; this is its Zustand realization.
- **Pure exported reducer is the test/DI seam the pipeline asked for.** AC5 requires the store be exercised directly with no channel/IPC/transport. A pure `SessionState → SessionState` function tests without React, without a store, without mocks — and the vanilla `createStore` factory yields an isolated store per test, so tests share no global state. This is why the reducer is exported and built without `...state` spread: it stays a clean function independent of the store's extra `dispatch` field.
- **Reuse wire types, don't mirror them.** Reusing `MessagePayload` means #3 dispatches exactly what it parsed off the wire — zero drift, single source (see [0002](0002-remote-head-over-relay-shared-wire.md), which forbids drifting the wire types from the mobile contract). Inventing a renderer message model would create a second shape to keep in sync for no rendering benefit this ticket has (#2 renders nothing).
- **`ConnectionError` is the justified exception.** Not every failure arrives as a wire `error` envelope: a silent Noise-handshake failure or a dropped socket (detected in #4's transport) has none. One store-owned error shape lets both a wire `error` (fields copied across) and a synthesized transport failure (`code: 'transport' | 'handshake'`) land in the same `status.error` the UI reads. The message path deliberately has no such model.
- **Unconditional status set, no transition guards.** Each status action sets its target regardless of the current status — no state-machine rejection layer. Ordering ("connecting → connected", "connecting → error") is the caller's (#3's) responsibility. No transition guard is built because none has been needed — consistent with the pipeline's evidence-based-fix rule.

## Consequences

- **The pattern is the template for future renderer stores.** Sealed action union + pure exported reducer + vanilla-store factory + narrow-slice selectors is now the established shape. New state (another screen, another facet) should follow it rather than reach for `set`-based ad-hoc mutations.
- **The `#12` adapter seam is fixed.** Because the store holds wire `MessagePayload` (`role`, `message_id`), #12 must adapt `role: 'assistant'` → the shell's `'daemon'` and `message_id` → `id` at the component boundary (or update `conversation.css` to key off `assistant`). See the [conversation-shell feature doc](../features/conversation-shell.md).
- **`connected` carries the whole `HelloAckPayload`.** Convenient and drift-free from #3's `hello_ack` translation; narrow to `{ server_id, conn_id }` later only if the UI proves it needs less.
- **Deferred by design (revisit when #3 wires reconnect/backfill):** dedupe of re-delivered `message_chunk` backfill (same `message_id` appends unconditionally today); whether a fresh `connecting`/`disconnected` clears `messages` (kept orthogonal — status actions never touch history); `conversation_id` scoping (single active conversation assumed, all messages appended); and an optimistic-send action for the composer's own echo. The sealed union extends cleanly for each.

Related: [0001](0001-stack-electron-react-typescript.md) (Zustand for event-stream state), [0002](0002-remote-head-over-relay-shared-wire.md) (the wire reuse this store depends on), the [session-store feature doc](../features/session-store.md), and [#2 codebase notes](../codebase/2.md).
