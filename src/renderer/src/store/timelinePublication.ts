import { createStore } from 'zustand/vanilla'

/** Keep existing folds synchronous, but publish a group of folds as one store change. */
export function createPublishedTimelineStore<T extends object>(
  initialize: (set: (update: (state: T) => T | Partial<T>, origin?: string | null) => void, get: () => T) => T
) {
  const boundaries = new Set<() => void>()
  const writes = new Set<(state: T, previous: T, origin?: string | null) => void>()
  let staged: T | undefined
  let batchPublication: T | undefined
  let batching = false
  let batchTimeline = (run: () => void): void => { run() }
  const store = createStore<T>((publish, read) => {
    const get = (): T => {
      if (!batching) for (const boundary of boundaries) boundary()
      return staged ?? read()
    }
    const set = (update: (state: T) => T | Partial<T>, origin?: string | null): void => {
      if (!batching) {
        for (const boundary of boundaries) boundary()
        publish(update)
        return
      }
      const before = get()
      const next = update(before)
      if (!Object.is(before, next)) {
        staged = Object.assign({}, before, next)
        // Persistence sees every accepted fold, including host replacements hidden by batching.
        for (const listener of writes) listener(staged, before, origin)
      }
    }
    batchTimeline = run => {
      if (batching) { run(); return }
      batching = true
      try { run() } finally {
        const next = staged
        staged = undefined
        batching = false
        if (next !== undefined) {
          batchPublication = next
          try { publish(next, true) } finally { batchPublication = undefined }
        }
      }
    }
    return initialize(set, get)
  })
  return Object.assign(store, {
    batchTimeline: (run: () => void) => batchTimeline(run),
    subscribeTimelineWrites: (listener: (state: T, previous: T, origin?: string | null) => void) => {
      writes.add(listener)
      const off = store.subscribe((state, previous) => {
        if (state !== batchPublication) listener(state, previous)
      })
      return () => { writes.delete(listener); off() }
    },
    onBeforeTimelineMutation: (flush: () => void) => {
      boundaries.add(flush)
      return () => { boundaries.delete(flush) }
    }
  })
}
