import { describe, expect, it } from 'vitest'
import { hasRunningPhaseLabel } from './phaseReconnectEvidence'

describe('live reconnect running-status observation', () => {
  it.each(['Thinking…', 'Working…', 'Running Bash…', 'Running Bash… 12s', 'Running Bash… 1m 02s'])(
    'recognizes the existing running presentation: %s', label => {
      expect(hasRunningPhaseLabel([{ textContent: label }])).toBe(true)
    }
  )

  it('does not mistake idle or superseding notices for the held Bash turn', () => {
    expect(hasRunningPhaseLabel([])).toBe(false)
    for (const label of [null, '', 'Retrying…', 'Compacting…', 'Resetting…', 'Running Read…']) {
      expect(hasRunningPhaseLabel([{ textContent: label }])).toBe(false)
    }
  })
})
