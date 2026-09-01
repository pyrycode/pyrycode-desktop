# Recent-workspaces store

The renderer's held copy of the daemon's recent-workspaces list — a dedicated, unidirectional
Zustand store fed by a headless bridge that observes the [daemon-event
channel](daemon-event-channel.md)'s `recentWorkspacesReceived` event and drives a de-duplicated
one-shot `requestRecentWorkspaces` request, so the [Workspace Picker
sheet](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) (#157's remaining split-child) can read one
source of truth.

Introduced in [#382](../codebase/382.md), the renderer half of the `#380 transport → #382 renderer`
split — the exact `#139 → #208` shape. #380 (transport, shipped PR#388) decoded the daemon's
`recent_workspaces_list` reply into `recentWorkspacesReceived` and shipped the outbound
`requestRecentWorkspaces` [command](command-channel.md), both dormant. #382 shipped no visible
surface — the store and its bridge shipped dormant too; [#383](../codebase/383.md) later mounted
`RecentWorkspacesData` inside the Workspace Picker sheet, its first and (so far) only consumer.

## What it does

Holds the daemon's recent-workspaces list as an ordered array, most-recent-first as the wire
delivers it, until the next list arrives — whole-list replace, no merge, no dedupe. A dedicated
store, not a [session store](session-store.md) facet: a recent-workspaces arrival never touches
connection/messages state and vice versa.

## How it works

### The store (`src/renderer/src/store/recentWorkspacesStore.ts`)

```ts
export interface RecentWorkspacesState {
  recentWorkspaces: readonly RecentWorkspace[] | null   // null = not yet loaded
}
export type RecentWorkspacesStore = RecentWorkspacesState & {
  setRecentWorkspaces: (recentWorkspaces: readonly RecentWorkspace[]) => void
}

createRecentWorkspacesStore(init?)     // vanilla createStore — one isolated instance per test (DI seam)
recentWorkspacesStore                  // app-wide singleton
useRecentWorkspacesStore(selector)     // narrow-slice React binding: useStore(recentWorkspacesStore, selector)
selectRecentWorkspaces(state)          // the only read surface
```

A near-exact clone of [`conversationListStore`](conversation-list-store.md) — same DI-factory →
singleton → hook → selector structure, same `null` "not yet loaded" sentinel kept distinguishable
from a delivered `[]` ("loaded, zero workspaces"), same single whole-array-replace setter (not a
reducer — exactly one mutation, so a discriminated-union action set would be a one-member union). No
`selectArchivedCount`-style derived selector — there is no downstream derived read in scope.

Rows are held **verbatim in wire snake_case** — `RecentWorkspace { path, last_used_at }` imported
directly from `@shared/wire/types`, no camelCase renderer twin, no per-field remap. `last_used_at`
stays the opaque wire string; relative-time formatting is a deferred picker concern.

### The data path (`src/renderer/src/store/recentWorkspacesBridge.ts`)

A **hybrid** of two existing shapes — the subscription half from
[`conversationListBridge`](conversation-list-store.md), the on-demand one-shot half from
[`serverInfoLoader`](server-info-store.md):

```ts
translateRecentWorkspacesEvent(event: DaemonEvent): readonly RecentWorkspace[] | null
// switch (event.type) { case 'recentWorkspacesReceived': return event.recentWorkspaces; default: return null }

requestRecentWorkspaces(sendCommand: (c: RendererCommand) => void): void
// sendCommand({ type: 'requestRecentWorkspaces' })  — the existing bare #380 command, no new builder

subscribeRecentWorkspaces(onDaemonEvent, setRecentWorkspaces): () => void
// onDaemonEvent(event => { const list = translateRecentWorkspacesEvent(event); if (list !== null) setRecentWorkspaces(list) })
// returns the off-handle (the subscribeConversations idiom) — NO refreshOnChange parameter

RecentWorkspacesData(): null
// headless leaf, two effects: subscribe on mount ([]), one-shot request on mount via a useRef guard
```

`translateRecentWorkspacesEvent` uses the same **soft** `default: null` as
`translateConversationsEvent` — this path permanently consumes only `recentWorkspacesReceived`.
`subscribeRecentWorkspaces` guards on `list !== null`, not `if (list)`, so a delivered `[]` still
writes (loaded-zero, not not-loaded).

Unlike `conversationListBridge`, `subscribeRecentWorkspaces` carries **no `refreshOnChange`
parameter** — there is no `conversationUpdated`-style broadcast that re-requests the recent-workspaces
list; the picker re-fetches by remounting `RecentWorkspacesData`, not via an unsolicited daemon
event.

`RecentWorkspacesData` owns two effects, subscribe declared (and running) first:

1. **Subscribe** (deps `[]`) — `subscribeRecentWorkspaces(window.pyry.onDaemonEvent, list =>
   recentWorkspacesStore.getState().setRecentWorkspaces(list))`; the off-handle is the cleanup, so a
   StrictMode double-mount nets exactly one live listener.
2. **One-shot request on mount** — a `useRef(false)` guard (`requested`) fires
   `requestRecentWorkspaces(window.pyry.sendCommand)` exactly once per mount; the ref persists across
   the StrictMode simulated unmount/remount (same fiber), so exactly one request fires. **No
   connection-lifecycle gate, no ref reset** — unlike `ConversationListData`'s per-connection-episode
   re-arm, this is a pure on-mount one-shot (the `serverInfoLoader` "fetch fresh every time the
   surface opens" shape): a real unmount/remount (picker closed and reopened) is a fresh instance →
   fresh ref → a fresh fetch, which is the intended on-demand behavior.

`window.pyry` is dereferenced only inside the effects, never during render, so `RecentWorkspacesData`
server-renders to empty markup without a bridge mock (the `ServerInfoData` invariant).

### Data flow

```
WorkspacePickerSheet mounts RecentWorkspacesData while open (#383)
  → subscribe effect: window.pyry.onDaemonEvent → subscribeRecentWorkspaces (live immediately)
  → one-shot effect: requestRecentWorkspaces(window.pyry.sendCommand) → {type:'requestRecentWorkspaces'}
    → COMMAND_CHANNEL → onCommand → connection.requestRecentWorkspaces() [#380, already shipped]

daemon → recent_workspaces_list frame → parseInboundMessage → recentWorkspacesReceived DaemonEvent [#380]
  → DAEMON_EVENT_CHANNEL → subscribeRecentWorkspaces listener
    → translateRecentWorkspacesEvent → rows (or null → skip)
    → recentWorkspacesStore.setRecentWorkspaces(rows)   [whole-list replace]
  → selectRecentWorkspaces / useRecentWorkspacesStore   (read by WorkspacePickerSheet, #383)
```

## Configuration and usage

- **Import surface:** `import { useRecentWorkspacesStore, selectRecentWorkspaces } from
  '@renderer/store/recentWorkspacesStore'` and `import { RecentWorkspacesData } from
  '@renderer/store/recentWorkspacesBridge'`.
- **Mounted by the Workspace Picker sheet** ([#383](../codebase/383.md)) — `WorkspacePickerSheet`
  mounts `<RecentWorkspacesData />` only while the picker is open, so each open is a fresh instance →
  fresh `useRef` → exactly one `requestRecentWorkspaces` per open, re-fetching on every reopen. No
  gate on `connected` (recent-workspaces is a paired-only surface, expected live at mount).

## Edge cases and limitations

- **`daemonEventBridge.ts`'s pre-existing `recentWorkspacesReceived` no-op is untouched** — the
  session store does not own this list; this ticket adds a dedicated store + bridge instead, the
  `conversationListStore`/`conversationListBridge` pattern, not a session-store case.
- **A request sent while disconnected is the main side's concern** — fire-and-forget, exactly as
  `requestConversationList`; no renderer-side result or error to surface. If the connection is down
  when the picker mounts the trigger, no reply arrives and the store stays `null`; the picker's own
  loading affordance covers that, on its ticket.
- **`path` is untrusted daemon-supplied opaque display text** (carried forward from #380's security
  review). This slice only stores and reads it as a string. The picker (its own ticket, no DOM sink
  here) must render it as plain text, never HTML, and never resolve it into a local filesystem
  operation — it is a remote daemon-side path.
- **`RecentWorkspacesData`'s effect timing is not unit-tested** — mirrors the `ServerInfoData` /
  `ConversationListData` precedent: verified by inspection against the `ConversationListData`
  ref-guard idiom, not a bespoke StrictMode render harness. The pure
  `translateRecentWorkspacesEvent`/`requestRecentWorkspaces`/`subscribeRecentWorkspaces` helpers carry
  all the testable logic.
- **Relative-time formatting of `last_used_at`** is deferred to the picker; the store holds the
  opaque wire string.

## Related

- [Daemon-event channel](daemon-event-channel.md) / [#380 codebase notes](../codebase/380.md) — the
  transport half this store consumes (`recentWorkspacesReceived` event, `requestRecentWorkspaces`
  command, `RecentWorkspace` wire type); shipped first, unchanged by this ticket.
- [Conversation list store](conversation-list-store.md) / [#208 codebase notes](../codebase/208.md)
  — the store-shape and subscription-half precedent this ticket clones (single-setter form,
  `default: null` filter, `!== null` write guard).
- [Server-info store](server-info-store.md) / [#340 codebase notes](../codebase/340.md) — the
  on-demand one-shot-request lifecycle precedent (`useRef` mount-scoped fetch, dormant binding, no
  connection-lifecycle gate).
- [Conversation workspace change](conversation-workspace-change.md) / [#379 codebase
  notes](../codebase/379.md) — the sibling outbound slice of the same #157 Workspace Picker split
  (`change_workspace`); both are now wired by the same consumer, the picker UI.
- [Workspace Picker sheet](conversation-shell-workspace-and-run-config.md#workspace-picker-sheet-383) / [#383 codebase
  notes](../codebase/383.md) — the real consumer, mounting `RecentWorkspacesData` and reading
  `selectRecentWorkspaces`.
- [#382 codebase notes](../codebase/382.md) — implementation summary and patterns established.
