# Last-effort store

The renderer's persisted, client-owned "last effort level used" preference — a `string | null` slice
that survives an app restart, so a new chat opens at the effort level the last one was set to instead of
drawing nothing on [the footer's effort control](composer-effort-menu.md).

Introduced in [#1169](../codebase/1169.md). The **data half** only — see [Composer effort default](composer-effort-menu.md#the-default-apply-1169)
for the decision that reads it and applies it to a newly opened chat.

## What it does

Holds one persisted value: the effort level the daemon most recently *confirmed* for any chat, or
`null` when nothing has ever been confirmed (fresh install, or every level so far rejected). `null` is a
distinct, meaningful state — "nothing to offer" — never coerced into an invented level: with nothing
usable the footer control stays blank, which is #988's constraint that nothing it displays is
client-authored.

Client-owned: claude's session-open line carries no effort field, so there is no daemon-side notion of
"the last level used" to read back. It lives entirely in the renderer.

**One remembered level app-wide.** Not per host, per server, per workspace or per chat — the ticket's
ruling. Cross-model mismatch is answered downstream, by validating the remembered level against the
opened chat's own published levels before applying it, not by partitioning this store's one key.

## How it works

### Mechanism: renderer-local `localStorage`, behind an injected port

The app's **third** renderer preference, a structural clone of [default-workspace store](default-workspace-store.md)
(#403) and [push-notification preference store](push-notification-preference-store.md) (#408):

```ts
export interface LastEffortStorage {
  read(): string | null
  write(value: string): void
}
```

An effort level is a published, non-secret display value, so persistence is renderer-local
`localStorage` rather than a main-process preference file — no new IPC command/event, no preload
wiring, no `isRendererCommand` guard. The vitest runtime is `node` — no jsdom, no `window`, no
`localStorage` — so the port is an injected DI seam, not a direct `window.localStorage` call inside the
store. `localStorageLastEffortPref()` is the real backend, guarded by `typeof window === 'undefined'`
(the two precedents' guard) so constructing the singleton is import-safe under `node`/static render —
`read()` yields `null`, `write()` is a no-op.

Storage key: `LAST_EFFORT_KEY = 'pyry.lastEffort'` — the app's **third** `localStorage` key, sibling to
`pyry.defaultWorkspace` and `pyry.pushNotificationsEnabled`, added in the same shape as the other two.
**The standing key-namespacing helper deferral — both precedents defer it "until a genuine third case" —
is declined here on purpose.** This is that third case, and extracting the helper would mean editing two
adjacent modules this ticket does not otherwise need: "don't refactor adjacent code while you are there."
If the helper is wanted, it is its own ticket.

No try/catch around the real port's `localStorage` calls — a quota/disabled failure is not an observed
failure mode in the Electron renderer (Evidence-Based Fix Selection); if it ever surfaces, the fix is
localized to `localStorageLastEffortPref`.

`read()` maps a stored `''` to `null`. `''` is the wire's *absence* of a level
(`SessionSettingsPayload.effort`, "inherited daemon default"), never a level, so it is not a value this
port may hand out — the same posture `requestRunConfigSnapshot` takes on an empty conversation id. No
writer in this app ever persists `''` (the write side refuses it before it reaches here); this guards a
hand-edited or corrupt cell rather than an observed frame.

**No length bound**, and that is a decision, not an omission. A stored level is claude-authored text, but
it can only leave the apply decision by being byte-identical to a level the daemon just published for the
opened chat's model, and it renders through `.composer__effort-label`'s existing escaped, ellipsized 64px
bound exactly as a live level does. Bounding here would be a defense for a failure mode nothing has
observed; if one surfaces, this is where it lands.

### The store (`src/renderer/src/store/lastEffortStore.ts`)

```ts
export interface LastEffortState { lastEffort: string | null }
export type LastEffortStore = LastEffortState & { setLastEffort: (value: string) => void }

createLastEffortStore(storage: LastEffortStorage)   // vanilla createStore, DI over the port
lastEffortStore                                      // app-wide singleton, real localStorage port
useLastEffortStore(selector)                         // narrow-slice React binding
selectLastEffort(state)                              // the only read surface
```

The three precedents' DI-factory → singleton → hook → selector shape, holding a bare `string | null`
rather than an object or array. A single setter, not a reducer: exactly one mutation exists ("record the
level the daemon just confirmed"), so a discriminated-union action set would be a one-member union.

- **Hydration** — initial state is `{ lastEffort: storage.read() }`, read once at construction. AC3's "a
  store built fresh from that same storage reports it" is asserted literally in the test: write through
  one store instance, construct a second over the same fake storage, read it back.
- **Set-through** — `setLastEffort(value)` calls `storage.write(value)` **then** `set({ lastEffort:
  value })`, replacing the whole value unconditionally — the two precedents' order.
- **No clear path.** The only writer is a daemon-confirmed level and no reset-to-default action exists —
  the push-notification preference's own simplification, one step narrower than the workspace store's
  `null`-clears-to-daemon-default setter.

### The one writer: remember on confirm, not on pick

`lastEffortStore` has exactly one caller of `setLastEffort` in the whole app: `foldWriteEvent` in
[Run configuration write store § Remembering the confirmed level](run-settings-write-store.md#remembering-the-confirmed-level-1169),
wired at `RunSettingsWriteData`'s App-level subscription. A rejected level is not a level that was used,
so nothing here is written on a pick — only on the daemon's confirm, and only for the `effort` field.
Applying a remembered level is itself an ordinary change that confirms and re-remembers the same value:
idempotent, not a loop.

## Configuration and usage

- **Import surface:** `import { useLastEffortStore, selectLastEffort, lastEffortStore } from
  '../../store/lastEffortStore'`.
- **The one write consumer:** `runSettingsWriteBridge.ts`'s `foldWriteEvent`, wired to
  `lastEffortStore.getState().setLastEffort`. See [Run configuration write store](run-settings-write-store.md#remembering-the-confirmed-level-1169).
- **The one read consumer:** [`EffortDefaultData`](composer-effort-menu.md#the-default-apply-1169), which
  composes `selectLastEffort` with the opened chat's session id, composed effort and published levels to
  decide whether to apply it.

## Edge cases and limitations

- **Nothing remembered (fresh install, or every level rejected so far)** — `lastEffort` is `null`; the
  default-apply decision refuses at that step and the footer control stays blank, per #988.
- **A remembered level absent from the opened chat's published levels** — the store still reports it
  (this store does no validation of its own); the membership check lives entirely in
  `effortDefaultToApply`, downstream.
- **Corrupt/hand-edited stored value** — decodes as the raw string; only a stored empty string is mapped
  to `null`. No further validation happens at this layer by design — see § Mechanism above.
- **`localStorage` throwing (quota / disabled) is not handled** — deliberately no try/catch (see §
  Mechanism above).
- **Server-render safety** — the singleton hydrates to `null` under `node` (the `typeof window` guard
  makes `read()` return `null`), the same posture the two precedent stores rely on.

## Related

- [Default-workspace store](default-workspace-store.md) / [Push-notification preference store](push-notification-preference-store.md) —
  the two structural precedents this store clones (DI-factory → singleton → hook → selector; the
  `typeof window` import-safety guard; the deferred key-namespacing helper this ticket declines to build).
- [Composer effort menu § The default apply](composer-effort-menu.md#the-default-apply-1169) — the
  decision and headless leaf that reads this store and applies its value to a newly opened chat.
- [Run configuration write store § Remembering the confirmed level](run-settings-write-store.md#remembering-the-confirmed-level-1169) —
  the one writer, and why it sits on the confirm edge rather than the pick.
