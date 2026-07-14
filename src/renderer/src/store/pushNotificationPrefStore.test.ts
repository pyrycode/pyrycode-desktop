import { describe, it, expect, vi } from 'vitest'
import {
  createPushNotificationPrefStore,
  localStoragePushNotificationPref,
  selectPushNotificationsEnabled,
  encodePushPref,
  decodePushPref,
  PUSH_NOTIFICATIONS_ENABLED_KEY,
  PUSH_NOTIFICATIONS_DEFAULT_ENABLED,
  type PushNotificationPrefStorage
} from './pushNotificationPrefStore'

// Plain-function store tests over isolated createPushNotificationPrefStore() instances — the
// defaultWorkspaceStore.test idiom. No React, no DOM: the store is pure renderer state with a single
// set-through mutation. The persistence backend is an injected PushNotificationPrefStorage port, so the
// persist-then-restore round-trip is testable under the `node` runtime with no localStorage/window.

// A closure over a mutable `boolean | null`, exposing read/write — the in-memory fake port. `read`/`write`
// are vi spies so the "persist" half is observable; `write` also mutates the backing value so a second
// store constructed over the SAME fake hydrates what the first wrote (the simulated restart). The fake
// stores the DECODED `boolean | null` directly (modeling the port's output contract), so it exercises the
// store's default-mapping without touching string encode/decode — those are unit-tested separately below.
function fakeStorage(seed: boolean | null = null): PushNotificationPrefStorage {
  let value = seed
  return {
    read: vi.fn((): boolean | null => value),
    write: vi.fn((next: boolean): void => {
      value = next
    })
  }
}

describe('pushNotificationPrefStore', () => {
  it('defaults to enabled when storage is empty — fresh install (AC1/AC2)', () => {
    const store = createPushNotificationPrefStore(fakeStorage())
    expect(store.getState().pushNotificationsEnabled).toBe(true)
    expect(selectPushNotificationsEnabled(store.getState())).toBe(true)
  })

  it('honors a persisted false at construction — not re-defaulted (AC1/AC4)', () => {
    const storage = fakeStorage(false)
    const store = createPushNotificationPrefStore(storage)
    expect(selectPushNotificationsEnabled(store.getState())).toBe(false)
    expect(storage.read).toHaveBeenCalledTimes(1)
  })

  it('honors a persisted true at construction', () => {
    const store = createPushNotificationPrefStore(fakeStorage(true))
    expect(selectPushNotificationsEnabled(store.getState())).toBe(true)
  })

  it('setPushNotificationsEnabled records the value; the selector returns it (AC4 write-then-read)', () => {
    const store = createPushNotificationPrefStore(fakeStorage())
    store.getState().setPushNotificationsEnabled(false)
    expect(selectPushNotificationsEnabled(store.getState())).toBe(false)
  })

  it('setPushNotificationsEnabled persists through the port — the persist half (AC3)', () => {
    const storage = fakeStorage()
    const store = createPushNotificationPrefStore(storage)
    store.getState().setPushNotificationsEnabled(false)
    expect(storage.write).toHaveBeenCalledWith(false)
  })

  it('survives a simulated restart — a disabled choice stays disabled (AC4-critical)', () => {
    const storage = fakeStorage()
    const a = createPushNotificationPrefStore(storage)
    a.getState().setPushNotificationsEnabled(false)
    // Fresh store over the SAME backend = a restart: it reads back what `a` persisted, NOT the enabled
    // default — the "explicitly toggled off stays off" guarantee.
    const b = createPushNotificationPrefStore(storage)
    expect(selectPushNotificationsEnabled(b.getState())).toBe(false)
  })

  it('survives a simulated restart — an enabled choice stays enabled (AC4)', () => {
    const storage = fakeStorage(false)
    const a = createPushNotificationPrefStore(storage)
    a.getState().setPushNotificationsEnabled(true)
    const b = createPushNotificationPrefStore(storage)
    expect(selectPushNotificationsEnabled(b.getState())).toBe(true)
  })

  it('keeps two stores over independent ports isolated (DI)', () => {
    const a = createPushNotificationPrefStore(fakeStorage())
    const b = createPushNotificationPrefStore(fakeStorage())
    a.getState().setPushNotificationsEnabled(false)
    expect(selectPushNotificationsEnabled(a.getState())).toBe(false)
    expect(selectPushNotificationsEnabled(b.getState())).toBe(true)
  })

  it('keeps the setPushNotificationsEnabled reference stable across updates', () => {
    const store = createPushNotificationPrefStore(fakeStorage())
    const before = store.getState().setPushNotificationsEnabled
    store.getState().setPushNotificationsEnabled(false)
    expect(store.getState().setPushNotificationsEnabled).toBe(before)
  })
})

describe('encodePushPref / decodePushPref', () => {
  // The Delta-2 coverage the `node` runtime cannot reach through the real port (window is undefined, so
  // the real read() short-circuits to null). Unit-testing the coercion directly pins the
  // not-set-vs-stored-`false` distinction the real port's getItem decode depends on.
  it('decodes exactly the two values encode emits; everything else is null (never set)', () => {
    expect(decodePushPref(null)).toBeNull()
    expect(decodePushPref('false')).toBe(false)
    expect(decodePushPref('true')).toBe(true)
    expect(decodePushPref('garbage')).toBeNull()
  })

  it('round-trips every boolean through encode then decode', () => {
    expect(decodePushPref(encodePushPref(true))).toBe(true)
    expect(decodePushPref(encodePushPref(false))).toBe(false)
  })
})

describe('localStoragePushNotificationPref', () => {
  it('uses the namespaced storage key', () => {
    expect(PUSH_NOTIFICATIONS_ENABLED_KEY).toBe('pyry.pushNotificationsEnabled')
  })

  it('exposes the enabled default as a single source of truth', () => {
    expect(PUSH_NOTIFICATIONS_DEFAULT_ENABLED).toBe(true)
  })

  // Under the `node` test runtime there is no `window`; the import-safety guard makes read() return null
  // and write() a no-op, so constructing the singleton over the real backend is safe (no ReferenceError).
  it('is a safe no-op when window is absent (import-safety guard)', () => {
    const pref = localStoragePushNotificationPref()
    expect(pref.read()).toBeNull()
    expect(() => pref.write(true)).not.toThrow()
  })
})
