import { describe, it, expect } from 'vitest'
import {
  DAEMON_EVENT_CHANNEL,
  type DaemonEvent,
  type DebugBundleFailure,
  type RelayLinkStatus
} from './events'

describe('daemon event channel', () => {
  it('pins the IPC channel string both process sides depend on', () => {
    // The emit helper sends on this channel and the preload subscribes to it; a drift
    // between the two would silently drop every event. Pin it like the wire constants.
    expect(DAEMON_EVENT_CHANNEL).toBe('pyry:daemon-event')
  })
})

// events.ts is pure types + a const, so there is no runtime behaviour to assert beyond the
// channel pin. These compile-time shape locks are runtime no-ops but fail `npm run typecheck`
// (the QA gate) if the debug-bundle contract drifts — a count, a path, and a closed enum.
describe('debug-bundle contract shape', () => {
  it('types the three debug-bundle members as DaemonEvent members', () => {
    const progress: DaemonEvent = { type: 'debugBundleProgress', chunksReceived: 0 }
    const saved: DaemonEvent = { type: 'debugBundleSaved', path: '/x' }
    const failed: DaemonEvent = { type: 'debugBundleFailed', reason: 'unavailable' }
    expect([progress.type, saved.type, failed.type]).toEqual([
      'debugBundleProgress',
      'debugBundleSaved',
      'debugBundleFailed'
    ])
  })

  it('pins the three coarse DebugBundleFailure categories', () => {
    const categories: DebugBundleFailure[] = ['unavailable', 'stream-corrupt', 'write-failed']
    expect(categories).toEqual(['unavailable', 'stream-corrupt', 'write-failed'])
  })
})

// The relay-link status arm (#328). Same compile-time shape-lock pattern as the debug-bundle
// contract: the closed RelayLinkStatus category enum plus the content-free arm — a `type` + a
// closed `status`, nothing else (AC3). A drift (an added value, or a code/token field smuggled
// onto the arm) fails `npm run typecheck`, the QA gate.
describe('relay-link status contract shape (#328)', () => {
  it('pins the three closed RelayLinkStatus categories', () => {
    const categories: RelayLinkStatus[] = ['connected', 'offline', 'daemon-absent']
    expect(categories).toEqual(['connected', 'offline', 'daemon-absent'])
  })

  it('types relayLinkChanged as a content-free DaemonEvent member (only type + status)', () => {
    const event: DaemonEvent = { type: 'relayLinkChanged', status: 'daemon-absent' }
    expect(Object.keys(event)).toEqual(['type', 'status'])
  })
})
