import { expectTypeOf, it } from 'vitest'
import type { DurableThreadItem } from '../../../shared/chatHistory'
import type { ThreadItem } from './threadTimeline'

it('keeps the durable row contract compatible with every current renderer row', () => {
  expectTypeOf<DurableThreadItem>().toEqualTypeOf<ThreadItem>()
})
