import { createScriptedThread } from './scriptedThread'
import type { createCanonicalThread } from './canonicalThread'

export type ThreadPublisherOptions =
  | { threadMode: 'canonical'; thread: ReturnType<typeof createCanonicalThread> }
  | { threadMode?: 'scripted' | 'native'; thread?: never }

/** Keep selection testable without starting Playwright or constructing the legacy adapter. */
export function selectThreadPublisher(options: ThreadPublisherOptions, history: boolean,
  scripted = createScriptedThread) {
  return options.threadMode === 'canonical' ? options.thread
    : options.threadMode === 'native' ? undefined : scripted({ history })
}
