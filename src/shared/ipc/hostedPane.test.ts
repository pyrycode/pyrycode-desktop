import { describe, it, expect } from 'vitest'
import { isHostedPaneCommand } from './hostedPane'

describe('hosted pane command boundary', () => {
  it('admits only bounded selection and generation-scoped controls', () => {
    expect(isHostedPaneCommand({ type: 'select', serverId: 'paired-host', appId: '22222222-2222-4222-8222-222222222222' })).toBe(true)
    for (const value of [null, [], {}, { type: 'select', serverId: '', appId: 'wrong' },
      { type: 'select', serverId: 'x'.repeat(10000), appId: '22222222-2222-4222-8222-222222222222' },
      { type: 'close', generation: -1 }, { type: 'close', generation: 1, extra: true },
      { type: 'layout', generation: 1, visible: true, bounds: { x: NaN, y: 0, width: 1, height: 1 } },
      { type: 'layout', generation: 1, visible: true, bounds: { x: 0, y: 0, width: -1, height: 1 } }])
      expect(isHostedPaneCommand(value)).toBe(false)
    expect(isHostedPaneCommand({ type: 'layout', generation: 1, visible: false,
      bounds: { x: 440, y: 100, width: 300, height: 400 } })).toBe(true)
  })
})
