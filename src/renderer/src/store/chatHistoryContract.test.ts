import { expectTypeOf, it } from 'vitest'
import type { DurableThreadItem } from '../../../shared/chatHistory'
import type { TurnEndMetrics } from '../../../shared/ipc/events'
import type { ThreadItem } from './threadTimeline'

// #1565: a turn boundary's token counts, duration and session cost are live-only. The durable row
// deliberately does not persist them, so the guard compares against the renderer row without them.
// #1621: an offered file is live-only as a whole row — `chatHistoryWriter` filters it out before saving.
type PersistedThreadItem =
  | Exclude<ThreadItem, { kind: 'turnBoundary' | 'attachmentOffer' }>
  | Omit<Extract<ThreadItem, { kind: 'turnBoundary' }>, keyof TurnEndMetrics>

it('keeps the durable row contract compatible with every current renderer row', () => {
  expectTypeOf<DurableThreadItem>().toEqualTypeOf<PersistedThreadItem>()
})
