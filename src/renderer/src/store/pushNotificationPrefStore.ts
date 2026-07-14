// The client-owned "push notifications when claude responds" preference (#408), persisted locally so the
// user's on/off choice survives restarts. Pure renderer state — no IPC, no preload bridge, no transport:
// a UX boolean is not a secret, so it need not sit behind the transport boundary. This slice renders
// nothing (the data half). The renderer trigger that decides WHEN to fire (#392) reads this slice via the
// selector before firing; the Settings toggle (#409, the presentation half) writes it through the single
// setter.
//
// A dedicated store (the defaultWorkspaceStore precedent, #403), NOT a facet of an existing store: this
// preference is orthogonal to connection/messages/conversation-list state, so it stays its own slice and
// only components selecting it re-render. It mirrors defaultWorkspaceStore's DI-factory → singleton →
// hook → selector structure. A single setter rather than a reducer: there is exactly one mutation
// ("record the on/off choice"), so a discriminated-union action set would be a one-member union — ceremony
// without benefit. Unidirectional is preserved: read-only selector, one write path, never two-way-bound
// from a component — #409 dispatches into the setter, it does not bind a field to it.
//
// The DI seam is the `storage` PORT because the dependency that varies between prod and test is the
// persistence backend. The vitest runtime is `node` (no jsdom, no localStorage, no window), so a store
// reaching for window.localStorage directly could not be unit-tested and would throw on import; the
// injected port makes the persist-then-restore round-trip testable with an in-memory fake.
//
// Two deltas vs. the workspace precedent: (1) a boolean whose absence-on-empty resolves to the ENABLED
// default (the workspace pref treats absence as itself the value, `null`), mapped AT THE STORE so the port
// stays a faithful "what's persisted" reporter; (2) string<->boolean serialization localized to the port
// via encode/decode helpers, keeping "never set" (null) distinguishable from a stored `false` so a user
// who explicitly toggled off is not silently re-enabled on next launch.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The persistence backend the store depends on — the injected DI seam. `read` reports what is persisted,
 *  distinguishing "never set" (`null`) from a stored `false`; `write` persists a concrete boolean. There
 *  is no "clear" path (the toggle only ever sets true|false; a reset-to-default action does not exist) —
 *  a deliberate simplification vs. the workspace port's null-clear. Synchronous: backs onto localStorage,
 *  whose access is synchronous. */
export interface PushNotificationPrefStorage {
  read(): boolean | null
  write(value: boolean): void
}

/** The default-on-empty, kept as a single source of truth (Delta 1): absence resolves to enabled — the
 *  mobile knob's on-position (Figma 17-68). The port never invents this default; the store applies it. */
export const PUSH_NOTIFICATIONS_DEFAULT_ENABLED = true as const

/** The renderer-pref key; sibling to `pyry.defaultWorkspace`. The const NAME is a preference, but the
 *  STRING is the contract. The app's second such key — do NOT extract a shared namespacing helper yet;
 *  the precedent's own comment defers that abstraction until a genuine third case (no premature
 *  abstraction). */
export const PUSH_NOTIFICATIONS_ENABLED_KEY = 'pyry.pushNotificationsEnabled' as const

/** Encode the boolean to the persisted string. `'true'`/`'false'` (devtools-readable, matches JS boolean
 *  toString). The only home of the boolean -> string coercion. */
export function encodePushPref(value: boolean): string {
  return value ? 'true' : 'false'
}

/** Decode a persisted string back to the boolean, or `null` for "not a valid persisted value". Recognizes
 *  EXACTLY the two values `encodePushPref` emits; anything else (absent `null` or a corrupt/hand-edited
 *  string) is `null` — this is the not-set-vs-stored-`false` sentinel (Delta 2). Extracted (unlike the
 *  workspace port's inline getItem) precisely because this coercion is a correctness trap the `node`
 *  runtime cannot exercise via the window-guarded real port, so it is unit-tested directly. */
export function decodePushPref(raw: string | null): boolean | null {
  if (raw === 'true') return true
  if (raw === 'false') return false
  return null
}

/**
 * The real `localStorage`-backed port, wired at the singleton composition root. The `typeof window` guard
 * is the import-safety guard: it makes constructing the singleton safe under `node`/`renderToStaticMarkup`,
 * where `read()` yields `null` (so the store starts at the enabled default) and `write()` is a no-op. It is
 * deliberately NOT a defensive try/catch — a localStorage quota/disabled failure is not an observed failure
 * mode in the Electron renderer (a single short path, always-present storage), and shipping a defense for
 * an unobserved failure is Evidence-Based Fix Selection's anti-pattern; if it ever surfaces, the fix is
 * localized here.
 */
export function localStoragePushNotificationPref(): PushNotificationPrefStorage {
  return {
    read: () =>
      typeof window === 'undefined'
        ? null
        : decodePushPref(window.localStorage.getItem(PUSH_NOTIFICATIONS_ENABLED_KEY)),
    write: (value) => {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(PUSH_NOTIFICATIONS_ENABLED_KEY, encodePushPref(value))
    }
  }
}

/** The whole push-notification-preference state — a bare boolean, always concrete (the empty-storage case
 *  resolves to the enabled default at construction, never surfacing `null`). */
export interface PushNotificationPrefState {
  pushNotificationsEnabled: boolean
}

/** Store shape = state + the single mutation entry point. */
export type PushNotificationPrefStore = PushNotificationPrefState & {
  setPushNotificationsEnabled: (value: boolean) => void
}

/**
 * DI-friendly, React-free store — one isolated instance per test, wired to the injected port.
 * Hydration: `storage.read() ?? PUSH_NOTIFICATIONS_DEFAULT_ENABLED` — the persisted value if present
 * (including a stored `false`), else the enabled default (Delta 1, mapped AT THE STORE so the port stays a
 * faithful "what's persisted" reporter). Set-through: `setPushNotificationsEnabled` persists via the port
 * THEN records the value in state (the "persist" half), replacing the whole value unconditionally.
 */
export function createPushNotificationPrefStore(storage: PushNotificationPrefStorage) {
  return createStore<PushNotificationPrefStore>((set) => ({
    pushNotificationsEnabled: storage.read() ?? PUSH_NOTIFICATIONS_DEFAULT_ENABLED,
    setPushNotificationsEnabled: (pushNotificationsEnabled) => {
      storage.write(pushNotificationsEnabled)
      set({ pushNotificationsEnabled })
    }
  }))
}

/** App-wide singleton — the one source of truth #392 reads and #409 writes, backed by the real
 *  localStorage port. */
export const pushNotificationPrefStore = createPushNotificationPrefStore(
  localStoragePushNotificationPref()
)

/** Narrow-slice React binding. Selecting a single slice avoids cross-facet re-renders. */
export function usePushNotificationPrefStore<T>(
  selector: (s: PushNotificationPrefStore) => T
): T {
  return useStore(pushNotificationPrefStore, selector)
}

/** The read surface, the sole path #392 reads before firing. There is no exposed setter beyond
 *  `setPushNotificationsEnabled`; it is the sole mutation path, never two-way-bound from a component. */
export const selectPushNotificationsEnabled = (s: PushNotificationPrefState): boolean =>
  s.pushNotificationsEnabled
