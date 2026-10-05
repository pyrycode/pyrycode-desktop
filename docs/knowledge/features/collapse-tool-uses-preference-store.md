# Collapse assistant tool uses preference

Settings → Thread exposes “Collapse assistant tool uses”, a default-on preference
shared by every conversation and paired host on this client. It persists across
app restarts in renderer-local `localStorage` and is never sent to the daemon.

## Storage and subscriptions

[`collapseToolUsesPrefStore.ts`](../../../src/renderer/src/store/collapseToolUsesPrefStore.ts)
follows the [push-notification preference store](push-notification-preference-store.md)
factory → singleton → hook → selector pattern:

- `CollapseToolUsesPrefStorage` supplies `read(): boolean | null` and
  `write(value: boolean): void` for injected storage.
- `createCollapseToolUsesPrefStore(storage)` hydrates once with `storage.read() ?? true`.
- `collapseToolUsesPrefStore` is the app-wide singleton;
  `useCollapseToolUsesPrefStore(selectCollapseToolUses)` subscribes to its boolean.
- `setCollapseToolUses(value)` writes storage before publishing the new state.

The separate fixed key is `pyry.collapseAssistantToolUses`. The real port writes
exactly `true` or `false` strings; `decodeCollapseToolUsesPref` recognizes only those
two encodings. Missing or corrupt values return `null` and fall back to on.
Using a truthy fallback would erase an explicit off choice during hydration;
`false` must remain distinct from missing storage. The `typeof window` guard makes
reads return `null` and writes do nothing under Node. Storage exceptions are not
caught, matching the existing preference-store precedent.

## Consumers

[`CollapseToolUsesRowControl`](../../../src/renderer/src/screens/settings/CollapseToolUsesRow.tsx)
selects the boolean and calls the singleton setter from its toggle callback.
Its pure view reuses Settings' notification row and native switch styles; see
[Settings Thread section](settings-screen-how-it-works.md#the-thread-section).

`ConversationScreen` subscribes to the same singleton and passes its value into
`Timeline.foldTools`. Off renders ordinary tool rows with existing joined stacks
and no “Using tools: N” headers. On restores folding without a restart, including
retained chats and conversations opened on another host. The choice is outside
pairing and conversation state resets. `Timeline` itself still defaults an absent
or false prop to ordinary rendering; see [Adjacent tool runs](conversation-shell-tool-row-header-groups.md#adjacent-tool-runs).

## Coverage and evidence

[`collapseToolUsesPrefStore.test.ts`](../../../src/renderer/src/store/collapseToolUsesPrefStore.test.ts)
covers exact decoding, missing/corrupt fallback, off/on persistence into fresh
stores, notification after persistence, unsubscribe and the Node-safe port.
Static Settings tests pin Thread between Notifications and Storage and its default
on state; `CollapseToolUsesRow.test.tsx` injects both switch states into the pure
view. Server rendering cannot exercise clicks or subscriptions, and the guarded
singleton's enabled initial state cannot prove the off branch through the container.
`toolRuns.test.tsx` pins both fold modes and ordinary-row markup/joins.

[`e2e/collapse-tool-uses-preference.spec.ts`](../../../e2e/collapse-tool-uses-preference.spec.ts)
contains “collapse choice applies immediately to retained chats and another host at
800px” and its 1280px counterpart, covering click/Enter/Space, `aria-checked`,
Settings round trips, both hosts and ordinary stack geometry. “explicit collapse
off survives a full app relaunch” reuses the first launch's `userDataDir` through
`reuseUserDataDir`, and checks that the push-notification preference remains on.
Recreating a store alone cannot prove Electron persisted the renderer's storage.

The [verifier verdict](https://github.com/pyrycode/pyrycode-desktop/pull/1793#issuecomment-6003905659)
records review at `08f34a4f` and builder-reported focused-spec success, but supplies
no skipped count for that scoped run. The supplied dispatcher gate 6 report records
276 executed, 275 passed, 1 failed and 4 skipped, with no per-test identification
for this preference spec. These records do not establish a counted full-suite pass
or counted results for the individual tests above. No live-Claude run is required
for this renderer-only preference.

Design: [collapse assistant tool uses preference](../../specs/architecture/1765-collapse-assistant-tool-uses.md).
