// The client-owned "last effort level used" preference (#1169), persisted locally so a new chat opens at
// the level the last one was set to instead of drawing nothing. Pure renderer state — no IPC, no preload
// bridge, no transport: an effort level is a published, non-secret display value, so it need not sit
// behind the transport boundary. This slice renders nothing (the data half). `foldWriteEvent`
// (runSettingsWriteBridge) writes it on a daemon CONFIRM, and `EffortDefaultData`'s decision reads it.
//
// A dedicated store — the app's THIRD renderer preference, after defaultWorkspaceStore (#403) and
// pushNotificationPrefStore (#408), and it mirrors their DI-factory → singleton → hook → selector shape
// verbatim. A single setter rather than a reducer: there is exactly one mutation ("record the level the
// daemon just confirmed"), so a discriminated-union action set would be a one-member union — ceremony
// without benefit. Unidirectional is preserved: read-only selector, one write path, never two-way-bound
// from a component.
//
// The DI seam is the `storage` PORT because the dependency that varies between prod and test is the
// persistence backend. The vitest runtime is `node` (no jsdom, no localStorage, no window), so a store
// reaching for window.localStorage directly could not be unit-tested and would throw on import; the
// injected port makes the persist-then-restore round trip testable with an in-memory fake.
//
// THE THIRD KEY FIRES BOTH PRECEDENTS' STANDING DEFERRAL of a shared key-namespacing helper "until a
// genuine third case", and the answer for this slice is NO. Extracting it means editing two adjacent
// modules this task does not otherwise need — squarely "don't refactor adjacent code while you are
// there" — and the key is added in the same shape as the other two instead. If the helper is wanted, it
// is its own ticket.
//
// WHAT IS STORED IS ALWAYS A LEVEL THE DAEMON PUBLISHED AND THEN CONFIRMED. Never a client-invented one
// (#988's constraint: nothing the client displays on this control is client-authored), and never a level
// it merely offered — a rejected level is not a level that was used, which is why the one writer sits on
// the confirm edge rather than on the pick.
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'

/** The persistence backend the store depends on — the injected DI seam. `read` reports what is
 *  persisted, `null` for "never set"; `write` persists a concrete level. There is no "clear" path (the
 *  only writer is a daemon confirm and no reset-to-default action exists) — the push preference's own
 *  simplification against the workspace port's null-clear. Synchronous: backs onto localStorage, whose
 *  access is synchronous. */
export interface LastEffortStorage {
  read(): string | null
  write(value: string): void
}

/** The renderer-pref key; sibling to `pyry.defaultWorkspace` and `pyry.pushNotificationsEnabled`. The
 *  const NAME is a preference, but the STRING is the contract — a rename strands every already-persisted
 *  choice, so it is pinned by a test.
 *
 *  A CONSTANT LITERAL, and that is load-bearing rather than incidental: "one remembered level app-wide"
 *  (the ticket's ruling — not per host, server, workspace or chat) is what keeps claude-authored text out
 *  of a storage-key position. A per-model key would have composed a daemon string into this name. */
export const LAST_EFFORT_KEY = 'pyry.lastEffort' as const

/**
 * The real `localStorage`-backed port, wired at the singleton composition root. The `typeof window` guard
 * is the import-safety guard: it makes constructing the singleton safe under `node`/`renderToStaticMarkup`,
 * where `read()` yields `null` (so the store starts with nothing remembered) and `write()` is a no-op. It
 * is deliberately NOT a defensive try/catch — a localStorage quota/disabled failure is not an observed
 * failure mode in the Electron renderer, and shipping a defense for an unobserved failure is
 * Evidence-Based Fix Selection's anti-pattern; if it ever surfaces, the fix is localized here.
 *
 * `''` decodes to `null`, the not-set sentinel. An empty effort is the wire's ABSENCE of a level
 * (`SessionSettingsPayload.effort`, "inherited daemon default") and never a level, so it is not a value
 * this port may hand out — the same posture `requestRunConfigSnapshot` takes on an empty conversation id.
 * The write side never emits one (`confirmedEffortLevel` refuses it), so this guards a hand-edited or
 * corrupt cell rather than anything this app writes.
 *
 * NO LENGTH BOUND, and that is a decision. A stored level is claude-authored text, but it can only leave
 * `effortDefaultToApply` by matching a level the daemon just published for this chat's model, and it
 * renders through `.composer__effort-label`'s existing escaped, ellipsized 64px bound exactly as a live
 * level does. Bounding here would be a defense for an unobserved failure mode; if one surfaces, this is
 * where it lands.
 */
export function localStorageLastEffortPref(): LastEffortStorage {
  return {
    read: () => {
      if (typeof window === 'undefined') return null
      const raw = window.localStorage.getItem(LAST_EFFORT_KEY)
      return raw === '' ? null : raw
    },
    write: (value) => {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(LAST_EFFORT_KEY, value)
    }
  }
}

/** The whole last-effort state. `lastEffort: null` is the distinct "nothing remembered" state — a fresh
 *  install, or a run in which every level so far was rejected. It is never coerced to a level: with
 *  nothing usable the control stays blank, which is #988's constraint kept intact. */
export interface LastEffortState {
  lastEffort: string | null
}

/** Store shape = state + the single mutation entry point. It lives here and NOT on `LastEffortState`, so
 *  the selector — typed against the state-only interface — cannot see it. */
export type LastEffortStore = LastEffortState & {
  setLastEffort: (value: string) => void
}

/**
 * DI-friendly, React-free store — one isolated instance per test, wired to the injected port.
 * Hydration: the persisted value once at construction (the "restore" half). Set-through:
 * `setLastEffort` persists via the port THEN records the value in state (the "persist" half), replacing
 * the whole value unconditionally — no merge, no coercion, the two precedents' order.
 */
export function createLastEffortStore(storage: LastEffortStorage) {
  return createStore<LastEffortStore>((set) => ({
    lastEffort: storage.read(),
    setLastEffort: (lastEffort) => {
      storage.write(lastEffort)
      set({ lastEffort })
    }
  }))
}

/** App-wide singleton — the one source of truth `foldWriteEvent` writes and the apply decision reads,
 *  backed by the real localStorage port. */
export const lastEffortStore = createLastEffortStore(localStorageLastEffortPref())

/** Narrow-slice React binding. Selecting a single slice avoids cross-facet re-renders. */
export function useLastEffortStore<T>(selector: (s: LastEffortStore) => T): T {
  return useStore(lastEffortStore, selector)
}

/** The only read surface. `setLastEffort` is the sole mutation path, never two-way-bound from a
 *  component. */
export const selectLastEffort = (s: LastEffortState): string | null => s.lastEffort
