import { describe, it, expect } from 'vitest'
import { DAEMON_EVENT_CHANNEL } from './events'

describe('daemon event channel', () => {
  it('pins the IPC channel string both process sides depend on', () => {
    // The emit helper sends on this channel and the preload subscribes to it; a drift
    // between the two would silently drop every event. Pin it like the wire constants.
    expect(DAEMON_EVENT_CHANNEL).toBe('pyry:daemon-event')
  })
})
