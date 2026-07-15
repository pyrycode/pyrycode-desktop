# Push-notification preference store

The renderer's persisted, client-owned "push notifications when claude responds" on/off preference —
a `boolean` slice that survives an app restart, so the user's choice to be (or not be) interrupted by
an OS notification is remembered.

Introduced in [#408](../codebase/408.md), the **data half** of the push-notification toggle. Split
from [#353](https://github.com/pyrycode/pyrycode-desktop/issues/353). Renders nothing itself — the
Settings row that lets the user *change* the preference, [#409](../codebase/409.md) (Figma 17-64,
blocked-by this ticket), has since shipped and is this store's write consumer.

## What it does

Holds one persisted value: whether the app should fire an OS notification (via [the delivery
primitive](push-notifications.md)) when a turn completes or a prompt needs an answer while the window
is unfocused. Defaults to **enabled** when nothing has ever been persisted (fresh install — the
mobile knob's on-position, Figma 17-68); an explicit toggle to `false` persists and stays `false` on
the next launch — it is never silently re-enabled.

Client-owned: there is no daemon-side notion of this preference. It lives entirely in the renderer.

## How it works

### Mechanism: renderer-local `localStorage`, behind an injected port

A structural clone of [defaultWorkspaceStore](default-workspace-store.md) (#403), the app's precedent
for this exact shape:

```ts
export interface PushNotificationPrefStorage {
  read(): boolean | null   // null === never persisted (fresh install)
  write(value: boolean): void
}
```

Same reasoning as #403: a UX boolean is not a secret, so persistence is renderer-local `localStorage`
rather than a main-process preference file — no new IPC command/event, no preload wiring, no
`isRendererCommand` guard. The vitest runtime is `node` — no jsdom, no `window`, no `localStorage` — so
the port is an injected seam, not a direct `window.localStorage` call inside the store.
`localStoragePushNotificationPref()` is the real backend, guarded by `typeof window === 'undefined'`
(mirroring `localStorageWorkspacePref` exactly) so constructing the singleton is import-safe under
`node`/static render — `read()` yields `null`, `write()` is a no-op.

Storage key: `PUSH_NOTIFICATIONS_ENABLED_KEY = 'pyry.pushNotificationsEnabled'` — the app's **second**
`localStorage` key, sibling to `pyry.defaultWorkspace`. Per both this ticket's and #403's own notes, a
shared key-namespacing helper is deliberately *not* extracted yet — deferred until a genuine third
case.

No try/catch around the real port's `localStorage` calls — a quota/disabled failure is not an observed
failure mode in the Electron renderer (Evidence-Based Fix Selection); if it ever surfaces, the fix is
localized to `localStoragePushNotificationPref`.

### Two deltas vs. the #403 precedent

`defaultWorkspaceStore` treats absence as *itself* the value (`null` = "no default set") and needs no
serialization (`string | null` passes straight through). This store's `boolean` needed two additions:

1. **A meaningful default-on-empty, mapped at the store, not the port.** The port only ever reports
   what's on disk (`boolean | null`); the store maps `storage.read() ?? PUSH_NOTIFICATIONS_DEFAULT_ENABLED`
   at construction, with the default as a single exported `const`.
2. **String encode/decode, extracted as pure functions and tested directly.** `localStorage` only
   holds strings. `encodePushPref`/`decodePushPref` live outside the port (unlike #403's inline
   `getItem`/`setItem` pass-through) because the coercion is a correctness trap the `node` test runtime
   can't reach through the real, `window`-guarded port — under `node`, `read()` always short-circuits
   to `null` before touching the decoder. `decodePushPref` recognizes exactly the two strings
   `encodePushPref` emits (`'true'`/`'false'`); anything else — absent (`null`) or a corrupt/hand-edited
   value — maps to `null`, "not a valid persisted value." That `null` is what keeps "never set"
   distinguishable from an explicit stored `false`, which is the whole point: without it, an explicit
   toggle-off would be indistinguishable from a fresh install and silently re-enabled on next launch.

### The store (`src/renderer/src/store/pushNotificationPrefStore.ts`)

```ts
export interface PushNotificationPrefState { pushNotificationsEnabled: boolean }
export type PushNotificationPrefStore = PushNotificationPrefState & {
  setPushNotificationsEnabled: (value: boolean) => void
}

createPushNotificationPrefStore(storage: PushNotificationPrefStorage)  // vanilla createStore, DI over the port
pushNotificationPrefStore                                              // app-wide singleton, real localStorage port
usePushNotificationPrefStore(selector)                                 // narrow-slice React binding
selectPushNotificationsEnabled(state)                                  // the only read surface
```

The `defaultWorkspaceStore`/`serverInfoStore` DI-factory → singleton → hook → selector shape, holding
a bare `boolean` rather than an object or array. A dedicated store, not a facet of an existing one —
orthogonal to connection/messages/conversation-list state. A single setter, not a reducer: exactly one
mutation exists ("record the on/off choice"), so a discriminated-union action set would be a
one-member union.

Two behaviors:
- **Hydration** — initial state is `{ pushNotificationsEnabled: storage.read() ??
  PUSH_NOTIFICATIONS_DEFAULT_ENABLED }`, read once at construction.
- **Set-through** — `setPushNotificationsEnabled(value)` calls `storage.write(value)` **then**
  `set({ pushNotificationsEnabled: value })`, replacing the whole value unconditionally. There is no
  "clear"/reset-to-default path — the toggle only ever sets `true`/`false` — a deliberate
  simplification vs. `defaultWorkspaceStore`'s `null`-clears-to-daemon-default setter.

## Configuration and usage

- **Import surface:** `import { usePushNotificationPrefStore, selectPushNotificationsEnabled } from
  '../../store/pushNotificationPrefStore'`.
- **The write consumer has shipped.** [#409](../codebase/409.md) (Settings toggle UI, Figma 17-64) —
  the [Settings screen](settings-screen.md)'s Notifications section — reads
  `usePushNotificationPrefStore(selectPushNotificationsEnabled)` to drive its switch's `aria-checked`
  and on/off styling, and dispatches into
  `pushNotificationPrefStore.getState().setPushNotificationsEnabled(next)` on toggle, the same
  `getState().setter(...)`-from-callback idiom [#404](../codebase/404.md) established for
  `defaultWorkspaceStore` (no standalone exported setter function).
- **The read consumer has shipped.** [#392](../codebase/392.md) (renderer trigger) reads
  `pushNotificationPrefStore.getState().pushNotificationsEnabled` — not the React hook, since the
  read happens inside a daemon-event subscriber callback, not a render — as a **per-event thunk**
  passed into `subscribePushNotify`, so a mid-session toggle flip is honored on the very next
  `turnEnd`/`modalShown` before dispatching the `notify` command described in [Push
  notifications](push-notifications.md).

## Edge cases and limitations

- **No default set (fresh install)** — `pushNotificationsEnabled` is `true`; matches the mobile knob's
  on-position (Figma 17-68).
- **Explicit toggle-off survives restart** — the entire point of the `null`-vs-`false` sentinel
  (Deltas above): a user who disables notifications is never silently re-enabled on next launch.
- **Corrupt/hand-edited stored value** (e.g. `'maybe'`) — `decodePushPref` returns `null`, so the store
  falls back to the enabled default. A total, natural consequence of "recognize exactly the two
  encodings I emit," not a speculative safety net.
- **`localStorage` throwing (quota / disabled) is not handled** — deliberately no try/catch (see
  Mechanism above).
- **Server-render safety** — the singleton hydrates to the enabled default under `node` (the `typeof
  window` guard makes `read()` return `null`), the same posture `defaultWorkspaceStore` relies on.
- **No reset-to-default (clear) path** — the setter is boolean-only; if a future "restore defaults"
  action needs one, add a `write`-clearing path then (YAGNI, not built here).

## Related

- [Default-workspace store](default-workspace-store.md) / [#403 codebase notes](../codebase/403.md) —
  the direct structural precedent this store clones (DI-factory → singleton → hook → selector; the
  `fakeStorage()` test idiom).
- [Push notifications](push-notifications.md) — the delivery primitive (#391) + trigger (#392) +
  click-to-focus (#393) this preference gates; the feature is live end-to-end.
- [#408 codebase notes](../codebase/408.md) — implementation summary, the two deltas vs. #403, and
  patterns established.
- [Settings screen](settings-screen.md) / [#409 codebase notes](../codebase/409.md) — the Notifications
  section's push-toggle row, the write consumer (shipped).
- [#392 codebase notes](../codebase/392.md) — the renderer trigger, the read consumer (shipped).
- [E2E test harness](e2e-harness.md) / [#466 codebase notes](../codebase/466.md) — the fake-stack e2e
  that proves this store's persisted value survives a full app relaunch, driving the `reuseUserDataDir`
  affordance added to `launchPairedApp` for exactly this purpose.
