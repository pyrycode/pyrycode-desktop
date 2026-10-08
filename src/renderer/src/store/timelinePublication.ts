import { createStore } from 'zustand/vanilla'

/** Keep existing folds synchronous, but publish a group of folds as one store change. */
export function createPublishedTimelineStore<T extends object>(
  initialize: (set: (update: (state: T) => T | Partial<T>) => void, get: () => T) => T
) {
  const boundaries = new Set<() => void>()
  let staged: T | undefined
  let batching = false
  let batchTimeline = (run: () => void): void => { run() }
  const store = createStore<T>((publish, read) => {
    const get = (): T => {
      if (!batching) for (const boundary of boundaries) boundary()
      return staged ?? read()
    }
    const set = (update: (state: T) => T | Partial<T>): void => {
      if (!batching) {
        for (const boundary of boundaries) boundary()
        publish(update)
        return
      }
      const before = get()
      const next = update(before)
      if (!Object.is(before, next)) staged = Object.assign({}, before, next)
    }
    batchTimeline = run => {
      if (batching) { run(); return }
      batching = true
      try { run() } finally {
        const next = staged
        staged = undefined
        batching = false
        if (next !== undefined) publish(next, true)
      }
    }
    return initialize(set, get)
  })
  return Object.assign(store, {
    batchTimeline: (run: () => void) => batchTimeline(run),
    onBeforeTimelineMutation: (flush: () => void) => {
      boundaries.add(flush)
      return () => { boundaries.delete(flush) }
    }
  })
}
